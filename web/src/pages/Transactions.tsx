import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Transaction, Account, Category, Receipt, CategoryKind, PatternKind } from '@keepmyledger/shared';
import { api } from '../api/client';
import { ReceiptPicker } from '../components/ReceiptPicker';
import { CategoryCombobox } from '../components/CategoryCombobox';
import { AiAssistModal } from '../components/AiAssistModal';
import { EditTransactionModal } from '../components/EditTransactionModal';
import { SplitModal } from '../components/SplitModal';
import { ConfirmModal } from '../components/ConfirmModal';
import { useAuth } from '../auth/AuthContext';
import { useSetting } from '../settings';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { receiptView } from '../utils/receipt';
import { colors } from '../styles/tokens';

export function TransactionsPage() {
  useDocumentTitle('Transactions');
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
  const [splitTx, setSplitTx] = useState<Transaction | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<Transaction | 'bulk' | null>(null);

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
  const [defaultPageSize, setDefaultPageSize] = useSetting('transactionsPageSize');
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [gearOpen, setGearOpen] = useState(false);
  const gearRef = useRef<HTMLDivElement>(null);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  // Follow the default when it changes
  useEffect(() => { setPageSize(defaultPageSize); }, [defaultPageSize]);
  // Close gear popover on outside click
  useEffect(() => {
    if (!gearOpen) return;
    const handler = (e: MouseEvent) => {
      if (gearRef.current && !gearRef.current.contains(e.target as Node)) setGearOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [gearOpen]);

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

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const deleteOne = (tx: Transaction) => setConfirmDelete(tx);

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    setConfirmDelete('bulk');
  };

  const doDelete = async () => {
    if (confirmDelete === null) return;
    if (confirmDelete === 'bulk') {
      await api.transactions.bulkDelete([...selectedIds]);
    } else {
      await api.transactions.delete(confirmDelete.id);
    }
    setConfirmDelete(null);
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
      manual: { background: colors.successBg, color: colors.successFg },
      rule:   { background: colors.warningBg, color: colors.warningFg },
    };
    const s = styles[source] ?? { background: colors.creamDeep, color: colors.mutedGray };
    return (
      <span style={{ ...s, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500 }}>
        {source}
      </span>
    );
  };

  return (
    <div>
      <h1>Transactions</h1>

      {/* Primary filters */}
      <div style={{ ...filterBarStyle, marginBottom: filterPanelOpen ? 4 : 8 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search description, category…"
          style={{ ...inputStyle, flex: 1, minWidth: 180 }}
        />
        <label style={fieldStyle}>Account
          <select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)} style={inputStyle}>
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label style={fieldStyle}>From
          <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} style={inputStyle} />
        </label>
        <label style={fieldStyle}>To
          <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ ...fieldStyle, alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 6 }}>
          <input type="checkbox" checked={filterUncategorized} onChange={(e) => setFilterUncategorized(e.target.checked)} />
          Uncategorized
        </label>
        <button
          onClick={() => setFilterPanelOpen((o) => !o)}
          style={{ ...buttonStyle, alignSelf: 'flex-end', ...(filterPanelOpen ? { background: colors.successBg, borderColor: colors.forestGreen, color: colors.successFg } : {}) }}
          title="More filters"
        >
          {filterPanelOpen ? '⊟ Less' : '⊞ More'}
        </button>
        {selectedIds.size > 0 && (
          <button
            onClick={() => void deleteSelected()}
            style={{ ...buttonStyle, alignSelf: 'flex-end', background: colors.dangerFg, color: colors.warmWhite, borderColor: colors.dangerFg }}
          >
            Delete ({selectedIds.size})
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
          style={{ ...buttonStyle, alignSelf: 'flex-end' }}
          title="Export filtered transactions as CSV"
        >
          ⬇ CSV
        </button>
      </div>

      {/* Secondary filters */}
      {filterPanelOpen && (
        <div style={{ ...filterBarStyle, marginBottom: 8, padding: '8px 12px', background: colors.cream, borderRadius: 6, border: `1px solid ${colors.softLine}` }}>
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
          <label style={{ ...fieldStyle, alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 6 }}>
            <input type="checkbox" checked={filterMissingTaxDesc} onChange={(e) => setFilterMissingTaxDesc(e.target.checked)} />
            Missing tax description
          </label>
          <button onClick={() => void load()} style={{ ...buttonStyle, alignSelf: 'flex-end' }}>↺ Refresh</button>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, color: colors.mutedGray, fontSize: 13 }}>
        <span>
          {filtered.length === 0
            ? 'No transactions'
            : `Showing ${pageStart + 1}–${Math.min(pageStart + pageSize, filtered.length)} of ${filtered.length}`}
          {search && transactions.length !== filtered.length && (
            <span style={{ color: colors.hintText }}> (filtered from {transactions.length})</span>
          )}
        </span>
        <div ref={gearRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setGearOpen((o) => !o)}
            title="Table settings"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.hintText, fontSize: 16, lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}
          >
            ⚙
          </button>
          {gearOpen && (
            <div style={{
              position: 'absolute', right: 0, top: '100%', marginTop: 4,
              background: colors.warmWhite, borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              border: `1px solid ${colors.softLine}`, padding: '12px 16px', zIndex: 100, minWidth: 160,
            }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ fontWeight: 500, color: colors.mutedGray }}>Rows per page</span>
                <select
                  value={pageSize}
                  onChange={(e) => { const n = Number(e.target.value); setPageSize(n); setDefaultPageSize(n); setGearOpen(false); }}
                  style={{ ...inputStyle, padding: '4px 8px' }}
                >
                  {[10, 25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
          )}
        </div>
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
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((tx, idx) => {
            const txReceipts = receiptMap.get(tx.id) ?? [];
            const isUncategorized = tx.categoryId == null;
            const isTransfer = isTransferCategory(tx.categoryId);
            const isSuggested = tx.categorySource === 'suggested';
            const isExpanded = expandedIds.has(tx.id);
            const rowBase: React.CSSProperties = {
              borderBottom: `1px solid ${colors.softLine}`,
              background: idx % 2 === 0 ? colors.warmWhite : colors.cream,
            };
            const rowStyle: React.CSSProperties = isUncategorized
              ? { ...rowBase, background: colors.dangerBg, borderLeft: `3px solid ${colors.dangerFg}` }
              : isTransfer
                ? { ...rowBase, background: colors.creamDeep, color: colors.mutedGray }
                : isSuggested
                  ? { ...rowBase, background: colors.warningBg }
                  : rowBase;
            return (
              <React.Fragment key={tx.id}>
                <tr style={rowStyle}>
                  <td style={{ ...tdStyle, width: 32 }}>
                    <input type="checkbox" checked={selectedIds.has(tx.id)} onChange={() => toggleSelect(tx.id)} />
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: colors.mutedGray }}>{tx.date}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: colors.mutedGray, fontSize: 12 }}>{accName(tx.accountId)}</td>
                  <td style={{ ...tdStyle, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }} title={tx.description}>
                    {tx.description}
                  </td>
                  <td style={{ ...tdStyle, color: tx.amount < 0 ? colors.goldAntique : colors.forestGreen, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: 500 }}>
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
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    {isSuggested && (
                      <button onClick={() => void approve(tx)} style={{ ...smallButtonStyle, marginRight: 4, background: colors.successBg, borderColor: colors.forestGreen, color: colors.successFg }}>✓ Approve</button>
                    )}
                    <button onClick={() => setEditTx(tx)} style={{ ...smallButtonStyle, marginRight: 4 }} title="Edit date, description, or amount">✎ Edit</button>
                    <button onClick={() => void deleteOne(tx)} style={{ ...smallButtonStyle, marginRight: 4, color: colors.dangerFg, borderColor: colors.dangerFg }} title="Delete">✕</button>
                    <button
                      onClick={() => toggleExpand(tx.id)}
                      style={{ ...smallButtonStyle, padding: '2px 6px', fontFamily: 'monospace' }}
                      title={isExpanded ? 'Collapse' : 'Show details'}
                    >
                      {isExpanded ? '▲' : '▼'}
                    </button>
                  </td>
                </tr>
                {isExpanded && (
                  <tr style={{ background: colors.creamDeep }}>
                    <td colSpan={7} style={{ padding: 0, borderBottom: `2px solid ${colors.surfaceLine}` }}>
                      <div style={{ display: 'flex', gap: 20, padding: '10px 12px 12px 44px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px', minWidth: 200 }}>
                          <span style={{ fontWeight: 600, color: colors.mutedGray, textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 11 }}>Tax Description</span>
                          <input
                            type="text"
                            defaultValue={tx.taxDescription ?? ''}
                            placeholder="Business purpose"
                            onBlur={(e) => void saveTaxDescription(tx, e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            style={{ ...inputStyle, fontSize: 12 }}
                            title="Justification for this expense in case of an audit"
                          />
                        </label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontWeight: 600, color: colors.mutedGray, textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 11 }}>Source</span>
                          {isSuggested
                            ? <span title={`Suggested: ${catName(tx.suggestedCategoryId)}`} style={{ background: colors.warningBg, color: colors.warningFg, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 500 }}>⚡ suggested</span>
                            : sourceBadge(tx.categorySource) ?? <span style={{ color: colors.hintText, fontSize: 11 }}>—</span>}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontWeight: 600, color: colors.mutedGray, textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 11 }}>Receipts</span>
                          {txReceipts.length > 0 && (
                            <div style={{ marginBottom: 4 }}>
                              {txReceipts.map((r) => {
                                const v = receiptView(r);
                                return v.href
                                  ? <a key={r.id} href={v.href} target="_blank" rel="noreferrer" style={{ display: 'block', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.name}>{v.name}</a>
                                  : <span key={r.id} style={{ display: 'block' }}>{v.name}</span>;
                              })}
                            </div>
                          )}
                          <button onClick={() => setPickerTxId(tx.id)} style={smallButtonStyle}>
                            {txReceipts.length === 0 ? '+ Receipt' : '✎ Receipts'}
                          </button>
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignSelf: 'flex-end' }}>
                          {aiEnabled && (
                            <button onClick={() => setAiAssistTx(tx)} style={smallButtonStyle} title="AI: suggest category, tax description, and rule">✨ AI</button>
                          )}
                          <button onClick={() => setCreateRuleForTx(tx)} style={smallButtonStyle} title="Create a rule from this transaction">+ Rule</button>
                          <button onClick={() => setSplitTx(tx)} style={smallButtonStyle} title="Split this transaction across multiple categories">⑂ Split</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {filtered.length === 0 && <tr><td colSpan={7} style={{ ...tdStyle, color: colors.mutedGray, textAlign: 'center', padding: 24 }}>No transactions found.</td></tr>}
        </tbody>
      </table>
      </div>

      {/* Mobile card list, shown only on narrow viewports via CSS */}
      <div className="mobile-only" style={{ display: 'none' }}>
        {pageRows.length === 0 ? (
          <div style={{ color: colors.mutedGray, textAlign: 'center', padding: 24, border: `1px solid ${colors.softLine}`, borderRadius: 10, background: colors.warmWhite }}>
            No transactions found.
          </div>
        ) : pageRows.map((tx) => {
          const txReceipts = receiptMap.get(tx.id) ?? [];
          const isUncategorized = tx.categoryId == null;
          const isTransfer = isTransferCategory(tx.categoryId);
          const isSuggested = tx.categorySource === 'suggested';
          const cardStyle: React.CSSProperties = {
            background: isUncategorized ? colors.dangerBg : isTransfer ? colors.creamDeep : isSuggested ? colors.warningBg : colors.warmWhite,
            border: `1px solid ${colors.softLine}`,
            borderLeft: isUncategorized ? `4px solid ${colors.dangerFg}` : `1px solid ${colors.softLine}`,
            borderRadius: 6,
            padding: 12,
            marginBottom: 10,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            color: isTransfer ? colors.mutedGray : undefined,
          };
          return (
            <div key={tx.id} style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 12, color: colors.mutedGray, whiteSpace: 'nowrap' }}>{tx.date}</span>
                <span style={{
                  color: tx.amount < 0 ? colors.goldAntique : colors.forestGreen,
                  fontWeight: 600, fontSize: 16, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                }}>
                  {tx.amount < 0 ? '−' : '+'}${Math.abs(tx.amount).toFixed(2)}
                </span>
              </div>
              <div style={{ fontWeight: 500, marginTop: 4, wordBreak: 'break-word' }}>{tx.description}</div>
              <div style={{ fontSize: 12, color: colors.mutedGray, marginTop: 2 }}>
                {accName(tx.accountId)}
                {' · '}
                {isSuggested
                  ? <span title={`Suggested: ${catName(tx.suggestedCategoryId)}`} style={{ background: colors.warningBg, color: colors.warningFg, padding: '1px 6px', borderRadius: 999, fontSize: 11 }}>⚡ suggested</span>
                  : sourceBadge(tx.categorySource) ?? <span style={{ color: colors.hintText }}>manual entry</span>}
              </div>

              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 11, color: colors.mutedGray, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
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
                <label style={{ fontSize: 11, color: colors.mutedGray, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
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
                  <div style={{ color: colors.mutedGray, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Receipts</div>
                  {txReceipts.map((r) => {
                    const v = receiptView(r);
                    return v.href
                      ? <a key={r.id} href={v.href} target="_blank" rel="noreferrer" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.name}>{v.name}</a>
                      : <span key={r.id} style={{ display: 'block' }}>{v.name}</span>;
                  })}
                </div>
              )}

              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {isSuggested && (
                  <button onClick={() => void approve(tx)} style={{ ...smallButtonStyle, background: colors.successBg, borderColor: colors.forestGreen, color: colors.successFg }}>✓ Approve</button>
                )}
                <button onClick={() => setPickerTxId(tx.id)} style={smallButtonStyle}>
                  {txReceipts.length === 0 ? '+ Receipt' : '✎ Receipts'}
                </button>
                {aiEnabled && (
                  <button onClick={() => setAiAssistTx(tx)} style={smallButtonStyle}>✨ AI</button>
                )}
                <button onClick={() => setEditTx(tx)} style={smallButtonStyle}>✎ Edit</button>
                <button onClick={() => setCreateRuleForTx(tx)} style={smallButtonStyle}>+ Rule</button>
                <button onClick={() => void deleteOne(tx)} style={{ ...smallButtonStyle, color: colors.dangerFg, borderColor: colors.dangerFg }}>✕ Delete</button>
              </div>
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, marginTop: 12 }}>
          <button onClick={() => setPage(1)} disabled={currentPage === 1} style={pageButtonStyle}>«</button>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} style={pageButtonStyle}>‹</button>
          <span style={{ padding: '0 12px', fontSize: 13, color: colors.mutedGray }}>Page {currentPage} of {totalPages}</span>
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

      {splitTx && (
        <SplitModal
          tx={splitTx}
          categories={categories}
          onClose={() => setSplitTx(null)}
          onSaved={() => void load()}
          onCreateCategory={() => setCreateCatForTx(splitTx)}
        />
      )}
      {confirmDelete !== null && (
        <ConfirmModal
          message={
            confirmDelete === 'bulk'
              ? `Delete ${selectedIds.size} selected transaction${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`
              : `Delete "${(confirmDelete as Transaction).description}" (${(confirmDelete as Transaction).date}, $${Math.abs((confirmDelete as Transaction).amount).toFixed(2)})?`
          }
          onConfirm={() => void doDelete()}
          onCancel={() => setConfirmDelete(null)}
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
        {error && <div style={{ color: colors.dangerFg }}>{error}</div>}
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
        <div style={{ fontSize: 12, color: colors.mutedGray }}>
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
        {error && <div style={{ color: colors.dangerFg }}>{error}</div>}
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
        style={{ background: colors.warmWhite, borderRadius: 14, padding: 20, width: 420, maxWidth: '90vw', boxShadow: '0 12px 40px rgba(31,41,32,0.22)', border: `1px solid ${colors.softLine}` }}
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
  border: `1px solid ${colors.softLine}`,
  borderRadius: 10,
  overflow: 'auto',
  background: colors.warmWhite,
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
  background: colors.cream,
  borderBottom: `1px solid ${colors.softLine}`,
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: colors.mutedGray,
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
  background: colors.cream,
  border: `1px solid ${colors.softLine}`,
  borderRadius: 10,
};
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 11,
  color: colors.mutedGray,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  fontWeight: 600,
};
const inputStyle: React.CSSProperties = {
  padding: '4px 8px',
  border: `1px solid ${colors.surfaceLine}`,
  borderRadius: 6,
  fontSize: 13,
  background: colors.warmWhite,
  fontFamily: 'inherit',
  color: colors.darkSlate,
  textTransform: 'none',
  letterSpacing: 0,
  fontWeight: 400,
};
const buttonStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: colors.warmWhite,
  border: `1px solid ${colors.surfaceLine}`,
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  color: colors.darkSlate,
};
const smallButtonStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '3px 8px',
  background: colors.warmWhite,
  border: `1px solid ${colors.surfaceLine}`,
  borderRadius: 6,
  cursor: 'pointer',
  color: colors.darkSlate,
};
const pageButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  background: colors.warmWhite,
  border: `1px solid ${colors.surfaceLine}`,
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  minWidth: 32,
  color: colors.darkSlate,
};
