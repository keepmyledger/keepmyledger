import React, { useEffect, useState } from 'react';
import type { ReportByCategoryRow, CashflowRow } from '@keepmyledger/shared';
import { api } from '../api/client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, ResponsiveContainer,
} from 'recharts';
import { colors as brand } from '../styles/tokens';

// Pie palette: warm gold + green-led brand tones, no fintech blue.
const COLORS = ['#2E7D61','#D4A72C','#9A6B12','#1F5C4A','#C97A4A','#8A5A20','#A8B86B','#5E5E5E'];

export function ReportsPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [byCategory, setByCategory] = useState<ReportByCategoryRow[]>([]);
  const [cashflow, setCashflow] = useState<CashflowRow[]>([]);

  useEffect(() => {
    void api.reports.byCategory(year).then(setByCategory);
    void api.reports.cashflow(year).then(setCashflow);
  }, [year]);

  const expenses = byCategory.filter((r) => r.kind === 'expense' && r.total !== 0);
  const pieData = expenses.map((r) => ({ name: r.categoryName ?? 'Uncategorized', value: Math.abs(r.total) }));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Reports</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label>Year <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 80 }} /></label>
          <a href={api.reports.taxExportUrl(year)} download style={{ padding: '6px 12px', background: brand.forestGreen, color: '#fff', borderRadius: 6, textDecoration: 'none', fontWeight: 600 }}>
            ⬇ Tax Export CSV
          </a>
          <a
            href={api.reports.transactionsExportUrl({ kind: 'expense', dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` })}
            download
            style={{ padding: '6px 12px', background: brand.goldAntique, color: '#fff', borderRadius: 6, textDecoration: 'none', fontWeight: 600 }}
          >
            ⬇ Expenses CSV
          </a>
        </div>
      </div>

      <h2>Monthly Cashflow</h2>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={cashflow} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="period" />
          <YAxis />
          <Tooltip formatter={(v: number) => `$${Math.abs(v).toFixed(2)}`} />
          <Legend />
          <Bar dataKey="income" fill={brand.forestGreen} name="Income" />
          <Bar dataKey="expenses" fill={brand.goldAntique} name="Expenses" />
        </BarChart>
      </ResponsiveContainer>

      {cashflow.length > 0 && (() => {
        const ytdIncome = cashflow.reduce((s, r) => s + r.income, 0);
        const ytdExpenses = cashflow.reduce((s, r) => s + r.expenses, 0);
        const ytdNet = cashflow.reduce((s, r) => s + r.net, 0);
        const fmt = (n: number) => `$${Math.abs(n).toFixed(2)}`;
        const netColor = (n: number) => (n < 0 ? '#c00' : n > 0 ? '#080' : '#444');
        return (
          <div className="table-wrap" style={{ marginTop: 16 }}>
          <table style={{ ...tableStyle, minWidth: 420 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 12px' }}>Month</th>
                <th style={{ textAlign: 'right', padding: '4px 12px' }}>Income</th>
                <th style={{ textAlign: 'right', padding: '4px 12px' }}>Expenses</th>
                <th style={{ textAlign: 'right', padding: '4px 12px' }}>Net</th>
              </tr>
            </thead>
            <tbody>
              {cashflow.map((r) => (
                <tr key={r.period}>
                  <td style={{ padding: '4px 12px' }}>{r.period}</td>
                  <td style={{ textAlign: 'right', padding: '4px 12px', color: '#080' }}>{fmt(r.income)}</td>
                  <td style={{ textAlign: 'right', padding: '4px 12px', color: '#c00' }}>{fmt(r.expenses)}</td>
                  <td style={{ textAlign: 'right', padding: '4px 12px', color: netColor(r.net), fontWeight: 500 }}>
                    {r.net < 0 ? '-' : ''}{fmt(r.net)}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid #444', fontWeight: 600 }}>
                <td style={{ padding: '6px 12px' }}>YTD</td>
                <td style={{ textAlign: 'right', padding: '6px 12px', color: '#080' }}>{fmt(ytdIncome)}</td>
                <td style={{ textAlign: 'right', padding: '6px 12px', color: '#c00' }}>{fmt(ytdExpenses)}</td>
                <td style={{ textAlign: 'right', padding: '6px 12px', color: netColor(ytdNet) }}>
                  {ytdNet < 0 ? '-' : ''}{fmt(ytdNet)}
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        );
      })()}

      <h2>Expenses by Category</h2>
      {pieData.length > 0 ? (
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <ResponsiveContainer width={320} height={320}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={120} label>
                {pieData.map((_entry, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
            </PieChart>
          </ResponsiveContainer>
          <div className="table-wrap">
          <table style={tableStyle}>
            <thead><tr><th>Category</th><th>Total</th></tr></thead>
            <tbody>
              {expenses.sort((a, b) => a.total - b.total).map((r) => (
                <tr key={r.categoryId ?? 'null'}>
                  <td>{r.categoryName ?? 'Uncategorized'}</td>
                  <td style={{ textAlign: 'right', color: '#c00' }}>-${Math.abs(r.total).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : (
        <p style={{ color: '#888' }}>No expense data for {year}.</p>
      )}
    </div>
  );
}

const tableStyle: React.CSSProperties = { borderCollapse: 'collapse', minWidth: 280 };
