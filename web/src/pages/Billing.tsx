import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { SubscriptionTier } from '@keepmyledger/shared';
import { colors, radii, shadows } from '../styles/tokens';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { trackEvent } from '../lib/analytics';
import brandConfig from '@content/brand/config';

// Stripe promise (only initialised when the key is present)
const STRIPE_PK = (import.meta as unknown as { env: Record<string, string> }).env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise = STRIPE_PK ? loadStripe(STRIPE_PK) : null;

// ─── Types ────────────────────────────────────────────────────────────────────
type BillingStatus = {
  status: string | null;
  plan: string | null;
  tier: string | null;
  seats: number | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  daysRemaining: number | null;
  hasPaymentMethod: boolean;
  last4: string | null;
};

type Plan = 'monthly' | 'annual';
// Reuse the shared canonical type; free is not selectable on the billing page.
type Tier = Exclude<SubscriptionTier, 'free'>;

const TIER_LABELS: Record<Tier, string> = { business: 'Business', org: 'Organization' };
const TIER_PRICES: Record<Tier, { monthly: string; annual: string }> = {
  business: { monthly: '$9/mo', annual: '$90/yr' },
  org:      { monthly: '$29/mo + $5/seat', annual: '$290/yr + $50/seat' },
};

// Numeric prices for the GA purchase event. Mirrors the display prices above —
// keep these in sync. Org has 3 included seats; extra seats cost monthly $5 /
// annual $50.
const TIER_PRICE_USD: Record<Tier, { monthly: number; annual: number }> = {
  business: { monthly: 9, annual: 90 },
  org:      { monthly: 29, annual: 290 },
};
const ORG_EXTRA_SEAT_USD: { monthly: number; annual: number } = { monthly: 5, annual: 50 };
const ORG_INCLUDED_SEATS = 3;

function purchaseValue(tier: Tier, plan: Plan, seats: number): number {
  const base = TIER_PRICE_USD[tier][plan];
  if (tier !== 'org') return base;
  const extra = Math.max(0, seats - ORG_INCLUDED_SEATS);
  return base + extra * ORG_EXTRA_SEAT_USD[plan];
}
const TIER_FEATURES: Record<Tier, string[]> = {
  business: ['Unlimited AI Assist', 'Receipt storage', 'Custom logo', '1 user'],
  org:      ['Everything in Business', 'Multiple businesses', 'Team seats (3 included)', 'Priority support'],
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: colors.warmWhite, border: `1px solid ${colors.softLine}`,
  borderRadius: radii.md, padding: 24, boxShadow: shadows.card, maxWidth: 560,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: colors.mutedGray,
  textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
};

const valueStyle: React.CSSProperties = {
  fontSize: 18, fontWeight: 600, color: colors.darkSlate,
};

const btnPrimary: React.CSSProperties = {
  padding: '10px 20px', borderRadius: radii.sm, border: 'none',
  background: colors.ledgerGreen, color: colors.warmWhite, fontWeight: 600,
  fontSize: 14, cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  padding: '9px 18px', borderRadius: radii.sm,
  background: 'transparent', border: `1px solid ${colors.softLine}`,
  color: colors.mutedGray, fontSize: 14, cursor: 'pointer',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Plan toggle ─────────────────────────────────────────────────────────────

function PlanToggle({ value, onChange }: { value: Plan; onChange: (p: Plan) => void }) {
  const optStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '9px 0', textAlign: 'center', fontSize: 14, fontWeight: 600,
    cursor: 'pointer', borderRadius: radii.sm, transition: 'all 0.15s',
    background: active ? colors.ledgerGreen : 'transparent',
    color: active ? colors.warmWhite : colors.mutedGray,
    border: 'none',
  });
  return (
    <div style={{
      display: 'flex', gap: 4, padding: 4,
      background: colors.cream, borderRadius: radii.sm,
      border: `1px solid ${colors.softLine}`, marginBottom: 16,
    }}>
      <button style={optStyle(value === 'monthly')} onClick={() => onChange('monthly')}>Monthly</button>
      <button style={optStyle(value === 'annual')} onClick={() => onChange('annual')}>Annual</button>
    </div>
  );
}

// ─── Payment form (inner, must be inside <Elements>) ──────────────────────────

interface PaymentFormProps {
  plan: Plan;
  tier: Tier;
  seats: number;
  onSuccess: () => void;
  onCancel: () => void;
}

function PaymentForm({ plan, tier, seats, onSuccess, onCancel }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [showPromo, setShowPromo] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setFormError(null);

    const result = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    });

    if (result.error) {
      setFormError(result.error.message ?? 'Payment setup failed');
      setSubmitting(false);
      return;
    }

    const pmId =
      result.setupIntent?.payment_method;
    if (!pmId || typeof pmId !== 'string') {
      setFormError('Could not retrieve payment method. Please try again.');
      setSubmitting(false);
      return;
    }

    try {
      await api.billing.subscribe({ paymentMethodId: pmId, tier, interval: plan, seats: tier === 'org' ? seats : undefined, promoCode: promoCode.trim() || undefined });
      // Fire GA4 purchase event. Value is the headline price — promo discounts
      // are unknown client-side (Stripe applies them server-side) and would
      // require a follow-up /api/billing/status call to compute accurately;
      // GA tolerates the small gap.
      const value = purchaseValue(tier, plan, tier === 'org' ? seats : 1);
      trackEvent('purchase', {
        transaction_id: `kml-${tier}-${plan}-${Date.now()}`,
        currency: 'USD',
        value,
        items: [{
          item_id: `${tier}_${plan}`,
          item_name: `${TIER_LABELS[tier]} (${plan})`,
          item_category: 'subscription',
          price: value,
          quantity: 1,
        }],
      });
      onSuccess();
    } catch (err) {
      setFormError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} style={{ marginTop: 16 }}>
      <PaymentElement options={{ layout: 'tabs' }} />
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={() => setShowPromo(v => !v)}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13, color: colors.mutedGray, textDecoration: 'underline' }}
        >
          {showPromo ? 'Remove promo code' : 'Have a promo code?'}
        </button>
        {showPromo && (
          <input
            type="text"
            value={promoCode}
            onChange={e => setPromoCode(e.target.value)}
            placeholder="Enter promo code"
            style={{
              display: 'block', marginTop: 8, width: '100%', boxSizing: 'border-box',
              padding: '8px', borderRadius: radii.sm, border: `1px solid ${colors.softLine}`, fontSize: 13,
            }}
          />
        )}
      </div>
      {formError && (
        <p style={{ marginTop: 12, color: colors.dangerFg, fontSize: 14 }}>{formError}</p>
      )}
      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button type="submit" style={{ ...btnPrimary, opacity: submitting ? 0.7 : 1 }} disabled={submitting || !stripe}>
          {submitting ? 'Saving…' : 'Save card & subscribe'}
        </button>
        <button type="button" style={btnGhost} onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Add-payment-method section ───────────────────────────────────────────────

interface AddPaymentSectionProps {
  onSuccess: () => void;
}

function AddPaymentSection({ onSuccess }: AddPaymentSectionProps) {
  const [plan, setPlan] = useState<Plan>('monthly');
  const [tier, setTier] = useState<Tier>('business');
  const [seats, setSeats] = useState(3);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const openForm = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { clientSecret: secret } = await api.billing.setupIntent();
      setClientSecret(secret);
      setOpen(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  if (!stripePromise) {
    return (
      <p style={{ color: colors.mutedGray, fontSize: 14 }}>
        Payment setup is not yet configured.
      </p>
    );
  }

  if (!open) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Tier selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          {(['business', 'org'] as Tier[]).map(t => (
            <button
              key={t}
              style={{
                flex: 1, padding: '10px 0', borderRadius: radii.sm, cursor: 'pointer',
                fontWeight: 600, fontSize: 14, transition: 'all 0.15s',
                background: tier === t ? colors.ledgerGreen : colors.cream,
                color: tier === t ? colors.warmWhite : colors.darkSlate,
                border: `1px solid ${tier === t ? colors.ledgerGreen : colors.softLine}`,
              }}
              onClick={() => setTier(t)}
            >
              {TIER_LABELS[t]}<br />
              <span style={{ fontSize: 12, fontWeight: 400 }}>{TIER_PRICES[t][plan]}</span>
            </button>
          ))}
        </div>
        {/* Org seat picker */}
        {tier === 'org' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
            <span style={{ color: colors.mutedGray }}>Seats (min 3):</span>
            <button style={{ ...btnGhost, padding: '4px 10px' }} onClick={() => setSeats(s => Math.max(3, s - 1))}>−</button>
            <strong>{seats}</strong>
            <button style={{ ...btnGhost, padding: '4px 10px' }} onClick={() => setSeats(s => s + 1)}>+</button>
          </div>
        )}
        {/* Feature list */}
        <ul style={{ margin: '4px 0 8px', paddingLeft: 20, fontSize: 13, color: colors.mutedGray, lineHeight: 1.7 }}>
          {TIER_FEATURES[tier].map(f => <li key={f}>{f}</li>)}
        </ul>
        <PlanToggle value={plan} onChange={setPlan} />
        {err && <p style={{ color: colors.dangerFg, fontSize: 14, margin: 0 }}>{err}</p>}
        <button style={btnPrimary} onClick={() => { void openForm(); }} disabled={loading}>
          {loading ? 'Loading…' : 'Add payment method'}
        </button>
      </div>
    );
  }

  if (!clientSecret) return null;

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: 'stripe',
          variables: { colorPrimary: colors.ledgerGreen },
        },
      }}
    >
      <PaymentForm
        plan={plan}
        tier={tier}
        seats={seats}
        onSuccess={() => { setOpen(false); onSuccess(); }}
        onCancel={() => { setOpen(false); setClientSecret(null); }}
      />
    </Elements>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function BillingPage() {
  useDocumentTitle('Billing');
  const { config } = useAuth();
  const [data, setData] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reactivating, setReactivating] = useState(false);

  const fetchStatus = useCallback(() => {
    setLoading(true);
    api.billing.status()
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: unknown) => { setError((e as Error).message); setLoading(false); });
  }, []);

  useEffect(() => {
    if (config?.mode !== 'saas') { setLoading(false); return; }
    fetchStatus();
  }, [config?.mode, fetchStatus]);

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

  if (loading) return <div style={{ padding: 48, color: colors.mutedGray }}>Loading…</div>;

  if (error) {
    return (
      <div style={{ padding: 24, color: colors.dangerFg, background: colors.dangerBg, borderRadius: radii.md }}>
        {error}
      </div>
    );
  }

  const trialDate = data?.trialEndsAt
    ? new Date(data.trialEndsAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const periodEndDate = data?.currentPeriodEnd
    ? new Date(data.currentPeriodEnd).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const showAddPayment =
    config?.billingEnabled &&
    !data?.hasPaymentMethod &&
    (data?.status === 'trialing' || data?.status === 'past_due' || data?.status === 'incomplete' || data?.status === 'canceled');

  const showCancelButton =
    config?.billingEnabled &&
    data?.hasPaymentMethod &&
    (data?.status === 'active' || data?.status === 'trialing');

  const handleCancel = async () => {
    setCancelling(true);
    setActionMsg(null);
    try {
      await api.billing.cancel();
      setActionMsg('Your subscription will cancel at the end of the billing period.');
      fetchStatus();
    } catch (e) {
      setActionMsg((e as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  const handleReactivate = async () => {
    setReactivating(true);
    setActionMsg(null);
    try {
      await api.billing.reactivate();
      setActionMsg('Subscription reactivated.');
      fetchStatus();
    } catch (e) {
      setActionMsg((e as Error).message);
    } finally {
      setReactivating(false);
    }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 26, color: colors.ledgerGreen, fontFamily: '"Bree Serif", "Merriweather", Georgia, serif', marginBottom: 4 }}>
        Billing
      </h1>
      <div style={{
        marginBottom: 20, padding: '12px 16px', borderRadius: radii.sm,
        background: colors.warningBg, border: `1px solid ${colors.goldSoft}`,
        color: colors.warningFg, fontSize: 14, lineHeight: 1.55,
      }}>
        <strong>{brandConfig.name} is currently in BETA.</strong> Subscriptions and trials are free during the beta period; no charges will be incurred. Pricing details will be announced before the beta ends.{' '}
        <a href={`mailto:${brandConfig.supportEmail}`} style={{ color: colors.warningFg, fontWeight: 600 }}>Questions? Email us.</a>
      </div>
      <p style={{ color: colors.mutedGray, marginTop: 0, marginBottom: 24 }}>
        Manage your subscription and payment method.
      </p>

      {actionMsg && (
        <p style={{ marginBottom: 16, padding: '10px 14px', borderRadius: radii.sm, background: colors.successBg, color: colors.successFg, fontSize: 14 }}>
          {actionMsg}
        </p>
      )}

      <div style={card}>
        {/* Status grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 32px', marginBottom: 24 }}>
          <div>
            <p style={labelStyle}>Status</p>
            <p style={{ margin: 0 }}>{statusBadge(data?.status ?? null)}</p>
          </div>
          <div>
            <p style={labelStyle}>Plan</p>
            <p style={{ ...valueStyle, margin: 0 }}>
              {data?.tier && data.tier !== 'free'
                ? TIER_LABELS[data.tier as Tier] ?? data.tier
                : (data?.plan ? data.plan.charAt(0).toUpperCase() + data.plan.slice(1) : '—')}
            </p>
          </div>
          {data?.tier === 'org' && data?.seats && (
            <div>
              <p style={labelStyle}>Seats</p>
              <p style={{ ...valueStyle, margin: 0 }}>{data.seats}</p>
            </div>
          )}
          {data?.status === 'trialing' && trialDate && (
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={labelStyle}>Trial ends</p>
              <p style={{ ...valueStyle, margin: 0, color: (data.daysRemaining ?? 99) < 3 ? colors.dangerFg : colors.darkSlate }}>
                {trialDate}
                {data.daysRemaining !== null && (
                  <span style={{ fontWeight: 400, fontSize: 14, color: colors.mutedGray, marginLeft: 8 }}>
                    ({data.daysRemaining} {data.daysRemaining === 1 ? 'day' : 'days'} remaining)
                  </span>
                )}
              </p>
            </div>
          )}
          {periodEndDate && data?.status !== 'trialing' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={labelStyle}>Current period ends</p>
              <p style={{ ...valueStyle, margin: 0 }}>{periodEndDate}</p>
            </div>
          )}
        </div>

        {/* Payment method section */}
        <div style={{ borderTop: `1px solid ${colors.softLine}`, paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <p style={labelStyle}>Payment method</p>
            <p style={{ margin: 0, color: data?.last4 ? colors.darkSlate : colors.mutedGray, fontSize: 14 }}>
              {data?.last4 ? `Card ending in ${data.last4}` : 'No payment method on file'}
            </p>
          </div>

          {showAddPayment && (
            <AddPaymentSection
              onSuccess={() => {
                setActionMsg('Payment method saved! Your subscription is now active.');
                fetchStatus();
              }}
            />
          )}

          {showCancelButton && (
            <button
              style={{ ...btnGhost, alignSelf: 'flex-start', color: colors.dangerFg, borderColor: colors.dangerFg }}
              onClick={() => { void handleCancel(); }}
              disabled={cancelling}
            >
              {cancelling ? 'Cancelling…' : 'Cancel subscription'}
            </button>
          )}

          {data?.status === 'canceled' && config?.billingEnabled && (
            <div>
              <p style={{ margin: '0 0 8px', fontSize: 14, color: colors.mutedGray }}>
                Your subscription is canceled.
              </p>
              <button
                style={{ ...btnPrimary, alignSelf: 'flex-start' }}
                onClick={() => { void handleReactivate(); }}
                disabled={reactivating}
              >
                {reactivating ? 'Reactivating…' : 'Resubscribe'}
              </button>
            </div>
          )}
        </div>
      </div>

      <p style={{ marginTop: 20 }}>
        <Link to="/dashboard" style={{ color: colors.forestGreen, fontSize: 14 }}>← Back to Dashboard</Link>
      </p>
    </div>
  );
}
