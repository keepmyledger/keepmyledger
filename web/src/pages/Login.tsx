import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { colors, radii, shadows } from '../styles/tokens';

const PROVIDER_STYLES: Record<string, { bg: string; color: string; icon: string }> = {
  google:   { bg: '#fff',     color: '#3c4043', icon: 'G' },
  facebook: { bg: '#1877f2',  color: '#fff',    icon: 'f' },
  apple:    { bg: '#000',     color: '#fff',    icon: '' },
};

type Mode = 'signin' | 'register' | 'mfa';

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: `1px solid ${colors.softLine}`,
  borderRadius: radii.sm,
  fontSize: 15,
  background: colors.warmWhite,
  width: '100%',
  boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 5,
  fontSize: 14, fontWeight: 500, color: colors.darkSlate,
};
function PrimaryBtn({ children, disabled, type = 'submit', onClick }: {
  children: React.ReactNode; disabled?: boolean; type?: 'submit' | 'button'; onClick?: () => void;
}) {
  return (
    <button type={type} disabled={disabled} onClick={onClick} style={{
      padding: '12px 16px', borderRadius: radii.sm, border: 'none',
      background: disabled ? colors.mutedGray : colors.forestGreen,
      color: '#fff', fontWeight: 600, fontSize: 15,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
    }}>{children}</button>
  );
}
function GhostBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: '8px 16px', borderRadius: radii.sm, border: `1px solid ${colors.softLine}`,
      background: 'transparent', color: colors.mutedGray, fontSize: 14, cursor: 'pointer',
    }}>{children}</button>
  );
}
function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div style={{
      background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B',
      padding: '10px 12px', borderRadius: radii.sm, fontSize: 13,
    }}>{msg}</div>
  );
}

export function LoginPage() {
  const { config, refresh } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const oauthProviders = config?.providers.filter((p) => p.id !== 'local') ?? [];
  const hasLocal = config?.providers.some((p) => p.id === 'local') ?? true;

  async function handleLocalSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'register') {
        await api.auth.local.register(username.trim(), password);
      } else {
        const res = await api.auth.local.login(username.trim(), password);
        if (res.mfaRequired) { setMode('mfa'); return; }
      }
      await refresh();
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.auth.local.verifyMfa(mfaCode.replace(/\s/g, ''));
      await refresh();
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: colors.cream,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        display: 'grid', gap: 32, alignItems: 'center',
        gridTemplateColumns: 'minmax(0, 1fr)',
        width: '100%', maxWidth: 1080,
      }} className="kml-login-grid">
        <div style={{
          borderRadius: radii.lg, overflow: 'hidden',
          boxShadow: shadows.raised, background: colors.ledgerGreen,
          aspectRatio: '3 / 2',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}>
          <div style={{ color: colors.warmWhite, textAlign: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 28 }}>KeepMyLedger</h2>
            <p style={{ marginTop: 10, marginBottom: 0, opacity: 0.9 }}>
              Self-hosted finance tracking for people and small teams.
            </p>
          </div>
        </div>

        <div style={{
          background: colors.warmWhite, borderRadius: radii.lg,
          padding: '40px 32px', boxShadow: shadows.raised, border: `1px solid ${colors.softLine}`,
        }}>
          {/* ── MFA step ───────────────────────────────────────────────── */}
          {mode === 'mfa' ? (
            <>
              <h1 style={{ margin: 0, fontSize: 22, color: colors.ledgerGreen, textAlign: 'center' }}>
                Two-factor verification
              </h1>
              <p style={{ color: colors.mutedGray, textAlign: 'center', marginTop: 8, marginBottom: 24 }}>
                Enter the 6-digit code from your authenticator app.
              </p>
              <form onSubmit={handleMfaSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <label style={labelStyle}>
                  Authenticator code
                  <input
                    type="text" inputMode="numeric" autoComplete="one-time-code"
                    maxLength={7} placeholder="123 456"
                    value={mfaCode} onChange={(e) => setMfaCode(e.target.value)}
                    style={{ ...inputStyle, textAlign: 'center', letterSpacing: 4, fontSize: 22 }}
                    autoFocus
                  />
                </label>
                {error && <ErrorBanner msg={error} />}
                <PrimaryBtn disabled={loading || mfaCode.replace(/\s/g, '').length < 6}>
                  {loading ? 'Verifying…' : 'Verify'}
                </PrimaryBtn>
                <GhostBtn onClick={() => { setMode('signin'); setMfaCode(''); setError(null); }}>
                  ← Back to sign in
                </GhostBtn>
              </form>
            </>
          ) : (
            <>
              <h1 style={{ margin: 0, fontSize: 24, color: colors.ledgerGreen, textAlign: 'center' }}>
                {mode === 'register' ? 'Create an account' : 'Sign in to continue'}
              </h1>
              <p style={{ color: colors.mutedGray, textAlign: 'center', marginTop: 8, marginBottom: 28 }}>
                {mode === 'register' ? 'No email required.' : 'Choose a provider to get started.'}
              </p>

              {config?.providers.length === 0 && (
                <div style={{
                  background: colors.warningBg, border: `1px solid ${colors.goldSoft}`, color: colors.warningFg,
                  padding: 12, borderRadius: radii.sm, fontSize: 14,
                }}>
                  No authentication providers are configured.
                </div>
              )}

              {/* OAuth buttons (sign-in only) */}
              {mode === 'signin' && oauthProviders.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {oauthProviders.map((p) => {
                    const s = PROVIDER_STYLES[p.id] ?? { bg: colors.forestGreen, color: '#fff', icon: '•' };
                    return (
                      <a key={p.id} href={api.auth.loginUrl(p.id)} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                        padding: '12px 16px', borderRadius: radii.sm, textDecoration: 'none',
                        background: s.bg, color: s.color, fontWeight: 600, fontSize: 15,
                        border: p.id === 'google' ? `1px solid ${colors.surfaceLine}` : 'none',
                      }}>
                        <span style={{ fontSize: 18, fontWeight: 700, width: 20, textAlign: 'center' }}>{s.icon}</span>
                        Continue with {p.label}
                      </a>
                    );
                  })}
                </div>
              )}

              {/* Divider */}
              {mode === 'signin' && oauthProviders.length > 0 && hasLocal && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  margin: '20px 0', color: colors.mutedGray, fontSize: 13,
                }}>
                  <div style={{ flex: 1, height: 1, background: colors.softLine }} />
                  or sign in with username
                  <div style={{ flex: 1, height: 1, background: colors.softLine }} />
                </div>
              )}

              {/* Local auth form */}
              {hasLocal && (
                <form onSubmit={handleLocalSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <label style={labelStyle}>
                    Username
                    <input
                      type="text"
                      autoComplete="username"
                      placeholder="your_username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      style={inputStyle}
                    />
                  </label>
                  <label style={labelStyle}>
                    Password
                    <input
                      type="password"
                      autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                      placeholder={mode === 'register' ? 'Minimum 8 characters' : '••••••••'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      style={inputStyle}
                    />
                  </label>
                  {mode === 'register' && (
                    <p style={{ fontSize: 12, color: colors.mutedGray, margin: 0 }}>
                      No email required. There is no password recovery — save it somewhere safe.
                    </p>
                  )}
                  {error && <ErrorBanner msg={error} />}
                  <PrimaryBtn disabled={loading || !username.trim() || !password}>
                    {loading
                      ? (mode === 'register' ? 'Creating account…' : 'Signing in…')
                      : (mode === 'register' ? 'Create account' : 'Sign in')}
                  </PrimaryBtn>
                  <GhostBtn onClick={() => { setMode(mode === 'signin' ? 'register' : 'signin'); setError(null); }}>
                    {mode === 'signin' ? 'Create a new account' : 'Already have an account? Sign in'}
                  </GhostBtn>
                </form>
              )}
            </>
          )}

          <p style={{ marginTop: 24, textAlign: 'center', fontSize: 13, color: colors.mutedGray }}>
            Sign in to continue.
          </p>
        </div>
      </div>
    </div>
  );
}
