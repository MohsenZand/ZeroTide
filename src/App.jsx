import { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, signOutUser } from './config/firebase';
import { ShoppingProvider, useShopping } from './contexts/ShoppingContext';
import Navbar from './components/layout/Navbar';
import Toast from './components/common/Toast';
import LoginScreen from './components/auth/LoginScreen';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';

function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = typeof localStorage !== 'undefined' && localStorage.getItem('zerotide-theme');
    if (saved) return saved;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('zerotide-theme', theme); } catch { /* ignore */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

// Rendered only once a user is signed in. If the backend rejects them (not the
// owner), authError flips and we send them back to the login screen.
function AuthedApp({ user }) {
  const { toast, authError } = useShopping();
  const [view, setView] = useState('dashboard');
  const [theme, toggleTheme] = useTheme();

  if (authError) {
    return <LoginScreen notAllowedEmail={user.email} onSignOut={signOutUser} />;
  }

  return (
    <div className="app">
      <Navbar view={view} setView={setView} theme={theme} toggleTheme={toggleTheme}
        user={user} onSignOut={signOutUser} />
      {view === 'dashboard' ? <DashboardPage /> : <SettingsPage />}
      <Toast toast={toast} />
    </div>
  );
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u);
    setAuthLoading(false);
  }), []);

  if (authLoading) {
    return <div className="center-load"><span className="spinner" /> Loading…</div>;
  }
  if (!user) {
    // theme applied via useTheme so the login screen matches; toggle unused here.
    void theme; void toggleTheme;
    return <LoginScreen />;
  }

  return (
    <ShoppingProvider>
      <AuthedApp user={user} />
    </ShoppingProvider>
  );
}
