import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { colors, radii, shadows } from '../styles/tokens';

/**
 * AcceptInvitePage — public route at /invite/:token.
 *
 * When an authenticated user lands here, the server validates the token and
 * adds them to the org. Unauthenticated users are redirected to /login with
 * a `next` parameter so they return here after signing in.
 */

const BASE = '/api';

export function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) return;
    if (!user) {
      // Redirect to login and come back here after.
      navigate(`/login?next=/invite/${token}`, { replace: true });
      return;
    }
    if (state !== 'idle') return;

    setState('loading');
    fetch(`${BASE}/invites/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
          throw new Error(body.error ?? res.statusText);
        }
        // Refresh auth context so new org+business appear.
        await refresh();
        setState('success');
        setMessage('You have joined the org! Redirecting…');
        setTimeout(() => navigate('/dashboard', { replace: true }), 2000);
      })
      .catch((err: unknown) => {
        setState('error');
        setMessage(err instanceof Error ? err.message : 'Failed to accept invite.');
      });
  }, [token, user, state, navigate, refresh]);

  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: colors.warmWhite,
          border: `1px solid ${colors.surfaceLine}`,
          borderRadius: radii.md,
          padding: '40px 48px',
          boxShadow: shadows.raised,
          textAlign: 'center',
          maxWidth: 400,
          width: '100%',
        }}
      >
        {state === 'idle' || state === 'loading' ? (
          <>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✉️</div>
            <p style={{ color: colors.mutedGray, fontSize: 14 }}>Accepting your invite…</p>
          </>
        ) : state === 'success' ? (
          <>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🎉</div>
            <p style={{ color: colors.successFg, fontSize: 14, fontWeight: 500 }}>{message}</p>
          </>
        ) : (
          <>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
            <p style={{ color: colors.dangerFg, fontSize: 14, fontWeight: 500 }}>{message}</p>
            <button
              type="button"
              onClick={() => navigate('/dashboard', { replace: true })}
              style={{
                marginTop: 16,
                background: colors.ledgerGreen,
                color: colors.warmWhite,
                border: 'none',
                borderRadius: radii.sm,
                padding: '8px 20px',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Go to dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
