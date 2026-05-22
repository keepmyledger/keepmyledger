import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AccountsPage } from './pages/Accounts';
import { CategoriesPage } from './pages/Categories';
import { RulesPage } from './pages/Rules';
import { ImportPage } from './pages/Import';
import { TransactionsPage } from './pages/Transactions';
import { ReportsPage } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { LoginPage } from './pages/Login';
import { AboutPage } from './pages/About';
import { DashboardPage } from './pages/Dashboard';
import { BillingPage } from './pages/Billing';
import { StartupPromptModal } from './components/StartupPromptModal';
import { useIsMobile } from './hooks/useMediaQuery';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { setSubscriptionRequiredHandler, api } from './api/client';
import { colors } from './styles/tokens';

const NAV_ITEMS: { to: string; label: string }[] = [
  { to: '/dashboard',    label: 'Dashboard' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/import',       label: 'Import' },
  { to: '/accounts',     label: 'Accounts' },
  { to: '/categories',   label: 'Categories' },
  { to: '/rules',        label: 'Rules' },
  { to: '/reports',      label: 'Reports' },
  { to: '/settings',     label: 'Settings' },
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

  // Public pages (no auth required). When unauthenticated in SaaS mode,
  // anonymous visitors land on the marketing page at '/'.
  const publicPaths = ['/about', '/login'];
  if (publicPaths.includes(location.pathname)) {
    return (
      <Routes>
        <Route path="/about" element={<AboutPage />} />
        <Route path="/login" element={<LoginPage />} />
      </Routes>
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
        <Routes>
          <Route path="/" element={<AboutPage />} />
        </Routes>
      );
    }
    return <LoginPage />;
  }

  return (
    <>
      <StartupPromptModal />
      <TrialBanner />
      <NavBar />
      <main className="app-main" style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
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
          <Route path="/about"   element={<AboutPage />} />
        </Routes>
        <AppFooter />
      </main>
    </>
  );
}

function TrialBanner() {
  const { config, user } = useAuth();
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (config?.mode !== 'saas' || !user) return;
    let cancelled = false;
    api.billing.status()
      .then((d) => {
        if (cancelled) return;
        setDaysRemaining(d.daysRemaining);
        setStatus(d.status);
      })
      .catch(() => {/* silent */});
    return () => { cancelled = true; };
  }, [config?.mode, user]);

  if (config?.mode !== 'saas' || !user) return null;

  const showTrialWarning = status === 'trialing' && daysRemaining !== null && daysRemaining < 4;
  const showExpired = status !== null && !['trialing', 'active'].includes(status);

  if (!showTrialWarning && !showExpired) return null;

  const bg = showExpired ? colors.dangerBg : colors.warningBg;
  const fg = showExpired ? colors.dangerFg : colors.warningFg;

  return (
    <div style={{
      background: bg, color: fg, padding: '10px 24px',
      textAlign: 'center', fontSize: 14, fontWeight: 500,
    }}>
      {showExpired
        ? <>Your trial has ended. <NavLink to="/billing" style={{ color: fg, fontWeight: 700 }}>Upgrade to continue</NavLink> importing and editing.</>
        : <>Your free trial ends in <strong>{daysRemaining} {daysRemaining === 1 ? 'day' : 'days'}</strong>. <NavLink to="/billing" style={{ color: fg, fontWeight: 700 }}>View billing →</NavLink></>
      }
    </div>
  );
}

function AppFooter() {
  return (
    <footer style={{
      marginTop: 48, paddingTop: 16, borderTop: `1px solid ${colors.softLine}`,
      color: colors.mutedGray, fontSize: 13, textAlign: 'center',
    }}>
      <NavLink to="/about" style={{ color: colors.mutedGray, textDecoration: 'none', marginRight: 16 }}>
        About
      </NavLink>
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
      <nav className="app-nav" style={navStyle}>
        <NavLink to="/dashboard" className="brand" style={{ color: colors.warmWhite, fontWeight: 600, marginRight: 16, fontSize: 19, fontFamily: '"Bree Serif", "Merriweather", Georgia, serif', display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <img src="/favicon.svg" alt="" aria-hidden width={24} height={24} style={{ display: 'block' }} />
          KeepMyLedger
        </NavLink>
        {NAV_ITEMS.map((n) => (
          <NavLink key={n.to} to={n.to} style={linkStyle}>{n.label}</NavLink>
        ))}
        <div style={{ marginLeft: 'auto' }}><UserMenu /></div>
      </nav>
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
          KeepMyLedger
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
          {open ? '✕' : '☰'}
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
  if (config?.mode !== 'saas' || !user) return null;

  const handleLogout = async () => {
    onAction?.();
    await logout();
  };

  if (mobile) {
    return (
      <>
        <NavLink to="/billing" style={mobileLinkStyle} onClick={onAction}>Billing</NavLink>
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

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {user.avatarUrl && (
        <img src={user.avatarUrl} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />
      )}
      <span style={{ color: 'rgba(255,253,248,0.85)', fontSize: 14 }}>{user.name ?? user.email}</span>
      <NavLink to="/billing" style={{ color: 'rgba(255,253,248,0.85)', fontSize: 13, textDecoration: 'none' }}>Billing</NavLink>
      <button
        onClick={handleLogout}
        style={{
          background: 'transparent', border: '1px solid rgba(255,253,248,0.35)', color: colors.warmWhite,
          padding: '6px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
        }}
      >
        Sign out
      </button>
    </div>
  );
}
