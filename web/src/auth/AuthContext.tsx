import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setUnauthorizedHandler } from '../api/client';
import type { AppConfig, User } from '@keepmyledger/shared';

interface AuthState {
  status: 'loading' | 'ready';
  config: AppConfig | null;
  user: User | null;
}

interface AuthContextValue extends AuthState {
  /** Force a re-fetch of /api/auth/me — used after redirect-back from OAuth. */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', config: null, user: null });

  const refresh = useCallback(async () => {
    try {
      const [config, me] = await Promise.all([api.config(), api.auth.me()]);
      setState({ status: 'ready', config, user: me.user });
    } catch {
      setState({ status: 'ready', config: null, user: null });
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
    setState((s) => ({ ...s, user: null }));
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
