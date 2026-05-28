import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { colors, radii, shadows } from '../styles/tokens';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import type { Account, Transaction, ReportByCategoryRow, CashflowRow } from '@keepmyledger/shared';
import brandConfig from '@content/brand/config';

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

const card: React.CSSProperties = {
  background: colors.warmWhite, border: `1px solid ${colors.softLine}`,
  borderRadius: radii.md, padding: 20, boxShadow: shadows.card,
};
const sectionTitle: React.CSSProperties = {
  margin: '0 0 12px', fontSize: 18, color: colors.ledgerGreen,
  fontFamily: '"Bree Serif", "Merriweather", Georgia, serif',
};
const tileLabel: React.CSSProperties = {
  margin: 0, fontSize: 12, fontWeight: 600, color: colors.mutedGray,
  textTransform: 'uppercase', letterSpacing: 0.5,
};
const tileValue: React.CSSProperties = {
  margin: '6px 0 0', fontSize: 28, fontWeight: 700,
  fontFamily: '"Bree Serif", "Merriweather", Georgia, serif',
};

export function DashboardPage() {
  useDocumentTitle('Dashboard');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [byCategory, setByCategory] = useState<ReportByCategoryRow[]>([]);
  const [cashflow, setCashflow] = useState<CashflowRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const year = new Date().getUTCFullYear();
        const [a, t, c, cf] = await Promise.all([
          api.accounts.list(),
          api.transactions.list({ limit: 500 }),
          api.reports.byCategory(year),
          api.reports.cashflow(year),
        ]);
        if (cancelled) return;
        setAccounts(a);
        setTransactions(t);
        setByCategory(c);
        setCashflow(cf);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const thisMonth = useMemo(() => {
    const now = new Date();
    const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return cashflow.find((r) => r.period === period) ?? { period, income: 0, expenses: 0, net: 0 };
  }, [cashflow]);

  const topCategoriesThisYear = useMemo(() => {
    // byCategory totals are signed; expenses are negative. Rank by |total| descending,
    // exclude transfers and uncategorized.
    return byCategory
      .filter((r) => r.kind !== 'transfer' && r.categoryId !== null)
      .map((r) => ({ ...r, magnitude: Math.abs(r.total) }))
      .sort((a, b) => b.magnitude - a.magnitude)
      .slice(0, 5);
  }, [byCategory]);

  const uncategorizedCount = useMemo(
    () => transactions.filter((t) => t.categoryId === null).length,
    [transactions]
  );

  const recent = useMemo(
    () => [...transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6),
    [transactions]
  );

  const accountById = useMemo(() => {
    const m = new Map<number, Account>();
    accounts.forEach((a) => m.set(a.id, a));
    return m;
  }, [accounts]);

  if (loading) {
    return <div style={{ padding: 24, color: colors.mutedGray }}>Loading dashboard…</div>;
  }
  if (error) {
    return (
      <div style={{
        padding: 16, background: colors.dangerBg, color: colors.dangerFg,
        border: `1px solid ${colors.softLine}`, borderRadius: radii.sm,
      }}>
        {error}
      </div>
    );
  }

  const empty = accounts.length === 0;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{
            margin: 0, fontSize: 26, color: colors.ledgerGreen,
            fontFamily: '"Bree Serif", "Merriweather", Georgia, serif',
          }}>
            Dashboard
          </h1>
          <p style={{ margin: '4px 0 0', color: colors.mutedGray }}>
            {monthLabel(thisMonth.period)} at a glance.
          </p>
        </div>
        {!empty && (
          <Link to="/import" style={primaryBtn}>Import transactions</Link>
        )}
      </div>      {empty ? (
        <div style={{ ...card, textAlign: 'center', padding: 32 }}>
          <h2 style={{ ...sectionTitle, marginBottom: 8 }}>Welcome to {brandConfig.name}</h2>
          <p style={{ color: colors.mutedGray, marginTop: 0 }}>
            Start by adding an account, then import a statement.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16 }}>
            <Link to="/accounts" style={primaryBtn}>Add an account</Link>
            <Link to="/import" style={secondaryBtn}>Import transactions</Link>
          </div>
        </div>
      ) : (
        <>
          {/* Top tiles */}
          <div style={{
            display: 'grid', gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          }}>
            <Tile label="Income"   value={usd(thisMonth.income)}   color={colors.forestGreen} />
            <Tile label="Expenses" value={usd(Math.abs(thisMonth.expenses))} color={colors.dangerFg} />
            <Tile label="Net"      value={usd(thisMonth.net)} color={thisMonth.net >= 0 ? colors.forestGreen : colors.dangerFg} />
            <Tile label="Accounts" value={String(accounts.length)} color={colors.darkSlate} />
          </div>

          {/* Two-column body */}
          <div style={{
            display: 'grid', gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          }}>
            {/* Top categories (year-to-date) */}
            <div style={card}>
              <h2 style={sectionTitle}>Top categories this year</h2>
              {topCategoriesThisYear.length === 0 ? (
                <p style={{ color: colors.mutedGray, margin: 0 }}>No categorized transactions yet.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {topCategoriesThisYear.map((r) => (
                    <li key={r.categoryId ?? 'uncat'} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                      padding: '8px 0', borderBottom: `1px solid ${colors.softLine}`,
                    }}>
                      <span>{r.categoryName ?? 'Uncategorized'}</span>
                      <span style={{ fontWeight: 600, color: r.total < 0 ? colors.dangerFg : colors.forestGreen }}>
                        {usd(r.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ marginTop: 12 }}>
                <Link to="/reports" style={linkBtn}>Open reports →</Link>
              </div>
            </div>

            {/* Action: uncategorized */}
            <div style={card}>
              <h2 style={sectionTitle}>Needs review</h2>
              <p style={{ ...tileLabel }}>Uncategorized</p>
              <p style={{ ...tileValue, color: uncategorizedCount > 0 ? colors.warningFg : colors.mutedGray }}>
                {uncategorizedCount}
              </p>
              <p style={{ color: colors.mutedGray, fontSize: 14, marginTop: 4 }}>
                Across your most recent {transactions.length} transactions.
              </p>
              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Link to="/transactions?uncategorized=1" style={primaryBtn}>Review transactions</Link>
                <Link to="/rules" style={secondaryBtn}>Manage rules</Link>
              </div>
            </div>
          </div>

          {/* Recent activity */}
          <div style={card}>
            <h2 style={sectionTitle}>Recent activity</h2>
            {recent.length === 0 ? (
              <p style={{ color: colors.mutedGray, margin: 0 }}>No transactions yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <tbody>
                  {recent.map((t) => (
                    <tr key={t.id} style={{ borderBottom: `1px solid ${colors.softLine}` }}>
                      <td style={{ padding: '8px 8px 8px 0', color: colors.mutedGray, whiteSpace: 'nowrap' }}>{t.date}</td>
                      <td style={{ padding: '8px', color: colors.mutedGray, whiteSpace: 'nowrap' }}>
                        {accountById.get(t.accountId)?.name ?? '—'}
                      </td>
                      <td style={{ padding: '8px', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.description}
                      </td>
                      <td style={{
                        padding: '8px 0 8px 8px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap',
                        color: t.amount < 0 ? colors.darkSlate : colors.forestGreen,
                      }}>
                        {usd(t.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ marginTop: 12 }}>
              <Link to="/transactions" style={linkBtn}>All transactions →</Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={card}>
      <p style={tileLabel}>{label}</p>
      <p style={{ ...tileValue, color }}>{value}</p>
    </div>
  );
}

function monthLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

const primaryBtn: React.CSSProperties = {
  display: 'inline-block',
  background: colors.ledgerGreen, color: colors.warmWhite, padding: '8px 16px',
  borderRadius: radii.sm, textDecoration: 'none', fontWeight: 600, fontSize: 14,
  border: `1px solid ${colors.ledgerGreen}`, whiteSpace: 'nowrap',
};
const secondaryBtn: React.CSSProperties = {
  display: 'inline-block',
  background: colors.warmWhite, color: colors.ledgerGreen, padding: '8px 16px',
  borderRadius: radii.sm, textDecoration: 'none', fontWeight: 600, fontSize: 14,
  border: `1px solid ${colors.surfaceLine}`, whiteSpace: 'nowrap',
};
const linkBtn: React.CSSProperties = {
  color: colors.forestGreen, textDecoration: 'none', fontSize: 14, fontWeight: 600,
};
