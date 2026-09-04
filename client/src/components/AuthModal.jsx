import { useEffect, useState } from 'react';

// Sign in / create account. Deliberately optional: the game is fully playable
// without ever opening this, and the copy says so rather than nagging.
export default function AuthModal({ mode = 'login', account, error, busy, onLogin, onSignup, onClose, onClearError }) {
  const [tab, setTab] = useState(mode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);

  // A successful sign-in sets the account name, which is our cue to close.
  useEffect(() => {
    if (account) onClose();
  }, [account, onClose]);

  const switchTab = (next) => {
    setTab(next);
    onClearError?.();
  };

  const submit = (e) => {
    e.preventDefault();
    const u = username.trim();
    if (!u || !password || busy) return;
    if (tab === 'signup') onSignup(u, password);
    else onLogin(u, password);
  };

  const canSubmit = username.trim().length >= 3 && password.length >= (tab === 'signup' ? 8 : 1) && !busy;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel auth-panel" onClick={(e) => e.stopPropagation()}>
        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'login'}
            className={`auth-tab ${tab === 'login' ? 'active' : ''}`}
            onClick={() => switchTab('login')}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'signup'}
            className={`auth-tab ${tab === 'signup' ? 'active' : ''}`}
            onClick={() => switchTab('signup')}
          >
            Create account
          </button>
        </div>

        <p className="auth-blurb">
          {tab === 'signup'
            ? 'Keeps your coins, stats and streak when you switch device. Everything you have earned so far comes with you.'
            : 'Sign in to pick up your coins and stats on this device.'}
        </p>

        <form onSubmit={submit}>
          <label className="auth-label" htmlFor="auth-username">
            Username
          </label>
          <input
            id="auth-username"
            className="auth-input"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            maxLength={20}
            placeholder="3-20 characters"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />

          <label className="auth-label" htmlFor="auth-password">
            Password
          </label>
          <div className="auth-password-row">
            <input
              id="auth-password"
              className="auth-input"
              type={show ? 'text' : 'password'}
              autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
              maxLength={200}
              placeholder={tab === 'signup' ? 'at least 8 characters' : 'your password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="auth-reveal"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              {show ? 'Hide' : 'Show'}
            </button>
          </div>

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button type="submit" className="auth-submit" disabled={!canSubmit}>
            {busy ? 'Working…' : tab === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <button type="button" className="auth-skip" onClick={onClose}>
          Not now — keep playing as a guest
        </button>
      </div>
    </div>
  );
}
