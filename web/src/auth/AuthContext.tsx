import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setUnauthorizedHandler, setActiveBusinessId } from '../api/client';
import type { AppConfig, User, Business } from '@keepmyledger/shared';

interface AuthState {
  status: 'loading' | 'ready';
  config: AppConfig | null;
  user: User | null;
  /** Active org id (personal org id == user id by convention). */
  orgId: string | null;
  /** Active business id. */
  businessId: number | null;
  /** All businesses visible to the user across all their orgs. */
  businesses: Business[];
}

interface AuthContextValue extends AuthState {
  /** Force a re-fetch of /api/auth/me; used after redirect-back from OAuth. */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  /** Switch the active business. Persists through page refreshes via the x-business-id header. */
  switchBusiness: (businessId: number) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    config: null,
    user: null,
    orgId: null,
    businessId: null,
    businesses: [],
  });

  const refresh = useCallback(async () => {
    try {
      const [config, me] = await Promise.all([api.config(), api.auth.me()]);
      if (!me.user) {
        setState({ status: 'ready', config, user: null, orgId: null, businessId: null, businesses: [] });
        return;
      }
      // Load orgs + all businesses for this user.
      const orgs = await api.orgs.list().catch(() => []);
      const bizLists = await Promise.all(orgs.map((o) => api.businesses.list(o.id).catch(() => [])));
      const allBusinesses = bizLists.flat();
      // Determine which business is active: prefer the currently set one if
      // it still belongs to the user, otherwise use the first one.
      setState((prev) => {
        const currentBizId = prev.businessId ?? (allBusinesses[0]?.id ?? null);
        const validBizId = allBusinesses.some((b) => b.id === currentBizId)
          ? currentBizId
          : (allBusinesses[0]?.id ?? null);
        const activeOrg = allBusinesses.find((b) => b.id === validBizId);
        setActiveBusinessId(validBizId);
        return {
          status: 'ready',
          config,
          user: me.user,
          orgId: activeOrg?.orgId ?? (orgs[0]?.id ?? null),
          businessId: validBizId,
          businesses: allBusinesses,
        };
      });
    } catch {
      setState({ status: 'ready', config: null, user: null, orgId: null, businessId: null, businesses: [] });
    }
  }, []);

  useEffect(() => {
    // Redirect to /login on any 401 in saas mode.
    setUnauthorizedHandler(() => {
      setState((s) => (s.config?.mode === 'saas' ? { ...s, user: null } : s));
    });
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.auth.logout();
    setActiveBusinessId(null);
    setState((s) => ({ ...s, user: null, orgId: null, businessId: null, businesses: [] }));
  }, []);

  const switchBusiness = useCallback((businessId: number) => {
    setState((prev) => {
      const activeOrg = prev.businesses.find((b) => b.id === businessId);
      setActiveBusinessId(businessId);
      return {
        ...prev,
        businessId,
        orgId: activeOrg?.orgId ?? prev.orgId,
      };
    });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, refresh, logout, switchBusiness }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
