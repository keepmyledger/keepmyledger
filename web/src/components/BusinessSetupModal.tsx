import React, { useEffect, useState } from 'react';
import type { Business } from '@keepmyledger/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { colors, radii } from '../styles/tokens';

const PLACEHOLDER_REJECTION_MESSAGE =
  "'Personal' isn't a business name. Try something like 'Acme LLC' or 'Jane Smith Consulting'.";

export function isPlaceholderBusinessName(name: string): boolean {
  return name.trim().toLowerCase() === 'personal';
}

export function BusinessSetupModal() {
  const { orgId, businessId, businesses, refresh } = useAuth();
  const active: Business | undefined = businesses.find((b) => b.id === businessId);
  const needsSetup = !!active && isPlaceholderBusinessName(active.name);

  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset draft state whenever the active business changes (e.g. user switches biz).
  useEffect(() => {
    if (!needsSetup) {
      setValue('');
      setError(null);
    }
  }, [needsSetup, active?.id]);

  if (!needsSetup || !orgId || !active) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Business name is required');
      return;
    }
    if (isPlaceholderBusinessName(trimmed)) {
      setError(PLACEHOLDER_REJECTION_MESSAGE);
      return;
    }
    setSubmitting(true);
    try {
      await api.businesses.rename(orgId!, active!.id, trimmed);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-labelledby="business-setup-title">
      <form style={modal} onSubmit={handleSubmit}>
        <h2 id="business-setup-title" style={{ marginTop: 0, color: colors.darkSlate }}>
          Name your business
        </h2>
        <p style={{ color: colors.darkSlate, lineHeight: 1.5 }}>
          KeepMyLedger is built for businesses. <strong>&quot;Personal&quot;</strong> is just a
          placeholder &mdash; tell us what to call your books.
        </p>
        <label style={labelStyle}>
          Business name
          <input
            autoFocus
            type="text"
            autoComplete="organization"
            placeholder="e.g. Acme LLC, Jane Smith Consulting"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={100}
            style={inputStyle}
          />
        </label>
        {error && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B',
            padding: '10px 12px', borderRadius: radii.sm, fontSize: 13, marginTop: 12,
          }}>{error}</div>
        )}
        <div style={{ textAlign: 'right', marginTop: 18 }}>
          <button
            type="submit"
            disabled={submitting || !value.trim()}
            style={{
              padding: '10px 18px', borderRadius: radii.sm, border: 'none',
              background: submitting || !value.trim() ? colors.mutedGray : colors.forestGreen,
              color: '#fff', fontWeight: 600, fontSize: 15,
              cursor: submitting || !value.trim() ? 'not-allowed' : 'pointer',
              opacity: submitting || !value.trim() ? 0.6 : 1,
            }}
          >
            {submitting ? 'Saving…' : 'Save business name'}
          </button>
        </div>
      </form>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(43, 43, 43, 0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
};
const modal: React.CSSProperties = {
  background: colors.warmWhite, borderRadius: 14, padding: '24px 32px',
  minWidth: 360, maxWidth: 520, width: '90%',
  boxShadow: '0 12px 40px rgba(31,41,32,0.22)',
  border: `1px solid ${colors.softLine}`,
};
const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6,
  fontSize: 14, fontWeight: 500, color: colors.darkSlate, marginTop: 8,
};
const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: `1px solid ${colors.softLine}`,
  borderRadius: radii.sm,
  fontSize: 15,
  background: colors.warmWhite,
  width: '100%',
  boxSizing: 'border-box',
};
