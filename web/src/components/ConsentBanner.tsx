import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { colors, radii, shadows } from '../styles/tokens';
import {
  type ConsentChoice,
  type ConsentState,
  getStoredConsent,
  hasDecidedConsent,
  saveConsent,
} from '../lib/analytics';
import { CONSENT_CONTENT } from '@content/cookies/consent';

/**
 * Settings → "Cookie preferences" fires this on `window` to re-open the
 * banner so the user can revise their previously-saved choice.
 */
export const CONSENT_REOPEN_EVENT = 'kml:cookie-prefs-open';

type ToggleKey = 'analytics' | 'ads';

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', borderRadius: radii.sm, border: 'none',
  background: colors.ledgerGreen, color: colors.warmWhite,
  fontWeight: 600, fontSize: 14, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '8px 16px', borderRadius: radii.sm,
  border: `1px solid ${colors.softLine}`,
  background: colors.warmWhite, color: colors.darkSlate,
  fontWeight: 500, fontSize: 14, cursor: 'pointer',
};
const btnLink: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0,
  color: colors.ledgerGreen, fontSize: 13, cursor: 'pointer',
  textDecoration: 'underline',
};

export function ConsentBanner() {
  const [visible, setVisible] = useState<boolean>(() => !hasDecidedConsent());
  const [showCustom, setShowCustom] = useState(false);
  const [analytics, setAnalytics] = useState<ConsentChoice>('denied');
  const [ads, setAds] = useState<ConsentChoice>('denied');

  // Settings re-opens the banner via a window event so we don't have to
  // thread context just for this one button.
  useEffect(() => {
    const handler = () => {
      const stored: ConsentState | null = getStoredConsent();
      setAnalytics(stored?.analytics ?? 'denied');
      setAds(stored?.ads ?? 'denied');
      setShowCustom(stored !== null);
      setVisible(true);
    };
    window.addEventListener(CONSENT_REOPEN_EVENT, handler);
    return () => window.removeEventListener(CONSENT_REOPEN_EVENT, handler);
  }, []);

  if (!visible) return null;

  const toggle = (key: ToggleKey, next: ConsentChoice) => {
    if (key === 'analytics') setAnalytics(next);
    else setAds(next);
  };

  const acceptAll = () => {
    saveConsent({ analytics: 'granted', ads: 'granted' });
    setVisible(false);
  };
  const rejectAll = () => {
    saveConsent({ analytics: 'denied', ads: 'denied' });
    setVisible(false);
  };
  const saveCustom = () => {
    saveConsent({ analytics, ads });
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      aria-modal="false"
      style={{
        position: 'fixed', left: 16, right: 16, bottom: 16,
        maxWidth: 560, marginLeft: 'auto', marginRight: 'auto',
        background: colors.warmWhite,
        border: `1px solid ${colors.surfaceLine}`,
        borderRadius: radii.lg,
        boxShadow: shadows.raised,
        padding: 20,
        zIndex: 2000,
        fontSize: 14,
        color: colors.darkSlate,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 15 }}>
        {CONSENT_CONTENT.bannerTitle}
      </div>
      <p style={{ margin: '0 0 12px', color: colors.mutedGray, lineHeight: 1.5 }}>
        {CONSENT_CONTENT.bannerDescription}{' '}
        <NavLink to="/privacy" style={{ color: colors.ledgerGreen }}>Privacy policy</NavLink>
      </p>

      {showCustom && (
        <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ToggleRow
            label={CONSENT_CONTENT.analyticsLabel}
            description={CONSENT_CONTENT.analyticsDescription}
            value={analytics}
            onChange={(v) => toggle('analytics', v)}
          />
          <ToggleRow
            label={CONSENT_CONTENT.adsLabel}
            description={CONSENT_CONTENT.adsDescription}
            value={ads}
            onChange={(v) => toggle('ads', v)}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {!showCustom ? (
          <>
            <button style={btnPrimary} onClick={acceptAll}>Accept all</button>
            <button style={btnSecondary} onClick={rejectAll}>Reject all</button>
            <button style={btnLink} onClick={() => setShowCustom(true)}>Customize</button>
          </>
        ) : (
          <>
            <button style={btnPrimary} onClick={saveCustom}>Save preferences</button>
            <button style={btnSecondary} onClick={acceptAll}>Accept all</button>
            <button style={btnSecondary} onClick={rejectAll}>Reject all</button>
          </>
        )}
      </div>
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  description: string;
  value: ConsentChoice;
  onChange: (v: ConsentChoice) => void;
}

function ToggleRow({ label, description, value, onChange }: ToggleRowProps) {
  const granted = value === 'granted';
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: 10, borderRadius: radii.sm,
      background: colors.cream, border: `1px solid ${colors.softLine}`,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 13, color: colors.mutedGray, lineHeight: 1.4 }}>{description}</div>
      </div>
      <label style={{
        position: 'relative', display: 'inline-block',
        width: 38, height: 22, flexShrink: 0, cursor: 'pointer',
      }}>
        <input
          type="checkbox"
          checked={granted}
          onChange={(e) => onChange(e.target.checked ? 'granted' : 'denied')}
          style={{ opacity: 0, width: 0, height: 0 }}
        />
        <span style={{
          position: 'absolute', inset: 0,
          background: granted ? colors.ledgerGreen : colors.surfaceLine,
          borderRadius: 22, transition: 'background 0.15s',
        }} />
        <span style={{
          position: 'absolute', top: 2, left: granted ? 18 : 2,
          width: 18, height: 18, borderRadius: '50%',
          background: colors.warmWhite, transition: 'left 0.15s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </label>
    </div>
  );
}
