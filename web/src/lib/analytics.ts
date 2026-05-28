// Google Analytics 4 + Consent Mode v2.
//
// Why a single module: gtag has global state and a strict ordering contract
// (default consent must be set BEFORE the gtag script loads). Centralising it
// here means callers just say `track('purchase', {...})` and consent/loading
// is handled once.
//
// Cookie consent is captured by ConsentBanner.tsx and persisted in
// localStorage under CONSENT_KEY. This module reads + writes that key and
// pushes the resulting state into gtag via consent('default'|'update').

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

const CONSENT_KEY = 'kml.cookie-consent.v1';
const CONSENT_VERSION = 1;

export type ConsentChoice = 'granted' | 'denied';

export interface ConsentState {
  /** Schema version — bump if we add new categories so the banner re-prompts. */
  version: number;
  /** When the user made their choice. */
  decidedAt: string;
  analytics: ConsentChoice;
  ads: ConsentChoice;
}

const DENIED_DEFAULTS: Omit<ConsentState, 'version' | 'decidedAt'> = {
  analytics: 'denied',
  ads: 'denied',
};

function readStoredConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    if (parsed.version !== CONSENT_VERSION) return null;
    if (parsed.analytics !== 'granted' && parsed.analytics !== 'denied') return null;
    if (parsed.ads !== 'granted' && parsed.ads !== 'denied') return null;
    return {
      version: CONSENT_VERSION,
      decidedAt: parsed.decidedAt ?? new Date().toISOString(),
      analytics: parsed.analytics,
      ads: parsed.ads,
    };
  } catch {
    return null;
  }
}

export function getStoredConsent(): ConsentState | null {
  return readStoredConsent();
}

export function hasDecidedConsent(): boolean {
  return readStoredConsent() !== null;
}

export function saveConsent(choice: Omit<ConsentState, 'version' | 'decidedAt'>): ConsentState {
  const state: ConsentState = {
    version: CONSENT_VERSION,
    decidedAt: new Date().toISOString(),
    ...choice,
  };
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(state));
  } catch { /* localStorage unavailable — fall through; gtag still updated below */ }
  applyConsentToGtag(state);
  return state;
}

export function clearConsent() {
  try { localStorage.removeItem(CONSENT_KEY); } catch { /* noop */ }
}

/**
 * Initialise the dataLayer + push the consent default. Must run BEFORE
 * the gtag.js script is appended to the DOM (Consent Mode v2 requirement).
 * Safe to call multiple times — idempotent on the dataLayer side.
 */
function ensureDataLayer() {
  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) {
    window.gtag = function gtag(...args: unknown[]) {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer.push(arguments);
    };
  }
}

let consentDefaultPushed = false;
function pushConsentDefault() {
  if (consentDefaultPushed) return;
  consentDefaultPushed = true;
  ensureDataLayer();
  const stored = readStoredConsent();
  const analytics = stored?.analytics ?? DENIED_DEFAULTS.analytics;
  const ads = stored?.ads ?? DENIED_DEFAULTS.ads;
  window.gtag('consent', 'default', {
    ad_storage: ads,
    ad_user_data: ads,
    ad_personalization: ads,
    analytics_storage: analytics,
    // Cookieless pings + behavioral modeling for denied users.
    wait_for_update: 500,
  });
}

function applyConsentToGtag(state: ConsentState) {
  ensureDataLayer();
  window.gtag('consent', 'update', {
    ad_storage: state.ads,
    ad_user_data: state.ads,
    ad_personalization: state.ads,
    analytics_storage: state.analytics,
  });
}

let scriptInjected = false;
let activeMeasurementId: string | null = null;

/**
 * Load gtag for the given GA4 measurement ID. Sets Consent Mode defaults
 * first, then injects the script + calls `config`. Idempotent.
 */
export function initAnalytics(measurementId: string | null) {
  if (!measurementId) return;
  if (typeof window === 'undefined') return;
  if (scriptInjected && activeMeasurementId === measurementId) return;

  ensureDataLayer();
  pushConsentDefault();

  if (!scriptInjected) {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(s);
    scriptInjected = true;
  }

  window.gtag('js', new Date());
  window.gtag('config', measurementId, {
    // SPA routing — we'll fire manual page_view events.
    send_page_view: false,
  });
  activeMeasurementId = measurementId;
}

/** Fire a manual page_view (SPA route change). No-op until analytics initialised. */
export function trackPageView(path: string, title?: string) {
  if (!activeMeasurementId) return;
  window.gtag('event', 'page_view', {
    page_path: path,
    page_title: title ?? document.title,
    page_location: window.location.href,
  });
}

/** Fire an arbitrary event. No-op until analytics initialised. */
export function trackEvent(name: string, params: Record<string, unknown> = {}) {
  if (!activeMeasurementId) return;
  window.gtag('event', name, params);
}
