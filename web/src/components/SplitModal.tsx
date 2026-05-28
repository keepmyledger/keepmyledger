import React, { useEffect, useState } from 'react';
import type { Category, Transaction, TransactionSplit } from '@keepmyledger/shared';
import { api } from '../api/client';
import { CategoryCombobox } from './CategoryCombobox';
import { colors, radii, shadows } from '../styles/tokens';

interface Props {
  tx: Transaction;
  categories: Category[];
  onClose: () => void;
  /** Called after splits are saved so the parent can refresh the transaction list. */
  onSaved: () => void;
  onCreateCategory?: () => void;
}

interface SplitRow {
  /** Negative key for unsaved rows, positive id for saved rows. */
  key: number;
  categoryId: number | null;
  amountStr: string;
  note: string;
}

let nextKey = -1;
function newRow(): SplitRow {
  return { key: nextKey--, categoryId: null, amountStr: '', note: '' };
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(43, 43, 43, 0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
};
const dialogStyle: React.CSSProperties = {
  background: colors.warmWhite, borderRadius: radii.lg, padding: 24,
  maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto',
  boxShadow: shadows.modal, border: `1px solid ${colors.softLine}`,
};
const labelStyle: React.CSSProperties = {
  fontSize: 11, color: colors.mutedGray, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: 0.5,
};
const inputStyle: React.CSSProperties = {
  padding: '5px 8px', border: `1px solid ${colors.surfaceLine}`, borderRadius: radii.sm,
  fontSize: 13, background: colors.warmWhite, color: colors.darkSlate, width: '100%',
};
const btn: React.CSSProperties = {
  padding: '7px 14px', borderRadius: radii.sm, border: `1px solid ${colors.surfaceLine}`,
  background: colors.warmWhite, cursor: 'pointer', fontSize: 13, color: colors.darkSlate,
};
const btnPrimary: React.CSSProperties = {
  ...btn, background: colors.forestGreen, borderColor: colors.forestGreen, color: '#fff', fontWeight: 600,
};
const btnDanger: React.CSSProperties = {
  ...btn, color: '#c0392b', borderColor: '#dca9a9',
};

export function SplitModal({ tx, categories, onClose, onSaved, onCreateCategory }: Props) {
  const [rows, setRows] = useState<SplitRow[]>([newRow(), newRow()]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Load existing splits on mount.
  useEffect(() => {
    void (async () => {
      try {
        const { splits } = await api.transactions.getSplits(tx.id);
        if (splits.length > 0) {
          setRows(splits.map((s: TransactionSplit) => ({
            key: s.id,
            categoryId: s.categoryId,
            amountStr: s.amount.toFixed(2),
            note: s.note ?? '',
          })));
        }
      } catch {
        // Ignore; start with empty rows
      } finally {
        setLoading(false);
      }
    })();
  }, [tx.id]);

  const updateRow = (key: number, patch: Partial<SplitRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const removeRow = (key: number) =>
    setRows((prev) => prev.filter((r) => r.key !== key));

  const addRow = () => setRows((prev) => [...prev, newRow()]);

  const splitTotal = rows.reduce((acc, r) => {
    const n = Number(r.amountStr);
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);
  const remaining = Math.round((tx.amount - splitTotal) * 100) / 100;
  const fullyAllocated = Math.abs(remaining) < 0.01;

  const save = async () => {
    setError(null);
    const parsed: Array<{ categoryId: number; amount: number; note: string | null }> = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.categoryId === null) {
        setError(`Row ${i + 1}: please select a category`);
        return;
      }
      const amt = Number(r.amountStr);
      if (!Number.isFinite(amt) || amt === 0) {
        setError(`Row ${i + 1}: amount must be a nonzero number`);
        return;
      }
      parsed.push({ categoryId: r.categoryId, amount: Math.round(amt * 100) / 100, note: r.note.trim() || null });
    }
    if (!fullyAllocated) {
      setError(`Split amounts must sum to ${tx.amount.toFixed(2)}. Remaining: ${remaining.toFixed(2)}`);
      return;
    }
    setBusy(true);
    try {
      await api.transactions.replaceSplits(tx.id, parsed);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clearSplits = async () => {
    setBusy(true);
    try {
      await api.transactions.replaceSplits(tx.id, []);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby="split-modal-title"
      onClick={onClose}
    >
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h2 id="split-modal-title" style={{ margin: '0 0 4px', fontSize: 17 }}>Split transaction</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: colors.mutedGray }}>
          {tx.description} &nbsp;·&nbsp;
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
            {tx.amount < 0 ? '−' : '+'}${Math.abs(tx.amount).toFixed(2)}
          </strong>
        </p>

        {loading ? (
          <div style={{ color: colors.mutedGray, fontSize: 13, padding: '12px 0' }}>Loading…</div>
        ) : (
          <>
            {/* Column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 1fr 28px', gap: 6, marginBottom: 4 }}>
              <span style={labelStyle}>Category</span>
              <span style={{ ...labelStyle, textAlign: 'right' }}>Amount</span>
              <span style={labelStyle}>Note</span>
              <span />
            </div>

            {rows.map((r) => (
              <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 1fr 28px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <CategoryCombobox
                  categories={categories}
                  value={r.categoryId}
                  onChange={(id) => updateRow(r.key, { categoryId: id })}
                  onCreateNew={onCreateCategory}
                  invalid={r.categoryId === null}
                  width="100%"
                />
                <input
                  type="text"
                  inputMode="decimal"
                  value={r.amountStr}
                  onChange={(e) => updateRow(r.key, { amountStr: e.target.value })}
                  style={{ ...inputStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                  placeholder="0.00"
                  aria-label={`Amount for split row ${rows.indexOf(r) + 1}`}
                />
                <input
                  type="text"
                  value={r.note}
                  onChange={(e) => updateRow(r.key, { note: e.target.value })}
                  style={inputStyle}
                  placeholder="Optional note"
                  aria-label={`Note for split row ${rows.indexOf(r) + 1}`}
                />
                <button
                  onClick={() => removeRow(r.key)}
                  style={{ ...btn, padding: '4px 6px', color: colors.mutedGray }}
                  aria-label={`Remove split row ${rows.indexOf(r) + 1}`}
                  disabled={rows.length <= 1}
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </div>
            ))}

            <button onClick={addRow} style={{ ...btn, marginTop: 4, fontSize: 12 }}>
              + Add row
            </button>

            {/* Remaining indicator */}
            <div style={{
              marginTop: 12, padding: '8px 12px', borderRadius: radii.sm,
              background: fullyAllocated ? '#d4edda' : '#fdecea',
              color: fullyAllocated ? '#2a8a3e' : '#c0392b',
              fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>Remaining</span>
              <span>{remaining >= 0 ? '' : '−'}${Math.abs(remaining).toFixed(2)}</span>
            </div>
          </>
        )}

        {error && (
          <div style={{ color: '#c0392b', fontSize: 13, marginTop: 10 }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16 }}>
          <button onClick={() => void clearSplits()} style={btnDanger} disabled={busy}>
            Clear splits
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={btn} disabled={busy}>Cancel</button>
            <button onClick={() => void save()} style={btnPrimary} disabled={busy || loading}>
              {busy ? 'Saving…' : 'Save splits'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
