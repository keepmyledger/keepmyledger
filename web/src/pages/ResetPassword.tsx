import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { colors, radii, shadows } from '../styles/tokens';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: `1px solid ${colors.softLine}`,
  borderRadius: radii.sm,
  fontSize: 15,
  background: colors.warmWhite,
  width: '100%',
  boxSizing: 'border-box',
};

export function ResetPasswordPage() {
  useDocumentTitle('Reset password');
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await api.auth.local.resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div style={{
        minHeight: '100vh', background: colors.cream,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px',
      }}>
        <div style={{
          background: colors.warmWhite, borderRadius: radii.lg,
          boxShadow: shadows.card, padding: '40px 36px',
          width: '100%', maxWidth: 400,
        }}>
          <h1 style={{ margin: '0 0 16px', fontSize: 22, color: colors.darkSlate }}>Invalid link</h1>
          <p style={{ color: colors.mutedGray, lineHeight: 1.6 }}>
            This reset link is missing a token. Please request a new one.
          </p>
          <p style={{ marginTop: 16 }}>
            <Link to="/forgot-password" style={{ color: colors.forestGreen, fontWeight: 500 }}>
              Request a new reset link
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh', background: colors.cream,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px',
    }}>
      <div style={{
        background: colors.warmWhite, borderRadius: radii.lg,
        boxShadow: shadows.card, padding: '40px 36px',
        width: '100%', maxWidth: 400,
      }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 22, color: colors.darkSlate }}>
          Set a new password
        </h1>

        {done ? (
          <>
            <p style={{ color: '#166534', background: '#F0FDF4', border: '1px solid #BBF7D0', padding: '10px 12px', borderRadius: radii.sm, margin: '16px 0', fontSize: 14 }}>
              Password updated! Redirecting you to sign in…
            </p>
          </>
        ) : (
          <>
            <p style={{ color: colors.mutedGray, fontSize: 14, lineHeight: 1.6, margin: '8px 0 24px' }}>
              Choose a strong password, at least 8 characters.
            </p>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 14, fontWeight: 500, color: colors.darkSlate }}>
                New password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                  autoFocus
                  style={inputStyle}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 14, fontWeight: 500, color: colors.darkSlate }}>
                Confirm password
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  required
                  style={{ ...inputStyle, borderColor: mismatch ? '#FCA5A5' : undefined }}
                />
                {mismatch && <span style={{ color: '#991B1B', fontSize: 13 }}>Passwords do not match</span>}
              </label>

              {error && (
                <div style={{
                  background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B',
                  padding: '10px 12px', borderRadius: radii.sm, fontSize: 13,
                }}>{error}</div>
              )}

              <button
                type="submit"
                disabled={loading || !password || !confirm || mismatch}
                style={{
                  padding: '12px 16px', borderRadius: radii.sm, border: 'none',
                  background: loading || !password || !confirm || mismatch ? colors.mutedGray : colors.forestGreen,
                  color: '#fff', fontWeight: 600, fontSize: 15,
                  cursor: loading || !password || !confirm || mismatch ? 'not-allowed' : 'pointer',
                  opacity: loading || !password || !confirm || mismatch ? 0.6 : 1,
                }}
              >
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </form>
            <p style={{ margin: '16px 0 0', fontSize: 14, color: colors.mutedGray, textAlign: 'center' }}>
              <Link to="/login" style={{ color: colors.forestGreen, fontWeight: 500 }}>
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
