import React, { useEffect, useMemo, useState } from 'react';
import type { Rule, Account, Category, CreateRulePayload, UpdateRulePayload, PatternKind } from '@keepmyledger/shared';
import { api } from '../api/client';
import { CategoryCombobox } from '../components/CategoryCombobox';

type FormState = Partial<CreateRulePayload>;

export function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [applyMsg, setApplyMsg] = useState<Record<number, string>>({});

  const load = () => {
    void api.rules.list().then(setRules);
    void api.accounts.list().then(setAccounts);
    void api.categories.list().then(setCategories);
  };
  useEffect(load, []);

  const del = async (id: number) => {
    if (!confirm('Delete this rule?')) return;
    await api.rules.delete(id);
    load();
  };

  const apply = async (id: number) => {
    const res = await api.rules.apply(id);
    setApplyMsg((m) => ({ ...m, [id]: res.message }));
    setTimeout(() => setApplyMsg((m) => { const n = { ...m }; delete n[id]; return n; }), 3000);
  };

  const catName = (id: number) => categories.find((c) => c.id === id)?.name ?? String(id);
  const accName = (id: number | null) => (id == null ? 'Any' : accounts.find((a) => a.id === id)?.name ?? String(id));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter((r) =>
      r.name.toLowerCase().includes(q) ||
      r.descriptionPattern.toLowerCase().includes(q) ||
      (r.taxDescription ?? '').toLowerCase().includes(q) ||
      catName(r.categoryId).toLowerCase().includes(q)
    );
  }, [rules, search, categories]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>Categorization Rules</h1>
        <button style={primaryButtonStyle} onClick={() => setEditing('new')}>+ Add Rule</button>
      </div>
      <p style={{ color: '#555', marginTop: 8 }}>
        Rules are applied in priority order (highest first) to auto-assign categories to imported transactions.
      </p>

      <div style={filterBarStyle}>
        <label style={{ ...fieldStyle, flex: 1, minWidth: 220 }}>Search
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, pattern, category, tax description…"
            style={inputStyle}
          />
        </label>
        <span style={{ alignSelf: 'flex-end', color: '#666', fontSize: 13, paddingBottom: 8 }}>
          {filtered.length} of {rules.length} rule{rules.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="table-wrap" style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Pattern</th>
              <th style={thStyle}>Type</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Amount Range</th>
              <th style={thStyle}>Account</th>
              <th style={thStyle}>Category</th>
              <th style={thStyle}>Tax Description</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Priority</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, idx) => (
              <tr key={r.id} style={{ background: idx % 2 === 0 ? '#fff' : '#fafbfc', borderBottom: '1px solid #eee' }}>
                <td style={tdStyle}>{r.name}</td>
                <td style={tdStyle}><code style={codeStyle}>{r.descriptionPattern}</code></td>
                <td style={tdStyle}>
                  <span style={r.patternKind === 'regex' ? pillStyles.regex : pillStyles.substring}>
                    {r.patternKind}
                  </span>
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.amountMin == null && r.amountMax == null ? '#bbb' : '#333' }}>
                  {r.amountMin == null && r.amountMax == null
                    ? '—'
                    : `${r.amountMin ?? '−∞'} … ${r.amountMax ?? '+∞'}`}
                </td>
                <td style={{ ...tdStyle, color: r.accountId == null ? '#888' : '#333' }}>{accName(r.accountId)}</td>
                <td style={tdStyle}>{catName(r.categoryId)}</td>
                <td style={{ ...tdStyle, color: r.taxDescription ? '#333' : '#bbb', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.taxDescription ?? ''}>
                  {r.taxDescription ?? '—'}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.priority}</td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button style={smallButtonStyle} onClick={() => setEditing(r)}>Edit</button>
                    <button style={smallButtonStyle} onClick={() => void apply(r.id)}>Apply</button>
                    <button style={{ ...smallButtonStyle, color: '#a52a2a' }} onClick={() => void del(r.id)}>Delete</button>
                    {applyMsg[r.id] && <span style={{ color: 'green', fontSize: 11 }}>{applyMsg[r.id]}</span>}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} style={{ ...tdStyle, color: '#888', textAlign: 'center', padding: 24 }}>
                {rules.length === 0 ? 'No rules yet.' : 'No rules match your search.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <RuleEditorModal
          rule={editing === 'new' ? null : editing}
          accounts={accounts}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

// ── Editor modal (create + edit) ───────────────────────────────────────────
function RuleEditorModal({
  rule,
  accounts,
  categories,
  onClose,
  onSaved,
}: {
  rule: Rule | null;
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = rule !== null;
  const [form, setForm] = useState<FormState>(() =>
    rule
      ? {
          name: rule.name,
          descriptionPattern: rule.descriptionPattern,
          patternKind: rule.patternKind,
          amountMin: rule.amountMin,
          amountMax: rule.amountMax,
          accountId: rule.accountId,
          categoryId: rule.categoryId,
          priority: rule.priority,
          taxDescription: rule.taxDescription,
        }
      : { patternKind: 'substring', priority: 0 }
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.name?.trim()) { setError('Name is required'); return; }
    if (!form.descriptionPattern?.trim()) { setError('Pattern is required'); return; }
    if (!form.categoryId) { setError('Category is required'); return; }
    setBusy(true);
    try {
      if (isEdit && rule) {
        const payload: UpdateRulePayload = {
          name: form.name,
          descriptionPattern: form.descriptionPattern,
          patternKind: form.patternKind,
          amountMin: form.amountMin ?? null,
          amountMax: form.amountMax ?? null,
          accountId: form.accountId ?? null,
          categoryId: form.categoryId,
          priority: form.priority ?? 0,
          taxDescription: form.taxDescription ?? null,
        };
        await api.rules.update(rule.id, payload);
      } else {
        await api.rules.create(form as CreateRulePayload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div onClick={onClose} style={modalBackdropStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <h3 style={{ marginTop: 0 }}>{isEdit ? 'Edit Rule' : 'New Rule'}</h3>
        <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div style={{ color: '#9A2D20', background: '#FBE8E2', padding: 10, borderRadius: 6 }}>{error}</div>}
          <label style={labelStyle}>Rule Name
            <input style={inputStyle} value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label style={labelStyle}>Description Pattern
            <input style={inputStyle} value={form.descriptionPattern ?? ''} onChange={(e) => setForm({ ...form, descriptionPattern: e.target.value })} required />
          </label>
          <label style={labelStyle}>Pattern Type
            <select style={inputStyle} value={form.patternKind} onChange={(e) => setForm({ ...form, patternKind: e.target.value as PatternKind })}>
              <option value="substring">Substring (case-insensitive)</option>
              <option value="regex">Regex</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ ...labelStyle, flex: 1 }}>Amount Min
              <input style={inputStyle} type="number" step="0.01" value={form.amountMin ?? ''} onChange={(e) => setForm({ ...form, amountMin: e.target.value ? Number(e.target.value) : null })} />
            </label>
            <label style={{ ...labelStyle, flex: 1 }}>Amount Max
              <input style={inputStyle} type="number" step="0.01" value={form.amountMax ?? ''} onChange={(e) => setForm({ ...form, amountMax: e.target.value ? Number(e.target.value) : null })} />
            </label>
          </div>
          <label style={labelStyle}>Account (optional)
            <select style={inputStyle} value={form.accountId ?? ''} onChange={(e) => setForm({ ...form, accountId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Any account</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label style={labelStyle}>Category
            <CategoryCombobox
              categories={categories}
              value={form.categoryId ?? null}
              onChange={(id) => setForm({ ...form, categoryId: id ?? undefined })}
              placeholder="Select…"
              width="100%"
            />
          </label>
          <label style={labelStyle}>Priority
            <input style={inputStyle} type="number" value={form.priority ?? 0} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
          </label>
          <label style={labelStyle}>Tax Description (optional)
            <input
              style={inputStyle}
              value={form.taxDescription ?? ''}
              onChange={(e) => setForm({ ...form, taxDescription: e.target.value || null })}
              placeholder="e.g. Office supplies"
            />
            <small style={{ color: '#666', marginTop: 2, fontWeight: 400 }}>
              Applied to matching transactions that don't already have a tax description.
            </small>
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" onClick={onClose} disabled={busy} style={buttonStyle}>Cancel</button>
            <button type="submit" disabled={busy} style={primaryButtonStyle}>{isEdit ? 'Save' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const filterBarStyle: React.CSSProperties = {
  display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap',
  background: '#F7F3E8', border: '1px solid #E6DFCB', borderRadius: 10, padding: 12, marginBottom: 12,
};
const fieldStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
  fontSize: 11, color: '#5E5E5E', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600,
};
const inputStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid #E1DACB', borderRadius: 6,
  fontSize: 14, background: '#FFFDF8', textTransform: 'none', letterSpacing: 'normal', fontWeight: 400, color: '#2B2B2B',
};
const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
  fontSize: 12, color: '#5E5E5E', fontWeight: 600,
};
const tableWrapStyle: React.CSSProperties = {
  border: '1px solid #E6DFCB', borderRadius: 10, overflow: 'hidden',
  boxShadow: '0 1px 2px rgba(31,41,32,0.05)', background: '#FFFDF8',
};
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', background: '#F7F3E8',
  borderBottom: '1px solid #E6DFCB', fontSize: 11, fontWeight: 600,
  color: '#5E5E5E', textTransform: 'uppercase', letterSpacing: 0.5, position: 'sticky', top: 0,
};
const tdStyle: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle' };
const codeStyle: React.CSSProperties = {
  background: '#EFE8D4', padding: '2px 6px', borderRadius: 4,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: '#2B2B2B',
};
const buttonStyle: React.CSSProperties = {
  padding: '6px 14px', border: '1px solid #E1DACB', borderRadius: 6,
  background: '#FFFDF8', cursor: 'pointer', fontSize: 14, color: '#2B2B2B',
};
const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle, background: '#2E7D61', color: '#fff', border: '1px solid #2E7D61', fontWeight: 600,
};
const smallButtonStyle: React.CSSProperties = {
  padding: '3px 8px', border: '1px solid #E1DACB', borderRadius: 6,
  background: '#FFFDF8', cursor: 'pointer', fontSize: 12, color: '#2B2B2B',
};
const pillStyles: Record<PatternKind, React.CSSProperties> = {
  substring: { background: '#E7F1EA', color: '#1F5C4A', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 500 },
  regex:     { background: '#FBEFD0', color: '#8A5A20', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 500 },
};
const modalBackdropStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(43,43,43,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const modalStyle: React.CSSProperties = {
  background: '#FFFDF8', borderRadius: 14, padding: 20,
  width: 480, maxWidth: '92vw', maxHeight: '90vh', overflow: 'auto',
  boxShadow: '0 12px 40px rgba(31,41,32,0.22)', border: '1px solid #E6DFCB',
};
