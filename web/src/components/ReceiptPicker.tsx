import React, { useEffect, useRef, useState } from 'react';
import type { Receipt, DriveAuthStatus } from '@keepmyledger/shared';
import { api } from '../api/client';

interface Props {
  transactionId: number;
  linkedReceipts: Receipt[];
  onClose: () => void;
  onChanged: () => void;
}

type Tab = 'linked' | 'upload' | 'existing';

export function ReceiptPicker({ transactionId, linkedReceipts, onClose, onChanged }: Props) {
  const [tab, setTab] = useState<Tab>('linked');
  const [driveStatus, setDriveStatus] = useState<DriveAuthStatus | null>(null);
  const [allReceipts, setAllReceipts] = useState<Receipt[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.receipts.driveStatus().then(setDriveStatus).catch(() => {});
    api.receipts.list().then(setAllReceipts).catch(() => {});
  }, []);

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await api.receipts.uploadFile(file, transactionId);
      }
      onChanged();
      setTab('linked');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleLinkExisting = async (receipt: Receipt) => {
    setError(null);
    try {
      await api.transactions.linkReceipt(transactionId, receipt.id);
      onChanged();
      setTab('linked');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleUnlink = async (receiptId: number) => {
    setError(null);
    try {
      await api.transactions.unlinkReceipt(transactionId, receiptId);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const linkedIds = new Set(linkedReceipts.map((r) => r.id));

  return (
    <div style={overlay}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong>Receipts for transaction #{transactionId}</strong>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid #ddd', paddingBottom: 8 }}>
          {(['linked', 'upload', 'existing'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '4px 10px',
                borderRadius: 4,
                border: '1px solid #ccc',
                background: tab === t ? '#1a73e8' : '#fff',
                color: tab === t ? '#fff' : '#333',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {t === 'linked' ? `Linked (${linkedReceipts.length})` : t === 'upload' ? 'Upload' : 'Existing'}
            </button>
          ))}
        </div>

        {error && <div style={{ color: '#c00', marginBottom: 8, fontSize: 13 }}>{error}</div>}

        {/* Linked tab */}
        {tab === 'linked' && (
          <div>
            {linkedReceipts.length === 0 && <div style={{ color: '#888', fontSize: 13 }}>No receipts linked yet.</div>}
            {linkedReceipts.map((r) => (
              <div key={r.id} style={receiptRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {r.driveWebViewLink
                    ? <a href={r.driveWebViewLink} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>{r.driveFileName}</a>
                    : <span style={{ fontSize: 13 }}>{r.driveFileName}</span>}
                  <div style={{ fontSize: 11, color: '#888' }}>{r.driveMimeType} · {r.uploadedAt.slice(0, 10)}</div>
                </div>
                <button onClick={() => void handleUnlink(r.id)} style={smallBtn}>Unlink</button>
              </div>
            ))}
          </div>
        )}

        {/* Upload tab */}
        {tab === 'upload' && (
          <div>
            {!driveStatus?.configured && (
              <div style={{ color: '#8A5A20', background: '#FBEFD0', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
                Google Drive is not configured. Set <code>GOOGLE_OAUTH_CLIENT_ID</code> and <code>GOOGLE_OAUTH_CLIENT_SECRET</code> in your server <code>.env</code> file to enable Drive uploads.
              </div>
            )}
            {driveStatus?.configured && !driveStatus.authenticated && (
              <div style={{ color: '#8A5A20', background: '#FBEFD0', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
                Not connected to Google Drive.{' '}
                <a href="/api/receipts/drive/auth" onClick={async (e) => { e.preventDefault(); const { url } = await api.receipts.driveAuthUrl(); window.open(url, '_blank'); }}>
                  Connect Google Drive
                </a>
                <div style={{ marginTop: 6, fontSize: 12, color: '#666' }}>
                  Files will be uploaded to a folder named <strong>KeepMyLedger Receipts</strong> in your Drive.
                </div>
              </div>
            )}
            <div
              style={dropzone}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); void handleUpload(e.dataTransfer.files); }}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? 'Uploading…' : 'Drop files here or click to browse'}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => void handleUpload(e.target.files)}
            />
          </div>
        )}

        {/* Existing receipts tab */}
        {tab === 'existing' && (
          <div>
            {allReceipts.length === 0 && <div style={{ fontSize: 13, color: '#888' }}>No receipts in database yet.</div>}
            {allReceipts.map((r) => (
              <div key={r.id} style={receiptRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {r.driveWebViewLink
                    ? <a href={r.driveWebViewLink} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>{r.driveFileName}</a>
                    : <span style={{ fontSize: 13 }}>{r.driveFileName}</span>}
                  <div style={{ fontSize: 11, color: '#888' }}>{r.driveMimeType} · {r.uploadedAt.slice(0, 10)}</div>
                </div>
                <button
                  onClick={() => linkedIds.has(r.id) ? void handleUnlink(r.id) : void handleLinkExisting(r)}
                  style={{ ...smallBtn, background: linkedIds.has(r.id) ? '#e8f5e9' : undefined }}
                >
                  {linkedIds.has(r.id) ? 'Unlink' : 'Link'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(43, 43, 43, 0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};

const modal: React.CSSProperties = {
  background: '#FFFDF8', borderRadius: 14, padding: 20, width: 520,
  maxWidth: '95vw', maxHeight: '80vh', overflowY: 'auto',
  boxShadow: '0 12px 40px rgba(31,41,32,0.22)', border: '1px solid #E6DFCB',
};

const receiptRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
  borderBottom: '1px solid #EFE8D4',
};

const smallBtn: React.CSSProperties = {
  padding: '3px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #E1DACB',
  background: '#F7F3E8', cursor: 'pointer', whiteSpace: 'nowrap', color: '#2B2B2B',
};

const dropzone: React.CSSProperties = {
  border: '2px dashed #9A6B12', borderRadius: 10, padding: '32px 16px',
  textAlign: 'center', cursor: 'pointer', color: '#5E5E5E', fontSize: 14,
  background: '#F7F3E8',
};
