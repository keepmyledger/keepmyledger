import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Transaction, Account, Category, Receipt, CategoryKind, PatternKind } from '@keepmyledger/shared';
import { api } from '../api/client';
import { ReceiptPicker } from '../components/ReceiptPicker';
import { CategoryCombobox } from '../components/CategoryCombobox';
import { AiAssistModal } from '../components/AiAssistModal';
import { EditTransactionModal } from '../components/EditTransactionModal';
import { useAuth } from '../auth/AuthContext';
import { useSetting } from '../settings';

export function TransactionsPage() {
  const { config } = useAuth();
  const aiEnabled = config?.aiAssistEnabled ?? false;
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [receiptMap, setReceiptMap] = useState<Map<number, Receipt[]>>(new Map());
  const [pickerTxId, setPickerTxId] = useState<number | null>(null);
  const [createCatForTx, setCreateCatForTx] = useState<Transaction | null>(null);
  const [createRuleForTx, setCreateRuleForTx] = useState<Transaction | null>(null);
  const [aiAssistTx, setAiAssistTx] = useState<Transaction | null>(null);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Filters
  const [searchParams, setSearchParams] = useSearchParams();
  const [filterAccount, setFilterAccount] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterReceipt, setFilterReceipt] = useState('');
  const [filterUncategorized, setFilterUncategorized] = useState(
    () => searchParams.get('uncategorized') === '1' || searchParams.get('uncategorized') === 'true'
  );
  const [filterMissingTaxDesc, setFilterMissingTaxDesc] = useState(false);
  const [search, setSearch] = useState('');

  // Keep the `uncategorized` query string in sync with the filter so the URL
  // stays shareable / bookmarkable when the user toggles the checkbox.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (filterUncategorized) next.set('uncategorized', '1');
    else next.delete('uncategorized');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [filterUncategorized, searchParams, setSearchParams]);

  // Pagination
  const [page, setPage] = useState(1);
  const [defaultPageSize] = useSetting('transactionsPageSize');
  const [pageSize, setPageSize] = useState(defaultPageSize);
  // Follow the default when it changes (e.g. user updates it in Settings)
  useEffect(() => { setPageSize(defaultPageSize); }, [defaultPageSize]);

  const load = useCallback(async () => {
    const params: Record<string, string | number | boolean> = {};
    if (filterAccount) params.accountId = Number(filterAccount);
    if (filterDateFrom) params.dateFrom = filterDateFrom;
    if (filterDateTo) params.dateTo = filterDateTo;
    if (filterSource) params.categorySource = filterSource;
    if (filterReceipt) params.hasReceipts = filterReceipt === 'true';
    if (filterUncategorized) params.uncategorized = true;
    const [txs, accs, cats] = await Promise.all([
      api.transactions.list(params),
      api.accounts.list(),
      api.categories.list(),
    ]);
    setTransactions(txs);
    setAccounts(accs);
    setCategories(cats);
    // Load receipts for all transactions
    const entries = await Promise.all(txs.map(async (tx) => [tx.id, await api.transactions.listReceipts(tx.id)] as const));
    setReceiptMap(new Map(entries));
  }, [filterAccount, filterDateFrom, filterDateTo, filterSource, filterReceipt, filterUncategorized]);

  useEffect(() => { void load(); }, [load]);

  // Reset to page 1 when filters or search change
  useEffect(() => { setPage(1); }, [filterAccount, filterDateFrom, filterDateTo, filterSource, filterReceipt, filterUncategorized, filterMissingTaxDesc, search]);

  // Clear selection when list reloads
  useEffect(() => { setSelectedIds(new Set()); }, [transactions]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const deleteOne = async (tx: Transaction) => {
    if (!window.confirm(`Delete "${tx.description}" (${tx.date}, $${Math.abs(tx.amount).toFixed(2)})?`)) return;
    await api.transactions.delete(tx.id);
    void load();
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected transaction${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
    await api.transactions.bulkDelete([...selectedIds]);
    void load();
  };

  const refreshReceipts = async (txId: number) => {
    const receipts = await api.transactions.listReceipts(txId);
    setReceiptMap((prev) => new Map(prev).set(txId, receipts));
  };

  const approve = async (tx: Transaction) => {
    await api.transactions.approveSuggestion(tx.id);
    void load();
  };

  const updateCategory = async (tx: Transaction, categoryId: number) => {
    await api.transactions.update(tx.id, { categoryId, categorySource: 'manual' });
    void load();
  };

  const saveTaxDescription = async (tx: Transaction, value: string) => {
    const next = value.trim() === '' ? null : value;
    if ((tx.taxDescription ?? null) === next) return;
    await api.transactions.update(tx.id, { taxDescription: next });
    setTransactions((prev) => prev.map((t) => (t.id === tx.id ? { ...t, taxDescription: next } : t)));
  };

  const isTransferCategory = (id: number | null) =>
    id != null && categories.find((c) => c.id === id)?.kind === 'transfer';

  const catName = (id: number | null) => categories.find((c) => c.id === id)?.name ?? '—';
  const accName = (id: number) => accounts.find((a) => a.id === id)?.name ?? id;

  const pickerTx = pickerTxId !== null ? transactions.find((t) => t.id === pickerTxId) : null;

  // Apply search filter client-side (case-insensitive): matches description,
  // category name, category tax export code, or tax description.
  const filtered = transactions.filter((t) => {
    if (filterMissingTaxDesc && (t.taxDescription ?? '').trim() !== '') return false;
    const q = search.trim().toLowerCase();
    if (q) {
      const cat = t.categoryId != null ? categories.find((c) => c.id === t.categoryId) : undefined;
      const haystack = [
        t.description,
        t.taxDescription ?? '',
        cat?.name ?? '',
        cat?.taxExportCode ?? '',
      ].join(' \u0000 ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = filtered.slice(pageStart, pageStart + pageSize);

  const sourceBadge = (source: string | null) => {
    if (!source || source === 'suggested') return null;
    const styles: Record<string, React.CSSProperties> = {
      manual: { background: '#E7F1EA', color: '#1F5C4A' },
      rule:   { background: '#FBEFD0', color: '#8A5A20' },
    };
    const s = styles[source] ?? { background: '#EFE8D4', color: '#5E5E5E' };
    return (
      <span style={{ ...s, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500 }}>
        {source}
      </span>
    );
  };

  return (
    <div>
      <h1>Transactions</h1>

      {/* Filters */}
      <div style={filterBarStyle}>
        <label style={fieldStyle}>Account
          <select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)} style={inputStyle}>
            <option value="">All</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label style={fieldStyle}>From
          <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} style={inputStyle} />
        </label>
        <label style={fieldStyle}>To
          <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} style={inputStyle} />
        </label>
        <label style={fieldStyle}>Source
          <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} style={inputStyle}>
            <option value="">All</option>
            <option value="rule">Rule</option>
            <option value="manual">Manual</option>
            <option value="suggested">Suggested</option>
          </select>
        </label>
        <label style={fieldStyle}>Receipts
          <select value={filterReceipt} onChange={(e) => setFilterReceipt(e.target.value)} style={inputStyle}>
            <option value="">All</option>
            <option value="true">Has receipts</option>
            <option value="false">No receipts</option>
          </select>
        </label>
        <label style={{ ...fieldStyle, flex: 1, minWidth: 180 }}>Search
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Description, category, tax code, tax desc…"
            style={inputStyle}
          />
        </label>
        <label style={{ ...fieldStyle, alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 6 }}>
          <input type="checkbox" checked={filterUncategorized} onChange={(e) => setFilterUncategorized(e.target.checked)} />
          Uncategorized only
        </label>
        <label style={{ ...fieldStyle, alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 6 }}>
          <input type="checkbox" checked={filterMissingTaxDesc} onChange={(e) => setFilterMissingTaxDesc(e.target.checked)} />
          Missing tax description
        </label>
        <button onClick={() => void load()} style={buttonStyle}>Refresh</button>
        {selectedIds.size > 0 && (
          <button
            onClick={() => void deleteSelected()}
            style={{ ...buttonStyle, background: '#9A2D20', color: '#fff', borderColor: '#9A2D20' }}
          >
            Delete selected ({selectedIds.size})
          </button>
        )}
        <button
          onClick={() => {
            const params: Record<string, string | number | boolean> = {};
            if (filterAccount) params.accountId = Number(filterAccount);
            if (filterDateFrom) params.dateFrom = filterDateFrom;
            if (filterDateTo) params.dateTo = filterDateTo;
            if (filterSource) params.categorySource = filterSource;
            if (filterReceipt) params.hasReceipts = filterReceipt === 'true';
            if (filterUncategorized) params.uncategorized = true;
            window.location.href = api.reports.transactionsExportUrl(params);
          }}
          style={buttonStyle}
          title="Download the currently-filtered transactions as CSV (search/missing-tax-desc filters apply only in-app)"
        >
          ⬇ Export CSV
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, color: '#555', fontSize: 13 }}>
        <span>
          {filtered.length === 0
            ? 'No transactions'
            : `Showing ${pageStart + 1}–${Math.min(pageStart + pageSize, filtered.length)} of ${filtered.length}`}
          {search && transactions.length !== filtered.length && (
            <span style={{ color: '#888' }}> (filtered from {transactions.length})</span>
          )}
        </span>
        <span>
          Page size:&nbsp;
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ ...inputStyle, padding: '2px 6px' }}>
            {[10, 25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </span>
      </div>

      <div className="desktop-only table-wrap" style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: 32 }}>
              <input
                type="checkbox"
                title="Select all on this page"
                checked={pageRows.length > 0 && pageRows.every((t) => selectedIds.has(t.id))}
                onChange={(e) => {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) pageRows.forEach((t) => next.add(t.id));
                    else pageRows.forEach((t) => next.delete(t.id));
                    return next;
                  });
                }}
              />
            </th>
            <th style={thStyle}>Date</th>
            <th style={thStyle}>Account</th>
            <th style={thStyle}>Description</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
            <th style={thStyle}>Category</th>
            <th style={thStyle}>Tax Description</th>
            <th style={thStyle}>Source</th>
            <th style={thStyle}>Receipts</th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((tx, idx) => {
            const txReceipts = receiptMap.get(tx.id) ?? [];
            const isUncategorized = tx.categoryId == null;
            const isTransfer = isTransferCategory(tx.categoryId);
            const isSuggested = tx.categorySource === 'suggested';
            const rowBase: React.CSSProperties = {
              borderBottom: '1px solid #eee',
              background: idx % 2 === 0 ? '#FFFDF8' : '#F7F3E8',
            };
            const rowStyle: React.CSSProperties = isUncategorized
              ? { ...rowBase, background: '#FBE8E2', borderLeft: '3px solid #9A2D20' }
              : isTransfer
                ? { ...rowBase, background: '#EFE8D4', color: '#5E5E5E' }
                : isSuggested
                  ? { ...rowBase, background: '#FBEFD0' }
                  : rowBase;
            return (
              <tr key={tx.id} style={rowStyle}>
                <td style={{ ...tdStyle, width: 32 }}>
                  <input type="checkbox" checked={selectedIds.has(tx.id)} onChange={() => toggleSelect(tx.id)} />
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#555' }}>{tx.date}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#666', fontSize: 12 }}>{accName(tx.accountId)}</td>
                <td style={{ ...tdStyle, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }} title={tx.description}>
                  {tx.description}
                </td>
                <td style={{ ...tdStyle, color: tx.amount < 0 ? '#c0392b' : '#2a8a3e', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: 500 }}>
                  {tx.amount < 0 ? '−' : '+'}${Math.abs(tx.amount).toFixed(2)}
                </td>
                <td style={tdStyle}>
                  <CategoryCombobox
                    categories={categories}
                    value={tx.categoryId}
                    onChange={(id) => { if (id != null) void updateCategory(tx, id); }}
                    onCreateNew={() => setCreateCatForTx(tx)}
                    invalid={isUncategorized}
                    width={190}
                  />
                </td>
                <td style={tdStyle}>
                  <input
                    type="text"
                    defaultValue={tx.taxDescription ?? ''}
                    placeholder="Business purpose"
                    onBlur={(e) => void saveTaxDescription(tx, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    style={{ ...inputStyle, width: 190, fontSize: 12 }}
                    title="Justification for this expense in case of an audit"
                  />
                </td>
                <td style={tdStyle}>
                  {isSuggested
                    ? <span title={`Suggested: ${catName(tx.suggestedCategoryId)}`} style={{ background: '#FBEFD0', color: '#8A5A20', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 500 }}>⚡ suggested</span>
                    : sourceBadge(tx.categorySource) ?? <span style={{ color: '#bbb', fontSize: 11 }}>—</span>}
                </td>
                <td style={{ ...tdStyle, fontSize: 12 }}>
                  {txReceipts.length > 0 && (
                    <div style={{ marginBottom: 3 }}>
                      {txReceipts.map((r) =>
                        r.driveWebViewLink
                          ? <a key={r.id} href={r.driveWebViewLink} target="_blank" rel="noreferrer" style={{ display: 'block', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.driveFileName}>{r.driveFileName}</a>
                          : <span key={r.id} style={{ display: 'block' }}>{r.driveFileName}</span>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => setPickerTxId(tx.id)}
                    style={smallButtonStyle}
                    title="Manage receipts"
                  >
                    {txReceipts.length === 0 ? '+ Add' : '✎ Edit'}
                  </button>
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {isSuggested && (
                    <button onClick={() => void approve(tx)} style={{ ...smallButtonStyle, marginRight: 4, background: '#E7F1EA', borderColor: '#2E7D61', color: '#1F5C4A' }}>✓ Approve</button>
                  )}
                  {aiEnabled && (
                    <button
                      onClick={() => setAiAssistTx(tx)}
                      style={{ ...smallButtonStyle, marginRight: 4 }}
                      title="AI: suggest category, tax description, and rule"
                    >
                      ✨ AI
                    </button>
                  )}
                  <button
                    onClick={() => setEditTx(tx)}
                    style={{ ...smallButtonStyle, marginRight: 4 }}
                    title="Edit date, description, or amount (fix parser mistakes)"
                  >
                    ✎ Edit
                  </button>
                  <button
                    onClick={() => setCreateRuleForTx(tx)}
                    style={smallButtonStyle}
                    title="Create a rule from this transaction"
                  >
                    + Rule
                  </button>
                  <button
                    onClick={() => void deleteOne(tx)}
                    style={{ ...smallButtonStyle, marginLeft: 4, color: '#9A2D20', borderColor: '#9A2D20' }}
                    title="Delete this transaction"
                  >
                    ✕ Delete
                  </button>
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && <tr><td colSpan={10} style={{ ...tdStyle, color: '#888', textAlign: 'center', padding: 24 }}>No transactions found.</td></tr>}
        </tbody>
      </table>
      </div>

      {/* Mobile card list — shown only on narrow viewports via CSS */}
      <div className="mobile-only" style={{ display: 'none' }}>
        {pageRows.length === 0 ? (
          <div style={{ color: '#5E5E5E', textAlign: 'center', padding: 24, border: '1px solid #E6DFCB', borderRadius: 10, background: '#FFFDF8' }}>
            No transactions found.
          </div>
        ) : pageRows.map((tx) => {
          const txReceipts = receiptMap.get(tx.id) ?? [];
          const isUncategorized = tx.categoryId == null;
          const isTransfer = isTransferCategory(tx.categoryId);
          const isSuggested = tx.categorySource === 'suggested';
          const cardStyle: React.CSSProperties = {
            background: isUncategorized ? '#fff3ee' : isTransfer ? '#f4f4f4' : isSuggested ? '#fffbe6' : '#fff',
            border: '1px solid #e1e4e8',
            borderLeft: isUncategorized ? '4px solid #d9534f' : '1px solid #e1e4e8',
            borderRadius: 6,
            padding: 12,
            marginBottom: 10,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            color: isTransfer ? '#777' : undefined,
          };
          return (
            <div key={tx.id} style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 12, color: '#666', whiteSpace: 'nowrap' }}>{tx.date}</span>
                <span style={{
                  color: tx.amount < 0 ? '#c0392b' : '#2a8a3e',
                  fontWeight: 600, fontSize: 16, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                }}>
                  {tx.amount < 0 ? '−' : '+'}${Math.abs(tx.amount).toFixed(2)}
                </span>
              </div>
              <div style={{ fontWeight: 500, marginTop: 4, wordBreak: 'break-word' }}>{tx.description}</div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                {accName(tx.accountId)}
                {' · '}
                {isSuggested
                  ? <span title={`Suggested: ${catName(tx.suggestedCategoryId)}`} style={{ background: '#FBEFD0', color: '#8A5A20', padding: '1px 6px', borderRadius: 999, fontSize: 11 }}>⚡ suggested</span>
                  : sourceBadge(tx.categorySource) ?? <span style={{ color: '#bbb' }}>manual entry</span>}
              </div>

              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 11, color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Category
                  <div style={{ marginTop: 4 }}>
                    <CategoryCombobox
                      categories={categories}
                      value={tx.categoryId}
                      onChange={(id) => { if (id != null) void updateCategory(tx, id); }}
                      onCreateNew={() => setCreateCatForTx(tx)}
                      invalid={isUncategorized}
                      width="100%"
                    />
                  </div>
                </label>
                <label style={{ fontSize: 11, color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Tax Description
                  <input
                    type="text"
                    defaultValue={tx.taxDescription ?? ''}
                    placeholder="Business purpose"
                    onBlur={(e) => void saveTaxDescription(tx, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    style={{ ...inputStyle, width: '100%', marginTop: 4 }}
                  />
                </label>
              </div>

              {txReceipts.length > 0 && (
                <div style={{ fontSize: 12, marginTop: 8 }}>
                  <div style={{ color: '#555', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Receipts</div>
                  {txReceipts.map((r) =>
                    r.driveWebViewLink
                      ? <a key={r.id} href={r.driveWebViewLink} target="_blank" rel="noreferrer" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.driveFileName}>{r.driveFileName}</a>
                      : <span key={r.id} style={{ display: 'block' }}>{r.driveFileName}</span>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {isSuggested && (
                  <button onClick={() => void approve(tx)} style={{ ...smallButtonStyle, background: '#E7F1EA', borderColor: '#2E7D61', color: '#1F5C4A' }}>✓ Approve</button>
                )}
                <button onClick={() => setPickerTxId(tx.id)} style={smallButtonStyle}>
                  {txReceipts.length === 0 ? '+ Receipt' : '✎ Receipts'}
                </button>
                {aiEnabled && (
                  <button onClick={() => setAiAssistTx(tx)} style={smallButtonStyle}>✨ AI</button>
                )}
                <button onClick={() => setEditTx(tx)} style={smallButtonStyle}>✎ Edit</button>
                <button onClick={() => setCreateRuleForTx(tx)} style={smallButtonStyle}>+ Rule</button>
                <button onClick={() => void deleteOne(tx)} style={{ ...smallButtonStyle, color: '#9A2D20', borderColor: '#9A2D20' }}>✕ Delete</button>
              </div>
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, marginTop: 12 }}>
          <button onClick={() => setPage(1)} disabled={currentPage === 1} style={pageButtonStyle}>«</button>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} style={pageButtonStyle}>‹</button>
          <span style={{ padding: '0 12px', fontSize: 13, color: '#555' }}>Page {currentPage} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} style={pageButtonStyle}>›</button>
          <button onClick={() => setPage(totalPages)} disabled={currentPage === totalPages} style={pageButtonStyle}>»</button>
        </div>
      )}

      {pickerTx && (
        <ReceiptPicker
          transactionId={pickerTx.id}
          linkedReceipts={receiptMap.get(pickerTx.id) ?? []}
          onClose={() => setPickerTxId(null)}
          onChanged={() => void refreshReceipts(pickerTx.id)}
        />
      )}

      {createCatForTx && (
        <CreateCategoryDialog
          defaultKind={createCatForTx.amount < 0 ? 'expense' : 'income'}
          onClose={() => setCreateCatForTx(null)}
          onCreated={async (cat) => {
            const tx = createCatForTx;
            setCreateCatForTx(null);
            await updateCategory(tx, cat.id);
          }}
        />
      )}

      {createRuleForTx && (
        <CreateRuleDialog
          tx={createRuleForTx}
          categories={categories}
          onClose={() => setCreateRuleForTx(null)}
          onCreateCategory={() => {
            const tx = createRuleForTx;
            setCreateRuleForTx(null);
            setCreateCatForTx(tx);
          }}
          onCreated={() => {
            setCreateRuleForTx(null);
            void load();
          }}
        />
      )}

      {aiAssistTx && (
        <AiAssistModal
          tx={aiAssistTx}
          categories={categories}
          onClose={() => setAiAssistTx(null)}
          onApplied={() => void load()}
        />
      )}

      {editTx && (
        <EditTransactionModal
          tx={editTx}
          onClose={() => setEditTx(null)}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
}

// ── Create Category dialog ──────────────────────────────────────────────────
function CreateCategoryDialog({
  defaultKind,
  onClose,
  onCreated,
}: {
  defaultKind: CategoryKind;
  onClose: () => void;
  onCreated: (cat: Category) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>(defaultKind);
  const [taxExportCode, setTaxExportCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const cat = await api.categories.create({
        name: name.trim(),
        kind,
        taxExportCode: taxExportCode.trim() || null,
      });
      onCreated(cat);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Create category" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label>Name<br />
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
        </label>
        <label>Kind<br />
          <select value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="transfer">Transfer (excluded from reports)</option>
          </select>
        </label>
        <label>Tax export code (optional)<br />
          <input value={taxExportCode} onChange={(e) => setTaxExportCode(e.target.value)} style={{ width: '100%' }} />
        </label>
        {error && <div style={{ color: '#c00' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button onClick={() => void submit()} disabled={busy}>Create</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Create Rule dialog ──────────────────────────────────────────────────────
function CreateRuleDialog({
  tx,
  categories,
  onClose,
  onCreated,
  onCreateCategory,
}: {
  tx: Transaction;
  categories: Category[];
  onClose: () => void;
  onCreated: () => void;
  onCreateCategory: () => void;
}) {
  const [name, setName] = useState(`Auto: ${tx.description}`.slice(0, 80));
  const [descriptionPattern, setDescriptionPattern] = useState(tx.description);
  const [patternKind, setPatternKind] = useState<PatternKind>('substring');
  const [categoryId, setCategoryId] = useState<string>(tx.categoryId != null ? String(tx.categoryId) : '');
  const [priority, setPriority] = useState('0');
  const [taxDescription, setTaxDescription] = useState(tx.taxDescription ?? '');
  const [applyNow, setApplyNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!descriptionPattern.trim()) { setError('Pattern is required'); return; }
    if (!categoryId) { setError('Category is required'); return; }
    setBusy(true);
    setError(null);
    try {
      const rule = await api.rules.create({
        name: name.trim() || `Auto: ${descriptionPattern}`,
        descriptionPattern: descriptionPattern.trim(),
        patternKind,
        categoryId: Number(categoryId),
        priority: Number(priority) || 0,
        taxDescription: taxDescription.trim() || null,
      });
      if (applyNow) {
        try { await api.rules.apply(rule.id); } catch { /* ignore apply failure */ }
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Create rule" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: '#555' }}>
          From transaction: <strong>{tx.description}</strong>
        </div>
        <label>Rule name<br />
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
        </label>
        <label>Description pattern<br />
          <input value={descriptionPattern} onChange={(e) => setDescriptionPattern(e.target.value)} style={{ width: '100%' }} />
        </label>
        <label>Pattern kind<br />
          <select value={patternKind} onChange={(e) => setPatternKind(e.target.value as PatternKind)}>
            <option value="substring">Substring (case-insensitive)</option>
            <option value="regex">Regex</option>
          </select>
        </label>
        <label>Category<br />
          <CategoryCombobox
            categories={categories}
            value={categoryId ? Number(categoryId) : null}
            onChange={(id) => setCategoryId(id != null ? String(id) : '')}
            onCreateNew={onCreateCategory}
            placeholder="Select…"
            width="100%"
          />
        </label>
        <label>Priority<br />
          <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} style={{ width: 100 }} />
        </label>
        <label>Tax description (optional)<br />
          <input
            value={taxDescription}
            onChange={(e) => setTaxDescription(e.target.value)}
            placeholder="Applied to matching transactions without one"
            style={{ width: '100%' }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={applyNow} onChange={(e) => setApplyNow(e.target.checked)} />
          Apply to existing matching transactions now
        </label>
        {error && <div style={{ color: '#c00' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button onClick={() => void submit()} disabled={busy}>Create rule</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Modal shell ─────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#FFFDF8', borderRadius: 14, padding: 20, width: 420, maxWidth: '90vw', boxShadow: '0 12px 40px rgba(31,41,32,0.22)', border: '1px solid #E6DFCB' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const tableWrapStyle: React.CSSProperties = {
  border: '1px solid #E6DFCB',
  borderRadius: 10,
  overflow: 'auto',
  background: '#FFFDF8',
  boxShadow: '0 1px 2px rgba(31, 41, 32, 0.05), 0 1px 3px rgba(31, 41, 32, 0.04)',
};
const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  background: '#F7F3E8',
  borderBottom: '1px solid #E6DFCB',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: '#5E5E5E',
  position: 'sticky',
  top: 0,
  zIndex: 1,
};
const tdStyle: React.CSSProperties = {
  padding: '6px 10px',
  verticalAlign: 'middle',
};
const filterBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  marginBottom: 14,
  alignItems: 'flex-end',
  padding: 12,
  background: '#F7F3E8',
  border: '1px solid #E6DFCB',
  borderRadius: 10,
};
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 11,
  color: '#5E5E5E',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  fontWeight: 600,
};
const inputStyle: React.CSSProperties = {
  padding: '4px 8px',
  border: '1px solid #E1DACB',
  borderRadius: 6,
  fontSize: 13,
  background: '#FFFDF8',
  fontFamily: 'inherit',
  color: '#2B2B2B',
  textTransform: 'none',
  letterSpacing: 0,
  fontWeight: 400,
};
const buttonStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: '#FFFDF8',
  border: '1px solid #E1DACB',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  color: '#2B2B2B',
};
const smallButtonStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '3px 8px',
  background: '#FFFDF8',
  border: '1px solid #E1DACB',
  borderRadius: 6,
  cursor: 'pointer',
  color: '#2B2B2B',
};
const pageButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  background: '#FFFDF8',
  border: '1px solid #E1DACB',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  minWidth: 32,
  color: '#2B2B2B',
};
