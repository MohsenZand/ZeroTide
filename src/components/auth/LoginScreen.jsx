import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { signInWithGoogle } from '../../config/firebase';
import { APP_NAME, APP_TAGLINE } from '../../utils/constants';

export default function LoginScreen({ notAllowedEmail, onSignOut }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setError('');
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err.code === 'auth/popup-closed-by-user' ? '' : (err.message || 'Sign-in failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>{APP_NAME}<span style={{ color: 'var(--wave)' }}>.</span></h1>
        <p className="login-tag">{APP_TAGLINE}</p>

        {notAllowedEmail ? (
          <>
            <p className="login-msg">
              You’re signed in as <b>{notAllowedEmail}</b>, but this ZeroTide is private to its owner.
            </p>
            <button className="btn btn-ghost" onClick={onSignOut}>Sign out &amp; try another account</button>
          </>
        ) : (
          <>
            <p className="login-msg">This is a private ZeroTide. Sign in to continue.</p>
            <button className="btn btn-primary login-btn" onClick={signIn} disabled={busy}>
              <LogIn size={16} /> {busy ? 'Signing in…' : 'Sign in with Google'}
            </button>
          </>
        )}
        {error && <div className="err" style={{ marginTop: 14 }}>{error}</div>}
      </div>
    </div>
  );
}
