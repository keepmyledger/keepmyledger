import React, { useEffect, useState } from 'react';
import type { Transaction, Category, AiSuggestion } from '@keepmyledger/shared';
import { api } from '../api/client';
import { colors, radii, shadows } from '../styles/tokens';

interface Props {
  tx: Transaction;
  categories: Category[];
  onClose: () => void;
  /** Called after the user accepts changes; parent should refresh data. */
  onApplied: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(43, 43, 43, 0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
};
const dialogStyle: React.CSSProperties = {
  background: colors.warmWhite, borderRadius: radii.lg, padding: 24, maxWidth: 520, width: '100%',
  boxShadow: shadows.modal, maxHeight: '90vh', overflow: 'auto', border: `1px solid ${colors.softLine}`,
};
const labelStyle: React.CSSProperties = {
  fontSize: 11, color: colors.mutedGray, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
};
const inputStyle: React.CSSProperties = {
  padding: '6px 10px', border: `1px solid ${colors.surfaceLine}`, borderRadius: radii.sm,
  fontSize: 14, width: '100%', background: colors.warmWhite, color: colors.darkSlate,
};
const btn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: radii.sm, border: `1px solid ${colors.surfaceLine}`,
  background: colors.warmWhite, cursor: 'pointer', fontSize: 13, color: colors.darkSlate,
};
const btnPrimary: React.CSSProperties = {
  ...btn, background: colors.forestGreen, borderColor: colors.forestGreen, color: '#fff', fontWeight: 600,
};

export function AiAssistModal({ tx, categories, onClose, onApplied }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<AiSuggestion | null>(null);

  // Editable copies
  const [editedTaxDesc, setEditedTaxDesc] = useState('');
  const [createRule, setCreateRule] = useState(true);
  const [applyCategory, setApplyCategory] = useState(true);
  const [applyTax, setApplyTax] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    api.transactions.aiSuggest(tx.id)
      .then((res) => {
        if (cancelled) return;
        setS(res);
        setEditedTaxDesc(res.taxDescription ?? '');
        setApplyCategory(res.categoryId != null);
        setApplyTax(Boolean(res.taxDescription));
        setCreateRule(Boolean(res.proposedRule));
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tx.id]);

  const apply = async () => {
    if (!s) return;
    setSubmitting(true);
    try {
      const update: Record<string, unknown> = {};
      if (applyCategory && s.categoryId != null) {
        update.categoryId = s.categoryId;
        update.categorySource = 'manual';
      }
      const taxValue = editedTaxDesc.trim();
      if (applyTax && taxValue) update.taxDescription = taxValue;
      if (Object.keys(update).length > 0) {
        await api.transactions.update(tx.id, update);
      }

      if (createRule && s.proposedRule) {
        await api.rules.create({
          name: s.proposedRule.name,
          descriptionPattern: s.proposedRule.descriptionPattern,
          patternKind: s.proposedRule.patternKind,
          categoryId: s.proposedRule.categoryId,
          taxDescription: s.proposedRule.taxDescription ?? null,
        });
      }

      onApplied();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0, fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
          ✨ AI Suggestion
        </h2>
        <p style={{ color: '#666', fontSize: 13, marginTop: 4, marginBottom: 16 }}>
          {tx.date} · <strong>{tx.description}</strong> · {tx.amount < 0 ? '−' : '+'}${Math.abs(tx.amount).toFixed(2)}
        </p>

        {loading && <div style={{ padding: 20, textAlign: 'center', color: '#666' }}>Thinking…</div>}

        {error && (
          <div style={{ padding: 12, background: colors.dangerBg, color: colors.dangerFg, borderRadius: radii.sm, fontSize: 13 }}>
            {error}
          </div>
        )}

        {s && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 12, color: '#666' }}>
              Confidence: <strong>{(s.confidence * 100).toFixed(0)}%</strong>
              {s.rationale && <span> · {s.rationale}</span>}
            </div>

            {s.categoryId != null && (
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={applyCategory} onChange={(e) => setApplyCategory(e.target.checked)} />
                  <span style={labelStyle}>Category</span>
                </label>
                <div style={{ marginTop: 4, fontSize: 14 }}>
                  {s.categoryName} <span style={{ color: '#999', fontSize: 12 }}>(#{s.categoryId})</span>
                </div>
              </div>
            )}

            {s.categoryId == null && (
              <div style={{ fontSize: 13, color: colors.warningFg, background: colors.warningBg, padding: 10, borderRadius: radii.sm }}>
                The model wasn't confident enough to suggest a category for this transaction.
              </div>
            )}

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={applyTax} onChange={(e) => setApplyTax(e.target.checked)} />
                <span style={labelStyle}>Tax Description</span>
              </label>
              <input
                type="text"
                value={editedTaxDesc}
                onChange={(e) => setEditedTaxDesc(e.target.value)}
                placeholder="Business purpose (editable)"
                style={{ ...inputStyle, marginTop: 4 }}
              />
            </div>

            {s.proposedRule && (
              <div style={{ background: colors.cream, padding: 12, borderRadius: radii.sm, border: `1px solid ${colors.softLine}` }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={createRule} onChange={(e) => setCreateRule(e.target.checked)} />
                  <span style={labelStyle}>Also create a rule</span>
                </label>
                <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5 }}>
                  <div><strong>Name:</strong> {s.proposedRule.name}</div>
                  <div><strong>Match:</strong> {s.proposedRule.patternKind} — <code>{s.proposedRule.descriptionPattern}</code></div>
                  <div><strong>→ Category:</strong> {categories.find((c) => c.id === s.proposedRule!.categoryId)?.name ?? '—'}</div>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={btn} disabled={submitting}>Cancel</button>
          <button onClick={apply} style={btnPrimary} disabled={loading || !s || submitting}>
            {submitting ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
