import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  Account, ImportResult, PreviewResponse, CsvColumnMapping, PendingDuplicate,
} from '@keepmyledger/shared';
import { api } from '../api/client';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { colors, radii } from '../styles/tokens';

type Stage = 'upload' | 'preview' | 'done';
type LlmConsentState = 'idle' | 'prompting' | 'loading';
type SampleState = 'idle' | 'loading' | 'submitted' | 'error';

export function ImportPage() {
  useDocumentTitle('Import');
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
  const [llmConsent, setLlmConsent] = useState<LlmConsentState>('idle');
  const [sampleState, setSampleState] = useState<SampleState>('idle');
  const [bankHint, setBankHint] = useState('');
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
      || name.endsWith('.qif')
      || name.endsWith('.ofx')
      || name.endsWith('.qfx');
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
    // amount vs debit/credit are mutually exclusive; clear the other side.
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
    setLlmConsent('idle');
    setSampleState('idle');
    setBankHint('');
    setStage('upload');
    setFile(null);
    setError('');
  };

  const enhanceWithLlm = async () => {
    if (!preview?.token) return;
    setLlmConsent('loading');
    setError('');
    try {
      const res = await api.imports.enhanceLlm(
        preview.token,
        accountId !== '' ? Number(accountId) : undefined,
      );
      setPreview(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLlmConsent('idle');
    }
  };

  const submitSample = async () => {
    if (!preview?.token) return;
    setSampleState('loading');
    try {
      await api.imports.reportUnknown(
        preview.token,
        bankHint.trim() || undefined,
        accountId !== '' ? Number(accountId) : undefined,
      );
      setSampleState('submitted');
    } catch {
      setSampleState('error');
    }
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
            {file ? <span>📄 {file.name}</span> : <span>Drag &amp; drop a PDF, CSV, QIF, or OFX/QFX here, or click to browse</span>}
            <input ref={fileRef} type="file" accept="application/pdf,text/csv,.pdf,.csv,.tsv,.qif,.ofx,.qfx" style={{ display: 'none' }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <p style={{ fontSize: 12, color: colors.mutedGray, margin: 0 }}>
            PDF: bank/credit-card statements from any bank.{' '}
            CSV: most bank exports. Requires <code>date</code>, <code>description</code>, and either an <code>amount</code> column or split <code>debit</code>/<code>credit</code> columns.{' '}
            QIF: Quicken Interchange Format exported by most US banks and personal finance apps.
          </p>

          {error && <p style={{ color: colors.dangerFg }}>{error}</p>}
          <button type="submit" disabled={loading || !accountId || !file}>
            {loading ? 'Uploading…' : 'Preview'}
          </button>
        </form>
      )}

      {stage === 'preview' && preview && (
        <>
          <PreviewPane
            preview={preview}
            mapping={mapping}
            rememberMapping={rememberMapping}
            onRememberChange={setRememberMapping}
            onMappingChange={setMappingField}
            onConfirm={() => void commit()}
            onCancel={() => void cancel()}
            onRequestLlm={() => setLlmConsent('prompting')}
            llmConsent={llmConsent}
            sampleState={sampleState}
            bankHint={bankHint}
            onBankHintChange={setBankHint}
            onSubmitSample={() => void submitSample()}
            loading={loading}
            reparsing={reparsing}
            error={error}
          />
          {llmConsent === 'prompting' && (
            <LlmConsentModal
              onAccept={() => void enhanceWithLlm()}
              onCancel={() => setLlmConsent('idle')}
            />
          )}
        </>
      )}

      {stage === 'done' && result && (
        <DoneStage result={result} onUpdate={setResult} onRestart={restart} />
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
  onRequestLlm: () => void;
  llmConsent: LlmConsentState;
  sampleState: SampleState;
  bankHint: string;
  onBankHintChange: (v: string) => void;
  onSubmitSample: () => void;
  loading: boolean;
  reparsing: boolean;
  error: string;
}

function PreviewPane({
  preview, mapping, rememberMapping, onRememberChange,
  onMappingChange, onConfirm, onCancel, onRequestLlm, llmConsent,
  sampleState, bankHint, onBankHintChange, onSubmitSample, loading, reparsing, error,
}: PreviewPaneProps) {
  const parsed = preview.parsed;
  const txs = parsed?.transactions ?? [];
  const isGeneric = parsed?.parserUsed === 'generic';
  const showLlmOffer = preview.kind === 'pdf' && preview.llmAvailable && parsed?.parserUsed !== 'llm';
  const showSampleOffer = preview.kind === 'pdf' && isGeneric && txs.length === 0;

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
          <p style={{ margin: 0, color: colors.mutedGray }}>
            Parser: <strong>{parsed.parserUsed}</strong> · Period: <strong>{parsed.period}</strong>
          </p>
        )}
        {preview.kind === 'qif' && parsed && (
          <p style={{ margin: 0, color: colors.mutedGray }}>
            Parser: <strong>qif</strong> · Period: <strong>{parsed.period}</strong>
          </p>
        )}
        {preview.kind === 'ofx' && parsed && (
          <p style={{ margin: 0, color: colors.mutedGray }}>
            Parser: <strong>ofx</strong> · Period: <strong>{parsed.period}</strong>
          </p>
        )}
      </div>

      {showLlmOffer && (
        <div style={{
          background: colors.cream, border: `1px solid ${colors.softLine}`,
          borderRadius: radii.md, padding: '12px 16px',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
            {isGeneric && txs.length === 0
              ? "We couldn't identify this bank's format automatically."
              : 'Want a more accurate parse?'}
          </p>
          <p style={{ margin: 0, fontSize: 13, color: colors.mutedGray }}>
            AI-assisted parsing can improve results for unrecognized statement formats.
            {' '}Your statement will be sent to our AI provider. If successful, we'll save a
            parsing strategy for this bank so future imports won't need AI.
          </p>
          <button
            onClick={onRequestLlm}
            disabled={llmConsent === 'loading'}
            type="button"
            style={{
              alignSelf: 'flex-start', padding: '6px 14px', fontSize: 13,
              background: colors.forestGreen, color: colors.warmWhite,
              border: 'none', borderRadius: radii.md, cursor: 'pointer',
            }}
          >
            {llmConsent === 'loading' ? 'Parsing with AI…' : 'Parse with AI'}
          </button>
        </div>
      )}

      {showSampleOffer && (
        <div style={{
          background: colors.cream, border: `1px solid ${colors.softLine}`,
          borderRadius: radii.md, padding: '12px 16px',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
            Help us add support for this bank
          </p>
          <p style={{ margin: 0, fontSize: 13, color: colors.mutedGray }}>
            We couldn&apos;t extract transactions from this PDF. If you submit a redacted sample,
            we&apos;ll use it to add support for this statement format. Digits in account numbers,
            email addresses, and phone numbers will be masked before anything is stored.
          </p>
          {sampleState === 'submitted' ? (
            <p style={{ margin: 0, fontSize: 13, color: colors.forestGreen, fontWeight: 600 }}>
              Sample submitted — thank you!
            </p>
          ) : sampleState === 'error' ? (
            <p style={{ margin: 0, fontSize: 13, color: colors.dangerFg }}>
              Submission failed. You can try again or skip.
            </p>
          ) : null}
          {sampleState !== 'submitted' && (
            <>
              <input
                type="text"
                value={bankHint}
                onChange={(e) => onBankHintChange(e.target.value)}
                placeholder="Bank name (e.g., Wells Fargo) — optional but helpful"
                maxLength={100}
                disabled={sampleState === 'loading'}
                style={{
                  padding: '6px 10px', fontSize: 13,
                  border: `1px solid ${colors.softLine}`, borderRadius: radii.sm,
                  background: colors.warmWhite,
                }}
              />
              <button
                onClick={onSubmitSample}
                disabled={sampleState === 'loading'}
                type="button"
                style={{
                  alignSelf: 'flex-start', padding: '6px 14px', fontSize: 13,
                  background: colors.goldAntique, color: colors.warmWhite,
                  border: 'none', borderRadius: radii.md, cursor: 'pointer',
                }}
              >
                {sampleState === 'loading' ? 'Submitting…' : 'Submit Redacted Sample'}
              </button>
            </>
          )}
        </div>
      )}

      {reparsing && <p style={{ color: colors.mutedGray, margin: 0 }}>Re-parsing…</p>}

      {preview.parseError && (
        <p style={{ color: colors.dangerFg, margin: 0 }}>
          Could not parse: {preview.parseError}
        </p>
      )}

      {parsed && (parsed.warnings?.length ?? 0) > 0 && (
        <div
          role="alert"
          style={{
            background: colors.warningBg, color: colors.warningFg,
            border: `1px solid ${colors.goldSoft}`, borderRadius: radii.sm,
            padding: '10px 14px', fontSize: 13,
          }}
        >
          <strong style={{ display: 'block', marginBottom: 4 }}>
            Heads up &mdash; this import has {parsed.warnings!.length === 1 ? '1 concern' : `${parsed.warnings!.length} concerns`} to review
            {typeof parsed.confidence === 'number' && (
              <span style={{ fontWeight: 400, opacity: 0.85 }}> (confidence {Math.round(parsed.confidence * 100)}%)</span>
            )}
          </strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            {parsed.warnings!.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {parsed && txs.length > 0 && (
        <div>
          <p style={{ margin: '0 0 6px', color: colors.mutedGray }}>
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
                    <td style={{ color: tx.amount < 0 ? colors.goldAntique : colors.forestGreen, textAlign: 'right' }}>
                      {tx.amount < 0 ? '-' : '+'}${Math.abs(tx.amount).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {txs.length > 20 && (
              <p style={{ fontSize: 12, color: colors.hintText }}>…and {txs.length - 20} more</p>
            )}
          </div>
        </div>
      )}

      {error && <p style={{ color: colors.dangerFg, margin: 0 }}>{error}</p>}

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
      <p style={{ margin: 0, fontSize: 13, color: colors.mutedGray }}>
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
        <p style={{ fontSize: 12, color: colors.hintText, marginTop: 6 }}>
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

// ── LLM consent modal ────────────────────────────────────────────────────────

function LlmConsentModal({ onAccept, onCancel }: { onAccept: () => void; onCancel: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(43,43,43,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: colors.warmWhite, borderRadius: radii.lg, padding: 28,
        maxWidth: 460, width: '90%', display: 'flex', flexDirection: 'column', gap: 16,
        boxShadow: '0 8px 32px rgba(31,41,32,0.18)',
      }}>
        <h3 style={{ margin: 0 }}>Parse with AI?</h3>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
          Your statement will be sent to our AI provider (configured via <code>LLM_BASE_URL</code>)
          to extract transactions. No data is stored by the AI provider beyond the scope of this request.
        </p>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
          If parsing succeeds, we'll save a strategy for this bank format so{' '}
          <strong>future imports from this bank won't need AI</strong>.
        </p>
        <p style={{ margin: 0, fontSize: 13, color: colors.mutedGray }}>
          You can review all extracted transactions before confirming the import.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onAccept} style={{
            background: colors.forestGreen, color: colors.warmWhite,
            border: 'none', borderRadius: radii.md, padding: '8px 18px',
            cursor: 'pointer', fontWeight: 600,
          }}>
            Send to AI
          </button>
          <button onClick={onCancel} type="button" style={{
            background: colors.cream, color: colors.darkSlate,
            border: `1px solid ${colors.softLine}`, borderRadius: radii.md,
            padding: '8px 18px', cursor: 'pointer',
          }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const formStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480, marginBottom: 24,
};
const dropzone: React.CSSProperties = {
  border: `2px dashed ${colors.goldAntique}`, borderRadius: 10, padding: '32px 16px',
  textAlign: 'center', cursor: 'pointer', color: colors.mutedGray, background: colors.cream,
};
const resultBox: React.CSSProperties = {
  background: colors.successBg, border: `1px solid ${colors.forestGreen}`, borderRadius: 10, padding: 16,
};
const previewBox: React.CSSProperties = {
  background: colors.cream, border: `1px solid ${colors.goldAntique}`, borderRadius: 10, padding: 16,
};
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', marginTop: 12 };

function DoneStage({
  result, onUpdate, onRestart,
}: {
  result: ImportResult;
  onUpdate: (next: ImportResult) => void;
  onRestart: () => void;
}) {
  const pending = result.pendingReview ?? [];
  // Track per-row decisions; default everything to 'skip' (the safe choice — a
  // hash match in the DB is almost always a re-import of a row already on the
  // ledger).
  const [decisions, setDecisions] = useState<Record<string, 'keep' | 'skip'>>(() => {
    const map: Record<string, 'keep' | 'skip'> = {};
    for (const d of pending) map[d.externalHash] = 'skip';
    return map;
  });
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');
  const [resolved, setResolved] = useState(pending.length === 0);

  const setAll = (action: 'keep' | 'skip') => {
    const next: Record<string, 'keep' | 'skip'> = {};
    for (const d of pending) next[d.externalHash] = action;
    setDecisions(next);
  };

  const submit = async () => {
    setResolving(true);
    setResolveError('');
    try {
      const payload = pending.map((d) => ({
        externalHash: d.externalHash,
        action: decisions[d.externalHash] ?? 'skip',
        date: d.parsed.date,
        description: d.parsed.description,
        amount: d.parsed.amount,
      }));
      const res = await api.imports.resolveDuplicates(result.statementId, payload);
      onUpdate({
        ...result,
        transactionsImported: result.transactionsImported + res.inserted,
        pendingReview: [],
        transactions: res.transactions,
      });
      setResolved(true);
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolving(false);
    }
  };

  return (
    <div style={resultBox}>
      <h3>Import Complete</h3>
      <p>
        <strong>Period:</strong> {result.period} &nbsp;|&nbsp;
        <strong>Parser:</strong> {result.parserUsed} &nbsp;|&nbsp;
        <strong>Imported:</strong> {result.transactionsImported}
        {!resolved && pending.length > 0 && (
          <> &nbsp;|&nbsp; <strong>Needs review:</strong> {pending.length}</>
        )}
      </p>

      {!resolved && pending.length > 0 && (
        <div style={{
          background: colors.cream, border: `1px solid ${colors.softLine}`,
          borderRadius: radii.md, padding: 16, marginTop: 12,
        }}>
          <h4 style={{ marginTop: 0 }}>Possible duplicates ({pending.length})</h4>
          <p style={{ marginTop: 0, color: colors.mutedGray, fontSize: 13 }}>
            These rows match transactions already in your ledger. The default
            is to skip them as re-imports. If a row is a real second occurrence
            (e.g. two coffees on the same day), choose <em>Import anyway</em>.
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button type="button" onClick={() => setAll('skip')} disabled={resolving}>Skip all</button>
            <button type="button" onClick={() => setAll('keep')} disabled={resolving}>Import all</button>
          </div>
          <div className="table-wrap">
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th>New row</th>
                  <th>Existing row</th>
                  <th style={{ width: 220 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((d) => (
                  <DuplicateRow
                    key={d.externalHash}
                    pending={d}
                    decision={decisions[d.externalHash] ?? 'skip'}
                    onChange={(a) => setDecisions({ ...decisions, [d.externalHash]: a })}
                    disabled={resolving}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {resolveError && <p style={{ color: colors.dangerFg, marginTop: 8 }}>{resolveError}</p>}
          <div style={{ marginTop: 12 }}>
            <button onClick={() => void submit()} disabled={resolving}>
              {resolving ? 'Saving…' : 'Apply decisions'}
            </button>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table style={tableStyle}>
          <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Category</th></tr></thead>
          <tbody>
            {result.transactions.map((tx) => (
              <tr key={tx.id}>
                <td>{tx.date}</td>
                <td>{tx.description}</td>
                <td style={{ color: tx.amount < 0 ? colors.goldAntique : colors.forestGreen, textAlign: 'right' }}>
                  {tx.amount < 0 ? '-' : '+'}${Math.abs(tx.amount).toFixed(2)}
                </td>
                <td>
                  {tx.categorySource === 'suggested'
                    ? <span style={{ color: colors.hintText }}>Suggested (pending)</span>
                    : tx.categorySource ?? <span style={{ color: colors.hintText }}>Uncategorized</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={onRestart} style={{ marginTop: 12 }}>Import another</button>
    </div>
  );
}

function DuplicateRow({
  pending, decision, onChange, disabled,
}: {
  pending: PendingDuplicate;
  decision: 'keep' | 'skip';
  onChange: (a: 'keep' | 'skip') => void;
  disabled: boolean;
}) {
  const cell: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top', fontSize: 13 };
  const amtColor = (n: number) => (n < 0 ? colors.goldAntique : colors.forestGreen);
  const fmt = (n: number) => `${n < 0 ? '-' : '+'}$${Math.abs(n).toFixed(2)}`;
  return (
    <tr>
      <td style={cell}>
        <div>{pending.parsed.date} · <span style={{ color: amtColor(pending.parsed.amount) }}>{fmt(pending.parsed.amount)}</span></div>
        <div style={{ color: colors.mutedGray }}>{pending.parsed.description}</div>
      </td>
      <td style={cell}>
        <div>{pending.existing.date} · <span style={{ color: amtColor(pending.existing.amount) }}>{fmt(pending.existing.amount)}</span></div>
        <div style={{ color: colors.mutedGray }}>{pending.existing.description}</div>
      </td>
      <td style={cell}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="radio"
            checked={decision === 'skip'}
            onChange={() => onChange('skip')}
            disabled={disabled}
          />
          Skip (default)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="radio"
            checked={decision === 'keep'}
            onChange={() => onChange('keep')}
            disabled={disabled}
          />
          Import anyway
        </label>
      </td>
    </tr>
  );
}
