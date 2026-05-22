import React, { useEffect, useState } from 'react';
import { useSetting } from '../settings';
import { api } from '../api/client';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200];

// ── TOTP card ─────────────────────────────────────────────────────────────────

type TotpView = 'idle' | 'setup' | 'disabling';

interface SetupData {
  secret: string;
  qrCodeDataUrl: string;
}

function TotpCard() {
  const [status, setStatus] = useState<{ enabled: boolean; hasSecret: boolean } | null>(null);
  const [view, setView] = useState<TotpView>('idle');
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    api.auth.totp.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  async function startSetup() {
    setError(null);
    setLoading(true);
    try {
      const data = await api.auth.totp.setup();
      setSetup({ secret: data.secret, qrCodeDataUrl: data.qrCodeDataUrl });
      setView('setup');
      setCode('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleEnable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.auth.totp.enable(code.replace(/\s/g, ''));
      setStatus({ enabled: true, hasSecret: true });
      setView('idle');
      setSetup(null);
      setCode('');
      setSuccess('Two-factor authentication enabled.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.auth.totp.disable(code.replace(/\s/g, ''));
      setStatus({ enabled: false, hasSecret: false });
      setView('idle');
      setCode('');
      setSuccess('Two-factor authentication disabled.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (status === null) return null; // loading or not available

  return (
    <div style={cardStyle}>
      <h2 style={{ marginTop: 0 }}>Security</h2>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Two-factor authentication</div>
          <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>
            {status.enabled
              ? 'Your account is protected with an authenticator app.'
              : 'Add an extra layer of security to your account.'}
          </div>
        </div>
        <span style={{
          padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
          background: status.enabled ? '#D1FAE5' : '#F3F4F6',
          color: status.enabled ? '#065F46' : '#6B7280',
        }}>
          {status.enabled ? 'Enabled' : 'Not set up'}
        </span>
      </div>

      {success && (
        <div style={{
          background: '#D1FAE5', border: '1px solid #6EE7B7', color: '#065F46',
          padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 12,
        }}>
          {success}
        </div>
      )}

      {/* Idle state */}
      {view === 'idle' && (
        <div style={{ display: 'flex', gap: 8 }}>
          {!status.enabled && (
            <button onClick={startSetup} disabled={loading} style={btnStyle}>
              {loading ? 'Loading…' : 'Set up authenticator app'}
            </button>
          )}
          {status.enabled && (
            <button
              onClick={() => { setView('disabling'); setCode(''); setError(null); setSuccess(null); }}
              style={{ ...btnStyle, background: '#FEF2F2', color: '#991B1B', borderColor: '#FCA5A5' }}
            >
              Disable 2FA
            </button>
          )}
        </div>
      )}

      {/* Setup flow */}
      {view === 'setup' && setup && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ margin: 0, fontSize: 14 }}>
            Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.):
          </p>
          <div style={{ textAlign: 'center' }}>
            <img src={setup.qrCodeDataUrl} alt="TOTP QR code" style={{ width: 180, height: 180 }} />
          </div>
          <details style={{ fontSize: 13 }}>
            <summary style={{ cursor: 'pointer', color: '#666' }}>Can't scan? Enter the key manually</summary>
            <code style={{
              display: 'block', marginTop: 8, padding: '8px 10px', background: '#F3F4F6',
              borderRadius: 6, fontSize: 12, letterSpacing: 2, wordBreak: 'break-all',
            }}>
              {setup.secret}
            </code>
          </details>
          <form onSubmit={handleEnable} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 14, fontWeight: 500 }}>
              Confirm — enter the 6-digit code from your app:
              <input
                type="text" inputMode="numeric" autoComplete="one-time-code"
                maxLength={7} placeholder="123 456"
                value={code} onChange={(e) => setCode(e.target.value)}
                style={{ ...inputStyle, marginTop: 6, textAlign: 'center', letterSpacing: 4, fontSize: 20 }}
                autoFocus
              />
            </label>
            {error && <ErrorMsg msg={error} />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={loading || code.replace(/\s/g, '').length < 6} style={btnStyle}>
                {loading ? 'Enabling…' : 'Enable 2FA'}
              </button>
              <button type="button" onClick={() => { setView('idle'); setSetup(null); setError(null); }} style={cancelBtnStyle}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Disable flow */}
      {view === 'disabling' && (
        <form onSubmit={handleDisable} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: 14, fontWeight: 500 }}>
            Enter the 6-digit code from your authenticator app to confirm:
            <input
              type="text" inputMode="numeric" autoComplete="one-time-code"
              maxLength={7} placeholder="123 456"
              value={code} onChange={(e) => setCode(e.target.value)}
              style={{ ...inputStyle, marginTop: 6, textAlign: 'center', letterSpacing: 4, fontSize: 20 }}
              autoFocus
            />
          </label>
          {error && <ErrorMsg msg={error} />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={loading || code.replace(/\s/g, '').length < 6}
              style={{ ...btnStyle, background: '#FEF2F2', color: '#991B1B', borderColor: '#FCA5A5' }}>
              {loading ? 'Disabling…' : 'Confirm disable'}
            </button>
            <button type="button" onClick={() => { setView('idle'); setError(null); }} style={cancelBtnStyle}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div style={{
      background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B',
      padding: '8px 12px', borderRadius: 6, fontSize: 13,
    }}>{msg}</div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const [pageSize, setPageSize] = useSetting('transactionsPageSize');

  return (
    <div>
      <h1>Settings</h1>
      <div style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Transactions</h2>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 320 }}>
          <span style={{ fontWeight: 500 }}>Default page size</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            style={inputStyle}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n} per page</option>
            ))}
          </select>
          <span style={{ fontSize: 12, color: '#666' }}>
            Controls how many transactions are shown per page in the Transactions list.
          </span>
        </label>
      </div>
      <TotpCard />
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #E6DFCB',
  borderRadius: 10,
  padding: 16,
  background: '#FFFDF8',
  boxShadow: '0 1px 2px rgba(31, 41, 32, 0.05)',
  maxWidth: 600,
  marginBottom: 20,
};
const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid #E1DACB',
  borderRadius: 6,
  fontSize: 14,
  background: '#FFFDF8',
};
const btnStyle: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 6,
  border: '1px solid #D1CACB', background: '#F9F6F2',
  fontSize: 14, cursor: 'pointer', fontWeight: 500,
};
const cancelBtnStyle: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 6,
  border: '1px solid #E6DFCB', background: 'transparent',
  fontSize: 14, cursor: 'pointer', color: '#6B7280',
};
