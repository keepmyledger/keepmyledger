import React, { useEffect, useState } from 'react';
import type { DriveAuthStatus, ReceiptStoragePreference } from '@keepmyledger/shared';
import { api } from '../api/client';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useAuth } from '../auth/AuthContext';
import { getStoredConsent, type ConsentState } from '../lib/analytics';
import { CONSENT_REOPEN_EVENT } from '../components/ConsentBanner';
import { colors, radii } from '../styles/tokens';
import brandConfig from '@content/brand/config';

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
              Confirm: enter the 6-digit code from your app:
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

// ── Account danger zone ───────────────────────────────────────────────────────

const CONFIRM_PHRASE = 'delete my account';

function AccountDangerCard() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [exportDone, setExportDone] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    setLoading(true);
    try {
      await api.account.delete();
      // Server destroys the session; reload to kick user back to login.
      window.location.href = '/';
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <div style={{ ...cardStyle, borderColor: '#FCA5A5' }}>
      <h2 style={{ marginTop: 0, color: '#991B1B' }}>Danger zone</h2>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <strong style={{ display: 'block', marginBottom: 2 }}>Export your data</strong>
          <span style={{ fontSize: 13, color: '#666' }}>Download all your transactions, accounts, categories and rules as JSON.</span>
        </div>
        <a
          href={api.account.exportUrl()}
          download="keepmyledger-export.json"
          style={{ ...btnStyle, textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          Export data
        </a>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #FEE2E2', margin: '16px 0' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <strong style={{ display: 'block', marginBottom: 2 }}>Delete account</strong>
          <span style={{ fontSize: 13, color: '#666' }}>Permanently delete your account and all data. This cannot be undone.</span>
        </div>
        {!showConfirm && (
          <button
            onClick={() => { setShowConfirm(true); setExportDone(false); setConfirmText(''); setError(null); }}
            style={{ ...btnStyle, background: '#FEF2F2', color: '#991B1B', borderColor: '#FCA5A5', whiteSpace: 'nowrap' }}
          >
            Delete account
          </button>
        )}
      </div>

      {showConfirm && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '12px 14px',
            fontSize: 14, color: '#7F1D1D',
          }}>
            <strong>All your transactions, accounts, receipts, and rules will be permanently deleted. This cannot be undone.</strong>
          </div>

          {!exportDone && (
            <div style={{
              background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8, padding: '12px 14px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#92400E' }}>Download a copy of your data first</div>
                <div style={{ fontSize: 13, color: '#78350F', marginTop: 2 }}>
                  We recommend exporting before you delete. Your data cannot be recovered.
                </div>
              </div>
              <a
                href={api.account.exportUrl()}
                download="keepmyledger-export.json"
                onClick={() => setExportDone(true)}
                style={{ ...btnStyle, textDecoration: 'none', whiteSpace: 'nowrap', background: '#FEF3C7', borderColor: '#F59E0B', color: '#92400E' }}
              >
                Download my data
              </a>
            </div>
          )}

          {exportDone && (
            <div style={{
              background: '#D1FAE5', border: '1px solid #6EE7B7', borderRadius: 8,
              padding: '8px 14px', fontSize: 13, color: '#065F46',
            }}>
              Export started. Check your downloads folder.
            </div>
          )}

          <label style={{ fontSize: 14 }}>
            {exportDone
              ? <>Type <strong>{CONFIRM_PHRASE}</strong> to confirm deletion:</>
              : <span style={{ color: '#6B7280' }}>Or skip the export: type <strong style={{ color: '#374151' }}>{CONFIRM_PHRASE}</strong> to delete without exporting:</span>
            }
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_PHRASE}
              style={{ ...inputStyle, marginTop: 6, display: 'block', width: '100%', boxSizing: 'border-box' }}
            />
          </label>
          {error && <ErrorMsg msg={error} />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleDelete}
              disabled={loading || confirmText !== CONFIRM_PHRASE}
              style={{ ...btnStyle, background: '#991B1B', color: '#fff', borderColor: '#991B1B', opacity: confirmText !== CONFIRM_PHRASE ? 0.5 : 1 }}
            >
              {loading ? 'Deleting…' : 'Permanently delete'}
            </button>
            <button
              type="button"
              onClick={() => { setShowConfirm(false); setError(null); }}
              style={cancelBtnStyle}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  useDocumentTitle('Settings');
  return (
    <div>
      <h1>Settings</h1>
      <ReceiptStorageCard />
      <TotpCard />
      <CookiePreferencesCard />
      <AccountDangerCard />
    </div>
  );
}

// ── Cookie preferences ───────────────────────────────────────────────────────

function CookiePreferencesCard() {
  const { config } = useAuth();
  const [consent, setConsent] = useState<ConsentState | null>(() => getStoredConsent());

  // Refresh when the banner saves a new choice (it dispatches CONSENT_REOPEN_EVENT
  // only on open, so we listen to `storage` for cross-tab + re-read on focus).
  useEffect(() => {
    const refresh = () => setConsent(getStoredConsent());
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  if (!config) return null;
  // No tracker configured = nothing to manage.
  if (!config.gaMeasurementId) return null;

  const openBanner = () => window.dispatchEvent(new Event(CONSENT_REOPEN_EVENT));

  return (
    <div style={cardStyle}>
      <h2 style={{ marginTop: 0 }}>Cookie preferences</h2>
      <p style={{ marginTop: 0, fontSize: 13, color: colors.mutedGray }}>
        We use Google Analytics to understand how the app is used. You can change or revoke this
        at any time.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, marginBottom: 14 }}>
        <Row label="Analytics" value={consent?.analytics ?? 'denied'} />
        <Row label="Advertising" value={consent?.ads ?? 'denied'} />
        {consent && (
          <div style={{ fontSize: 12, color: colors.mutedGray, marginTop: 4 }}>
            Last updated {new Date(consent.decidedAt).toLocaleString()}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={openBanner}
        style={{
          padding: '8px 14px', borderRadius: radii.sm,
          border: `1px solid ${colors.surfaceLine}`,
          background: colors.warmWhite, cursor: 'pointer', fontSize: 14, fontWeight: 500,
        }}
      >
        Change preferences
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: 'granted' | 'denied' }) {
  const granted = value === 'granted';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span>{label}</span>
      <span style={{
        fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
        background: granted ? colors.successBg : colors.creamDeep,
        color: granted ? colors.successFg : colors.mutedGray,
      }}>
        {granted ? 'On' : 'Off'}
      </span>
    </div>
  );
}

// ── Receipt storage preference ───────────────────────────────────────────────

function ReceiptStorageCard() {
  const { config, user, refresh } = useAuth();
  const [driveStatus, setDriveStatus] = useState<DriveAuthStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.receipts.driveStatus().then(setDriveStatus).catch(() => setDriveStatus(null));
  }, []);

  if (!config || !user) return null;

  const explicit = user.receiptStoragePreference;
  const effective: ReceiptStoragePreference = explicit ?? config.defaultReceiptStorage;
  const kmlAvailable = config.kmlStorageAvailable;
  const driveConnected = !!driveStatus?.authenticated;
  const driveConfigured = !!driveStatus?.configured;

  async function choose(pref: ReceiptStoragePreference) {
    setError(null);
    setSaving(true);
    try {
      await api.account.setReceiptStorage(pref);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={cardStyle}>
      <h2 style={{ marginTop: 0 }}>Receipt storage</h2>
      <p style={{ marginTop: 0, fontSize: 13, color: '#666' }}>
        Where should {brandConfig.name} save the receipts you upload? You can change this anytime — existing
        receipts stay wherever they were originally saved.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <StorageOption
          checked={effective === 'kml'}
          disabled={!kmlAvailable || saving}
          onChange={() => void choose('kml')}
          title={`${brandConfig.name} storage`}
          body={
            kmlAvailable
              ? 'Receipts are stored in our hosted bucket and downloaded via short-lived signed links.'
              : 'Not available on this deployment.'
          }
        />
        <StorageOption
          checked={effective === 'drive'}
          disabled={!driveConfigured || saving}
          onChange={() => void choose('drive')}
          title="My Google Drive"
          body={
            !driveConfigured
              ? 'Google Drive is not configured on this server.'
              : driveConnected
                ? `Receipts upload into a "${brandConfig.name} Receipts" folder in your own Drive.`
                : <>
                    Receipts upload into your own Drive.{' '}
                    <a
                      href="#"
                      onClick={async (e) => {
                        e.preventDefault();
                        const { url } = await api.receipts.driveAuthUrl();
                        window.open(url, '_blank');
                      }}
                    >
                      Connect Google Drive
                    </a>{' '}first.
                  </>
          }
        />
      </div>

      {explicit === null && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#8A5A20' }}>
          Using the deployment default ({config.defaultReceiptStorage === 'kml' ? `${brandConfig.name} storage` : 'Google Drive'}).
        </div>
      )}
      {error && <div style={{ marginTop: 10 }}><ErrorMsg msg={error} /></div>}
    </div>
  );
}

function StorageOption({
  checked, disabled, onChange, title, body,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 8,
        border: checked ? '1.5px solid #2E7D61' : '1px solid #E6DFCB',
        background: checked ? '#E7F1EA' : '#FFFDF8',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        type="radio"
        name="receipt-storage"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        style={{ marginTop: 2 }}
      />
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
        <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>{body}</div>
      </div>
    </label>
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
