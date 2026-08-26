'use client';

interface LoginScreenProps {
  passwordInput: string;
  setPasswordInput: (value: string) => void;
  loginError: string;
  onSubmit: (e: React.FormEvent) => void;
}

export default function LoginScreen({ passwordInput, setPasswordInput, loginError, onSubmit }: LoginScreenProps) {
  return (
    <div className="login-overlay">
      <form onSubmit={onSubmit} className="login-card">
        <div className="login-logo">🔒</div>
        <h2 style={{ marginBottom: '0.5rem', fontWeight: 800 }}>AI Diet Maker</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
          Enter the password to access your diet dashboard
        </p>

        <div className="form-group" style={{ textAlign: 'left' }}>
          <label className="form-label" htmlFor="appPassword">Password</label>
          <input
            type="password"
            id="appPassword"
            name="appPassword"
            autoComplete="current-password"
            className="form-input"
            style={{ padding: '0.75rem 1rem' }}
            placeholder="••••••••"
            value={passwordInput}
            onChange={e => setPasswordInput(e.target.value)}
            required
          />
        </div>

        {loginError && (
          <div style={{ color: 'var(--accent-rose)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            {loginError}
          </div>
        )}

        <button type="submit" className="btn-primary" style={{ marginTop: '0.5rem' }}>
          Unlock Dashboard
        </button>
      </form>
    </div>
  );
}
