import React, { useState } from 'react';
import { Link } from 'react-router-dom';
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

export function ForgotPasswordPage() {
  useDocumentTitle('Forgot password');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.auth.local.forgotPassword(email.trim());
    } catch {
      // Always show success; don't leak whether email exists
    } finally {
      setLoading(false);
      setSubmitted(true);
    }
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
          Reset your password
        </h1>

        {submitted ? (
          <>
            <p style={{ color: colors.mutedGray, lineHeight: 1.6, margin: '16px 0' }}>
              If an account exists for <strong>{email}</strong>, we've sent a reset link.
              Check your inbox. The link expires in 1 hour.
            </p>
            <p style={{ color: colors.mutedGray, fontSize: 14, margin: '8px 0 0' }}>
              <Link to="/login" style={{ color: colors.forestGreen, fontWeight: 500 }}>
                Back to sign in
              </Link>
            </p>
          </>
        ) : (
          <>
            <p style={{ color: colors.mutedGray, fontSize: 14, lineHeight: 1.6, margin: '8px 0 24px' }}>
              Enter the email address for your account and we'll send you a reset link.
            </p>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 14, fontWeight: 500, color: colors.darkSlate }}>
                Email address
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                  style={inputStyle}
                />
              </label>
              <button
                type="submit"
                disabled={loading || !email.trim()}
                style={{
                  padding: '12px 16px', borderRadius: radii.sm, border: 'none',
                  background: loading || !email.trim() ? colors.mutedGray : colors.forestGreen,
                  color: '#fff', fontWeight: 600, fontSize: 15,
                  cursor: loading || !email.trim() ? 'not-allowed' : 'pointer',
                  opacity: loading || !email.trim() ? 0.6 : 1,
                }}
              >
                {loading ? 'Sending…' : 'Send reset link'}
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
