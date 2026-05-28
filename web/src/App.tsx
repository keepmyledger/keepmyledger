import React, { useEffect, useRef, useState, Suspense } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
const AccountsPage      = React.lazy(() => import('./pages/Accounts').then(m => ({ default: m.AccountsPage })));
const CategoriesPage    = React.lazy(() => import('./pages/Categories').then(m => ({ default: m.CategoriesPage })));
const RulesPage         = React.lazy(() => import('./pages/Rules').then(m => ({ default: m.RulesPage })));
const ImportPage        = React.lazy(() => import('./pages/Import').then(m => ({ default: m.ImportPage })));
const TransactionsPage  = React.lazy(() => import('./pages/Transactions').then(m => ({ default: m.TransactionsPage })));
const ReportsPage       = React.lazy(() => import('./pages/Reports').then(m => ({ default: m.ReportsPage })));
const SettingsPage      = React.lazy(() => import('./pages/Settings').then(m => ({ default: m.SettingsPage })));
const LoginPage         = React.lazy(() => import('./pages/Login').then(m => ({ default: m.LoginPage })));
const ForgotPasswordPage = React.lazy(() => import('./pages/ForgotPassword').then(m => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = React.lazy(() => import('./pages/ResetPassword').then(m => ({ default: m.ResetPasswordPage })));
const PrivacyPage       = React.lazy(() => import('./pages/Privacy').then(m => ({ default: m.PrivacyPage })));
const TermsPage         = React.lazy(() => import('./pages/Terms').then(m => ({ default: m.TermsPage })));
const AboutPage         = React.lazy(() => import('./pages/About').then(m => ({ default: m.AboutPage })));
const AccessibilityPage = React.lazy(() => import('./pages/Accessibility').then(m => ({ default: m.AccessibilityPage })));
const DashboardPage     = React.lazy(() => import('./pages/Dashboard').then(m => ({ default: m.DashboardPage })));
const BillingPage       = React.lazy(() => import('./pages/Billing').then(m => ({ default: m.BillingPage })));
const AdminPage         = React.lazy(() => import('./pages/Admin').then(m => ({ default: m.AdminPage })));
const OrgSettingsPage   = React.lazy(() => import('./pages/OrgSettings').then(m => ({ default: m.OrgSettingsPage })));
const AcceptInvitePage  = React.lazy(() => import('./pages/AcceptInvite').then(m => ({ default: m.AcceptInvitePage })));
import { StartupPromptModal } from './components/StartupPromptModal';
import { BusinessSetupModal } from './components/BusinessSetupModal';
import { BusinessSwitcher } from './components/BusinessSwitcher';
import { ConsentBanner } from './components/ConsentBanner';
import { useIsMobile } from './hooks/useMediaQuery';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { setSubscriptionRequiredHandler, api } from './api/client';
import { initAnalytics, trackPageView, trackEvent } from './lib/analytics';
import { colors, radii } from './styles/tokens';
import brandConfig from '@content/brand/config';

const NAV_ITEMS: { to: string; label: string }[] = [
  { to: '/transactions', label: 'Transactions' },
  { to: '/import',       label: 'Import' },
  { to: '/accounts',     label: 'Accounts' },
  { to: '/categories',   label: 'Categories' },
  { to: '/rules',        label: 'Rules' },
  { to: '/reports',      label: 'Reports' },
];

const navStyle: React.CSSProperties = {
  background: colors.ledgerGreen, padding: '0 24px', display: 'flex', alignItems: 'center', gap: 4,
  boxShadow: '0 1px 0 rgba(0,0,0,0.08)',
};
const linkStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
  color: isActive ? colors.warmWhite : 'rgba(255, 253, 248, 0.72)',
  textDecoration: 'none',
  padding: '14px 12px',
  fontWeight: isActive ? 600 : 500,
  borderBottom: isActive ? `3px solid ${colors.goldSoft}` : '3px solid transparent',
  display: 'inline-block',
});
const mobileLinkStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
  color: isActive ? colors.warmWhite : 'rgba(255, 253, 248, 0.78)',
  textDecoration: 'none',
  padding: '14px 20px',
  fontWeight: isActive ? 600 : 500,
  background: isActive ? 'rgba(0, 0, 0, 0.18)' : 'transparent',
  borderLeft: isActive ? `4px solid ${colors.goldSoft}` : '4px solid transparent',
  display: 'block',
  fontSize: 16,
});

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppShell />
        <ConsentBanner />
      </AuthProvider>
    </BrowserRouter>
  );
}

function AppShell() {
  const { status, config, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Wire the global 402 handler once. When a write is blocked because a
  // subscription has expired, redirect to /billing with a toast-like banner.
  useEffect(() => {
    setSubscriptionRequiredHandler(() => navigate('/billing'));
  }, [navigate]);

  // Initialise Google Analytics once config arrives. The helper is idempotent
  // and a no-op when measurementId is null (dev / self-host).
  useEffect(() => {
    initAnalytics(config?.gaMeasurementId ?? null);
  }, [config?.gaMeasurementId]);

  // Manual page_view on each route change (we set send_page_view: false).
  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);

  // GA4 recommended `sign_up` event. Fires once per user-browser when we
  // first observe a newly-provisioned account. Tied to user.id in
  // localStorage so re-logins don't double-count.
  useEffect(() => {
    if (!user) return;
    const key = `kml.ga.signup-fired.${user.id}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch { return; }
    // Only fire if this looks like a fresh signup — created within the last
    // hour. Avoids back-firing for existing accounts that just logged in on
    // a new browser / cleared storage.
    const createdMs = user.createdAt ? Date.parse(user.createdAt) : NaN;
    if (!isFinite(createdMs) || Date.now() - createdMs > 60 * 60 * 1000) {
      try { localStorage.setItem(key, '1'); } catch { /* noop */ }
      return;
    }
    // GA4 convention: `method` is the auth method. We can distinguish local
    // password auth from OAuth client-side; the specific OAuth provider is
    // server-only state, so OAuth signups bucket as 'oauth'.
    const method = user.username ? 'email' : 'oauth';
    trackEvent('sign_up', { method });
    try { localStorage.setItem(key, '1'); } catch { /* noop */ }
  }, [user]);

  // Public pages (no auth required). When unauthenticated in SaaS mode,
  // anonymous visitors land on the marketing page at '/'.
  const publicPaths = ['/privacy', '/terms', '/about', '/accessibility', '/login', '/forgot-password', '/reset-password'];
  const isPublicPath = publicPaths.includes(location.pathname) || location.pathname.startsWith('/invite/');
  if (isPublicPath) {
    return (
      <Suspense fallback={null}>
        <RouteTitle />
        <Routes>
          <Route path="/privacy"         element={<PrivacyPage />} />
          <Route path="/terms"           element={<TermsPage />} />
          <Route path="/about"           element={<AboutPage />} />
          <Route path="/accessibility"   element={<AccessibilityPage />} />
          <Route path="/login"           element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password"  element={<ResetPasswordPage />} />
          <Route path="/invite/:token"   element={<AcceptInvitePage />} />
        </Routes>
      </Suspense>
    );
  }

  if (status === 'loading') {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: colors.mutedGray }}>Loading…</div>
    );
  }

  // In saas mode, anonymous visitors see the marketing page at '/' and the
  // login page elsewhere. Selfhost auto-attaches the owner so this branch
  // never fires.
  if (config?.mode === 'saas' && !user) {
    if (location.pathname === '/') {
      return (
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<AboutPage />} />
          </Routes>
        </Suspense>
      );
    }
    return <Suspense fallback={null}><LoginPage /></Suspense>;
  }

  return (
    <>
      <RouteTitle />
      <BusinessSetupModal />
      <StartupPromptModal />
      <TrialBanner />
      <EmailPromptBanner />
      <NavBar />
      <main className="app-main" style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
        <Suspense fallback={<div style={{ padding: 48, textAlign: 'center', color: colors.mutedGray }}>Loading…</div>}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/org-settings" element={<OrgSettingsPage />} />
            <Route path="/invite/:token" element={<AcceptInvitePage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/terms"   element={<TermsPage />} />
            <Route path="/about"   element={<AboutPage />} />
            <Route path="/accessibility" element={<AccessibilityPage />} />
            <Route path="/admin/*" element={user?.isAdmin ? <AdminPage /> : <Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
        <AppFooter />
      </main>
    </>
  );
}

function TrialBanner() {
  const { config, user } = useAuth();
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [tier, setTier] = useState<string | null>(null);
  const [aiLifetimeCount, setAiLifetimeCount] = useState<number | null>(null);
  const [aiLifetimeLimit, setAiLifetimeLimit] = useState<number | null>(null);

  useEffect(() => {
    if (config?.mode !== 'saas' || !user) return;
    let cancelled = false;
    api.billing.status()
      .then((d) => {
        if (cancelled) return;
        setDaysRemaining(d.daysRemaining);
        setStatus(d.status);
        setTier(d.tier);
        setAiLifetimeCount(d.aiLifetimeCount);
        setAiLifetimeLimit(d.aiLifetimeLimit);
      })
      .catch(() => {/* silent */});
    return () => { cancelled = true; };
  }, [config?.mode, user]);

  if (config?.mode !== 'saas' || !user) return null;

  const showTrialWarning = status === 'trialing' && daysRemaining !== null && daysRemaining < 4;
  const showExpired = status !== null && !['trialing', 'active'].includes(status);
  // Only show the free-tier AI usage banner once the user has consumed at
  // least one assist. Showing it on first login (0/5 used) would be noisy
  // and feel like an immediate upsell for brand-new accounts.
  const showFreeTierAi = tier === 'free' && aiLifetimeCount !== null && aiLifetimeCount > 0 && aiLifetimeLimit !== null;
  const aiExhausted = showFreeTierAi && aiLifetimeCount >= aiLifetimeLimit;

  if (!showTrialWarning && !showExpired && !showFreeTierAi) return null;

  if (showExpired) {
    return (
      <div style={{
        background: colors.dangerBg, color: colors.dangerFg, padding: '10px 24px',
        textAlign: 'center', fontSize: 14, fontWeight: 500,
      }}>
        Your trial has ended.{' '}
        <NavLink to="/billing" style={{ color: colors.dangerFg, fontWeight: 700 }}>Upgrade to continue</NavLink>{' '}
        importing and editing.
      </div>
    );
  }

  if (showTrialWarning) {
    return (
      <div style={{
        background: colors.warningBg, color: colors.warningFg, padding: '10px 24px',
        textAlign: 'center', fontSize: 14, fontWeight: 500,
      }}>
        Your free trial ends in <strong>{daysRemaining} {daysRemaining === 1 ? 'day' : 'days'}</strong>.{' '}
        <NavLink to="/billing" style={{ color: colors.warningFg, fontWeight: 700 }}>View billing →</NavLink>
      </div>
    );
  }

  // Free tier: AI usage counter
  const remaining = aiLifetimeLimit! - aiLifetimeCount!;
  return (
    <div style={{
      background: aiExhausted ? colors.warningBg : colors.cream,
      color: aiExhausted ? colors.warningFg : colors.mutedGray,
      borderBottom: `1px solid ${colors.softLine}`,
      padding: '8px 24px',
      textAlign: 'center',
      fontSize: 13,
    }}>
      {aiExhausted ? (
        <>
          You've used all {aiLifetimeLimit} free AI assists.{' '}
          <NavLink to="/billing" style={{ color: colors.warningFg, fontWeight: 700 }}>Upgrade for more →</NavLink>
        </>
      ) : (
        <>
          Free plan: <strong>{aiLifetimeCount} of {aiLifetimeLimit}</strong> AI assists used.{' '}
          <NavLink to="/billing" style={{ color: colors.mutedGray, textDecoration: 'underline' }}>
            {remaining === 1 ? '1 remaining — upgrade for unlimited' : `${remaining} remaining`}
          </NavLink>
        </>
      )}
    </div>
  );
}

/**
 * EmailPromptBanner, shown to local-auth users who registered before email
 * was required. Dismissed permanently once an email is saved or the user
 * closes it (session-only dismissal via local state).
 */
function EmailPromptBanner() {
  const { user, refresh } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Only local-auth users without an email need this
  if (!user || user.email !== null || !user.username || dismissed) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      await api.auth.local.updateEmail(emailInput.trim());
      await refresh();
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      background: '#EFF6FF', borderBottom: '1px solid #BFDBFE',
      padding: '10px 24px', display: 'flex', alignItems: 'center',
      gap: 12, flexWrap: 'wrap', fontSize: 14,
    }}>
      <span style={{ color: '#1E40AF', fontWeight: 500, flexShrink: 0 }}>
        Add an email for password recovery:
      </span>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 240 }}>
        <input
          type="email"
          placeholder="you@example.com"
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          style={{
            padding: '6px 10px', borderRadius: radii.sm, border: '1px solid #BFDBFE',
            fontSize: 14, flex: 1, minWidth: 180,
          }}
        />
        <button
          type="submit"
          disabled={saving || !emailInput.trim()}
          style={{
            padding: '6px 14px', borderRadius: radii.sm, border: 'none',
            background: saving ? '#93C5FD' : '#2563EB', color: '#fff',
            fontWeight: 600, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
      {err && <span style={{ color: '#991B1B', fontSize: 13 }}>{err}</span>}
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#6B7280', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
      >
        ✕
      </button>
    </div>
  );
}

const n = brandConfig.name;
const ROUTE_TITLES: Record<string, string> = {
  '/':              `Dashboard – ${n}`,
  '/dashboard':     `Dashboard – ${n}`,
  '/transactions':  `Transactions – ${n}`,
  '/import':        `Import – ${n}`,
  '/accounts':      `Accounts – ${n}`,
  '/categories':    `Categories – ${n}`,
  '/rules':         `Rules – ${n}`,
  '/reports':       `Reports – ${n}`,
  '/settings':      `Settings – ${n}`,
  '/billing':       `Billing – ${n}`,
  '/admin':         `Admin – ${n}`,
  '/about':         `About – ${n}`,
  '/privacy':       `Privacy Policy – ${n}`,
  '/terms':         `Terms of Service – ${n}`,
  '/accessibility': `Accessibility – ${n}`,
  '/login':         `Sign in – ${n}`,
  '/forgot-password': `Forgot password – ${n}`,
  '/reset-password':  `Reset password – ${n}`,
};

function RouteTitle() {
  const location = useLocation();
  useEffect(() => {
    const title =
      ROUTE_TITLES[location.pathname] ??
      Object.entries(ROUTE_TITLES).find(([p]) => location.pathname.startsWith(p + '/'))?.[1] ??
      brandConfig.name;
    document.title = title;
  }, [location.pathname]);
  return null;
}

function AppFooter() {  return (
    <footer style={{
      marginTop: 48, paddingTop: 16, borderTop: `1px solid ${colors.softLine}`,
      color: colors.mutedGray, fontSize: 13, textAlign: 'center',
    }}>
      <NavLink to="/about" style={{ color: colors.mutedGray, textDecoration: 'none', marginRight: 16 }}>
        About
      </NavLink>
      <NavLink to="/privacy" style={{ color: colors.mutedGray, textDecoration: 'none', marginRight: 16 }}>
        Privacy Policy
      </NavLink>
      <NavLink to="/terms" style={{ color: colors.mutedGray, textDecoration: 'none', marginRight: 16 }}>
        Terms of Service
      </NavLink>
      <NavLink to="/accessibility" style={{ color: colors.mutedGray, textDecoration: 'none', marginRight: 16 }}>
        Accessibility
      </NavLink>
      <a href={`mailto:${brandConfig.supportEmail}`} style={{ color: colors.mutedGray, textDecoration: 'none', marginRight: 16 }}>{brandConfig.supportEmail}</a>
      <span style={{ color: colors.mutedGray }}>&copy; {new Date().getFullYear()} {brandConfig.parentEntity}</span>
    </footer>
  );
}

function NavBar() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!isMobile) {
    return (
      <div style={navStyle}>
        <nav className="app-nav" style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
          <NavLink to="/dashboard" className="brand" style={{ color: colors.warmWhite, fontWeight: 600, marginRight: 16, fontSize: 19, fontFamily: '"Bree Serif", "Merriweather", Georgia, serif', display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
            <img src="/favicon.svg" alt="" aria-hidden width={24} height={24} style={{ display: 'block' }} />
            {brandConfig.name}
            <span style={{ background: colors.goldSoft, color: colors.goldAntique, padding: '2px 7px', borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: 0.3 }}>BETA</span>
          </NavLink>
          {NAV_ITEMS.map((n) => (
            <NavLink key={n.to} to={n.to} style={linkStyle}>{n.label}</NavLink>
          ))}
        </nav>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <BusinessSwitcher />
          <UserMenu />
        </div>
      </div>
    );
  }

  return (
    <>
      <nav style={{
        background: colors.ledgerGreen, padding: '0 12px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', height: 52,
      }}>
        <NavLink to="/dashboard" style={{ color: colors.warmWhite, fontWeight: 600, fontSize: 17, fontFamily: '"Bree Serif", "Merriweather", Georgia, serif', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
          <img src="/favicon.svg" alt="" aria-hidden width={22} height={22} style={{ display: 'block' }} />
          {brandConfig.name}
          <span style={{ background: colors.goldSoft, color: colors.goldAntique, padding: '2px 7px', borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: 0.3 }}>BETA</span>
        </NavLink>
        <button
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          style={{
            background: 'transparent', border: 'none', color: colors.warmWhite,
            fontSize: 24, lineHeight: 1, padding: '8px 12px', cursor: 'pointer',
          }}
        >
          <span aria-hidden="true">{open ? '✕' : '☰'}</span>
        </button>
      </nav>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, top: 52, background: 'rgba(43,43,43,0.45)', zIndex: 998 }}
          />
          <div style={{
            position: 'fixed', top: 52, left: 0, bottom: 0, width: 260,
            background: colors.ledgerGreen, zIndex: 999, overflowY: 'auto',
            boxShadow: '2px 0 12px rgba(0,0,0,0.25)',
          }}>
            {NAV_ITEMS.map((n) => (
              <NavLink key={n.to} to={n.to} style={mobileLinkStyle} onClick={() => setOpen(false)}>
                {n.label}
              </NavLink>
            ))}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', marginTop: 8, paddingTop: 8 }}>
              <UserMenu mobile onAction={() => setOpen(false)} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function UserMenu({ mobile = false, onAction }: { mobile?: boolean; onAction?: () => void }) {
  const { user, config, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isSaas = config?.mode === 'saas';

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!user) return null;

  const handleLogout = async () => {
    onAction?.();
    setOpen(false);
    await logout();
  };

  if (mobile) {
    return (
      <>
        <NavLink to="/settings" style={mobileLinkStyle} onClick={onAction}>Settings</NavLink>
        <NavLink to="/org-settings" style={mobileLinkStyle} onClick={onAction}>Org &amp; Members</NavLink>
        {isSaas && <NavLink to="/billing" style={mobileLinkStyle} onClick={onAction}>Billing</NavLink>}
        {user.isAdmin && <NavLink to="/admin" style={mobileLinkStyle} onClick={onAction}>Admin</NavLink>}
        <a
          href={`mailto:${brandConfig.supportEmail}?subject=${encodeURIComponent(`Feedback – ${brandConfig.name}`)}`}
          style={{ ...mobileLinkStyle({ isActive: false }), display: 'block' }}
          onClick={onAction}
        >
          Send feedback
        </a>
        <button
          onClick={handleLogout}
          style={{
            background: 'transparent', border: 'none', color: 'rgba(255,253,248,0.85)', cursor: 'pointer',
            padding: '14px 20px', fontSize: 16, textAlign: 'left', width: '100%', display: 'block',
          }}
        >
          Sign out ({user.email ?? user.name ?? 'user'})
        </button>
      </>
    );
  }

  const displayName = user.name ?? user.email ?? 'Account';

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'rgba(255,253,248,0.85)', padding: '6px 8px', borderRadius: 6,
        }}
      >
        {user.avatarUrl && (
          <img src={user.avatarUrl} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />
        )}
        <span style={{ fontSize: 14 }}>{displayName}</span>
        <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', marginTop: 4,
          background: '#fff', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          border: '1px solid #E6DFCB', minWidth: 160, zIndex: 1000, overflow: 'hidden',
        }}>
          <NavLink
            to="/settings"
            onClick={() => setOpen(false)}
            style={{ display: 'block', padding: '10px 16px', color: colors.darkSlate, textDecoration: 'none', fontSize: 14 }}
          >
            Settings
          </NavLink>
          <NavLink
            to="/org-settings"
            onClick={() => setOpen(false)}
            style={{ display: 'block', padding: '10px 16px', color: colors.darkSlate, textDecoration: 'none', fontSize: 14 }}
          >
            Org &amp; Members
          </NavLink>
          {isSaas && (
            <NavLink
              to="/billing"
              onClick={() => setOpen(false)}
              style={{ display: 'block', padding: '10px 16px', color: colors.darkSlate, textDecoration: 'none', fontSize: 14 }}
            >
              Billing
            </NavLink>
          )}
          {user.isAdmin && (
            <NavLink
              to="/admin"
              onClick={() => setOpen(false)}
              style={{ display: 'block', padding: '10px 16px', color: colors.darkSlate, textDecoration: 'none', fontSize: 14 }}
            >
              Admin
            </NavLink>
          )}
          <a
            href={`mailto:${brandConfig.supportEmail}?subject=${encodeURIComponent(`Feedback – ${brandConfig.name}`)}`}
            onClick={() => setOpen(false)}
            style={{ display: 'block', padding: '10px 16px', color: colors.darkSlate, textDecoration: 'none', fontSize: 14 }}
          >
            Send feedback
          </a>
          <div style={{ borderTop: '1px solid #E6DFCB' }} />
          <button
            onClick={handleLogout}
            style={{
              display: 'block', width: '100%', padding: '10px 16px', textAlign: 'left',
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: colors.darkSlate,
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
