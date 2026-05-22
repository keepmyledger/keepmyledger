import React, { useEffect, useMemo, useState } from 'react';
import type { Category, CreateCategoryPayload, UpdateCategoryPayload, CategoryKind } from '@keepmyledger/shared';
import { api } from '../api/client';
import {
  filterBarStyle, fieldStyle, inputStyle, labelStyle,
  tableWrapStyle, tableStyle, thStyle, tdStyle,
  buttonStyle, primaryButtonStyle, smallButtonStyle,
  modalBackdropStyle, modalStyle, rowStripe, pillStyle,
} from '../styles/table';

const KIND_LABEL: Record<CategoryKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
};
const KIND_PILL: Record<CategoryKind, React.CSSProperties> = {
  expense:  pillStyle('#fbe4e4', '#a52a2a'),
  income:   pillStyle('#e7f5e0', '#3a7a1e'),
  transfer: pillStyle('#eee', '#666'),
};
const KIND_SECTIONS: { label: string; kind: CategoryKind; note?: string }[] = [
  { label: 'Expense Categories', kind: 'expense' },
  { label: 'Income Categories', kind: 'income' },
  { label: 'Transfer Categories', kind: 'transfer', note: 'Excluded from cashflow / by-category reports.' },
];

const UNTAGGED = '__untagged__';

type GroupMode = 'kind' | 'tax';

const mono: React.CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 };

export function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Category | { kind: CategoryKind } | null>(null);
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<GroupMode>('kind');

  const load = () => api.categories.list().then(setCategories).catch(console.error);
  useEffect(() => { void load(); }, []);

  const del = async (id: number) => {
    if (!confirm('Delete this category?')) return;
    await api.categories.delete(id);
    void load();
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      (c.taxExportCode ?? '').toLowerCase().includes(q)
    );
  }, [categories, search]);

  const knownTaxCodes = useMemo(() => {
    const set = new Set<string>();
    for (const c of categories) if (c.taxExportCode) set.add(c.taxExportCode);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [categories]);

  const taxGroups = useMemo(() => {
    const groups = new Map<string, Category[]>();
    for (const c of filtered) {
      const key = c.taxExportCode ?? UNTAGGED;
      const arr = groups.get(key) ?? [];
      arr.push(c);
      groups.set(key, arr);
    }
    const codes = Array.from(groups.keys())
      .filter((k) => k !== UNTAGGED)
      .sort((a, b) => a.localeCompare(b));
    if (groups.has(UNTAGGED)) codes.push(UNTAGGED);
    return codes.map((code) => ({
      code,
      list: (groups.get(code) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [filtered]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>Categories</h1>
        <button style={primaryButtonStyle} onClick={() => setEditing({ kind: 'expense' })}>+ Add Category</button>
      </div>

      <div style={{ ...filterBarStyle, marginTop: 12 }}>
        <label style={{ ...fieldStyle, flex: 1, minWidth: 220 }}>Search
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or tax code…"
            style={inputStyle}
          />
        </label>
        <label style={fieldStyle}>Group by
          <select style={inputStyle} value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupMode)}>
            <option value="kind">Kind</option>
            <option value="tax">Tax Code</option>
          </select>
        </label>
        <span style={{ alignSelf: 'flex-end', color: '#666', fontSize: 13, paddingBottom: 8 }}>
          {filtered.length} of {categories.length} categor{categories.length === 1 ? 'y' : 'ies'}
        </span>
      </div>

      {groupBy === 'kind' && KIND_SECTIONS.map(({ label, kind, note }) => {
        const list = filtered.filter((c) => c.kind === kind);
        return (
          <Section
            key={kind}
            title={label}
            count={list.length}
            note={note}
            addLabel={`+ Add ${KIND_LABEL[kind]}`}
            onAdd={() => setEditing({ kind })}
            columns={['Name', 'Kind', 'Tax Export Code', 'Actions']}
            emptyText={search ? 'No matches in this section.' : 'None.'}
          >
            {list.map((c, idx) => (
              <Row key={c.id} category={c} idx={idx} onEdit={() => setEditing(c)} onDelete={() => void del(c.id)} />
            ))}
          </Section>
        );
      })}

      {groupBy === 'tax' && taxGroups.map(({ code, list }) => {
        const isUntagged = code === UNTAGGED;
        return (
          <Section
            key={code}
            titleNode={isUntagged
              ? <span style={{ color: '#888' }}>Untagged</span>
              : <span style={mono}>{code}</span>}
            count={list.length}
            note={isUntagged ? 'Categories without a tax export code.' : undefined}
            columns={['Name', 'Kind', 'Tax Export Code', 'Actions']}
            emptyText={search ? 'No matches in this section.' : 'None.'}
          >
            {list.map((c, idx) => (
              <Row key={c.id} category={c} idx={idx} onEdit={() => setEditing(c)} onDelete={() => void del(c.id)} />
            ))}
          </Section>
        );
      })}

      {groupBy === 'tax' && taxGroups.length === 0 && (
        <div style={{ color: '#888', padding: 24, textAlign: 'center' }}>No categories match.</div>
      )}

      {editing && (
        <CategoryEditorModal
          category={'id' in editing ? editing : null}
          defaultKind={'id' in editing ? editing.kind : editing.kind}
          knownTaxCodes={knownTaxCodes}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}

function Section({
  title, titleNode, count, note, addLabel, onAdd, columns, emptyText, children,
}: {
  title?: string;
  titleNode?: React.ReactNode;
  count: number;
  note?: string;
  addLabel?: string;
  onAdd?: () => void;
  columns: string[];
  emptyText: string;
  children: React.ReactNode;
}) {
  const isEmpty = React.Children.count(children) === 0;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>
          {titleNode ?? title} <span style={{ color: '#888', fontWeight: 400, fontSize: 14 }}>({count})</span>
        </h2>
        {addLabel && onAdd && <button style={smallButtonStyle} onClick={onAdd}>{addLabel}</button>}
      </div>
      {note && <p style={{ color: '#666', fontSize: 13, marginTop: 0, marginBottom: 8 }}>{note}</p>}
      <div className="table-wrap" style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>{columns.map((c) => <th key={c} style={thStyle}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {isEmpty
              ? <tr><td colSpan={columns.length} style={{ ...tdStyle, color: '#888', textAlign: 'center', padding: 16 }}>{emptyText}</td></tr>
              : children}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  category: c, idx, onEdit, onDelete,
}: { category: Category; idx: number; onEdit: () => void; onDelete: () => void }) {
  return (
    <tr style={rowStripe(idx)}>
      <td style={{ ...tdStyle, fontWeight: 500 }}>{c.name}</td>
      <td style={tdStyle}><span style={KIND_PILL[c.kind]}>{KIND_LABEL[c.kind]}</span></td>
      <td style={{ ...tdStyle, color: c.taxExportCode ? '#333' : '#bbb', ...(c.taxExportCode ? mono : {}) }}>
        {c.taxExportCode ?? '—'}
      </td>
      <td style={tdStyle}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={smallButtonStyle} onClick={onEdit}>Edit</button>
          <button style={{ ...smallButtonStyle, color: '#a52a2a' }} onClick={onDelete}>Delete</button>
        </div>
      </td>
    </tr>
  );
}

function CategoryEditorModal({
  category, defaultKind, knownTaxCodes, onClose, onSaved,
}: {
  category: Category | null;
  defaultKind: CategoryKind;
  knownTaxCodes: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = category !== null;
  const [form, setForm] = useState<CreateCategoryPayload>(() => category
    ? { name: category.name, kind: category.kind, taxExportCode: category.taxExportCode ?? '' }
    : { name: '', kind: defaultKind, taxExportCode: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) { setError('Name is required'); return; }
    setBusy(true);
    try {
      const code = (form.taxExportCode ?? '').trim();
      const payload: UpdateCategoryPayload = {
        name: form.name,
        kind: form.kind,
        taxExportCode: code ? code : null,
      };
      if (isEdit && category) {
        await api.categories.update(category.id, payload);
      } else {
        await api.categories.create({ ...form, taxExportCode: code || null });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const trimmedCode = (form.taxExportCode ?? '').trim();
  const isNewCode = trimmedCode !== '' && !knownTaxCodes.includes(trimmedCode);

  return (
    <div onClick={onClose} style={modalBackdropStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <h3 style={{ marginTop: 0 }}>{isEdit ? 'Edit Category' : 'New Category'}</h3>
        <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div style={{ color: '#9A2D20', background: '#FBE8E2', padding: 10, borderRadius: 6 }}>{error}</div>}
          <label style={labelStyle}>Name
            <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label style={labelStyle}>Kind
            <select style={inputStyle} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CategoryKind })}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="transfer">Transfer (excluded from reports)</option>
            </select>
          </label>
          <label style={labelStyle}>
            Tax Export Code (optional)
            <input
              style={{ ...inputStyle, ...mono }}
              value={form.taxExportCode ?? ''}
              onChange={(e) => setForm({ ...form, taxExportCode: e.target.value })}
              placeholder="e.g. SCHED-C-L18"
              list="known-tax-codes"
              autoComplete="off"
            />
            <datalist id="known-tax-codes">
              {knownTaxCodes.map((code) => <option key={code} value={code} />)}
            </datalist>
            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
              {knownTaxCodes.length === 0 ? (
                <>No tax codes yet — type one to create the first.</>
              ) : isNewCode ? (
                <>
                  <span style={{ color: '#3a7a1e', fontWeight: 500 }}>New code</span> — will be added.
                  {' '}Existing: <span style={mono}>{knownTaxCodes.join(', ')}</span>
                </>
              ) : trimmedCode ? (
                <>Using existing code <span style={mono}>{trimmedCode}</span>.</>
              ) : (
                <>Existing codes: <span style={mono}>{knownTaxCodes.join(', ')}</span></>
              )}
            </div>
            {knownTaxCodes.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {knownTaxCodes.map((code) => (
                  <button
                    type="button"
                    key={code}
                    onClick={() => setForm({ ...form, taxExportCode: code })}
                    style={{
                      ...smallButtonStyle,
                      ...mono,
                      background: trimmedCode === code ? '#e7f0ff' : '#fff',
                      borderColor: trimmedCode === code ? '#88aaff' : '#ddd',
                    }}
                  >
                    {code}
                  </button>
                ))}
              </div>
            )}
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
