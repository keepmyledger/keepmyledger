import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  Account, ImportResult, PreviewResponse, CsvColumnMapping,
} from '@keepmyledger/shared';
import { api } from '../api/client';

type Stage = 'upload' | 'preview' | 'done';

export function ImportPage() {
  const [searchParams] = useSearchParams();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<number | ''>('');
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>('upload');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [mapping, setMapping] = useState<CsvColumnMapping | null>(null);
  const [rememberMapping, setRememberMapping] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.accounts.list().then((list) => {
      setAccounts(list);
      const hint = searchParams.get('accountId');
      if (hint) setAccountId(Number(hint));
      else if (list.length > 0) setAccountId(list[0].id);
    });
  }, []);

  // Abandon outstanding preview on unmount.
  useEffect(() => {
    return () => {
      if (preview?.token && stage === 'preview') {
        void api.imports.abandon(preview.token).catch(() => undefined);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview?.token, stage]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const name = f.name.toLowerCase();
    const ok = f.type === 'application/pdf'
      || f.type === 'text/csv'
      || name.endsWith('.pdf')
      || name.endsWith('.csv')
      || name.endsWith('.tsv')
      || name.endsWith('.qif');
    if (ok) setFile(f);
  };

  const submitPreview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId || !file) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.imports.preview(file, Number(accountId));
      setPreview(res);
      setMapping(res.csv?.appliedMapping ?? res.csv?.detectedMapping ?? null);
      setStage('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const reparse = async (next: CsvColumnMapping | null) => {
    if (!preview?.token) return;
    setReparsing(true);
    setError('');
    try {
      const res = await api.imports.reparse(preview.token, next);
      setPreview(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReparsing(false);
    }
  };

  const setMappingField = (
    key: 'date' | 'description' | 'amount' | 'debit' | 'credit',
    value: number | undefined,
  ) => {
    const base: CsvColumnMapping = mapping ?? { date: 0, description: 0 };
    const next: CsvColumnMapping = { ...base };
    if (value === undefined) {
      delete next[key];
    } else {
      (next as unknown as Record<string, number>)[key] = value;
    }
    // amount vs debit/credit are mutually exclusive — clear the other side.
    if (key === 'amount' && value !== undefined) {
      delete next.debit;
      delete next.credit;
    } else if ((key === 'debit' || key === 'credit') && value !== undefined) {
      delete next.amount;
    }
    setMapping(next);
    void reparse(next);
  };

  const cancel = async () => {
    if (preview?.token) {
      try { await api.imports.abandon(preview.token); } catch { /* ignore */ }
    }
    setPreview(null);
    setMapping(null);
    setStage('upload');
    setFile(null);
    setError('');
  };

  const commit = async () => {
    if (!preview?.token || !accountId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.imports.commit({
        token: preview.token,
        accountId: Number(accountId),
        mapping: preview.kind === 'csv' ? mapping : undefined,
        rememberMapping: preview.kind === 'csv' ? rememberMapping : undefined,
      });
      setResult(res);
      setStage('done');
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const restart = () => {
    setResult(null);
    setFile(null);
    setStage('upload');
    setError('');
  };

  return (
    <div>
      <h1>Import Transactions</h1>

      {stage === 'upload' && (
        <form onSubmit={(e) => void submitPreview(e)} style={formStyle}>
          <label>Account<br />
            <select value={accountId} onChange={(e) => setAccountId(Number(e.target.value))} required>
              <option value="">Select account…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>

          <div
            style={dropzone}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            {file ? <span>📄 {file.name}</span> : <span>Drag &amp; drop a PDF, CSV, or QIF here, or click to browse</span>}
            <input ref={fileRef} type="file" accept="application/pdf,text/csv,.pdf,.csv,.tsv,.qif" style={{ display: 'none' }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <p style={{ fontSize: 12, color: '#5E5E5E', margin: 0 }}>
            PDF: bank/credit-card statements from any bank.{' '}
            CSV: most bank exports — needs <code>date</code>, <code>description</code>, and either an <code>amount</code> column or split <code>debit</code>/<code>credit</code> columns.{' '}
            QIF: Quicken Interchange Format exported by most US banks and personal finance apps.
          </p>

          {error && <p style={{ color: 'red' }}>{error}</p>}
          <button type="submit" disabled={loading || !accountId || !file}>
            {loading ? 'Uploading…' : 'Preview'}
          </button>
        </form>
      )}

      {stage === 'preview' && preview && (
        <PreviewPane
          preview={preview}
          mapping={mapping}
          rememberMapping={rememberMapping}
          onRememberChange={setRememberMapping}
          onMappingChange={setMappingField}
          onConfirm={() => void commit()}
          onCancel={() => void cancel()}
          loading={loading}
          reparsing={reparsing}
          error={error}
        />
      )}

      {stage === 'done' && result && (
        <div style={resultBox}>
          <h3>Import Complete</h3>
          <p><strong>Period:</strong> {result.period} &nbsp;|&nbsp;
             <strong>Parser:</strong> {result.parserUsed} &nbsp;|&nbsp;
             <strong>Imported:</strong> {result.transactionsImported} &nbsp;|&nbsp;
             <strong>Duplicates skipped:</strong> {result.transactionsDuplicated}</p>
          <div className="table-wrap">
          <table style={tableStyle}>
            <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Category</th></tr></thead>
            <tbody>
              {result.transactions.map((tx) => (
                <tr key={tx.id}>
                  <td>{tx.date}</td>
                  <td>{tx.description}</td>
                  <td style={{ color: tx.amount < 0 ? '#c00' : '#080', textAlign: 'right' }}>
                    {tx.amount < 0 ? '-' : '+'}${Math.abs(tx.amount).toFixed(2)}
                  </td>
                  <td>
                    {tx.categorySource === 'suggested'
                      ? <span style={{ color: '#888' }}>Suggested (pending)</span>
                      : tx.categorySource ?? <span style={{ color: '#aaa' }}>Uncategorized</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <button onClick={restart} style={{ marginTop: 12 }}>Import another</button>
        </div>
      )}
    </div>
  );
}

// ── Preview pane ────────────────────────────────────────────────────────────

interface PreviewPaneProps {
  preview: PreviewResponse;
  mapping: CsvColumnMapping | null;
  rememberMapping: boolean;
  onRememberChange: (v: boolean) => void;
  onMappingChange: (
    key: 'date' | 'description' | 'amount' | 'debit' | 'credit',
    value: number | undefined,
  ) => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
  reparsing: boolean;
  error: string;
}

function PreviewPane({
  preview, mapping, rememberMapping, onRememberChange,
  onMappingChange, onConfirm, onCancel, loading, reparsing, error,
}: PreviewPaneProps) {
  const parsed = preview.parsed;
  const txs = parsed?.transactions ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={previewBox}>
        <h3 style={{ margin: '0 0 8px' }}>Preview</h3>
        {preview.kind === 'csv' && preview.csv && (
          <CsvMappingControls
            preview={preview}
            mapping={mapping}
            onMappingChange={onMappingChange}
            rememberMapping={rememberMapping}
            onRememberChange={onRememberChange}
          />
        )}
        {preview.kind === 'pdf' && parsed && (
          <p style={{ margin: 0, color: '#5E5E5E' }}>
            Parser: <strong>{parsed.parserUsed}</strong> · Period: <strong>{parsed.period}</strong>
          </p>
        )}
        {preview.kind === 'qif' && parsed && (
          <p style={{ margin: 0, color: '#5E5E5E' }}>
            Parser: <strong>qif</strong> · Period: <strong>{parsed.period}</strong>
          </p>
        )}
      </div>

      {reparsing && <p style={{ color: '#5E5E5E', margin: 0 }}>Re-parsing…</p>}

      {preview.parseError && (
        <p style={{ color: '#c00', margin: 0 }}>
          Could not parse: {preview.parseError}
        </p>
      )}

      {parsed && txs.length > 0 && (
        <div>
          <p style={{ margin: '0 0 6px', color: '#5E5E5E' }}>
            {txs.length} transactions · Period <strong>{parsed.period}</strong>
          </p>
          <div className="table-wrap">
            <table style={tableStyle}>
              <thead><tr><th>Date</th><th>Description</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
              <tbody>
                {txs.slice(0, 20).map((tx, i) => (
                  <tr key={i}>
                    <td>{tx.date}</td>
                    <td>{tx.description}</td>
                    <td style={{ color: tx.amount < 0 ? '#c00' : '#080', textAlign: 'right' }}>
                      {tx.amount < 0 ? '-' : '+'}${Math.abs(tx.amount).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {txs.length > 20 && (
              <p style={{ fontSize: 12, color: '#888' }}>…and {txs.length - 20} more</p>
            )}
          </div>
        </div>
      )}

      {error && <p style={{ color: 'red', margin: 0 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onConfirm} disabled={loading || reparsing || !parsed || txs.length === 0}>
          {loading ? 'Importing…' : `Confirm import (${txs.length})`}
        </button>
        <button onClick={onCancel} disabled={loading} type="button">Cancel</button>
      </div>
    </div>
  );
}

// ── CSV mapping controls ────────────────────────────────────────────────────

interface CsvMappingControlsProps {
  preview: PreviewResponse;
  mapping: CsvColumnMapping | null;
  onMappingChange: (
    key: 'date' | 'description' | 'amount' | 'debit' | 'credit',
    value: number | undefined,
  ) => void;
  rememberMapping: boolean;
  onRememberChange: (v: boolean) => void;
}

function CsvMappingControls({
  preview, mapping, onMappingChange, rememberMapping, onRememberChange,
}: CsvMappingControlsProps) {
  const csv = preview.csv!;
  const numCols = useMemo(() => {
    const a = csv.sampleRows[0]?.length ?? 0;
    const b = csv.header?.length ?? 0;
    return Math.max(a, b);
  }, [csv]);

  const columnLabel = (i: number): string => {
    if (csv.hasHeader && csv.header && csv.header[i]) return `${i + 1}: ${csv.header[i]}`;
    return `Column ${i + 1}`;
  };

  const renderSelect = (
    key: 'date' | 'description' | 'amount' | 'debit' | 'credit',
    required: boolean,
  ) => {
    const value = mapping?.[key];
    return (
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 13, minWidth: 140 }}>
        <span>{key}{required ? ' *' : ''}</span>
        <select
          value={value === undefined ? '' : String(value)}
          onChange={(e) => {
            const v = e.target.value;
            onMappingChange(key, v === '' ? undefined : Number(v));
          }}
        >
          {!required && <option value="">(none)</option>}
          {Array.from({ length: numCols }, (_, i) => (
            <option key={i} value={i}>{columnLabel(i)}</option>
          ))}
        </select>
      </label>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ margin: 0, fontSize: 13, color: '#5E5E5E' }}>
        Delimiter: <code>{csv.delimiter === '\t' ? '\\t' : csv.delimiter}</code>{' · '}
        {csv.hasHeader ? 'Header row detected' : 'No header detected (auto-inferred from data)'}{' · '}
        {csv.totalRows} rows
      </p>

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 13 }}>
          Column mapping {mapping ? `(date=${mapping.date + 1}, desc=${mapping.description + 1})` : ''}
        </summary>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
          {renderSelect('date', true)}
          {renderSelect('description', true)}
          {renderSelect('amount', false)}
          {renderSelect('debit', false)}
          {renderSelect('credit', false)}
        </div>
        <p style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
          Use <em>amount</em> for a single signed-amount column, or both <em>debit</em> and <em>credit</em>{' '}
          for split columns. Selecting one clears the other.
        </p>

        {csv.sampleRows.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table style={{ ...tableStyle, fontSize: 12 }}>
              <thead>
                <tr>
                  {Array.from({ length: numCols }, (_, i) => (
                    <th key={i}>{columnLabel(i)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csv.sampleRows.slice(0, 5).map((row, i) => (
                  <tr key={i}>
                    {Array.from({ length: numCols }, (_, j) => (
                      <td key={j}>{row[j] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      <label style={{ fontSize: 13 }}>
        <input
          type="checkbox"
          checked={rememberMapping}
          onChange={(e) => onRememberChange(e.target.checked)}
        />{' '}
        Remember this column mapping for future imports on this account
      </label>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const formStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480, marginBottom: 24,
};
const dropzone: React.CSSProperties = {
  border: '2px dashed #9A6B12', borderRadius: 10, padding: '32px 16px',
  textAlign: 'center', cursor: 'pointer', color: '#5E5E5E', background: '#F7F3E8',
};
const resultBox: React.CSSProperties = {
  background: '#E7F1EA', border: '1px solid #2E7D61', borderRadius: 10, padding: 16,
};
const previewBox: React.CSSProperties = {
  background: '#F7F3E8', border: '1px solid #9A6B12', borderRadius: 10, padding: 16,
};
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', marginTop: 12 };
