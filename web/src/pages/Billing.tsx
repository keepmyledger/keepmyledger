import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { colors, radii, shadows } from '../styles/tokens';

type BillingStatus = {
  status: string | null;
  plan: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  daysRemaining: number | null;
  hasPaymentMethod: boolean;
};

const card: React.CSSProperties = {
  background: colors.warmWhite, border: `1px solid ${colors.softLine}`,
  borderRadius: radii.md, padding: 24, boxShadow: shadows.card, maxWidth: 560,
};

const label: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: colors.mutedGray,
  textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
};

const value: React.CSSProperties = {
  fontSize: 18, fontWeight: 600, color: colors.darkSlate,
};

function statusBadge(status: string | null): React.ReactNode {
  if (!status) return null;
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    trialing:   { bg: colors.warningBg,  fg: colors.warningFg,  label: 'Trial' },
    active:     { bg: colors.successBg,  fg: colors.successFg,  label: 'Active' },
    past_due:   { bg: colors.dangerBg,   fg: colors.dangerFg,   label: 'Past Due' },
    canceled:   { bg: colors.dangerBg,   fg: colors.dangerFg,   label: 'Canceled' },
    incomplete: { bg: colors.warningBg,  fg: colors.warningFg,  label: 'Incomplete' },
  };
  const s = map[status] ?? { bg: colors.cream, fg: colors.mutedGray, label: status };
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 99,
      background: s.bg, color: s.fg, fontWeight: 600, fontSize: 13,
    }}>
      {s.label}
    </span>
  );
}

export function BillingPage() {
  const { config } = useAuth();
  const [data, setData] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (config?.mode !== 'saas') { setLoading(false); return; }
    let cancelled = false;
    api.billing.status()
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e: unknown) => { if (!cancelled) { setError((e as Error).message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [config?.mode]);

  if (config?.mode !== 'saas') {
    return (
      <div>
        <h1 style={{ fontSize: 26, color: colors.ledgerGreen, fontFamily: '"Bree Serif", "Merriweather", Georgia, serif', marginBottom: 8 }}>
          Billing
        </h1>
        <p style={{ color: colors.mutedGray }}>
          Billing is not applicable in self-hosted mode. You have unlimited access.
        </p>
        <p><Link to="/dashboard" style={{ color: colors.forestGreen }}>← Back to Dashboard</Link></p>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: 48, color: colors.mutedGray }}>Loading…</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 24, color: colors.dangerFg, background: colors.dangerBg, borderRadius: radii.md }}>
        {error}
      </div>
    );
  }

  const trialDate = data?.trialEndsAt ? new Date(data.trialEndsAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : null;

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 26, color: colors.ledgerGreen, fontFamily: '"Bree Serif", "Merriweather", Georgia, serif', marginBottom: 4 }}>
        Billing
      </h1>
      <p style={{ color: colors.mutedGray, marginTop: 0, marginBottom: 24 }}>
        Manage your subscription and payment method.
      </p>

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 32px', marginBottom: 24 }}>
          <div>
            <p style={label}>Status</p>
            <p style={{ margin: 0 }}>{statusBadge(data?.status ?? null)}</p>
          </div>
          <div>
            <p style={label}>Plan</p>
            <p style={{ ...value, margin: 0 }}>{data?.plan ? data.plan.charAt(0).toUpperCase() + data.plan.slice(1) : '—'}</p>
          </div>
          {data?.status === 'trialing' && trialDate && (
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={label}>Trial ends</p>
              <p style={{ ...value, margin: 0, color: (data.daysRemaining ?? 99) < 3 ? colors.dangerFg : colors.darkSlate }}>
                {trialDate}
                {data.daysRemaining !== null && (
                  <span style={{ fontWeight: 400, fontSize: 14, color: colors.mutedGray, marginLeft: 8 }}>
                    ({data.daysRemaining} {data.daysRemaining === 1 ? 'day' : 'days'} remaining)
                  </span>
                )}
              </p>
            </div>
          )}
          {data?.currentPeriodEnd && (
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={label}>Current period ends</p>
              <p style={{ ...value, margin: 0 }}>
                {new Date(data.currentPeriodEnd).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          )}
        </div>

        <div style={{
          borderTop: `1px solid ${colors.softLine}`, paddingTop: 20,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div>
            <p style={label}>Payment method</p>
            <p style={{ margin: 0, color: colors.mutedGray, fontSize: 14 }}>
              {data?.hasPaymentMethod ? 'On file' : 'No payment method on file'}
            </p>
          </div>
          <button
            disabled
            style={{
              display: 'inline-block', padding: '9px 18px', borderRadius: radii.sm,
              background: colors.cream, border: `1px solid ${colors.softLine}`,
              color: colors.mutedGray, fontSize: 14, cursor: 'not-allowed', alignSelf: 'flex-start',
            }}
            title="Coming soon"
          >
            Add payment method — Coming soon
          </button>
        </div>
      </div>

      <p style={{ marginTop: 20 }}>
        <Link to="/dashboard" style={{ color: colors.forestGreen, fontSize: 14 }}>← Back to Dashboard</Link>
      </p>
    </div>
  );
}
