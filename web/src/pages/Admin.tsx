import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import type { UnknownFormatSample, UnknownFormatStatus } from '@keepmyledger/shared';
import { api } from '../api/client';
import { colors, radii, shadows } from '../styles/tokens';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

// Mask email for display: "alice@example.com" → "a***@example.com"
// The server already returns masked emails; this is a client-side safety net.
function maskEmail(email: string | null): string {
  if (!email) return '—';
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return email[0] + '***' + email.slice(at);
}

// Shows a masked email with a "Reveal" button that fetches the real address
// via an audited endpoint.
function RevealableEmail({ userId, maskedEmail }: { userId: string; maskedEmail: string | null }) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (revealed !== null) {
    return <span style={{ fontWeight: 500 }}>{revealed || '—'}</span>;
  }
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontWeight: 500 }}>{maskedEmail || '—'}</span>
      <button
        onClick={async () => {
          setLoading(true);
          try {
            const r = await api.admin.users.revealEmail(userId);
            setRevealed(r.email ?? '');
          } finally {
            setLoading(false);
          }
        }}
        disabled={loading}
        title="Reveal email (audited)"
        style={{
          padding: '1px 6px', fontSize: 11, cursor: 'pointer',
          border: `1px solid ${colors.softLine}`, borderRadius: 4,
          background: 'transparent', color: colors.mutedGray,
        }}
      >
        {loading ? '…' : 'Reveal'}
      </button>
    </span>
  );
}

// ── Shared primitives ─────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: colors.warmWhite,
  border: `1px solid ${colors.softLine}`,
  borderRadius: radii.md,
  boxShadow: shadows.card,
  padding: '20px 24px',
};

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{ ...card, minWidth: 140 }}>
      <div style={{ fontSize: 13, color: colors.mutedGray, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: colors.darkSlate }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: colors.mutedGray, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/** Minimal bar chart rendered as SVG. */
function BarChart({ data, color = colors.ledgerGreen }: {
  data: { day: string; total: number }[];
  color?: string;
}) {
  if (data.length === 0) return <div style={{ color: colors.mutedGray, fontSize: 13 }}>No data</div>;
  const W = 480; const H = 120; const BAR_GAP = 2;
  const max = Math.max(...data.map(d => d.total), 1);
  const barW = Math.max(1, (W - BAR_GAP * (data.length - 1)) / data.length);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      {data.map((d, i) => {
        const h = Math.max(2, (d.total / max) * (H - 20));
        const x = i * (barW + BAR_GAP);
        return (
          <g key={d.day}>
            <rect x={x} y={H - h - 4} width={barW} height={h} fill={color} rx={2} opacity={0.85} />
            {data.length <= 14 && (
              <text x={x + barW / 2} y={H + 2} textAnchor="middle" fontSize={9} fill={colors.mutedGray}>
                {d.day.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Overview / Dashboard ──────────────────────────────────────────────────────

type Overview = {
  totalUsers: number;
  newUsers7d: number;
  newUsers30d: number;
  totalTransactions: number;
  totalStatements: number;
  subscriptions: Record<string, number>;
  aiCallsToday: number;
  aiCalls30d: number;
};

function AdminDashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [signups, setSignups] = useState<{ day: string; total: number }[]>([]);
  const [imports, setImports] = useState<{ day: string; total: number }[]>([]);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((d: number) => {
    setError(null);
    Promise.all([
      api.admin.stats.overview(),
      api.admin.stats.signups(d),
      api.admin.stats.imports(d),
    ])
      .then(([o, s, imp]) => { setOverview(o); setSignups(s); setImports(imp); })
      .catch(e => setError((e as Error).message));
  }, []);

  useEffect(() => { load(days); }, [load, days]);

  const subs = overview?.subscriptions ?? {};
  const activeCount = (subs['active'] ?? 0) + (subs['trialing'] ?? 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: colors.darkSlate }}>Overview</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                padding: '4px 12px', borderRadius: radii.sm, fontSize: 13, cursor: 'pointer',
                background: days === d ? colors.ledgerGreen : 'transparent',
                color: days === d ? colors.warmWhite : colors.mutedGray,
                border: `1px solid ${days === d ? colors.ledgerGreen : colors.softLine}`,
              }}
            >{d}d</button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ ...card, background: colors.dangerBg, color: colors.dangerFg, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {overview && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
            <KpiCard label="Total users"       value={overview.totalUsers} />
            <KpiCard label={`New (${days}d)`}  value={days === 7 ? overview.newUsers7d : overview.newUsers30d} />
            <KpiCard label="Active subs"       value={activeCount} sub={`trialing: ${subs['trialing'] ?? 0}`} />
            <KpiCard label="Transactions"      value={overview.totalTransactions.toLocaleString()} />
            <KpiCard label="Imports"           value={overview.totalStatements.toLocaleString()} />
            <KpiCard label="AI calls today"    value={overview.aiCallsToday} sub={`30d: ${overview.aiCalls30d}`} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.darkSlate, marginBottom: 12 }}>
                Signups ({days}d)
              </div>
              <BarChart data={signups} color={colors.forestGreen} />
            </div>
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.darkSlate, marginBottom: 12 }}>
                Imports ({days}d)
              </div>
              <BarChart data={imports} color={colors.goldRich} />
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.darkSlate, marginBottom: 12 }}>
              Subscriptions breakdown
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {Object.entries(subs).map(([status, count]) => (
                <div
                  key={status}
                  style={{
                    padding: '4px 12px', borderRadius: radii.sm, fontSize: 13,
                    background: colors.cream, border: `1px solid ${colors.softLine}`,
                  }}
                >
                  <strong>{status}</strong>: {count}
                </div>
              ))}
              {Object.keys(subs).length === 0 && (
                <span style={{ color: colors.mutedGray, fontSize: 13 }}>No subscription data</span>
              )}
            </div>
          </div>
        </>
      )}

      {!overview && !error && (
        <div style={{ color: colors.mutedGray, fontSize: 14 }}>Loading…</div>
      )}
    </div>
  );
}

// ── Users + trial extension ───────────────────────────────────────────────────

type AdminUser = {
  id: string;
  email: string | null;
  name: string | null;
  createdAt: string;
  subStatus: string | null;
  trialEndsAt: string | null;
  tier: string;
  seats: number;
  grantedByAdminId: string | null;
};

function AdminUsers() {
  const [users, setUsers]     = useState<AdminUser[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [q, setQ]             = useState('');
  const [trialFilter, setTrialFilter] = useState<number | null>(null);
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [showExtend, setShowExtend]   = useState(false);
  const [extendDays, setExtendDays]   = useState(14);
  const [extendReason, setExtendReason] = useState('');
  const [extending, setExtending]     = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [successMsg, setSuccessMsg]   = useState<string | null>(null);
  const [grantTarget, setGrantTarget] = useState<AdminUser | null>(null);
  const limit = 50;

  const load = useCallback(() => {
    const params: Record<string, string | number> = { page, limit };
    if (q) params.q = q;
    if (trialFilter !== null) params.trialEndingDays = trialFilter;
    api.admin.users.list(params)
      .then(r => { setUsers(r.users); setTotal(r.total); setSelected(new Set()); })
      .catch(e => setError((e as Error).message));
  }, [page, q, trialFilter]);

  useEffect(() => { load(); }, [load]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === users.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(users.map(u => u.id)));
    }
  };

  const handleExtend = async () => {
    setExtending(true);
    setError(null);
    try {
      const res = await api.admin.users.extendTrial([...selected], extendDays, extendReason || undefined);
      setSuccessMsg(`Extended trial for ${res.extended} user${res.extended === 1 ? '' : 's'} by ${extendDays} days.`);
      setShowExtend(false);
      setSelected(new Set());
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExtending(false);
    }
  };

  const handleGrant = async (userId: string, tier: 'business' | 'org', seats: number) => {
    setError(null);
    try {
      await api.admin.users.grantTier(userId, tier, seats);
      setSuccessMsg(`Granted ${tier} tier to user.`);
      setGrantTarget(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleRevoke = async (userId: string) => {
    setError(null);
    try {
      await api.admin.users.revokeGrant(userId);
      setSuccessMsg('Admin grant revoked.');
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const trialChips: { label: string; days: number | null }[] = [
    { label: 'All', days: null },
    { label: 'Trial ending ≤3d', days: 3 },
    { label: 'Trial ending ≤7d', days: 7 },
    { label: 'Trial ending ≤14d', days: 14 },
  ];

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: colors.darkSlate }}>Users</h2>
        <input
          placeholder="Search email or name…"
          value={q}
          onChange={e => { setQ(e.target.value); setPage(1); }}
          style={{
            padding: '6px 12px', borderRadius: radii.sm, border: `1px solid ${colors.softLine}`,
            fontSize: 13, width: 220,
          }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          {trialChips.map(chip => (
            <button
              key={chip.label}
              onClick={() => { setTrialFilter(chip.days); setPage(1); }}
              style={{
                padding: '4px 10px', borderRadius: radii.sm, fontSize: 12, cursor: 'pointer',
                background: trialFilter === chip.days ? colors.ledgerGreen : 'transparent',
                color: trialFilter === chip.days ? colors.warmWhite : colors.mutedGray,
                border: `1px solid ${trialFilter === chip.days ? colors.ledgerGreen : colors.softLine}`,
              }}
            >{chip.label}</button>
          ))}
        </div>
        {selected.size > 0 && (
          <button
            onClick={() => setShowExtend(true)}
            style={{
              marginLeft: 'auto', padding: '6px 14px', borderRadius: radii.sm, fontSize: 13,
              background: colors.forestGreen, color: colors.warmWhite, border: 'none', cursor: 'pointer',
            }}
          >
            Extend trial ({selected.size})
          </button>
        )}
      </div>

      {error && (
        <div style={{ ...card, background: colors.dangerBg, color: colors.dangerFg, marginBottom: 12 }}>
          {error}
        </div>
      )}
      {successMsg && (
        <div style={{ ...card, background: colors.successBg, color: colors.successFg, marginBottom: 12 }}>
          {successMsg}
        </div>
      )}

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.softLine}`, background: colors.cream }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', width: 36 }}>
                <input type="checkbox" checked={selected.size === users.length && users.length > 0} onChange={toggleAll} />
              </th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>Email / Name</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>Joined</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>Subscription</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>Tier</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}>Trial ends</th>
              <th style={{ padding: '10px 14px', textAlign: 'left' }}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => (
              <tr
                key={u.id}
                style={{
                  borderBottom: i < users.length - 1 ? `1px solid ${colors.softLine}` : undefined,
                  background: selected.has(u.id) ? colors.cream : undefined,
                }}
              >
                <td style={{ padding: '10px 14px' }}>
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleSelect(u.id)} />
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <RevealableEmail userId={u.id} maskedEmail={u.email} />
                  {u.name && <div style={{ color: colors.mutedGray, fontSize: 12 }}>{u.name}</div>}
                </td>
                <td style={{ padding: '10px 14px', color: colors.mutedGray }}>
                  {u.createdAt.slice(0, 10)}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <StatusBadge status={u.subStatus} />
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <TierBadge tier={u.tier} seats={u.seats} granted={!!u.grantedByAdminId} />
                </td>
                <td style={{ padding: '10px 14px', color: colors.mutedGray }}>
                  {u.trialEndsAt ? u.trialEndsAt.slice(0, 10) : '—'}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  {u.grantedByAdminId ? (
                    <button
                      onClick={() => handleRevoke(u.id)}
                      title="Revoke admin grant"
                      style={{
                        padding: '3px 8px', fontSize: 11, cursor: 'pointer',
                        border: `1px solid ${colors.dangerFg}`, borderRadius: 4,
                        background: 'transparent', color: colors.dangerFg,
                      }}
                    >Revoke</button>
                  ) : (
                    <button
                      onClick={() => setGrantTarget(u)}
                      title="Grant tier"
                      style={{
                        padding: '3px 8px', fontSize: 11, cursor: 'pointer',
                        border: `1px solid ${colors.softLine}`, borderRadius: 4,
                        background: 'transparent', color: colors.mutedGray,
                      }}
                    >Grant tier</button>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: colors.mutedGray }}>
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{ padding: '4px 10px', borderRadius: radii.sm, fontSize: 13, cursor: 'pointer', border: `1px solid ${colors.softLine}` }}
          >← Prev</button>
          <span style={{ color: colors.mutedGray, fontSize: 13 }}>Page {page} of {totalPages} ({total} total)</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{ padding: '4px 10px', borderRadius: radii.sm, fontSize: 13, cursor: 'pointer', border: `1px solid ${colors.softLine}` }}
          >Next →</button>
        </div>
      )}

      {showExtend && (
        <ExtendTrialModal
          count={selected.size}
          days={extendDays}
          reason={extendReason}
          busy={extending}
          onDaysChange={setExtendDays}
          onReasonChange={setExtendReason}
          onConfirm={handleExtend}
          onClose={() => setShowExtend(false)}
        />
      )}

      {grantTarget && (
        <GrantTierModal
          user={grantTarget}
          onConfirm={handleGrant}
          onClose={() => setGrantTarget(null)}
        />
      )}
    </div>
  );
}

function TierBadge({ tier, seats, granted }: { tier: string; seats: number; granted: boolean }) {
  const tierColors: Record<string, { bg: string; fg: string }> = {
    business: { bg: colors.tierBusinessBg, fg: colors.tierBusinessFg },
    org:      { bg: colors.tierOrgBg,      fg: colors.tierOrgFg },
    free:     { bg: colors.cream,          fg: colors.mutedGray },
  };
  const c = tierColors[tier] ?? tierColors.free;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{
        padding: '2px 8px', borderRadius: radii.sm, fontSize: 12, fontWeight: 500,
        background: c.bg, color: c.fg,
      }}>
        {tier}
        {tier === 'org' && seats > 1 ? ` ×${seats}` : ''}
      </span>
      {granted && (
        <span style={{ fontSize: 11, color: colors.mutedGray, fontStyle: 'italic' }}>admin</span>
      )}
    </span>
  );
}

function GrantTierModal({
  user,
  onConfirm,
  onClose,
}: {
  user: AdminUser;
  onConfirm: (userId: string, tier: 'business' | 'org', seats: number) => Promise<void>;
  onClose: () => void;
}) {
  const [tier, setTier]   = useState<'business' | 'org'>('business');
  const [seats, setSeats] = useState(1);
  const [busy, setBusy]   = useState(false);
  const overlayRef        = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm(user.id, tier, tier === 'org' ? Math.max(1, seats) : 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
      }}
    >
      <div style={{ ...card, width: 360, boxShadow: shadows.modal }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16, color: colors.darkSlate }}>Grant tier</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: colors.mutedGray }}>
          Grants access without Stripe. Audit-logged. User keeps access until revoked.
        </p>

        <label style={{ display: 'block', fontSize: 13, color: colors.mutedGray, marginBottom: 6 }}>Tier</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {(['business', 'org'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTier(t); if (t === 'business') setSeats(1); }}
              style={{
                flex: 1, padding: '8px 0', borderRadius: radii.sm, fontSize: 13, cursor: 'pointer',
                background: tier === t ? colors.ledgerGreen : 'transparent',
                color: tier === t ? colors.warmWhite : colors.mutedGray,
                border: `1px solid ${tier === t ? colors.ledgerGreen : colors.softLine}`,
                fontWeight: tier === t ? 600 : 400,
              }}
            >{t.charAt(0).toUpperCase() + t.slice(1)}</button>
          ))}
        </div>

        {tier === 'org' && (
          <>
            <label style={{ display: 'block', fontSize: 13, color: colors.mutedGray, marginBottom: 6 }}>Seats</label>
            {/* Admin path allows seats ≥ 1 (useful for single-seat demos/testing).
                The customer-facing Billing page enforces seats ≥ ORG_INCLUDED_SEATS (3). */}
            <input
              type="number"
              value={seats}
              min={1}
              max={500}
              onChange={e => setSeats(Math.max(1, Number(e.target.value)))}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '8px', borderRadius: radii.sm,
                border: `1px solid ${colors.softLine}`, fontSize: 13, marginBottom: 16,
              }}
            />
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', borderRadius: radii.sm, fontSize: 13, cursor: 'pointer',
              background: 'transparent', border: `1px solid ${colors.softLine}`, color: colors.darkSlate,
            }}
          >Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            style={{
              padding: '8px 16px', borderRadius: radii.sm, fontSize: 13, cursor: busy ? 'default' : 'pointer',
              background: colors.forestGreen, color: colors.warmWhite, border: 'none', opacity: busy ? 0.7 : 1,
            }}
          >{busy ? 'Granting…' : `Grant ${tier}`}</button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span style={{ color: colors.mutedGray }}>—</span>;
  const colors_map: Record<string, { bg: string; fg: string }> = {
    active:   { bg: colors.successBg, fg: colors.successFg },
    trialing: { bg: colors.warningBg, fg: colors.warningFg },
    canceled: { bg: colors.dangerBg, fg: colors.dangerFg },
    past_due: { bg: colors.dangerBg, fg: colors.dangerFg },
  };
  const c = colors_map[status] ?? { bg: colors.cream, fg: colors.mutedGray };
  return (
    <span style={{
      padding: '2px 8px', borderRadius: radii.sm, fontSize: 12, fontWeight: 500,
      background: c.bg, color: c.fg,
    }}>{status}</span>
  );
}

function ExtendTrialModal({
  count, days, reason, busy,
  onDaysChange, onReasonChange, onConfirm, onClose,
}: {
  count: number; days: number; reason: string; busy: boolean;
  onDaysChange: (d: number) => void;
  onReasonChange: (r: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
      }}
    >
      <div style={{ ...card, width: 360, boxShadow: shadows.modal }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16, color: colors.darkSlate }}>
          Extend trial for {count} user{count === 1 ? '' : 's'}
        </h3>
        <label style={{ display: 'block', fontSize: 13, color: colors.mutedGray, marginBottom: 4 }}>
          Days to extend
        </label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => onDaysChange(d)}
              style={{
                flex: 1, padding: '6px 0', borderRadius: radii.sm, fontSize: 13, cursor: 'pointer',
                background: days === d ? colors.ledgerGreen : 'transparent',
                color: days === d ? colors.warmWhite : colors.mutedGray,
                border: `1px solid ${days === d ? colors.ledgerGreen : colors.softLine}`,
              }}
            >{d}d</button>
          ))}
          <input
            type="number"
            value={days}
            min={1} max={365}
            onChange={e => onDaysChange(Number(e.target.value))}
            style={{
              width: 56, padding: '6px 8px', borderRadius: radii.sm, fontSize: 13,
              border: `1px solid ${colors.softLine}`, textAlign: 'center',
            }}
          />
        </div>
        <label style={{ display: 'block', fontSize: 13, color: colors.mutedGray, marginBottom: 4 }}>
          Reason (optional, logged for audit)
        </label>
        <textarea
          value={reason}
          onChange={e => onReasonChange(e.target.value)}
          rows={2}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '8px', borderRadius: radii.sm,
            border: `1px solid ${colors.softLine}`, fontSize: 13, resize: 'vertical', marginBottom: 16,
          }}
          placeholder="e.g. Bug compensation, promotional extension…"
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', borderRadius: radii.sm, fontSize: 13, cursor: 'pointer',
              background: 'transparent', border: `1px solid ${colors.softLine}`, color: colors.darkSlate,
            }}
          >Cancel</button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              padding: '8px 16px', borderRadius: radii.sm, fontSize: 13, cursor: busy ? 'default' : 'pointer',
              background: colors.forestGreen, color: colors.warmWhite, border: 'none', opacity: busy ? 0.7 : 1,
            }}
          >{busy ? 'Extending…' : `Extend ${days}d`}</button>
        </div>
      </div>
    </div>
  );
}

// ── AdminUnknownFormats ────────────────────────────────────────────────────────

const STATUS_LABELS: Record<UnknownFormatStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  done: 'Done',
  wont_implement: "Won't Implement",
};

const STATUS_COLORS: Record<UnknownFormatStatus, string> = {
  pending: colors.warningBg,
  in_progress: colors.creamDeep,
  done: colors.successBg,
  wont_implement: colors.cream,
};

function AdminUnknownFormats() {
  const [samples, setSamples] = useState<UnknownFormatSample[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<UnknownFormatStatus | 'all'>('pending');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [updating, setUpdating] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.admin.unknownFormats.list({
        status: statusFilter === 'all' ? undefined : statusFilter,
        page,
        limit: LIMIT,
      });
      setSamples(res.samples);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => { void load(); }, [load]);

  const updateSample = async (id: number, patch: { status?: UnknownFormatStatus; adminNotes?: string | null }) => {
    setUpdating(id);
    try {
      const updated = await api.admin.unknownFormats.update(id, patch);
      setSamples(prev => prev.map(s => s.id === id ? updated : s));
    } finally {
      setUpdating(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Unknown Format Samples</h2>
        <span style={{ fontSize: 13, color: colors.mutedGray }}>{total} total</span>
        {loading && <span style={{ fontSize: 13, color: colors.mutedGray }}>Loading…</span>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['all', 'pending', 'in_progress', 'done', 'wont_implement'] as const).map(s => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1); }}
            style={{
              padding: '4px 12px', fontSize: 13, borderRadius: radii.sm, cursor: 'pointer',
              background: statusFilter === s ? colors.ledgerGreen : 'transparent',
              color: statusFilter === s ? colors.warmWhite : colors.mutedGray,
              border: `1px solid ${statusFilter === s ? colors.ledgerGreen : colors.softLine}`,
            }}
          >
            {s === 'all' ? 'All' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {samples.length === 0 && !loading && (
        <p style={{ color: colors.mutedGray, fontSize: 14 }}>No samples found.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {samples.map(sample => (
          <div key={sample.id} style={{
            border: `1px solid ${colors.softLine}`, borderRadius: radii.md,
            overflow: 'hidden', background: colors.warmWhite,
          }}>
            {/* Header row */}
            <div
              onClick={() => setExpanded(expanded === sample.id ? null : sample.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                cursor: 'pointer', background: expanded === sample.id ? colors.cream : colors.warmWhite,
              }}
            >
              <span style={{
                padding: '2px 8px', borderRadius: radii.sm, fontSize: 12, fontWeight: 600,
                background: STATUS_COLORS[sample.status], color: colors.darkSlate,
              }}>
                {STATUS_LABELS[sample.status]}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
                {sample.bankHint ?? 'Unknown bank'}
              </span>
              <span style={{ fontSize: 12, color: colors.mutedGray }}>
                {sample.pageCount != null ? `${sample.pageCount}p` : ''}{' '}
                {sample.fileSizeKb != null ? `${sample.fileSizeKb} KB` : ''}
              </span>
              <span style={{ fontSize: 12, color: colors.mutedGray }}>
                {new Date(sample.submittedAt).toLocaleDateString()}
              </span>
              <span style={{ fontSize: 12, color: colors.mutedGray }}>{expanded === sample.id ? '▲' : '▼'}</span>
            </div>

            {/* Expanded detail */}
            {expanded === sample.id && (
              <div style={{ padding: '12px 14px', borderTop: `1px solid ${colors.softLine}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <pre style={{
                  fontSize: 11, fontFamily: 'monospace', background: colors.cream,
                  border: `1px solid ${colors.softLine}`, borderRadius: radii.sm,
                  padding: '10px 12px', overflowX: 'auto', maxHeight: 320,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
                }}>
                  {sample.redactedText || '(no text extracted)'}
                </pre>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  {/* Status selector */}
                  <select
                    value={sample.status}
                    disabled={updating === sample.id}
                    onChange={e => void updateSample(sample.id, { status: e.target.value as UnknownFormatStatus })}
                    style={{ fontSize: 13, padding: '4px 8px', borderRadius: radii.sm, border: `1px solid ${colors.softLine}` }}
                  >
                    {(Object.keys(STATUS_LABELS) as UnknownFormatStatus[]).map(s => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>

                  {/* Admin notes */}
                  <textarea
                    rows={2}
                    placeholder="Admin notes…"
                    value={notes[sample.id] ?? (sample.adminNotes ?? '')}
                    onChange={e => setNotes(prev => ({ ...prev, [sample.id]: e.target.value }))}
                    style={{ fontSize: 13, padding: '4px 8px', borderRadius: radii.sm, border: `1px solid ${colors.softLine}`, flex: 1, minWidth: 200, resize: 'vertical' }}
                  />
                  <button
                    onClick={() => void updateSample(sample.id, { adminNotes: notes[sample.id] ?? sample.adminNotes ?? null })}
                    disabled={updating === sample.id}
                    style={{ fontSize: 13, padding: '4px 12px', borderRadius: radii.sm, border: `1px solid ${colors.softLine}`, cursor: 'pointer' }}
                  >
                    Save notes
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ fontSize: 13, padding: '4px 10px', cursor: 'pointer' }}>Previous</button>
          <span style={{ fontSize: 13, color: colors.mutedGray }}>Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ fontSize: 13, padding: '4px 10px', cursor: 'pointer' }}>Next</button>
        </div>
      )}
    </div>
  );
}

// ── Top-level AdminPage (routing) ─────────────────────────────────────────────

const tabStyle = (isActive: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  textDecoration: 'none',
  borderRadius: radii.sm,
  fontSize: 14,
  fontWeight: isActive ? 600 : 400,
  background: isActive ? colors.ledgerGreen : 'transparent',
  color: isActive ? colors.warmWhite : colors.mutedGray,
  border: `1px solid ${isActive ? colors.ledgerGreen : colors.softLine}`,
});

export function AdminPage() {
  useDocumentTitle('Admin');
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 700, color: colors.darkSlate }}>
          Admin
        </h1>
        <p style={{ margin: 0, color: colors.mutedGray, fontSize: 14 }}>
          Platform analytics and user management
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <NavLink to="/admin" end style={({ isActive }) => tabStyle(isActive)}>Dashboard</NavLink>
        <NavLink to="/admin/users" style={({ isActive }) => tabStyle(isActive)}>Users</NavLink>
        <NavLink to="/admin/unknown-formats" style={({ isActive }) => tabStyle(isActive)}>Unknown Formats</NavLink>
      </div>

      <Routes>
        <Route index element={<AdminDashboard />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="unknown-formats" element={<AdminUnknownFormats />} />
      </Routes>
    </div>
  );
}
