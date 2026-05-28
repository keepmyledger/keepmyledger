import React, { useEffect, useMemo, useState } from 'react';
import type { Account, CreateAccountPayload, UpdateAccountPayload, BankType, AccountKind } from '@keepmyledger/shared';
import { api } from '../api/client';
import { ConfirmModal } from '../components/ConfirmModal';
import {
  filterBarStyle, fieldStyle, inputStyle, labelStyle,
  tableWrapStyle, tableStyle, thStyle, tdStyle,
  buttonStyle, primaryButtonStyle, smallButtonStyle,
  modalBackdropStyle, modalStyle, rowStripe, pillStyle,
} from '../styles/table';
import { colors } from '../styles/tokens';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const BANK_LABEL: Record<BankType, string> = {
  mt: 'M&T Bank',
  amex: 'American Express',
  chase: 'Chase',
  ofx: 'OFX / QFX',
  unknown: 'Other',
};
const KIND_LABEL: Record<AccountKind, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit Card',
};
const KIND_PILL: Record<AccountKind, React.CSSProperties> = {
  checking:    pillStyle(colors.creamDeep, colors.mutedGray),
  savings:     pillStyle(colors.successBg, colors.successFg),
  credit_card: pillStyle(colors.warningBg, colors.warningFg),
};

export function AccountsPage() {
  useDocumentTitle('Accounts');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const load = () => api.accounts.list().then(setAccounts).catch(console.error);
  useEffect(() => { void load(); }, []);

  const del = (id: number) => setConfirmDeleteId(id);
  const doDelete = async () => {
    if (confirmDeleteId === null) return;
    await api.accounts.delete(confirmDeleteId);
    setConfirmDeleteId(null);
    void load();
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      BANK_LABEL[a.bankType].toLowerCase().includes(q) ||
      KIND_LABEL[a.accountKind].toLowerCase().includes(q)
    );
  }, [accounts, search]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>Bank Accounts</h1>
        <button style={primaryButtonStyle} onClick={() => setEditing('new')}>+ Add Account</button>
      </div>

      <div style={{ ...filterBarStyle, marginTop: 12 }}>
        <label style={{ ...fieldStyle, flex: 1, minWidth: 220 }}>Search
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, bank, type…"
            style={inputStyle}
          />
        </label>
        <span style={{ alignSelf: 'flex-end', color: colors.mutedGray, fontSize: 13, paddingBottom: 8 }}>
          {filtered.length} of {accounts.length} account{accounts.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="table-wrap" style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Bank</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Last Statement</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a, idx) => (
              <tr key={a.id} style={rowStripe(idx)}>
                <td style={{ ...tdStyle, fontWeight: 500 }}>{a.name}</td>
                <td style={tdStyle}>{BANK_LABEL[a.bankType] ?? a.bankType}</td>
                <td style={tdStyle}>
                  <span style={KIND_PILL[a.accountKind]}>{KIND_LABEL[a.accountKind] ?? a.accountKind}</span>
                </td>
                <td style={{ ...tdStyle, color: a.lastStatementPeriod ? colors.darkSlate : colors.hintText, fontVariantNumeric: 'tabular-nums' }}>
                  {a.lastStatementPeriod ?? '—'}
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button style={smallButtonStyle} onClick={() => setEditing(a)}>Edit</button>
                    <button style={{ ...smallButtonStyle, color: colors.dangerFg }} onClick={() => void del(a.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} style={{ ...tdStyle, color: colors.mutedGray, textAlign: 'center', padding: 24 }}>
                {accounts.length === 0 ? 'No accounts yet.' : 'No accounts match your search.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <AccountEditorModal
          account={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
      {confirmDeleteId !== null && (
        <ConfirmModal
          message="Delete this account and all its transactions? This cannot be undone."
          onConfirm={() => void doDelete()}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  );
}

function AccountEditorModal({
  account, onClose, onSaved,
}: { account: Account | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = account !== null;
  const [form, setForm] = useState<CreateAccountPayload>(() => account
    ? { name: account.name, bankType: account.bankType, accountKind: account.accountKind }
    : { name: '', bankType: 'mt', accountKind: 'checking' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) { setError('Name is required'); return; }
    setBusy(true);
    try {
      if (isEdit && account) {
        const payload: UpdateAccountPayload = {
          name: form.name,
          bankType: form.bankType,
          accountKind: form.accountKind,
        };
        await api.accounts.update(account.id, payload);
      } else {
        await api.accounts.create(form);
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
        <h3 style={{ marginTop: 0 }}>{isEdit ? 'Edit Account' : 'New Account'}</h3>
        <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div style={{ color: colors.dangerFg, background: colors.dangerBg, padding: 10, borderRadius: 6 }}>{error}</div>}
          <label style={labelStyle}>Name
            <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label style={labelStyle}>Bank
            <select style={inputStyle} value={form.bankType} onChange={(e) => setForm({ ...form, bankType: e.target.value as BankType })}>
              <option value="mt">M&amp;T Bank</option>
              <option value="amex">American Express</option>
              <option value="chase">Chase</option>
              <option value="ofx">OFX / QFX</option>
              <option value="unknown">Other</option>
            </select>
          </label>
          <label style={labelStyle}>Account Type
            <select style={inputStyle} value={form.accountKind} onChange={(e) => setForm({ ...form, accountKind: e.target.value as AccountKind })}>
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
              <option value="credit_card">Credit Card</option>
            </select>
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
