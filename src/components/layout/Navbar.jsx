import { Moon, Sun, LayoutDashboard, Settings as SettingsIcon, LogOut } from 'lucide-react';
import { APP_NAME, APP_TAGLINE } from '../../utils/constants';

export default function Navbar({ view, setView, theme, toggleTheme, user, onSignOut }) {
  return (
    <header className="topbar">
      <div className="brand">
        <h1>{APP_NAME}<span className="dot">.</span></h1>
        <span className="tag">{APP_TAGLINE}</span>
      </div>
      <nav className="navbtns" aria-label="Main">
        <button
          className={`pill ${view === 'dashboard' ? 'active' : ''}`}
          onClick={() => setView('dashboard')}
          aria-current={view === 'dashboard' ? 'page' : undefined}
        >
          <LayoutDashboard size={15} /> Dashboard
        </button>
        <button
          className={`pill ${view === 'settings' ? 'active' : ''}`}
          onClick={() => setView('settings')}
          aria-current={view === 'settings' ? 'page' : undefined}
        >
          <SettingsIcon size={15} /> Settings
        </button>
        <button className="pill" onClick={toggleTheme} aria-label="Toggle color theme">
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        {user && onSignOut && (
          <button className="pill" onClick={onSignOut} aria-label={`Sign out ${user.email || ''}`} title={user.email || 'Sign out'}>
            <LogOut size={15} />
          </button>
        )}
      </nav>
    </header>
  );
}
