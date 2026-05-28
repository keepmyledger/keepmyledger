import type {
  Account, Category, Rule, Transaction, TransactionSplit, Statement, Receipt, DriveAuthStatus,
  CreateAccountPayload, UpdateAccountPayload,
  CreateCategoryPayload, UpdateCategoryPayload,
  CreateRulePayload, UpdateRulePayload,
  UpdateTransactionPayload,
  ImportResult, StartupCheckResult,
  ReportByCategoryRow, CashflowRow,
  AppConfig, User, ReceiptStoragePreference,
  AiSuggestion,
  PreviewResponse, CommitPayload, CsvColumnMapping,
  Org, OrgMember, Business, OrgInvite,
  UnknownFormatSample, UnknownFormatStatus,
} from '@keepmyledger/shared';

const BASE = '/api';

/** Optional handler invoked when any request returns 401. Set by AuthProvider. */
let onUnauthorized: (() => void) | undefined;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

/** Optional handler invoked when any request returns 402. Set by App. */
let onSubscriptionRequired: (() => void) | undefined;
export function setSubscriptionRequiredHandler(fn: () => void) { onSubscriptionRequired = fn; }

/** The active business id injected as x-business-id on every request. */
let activeBusinessId: number | null = null;
export function setActiveBusinessId(id: number | null) { activeBusinessId = id; }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const extraHeaders: Record<string, string> = {};
  if (activeBusinessId !== null) extraHeaders['x-business-id'] = String(activeBusinessId);
  const res = await fetch(`${BASE}${url}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...extraHeaders, ...init?.headers },
    ...init,
  });
  if (res.status === 401) onUnauthorized?.();
  if (res.status === 402) onSubscriptionRequired?.();
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function rawFormPost<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${url}`, { method: 'POST', body: form, credentials: 'include' });
  if (res.status === 401) onUnauthorized?.();
  if (res.status === 402) onSubscriptionRequired?.();
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ── Accounts ─────────────────────────────────────────────────────────────────
export const api = {
  accounts: {
    list: () => request<Account[]>('/accounts'),
    get: (id: number) => request<Account>(`/accounts/${id}`),
    create: (p: CreateAccountPayload) => request<Account>('/accounts', { method: 'POST', body: JSON.stringify(p) }),
    update: (id: number, p: UpdateAccountPayload) => request<Account>(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
    delete: (id: number) => request<void>(`/accounts/${id}`, { method: 'DELETE' }),
  },

  categories: {
    list: () => request<Category[]>('/categories'),
    get: (id: number) => request<Category>(`/categories/${id}`),
    create: (p: CreateCategoryPayload) => request<Category>('/categories', { method: 'POST', body: JSON.stringify(p) }),
    update: (id: number, p: UpdateCategoryPayload) => request<Category>(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
    delete: (id: number) => request<void>(`/categories/${id}`, { method: 'DELETE' }),
  },

  rules: {
    list: () => request<Rule[]>('/rules'),
    get: (id: number) => request<Rule>(`/rules/${id}`),
    create: (p: CreateRulePayload) => request<Rule>('/rules', { method: 'POST', body: JSON.stringify(p) }),
    update: (id: number, p: UpdateRulePayload) => request<Rule>(`/rules/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
    delete: (id: number) => request<void>(`/rules/${id}`, { method: 'DELETE' }),
    apply: (id: number) => request<{ message: string }>(`/rules/${id}/apply`, { method: 'POST' }),
  },

  transactions: {
    list: (params?: Record<string, string | number | boolean>) => {
      const qs = params ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString() : '';
      return request<Transaction[]>(`/transactions${qs}`);
    },
    get: (id: number) => request<Transaction>(`/transactions/${id}`),
    update: (id: number, p: UpdateTransactionPayload) => request<Transaction>(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
    approveSuggestion: (id: number) => request<Transaction>(`/transactions/${id}/approve-suggestion`, { method: 'POST' }),
    aiSuggest: (id: number) => request<AiSuggestion>(`/transactions/${id}/ai-suggest`, { method: 'POST' }),
    delete: (id: number) => request<void>(`/transactions/${id}`, { method: 'DELETE' }),
    bulkDelete: (ids: number[]) => request<{ deleted: number }>('/transactions', { method: 'DELETE', body: JSON.stringify({ ids }) }),
    listReceipts: (id: number) => request<Receipt[]>(`/receipts/transactions/${id}`),
    linkReceipt: (id: number, receiptId: number) => request<Receipt[]>(`/receipts/transactions/${id}`, { method: 'POST', body: JSON.stringify({ receiptId }) }),
    unlinkReceipt: (id: number, receiptId: number) => request<void>(`/receipts/transactions/${id}/${receiptId}`, { method: 'DELETE' }),
    getSplits: (id: number) => request<{ splits: TransactionSplit[] }>(`/transactions/${id}/splits`),
    replaceSplits: (id: number, splits: Array<{ categoryId: number; amount: number; note?: string | null }>) =>
      request<{ splits: TransactionSplit[] }>(`/transactions/${id}/splits`, { method: 'PUT', body: JSON.stringify({ splits }) }),
  },

  imports: {
    uploadPdf: (accountId: number, file: File) => {
      const form = new FormData();
      form.append('accountId', String(accountId));
      form.append('file', file);
      return rawFormPost<ImportResult>('/imports', form);
    },
    upload: (accountId: number, file: File) => {
      const form = new FormData();
      form.append('accountId', String(accountId));
      form.append('file', file);
      return rawFormPost<ImportResult>('/imports', form);
    },
    preview: (file: File, accountId?: number) => {
      const form = new FormData();
      if (accountId !== undefined) form.append('accountId', String(accountId));
      form.append('file', file);
      return rawFormPost<PreviewResponse>('/imports/preview', form);
    },
    reparse: (token: string, mapping: CsvColumnMapping | null) =>
      request<PreviewResponse>(`/imports/preview/${encodeURIComponent(token)}/reparse`, {
        method: 'POST',
        body: JSON.stringify({ mapping }),
      }),
    commit: (payload: CommitPayload) =>
      request<ImportResult>('/imports/commit', { method: 'POST', body: JSON.stringify(payload) }),
    enhanceLlm: (token: string, accountId?: number) =>
      request<PreviewResponse>(`/imports/preview/${encodeURIComponent(token)}/enhance-llm`, {
        method: 'POST',
        body: JSON.stringify({ accountId }),
      }),
    abandon: (token: string) =>
      request<void>(`/imports/preview/${encodeURIComponent(token)}`, { method: 'DELETE' }),
    reportUnknown: (token: string, bankHint?: string, accountId?: number) =>
      request<{ id: number }>('/imports/report-unknown', {
        method: 'POST',
        body: JSON.stringify({ token, bankHint, accountId }),
      }),
    resolveDuplicates: (statementId: number, decisions: Array<{
      externalHash: string;
      action: 'keep' | 'skip';
      date: string;
      description: string;
      amount: number;
    }>) =>
      request<{ inserted: number; transactions: Transaction[] }>('/imports/duplicates/resolve', {
        method: 'POST',
        body: JSON.stringify({ statementId, decisions }),
      }),
  },

  reports: {
    byCategory: (year?: number) => {
      const qs = year ? `?year=${year}` : '';
      return request<ReportByCategoryRow[]>(`/reports/by-category${qs}`);
    },
    cashflow: (year?: number) => {
      const qs = year ? `?year=${year}` : '';
      return request<CashflowRow[]>(`/reports/cashflow${qs}`);
    },
    taxExportUrl: (year?: number) => `${BASE}/exports/tax${year ? `?year=${year}` : ''}`,
    transactionsExportUrl: (params?: Record<string, string | number | boolean>) => {
      const qs = params && Object.keys(params).length
        ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
        : '';
      return `${BASE}/exports/transactions${qs}`;
    },
  },

  startupCheck: () => request<StartupCheckResult>('/startup-check'),

  receipts: {
    list: () => request<Receipt[]>('/receipts'),
    driveStatus: () => request<DriveAuthStatus>('/receipts/drive/status'),
    driveAuthUrl: () => request<{ url: string }>('/receipts/drive/auth'),
    uploadFile: (file: File, transactionId?: number) => {
      const form = new FormData();
      form.append('file', file);
      if (transactionId !== undefined) form.append('transactionId', String(transactionId));
      return rawFormPost<Receipt>('/receipts/upload', form);
    },
    linkFromDrive: (params: { driveFileId: string; driveFileName: string; driveMimeType?: string; driveWebViewLink?: string; driveThumbnailLink?: string; transactionId?: number }) =>
      request<Receipt>('/receipts/from-drive', { method: 'POST', body: JSON.stringify(params) }),
    delete: (id: number) => request<void>(`/receipts/${id}`, { method: 'DELETE' }),
  },

  config: () => request<AppConfig>('/config'),

  account: {
    exportUrl: () => `${BASE}/account/export`,
    delete: () => request<{ ok: boolean }>('/account', { method: 'DELETE' }),
    setReceiptStorage: (preference: ReceiptStoragePreference | null) =>
      request<{ ok: boolean; preference: ReceiptStoragePreference | null }>('/account/receipt-storage', {
        method: 'PUT',
        body: JSON.stringify({ preference }),
      }),
  },

  admin: {
    stats: {
      overview: () => request<{
        totalUsers: number;
        newUsers7d: number;
        newUsers30d: number;
        totalTransactions: number;
        totalStatements: number;
        subscriptions: Record<string, number>;
        aiCallsToday: number;
        aiCalls30d: number;
      }>('/admin/stats/overview'),
      signups: (days = 30) => request<{ day: string; total: number }[]>(`/admin/stats/signups?days=${days}`),
      imports: (days = 30) => request<{ day: string; total: number }[]>(`/admin/stats/imports?days=${days}`),
    },
    users: {
      list: (params?: { q?: string; trialEndingDays?: number; page?: number; limit?: number }) => {
        const qs = params
          ? '?' + new URLSearchParams(
              Object.entries(params)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k, String(v)])
            ).toString()
          : '';
        return request<{
          total: number;
          page: number;
          limit: number;
          users: Array<{
            id: string;
            email: string | null;
            name: string | null;
            createdAt: string;
            subStatus: string | null;
            trialEndsAt: string | null;
            tier: string;
            seats: number;
            grantedByAdminId: string | null;
          }>;
        }>(`/admin/users${qs}`);
      },
      extendTrial: (userIds: string[], days: number, reason?: string) =>
        request<{ ok: boolean; extended: number }>('/admin/users/extend-trial', {
          method: 'POST',
          body: JSON.stringify({ userIds, days, reason }),
        }),
      revealEmail: (userId: string) =>
        request<{ email: string | null }>(`/admin/users/${encodeURIComponent(userId)}/reveal-email`),
      grantTier: (userId: string, tier: 'business' | 'org', seats?: number) =>
        request<{ ok: boolean; userId: string; tier: string; seats: number }>(
          `/admin/users/${encodeURIComponent(userId)}/grant-tier`,
          { method: 'POST', body: JSON.stringify({ tier, seats }) },
        ),
      revokeGrant: (userId: string) =>
        request<{ ok: boolean; userId: string; status: string }>(
          `/admin/users/${encodeURIComponent(userId)}/revoke-grant`,
          { method: 'POST' },
        ),
    },

    unknownFormats: {
      list: (params?: { status?: UnknownFormatStatus; page?: number; limit?: number }) => {
        const qs = params
          ? '?' + new URLSearchParams(
              Object.entries(params)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k, String(v)])
            ).toString()
          : '';
        return request<{ total: number; page: number; limit: number; samples: UnknownFormatSample[] }>(
          `/admin/unknown-formats${qs}`
        );
      },
      update: (id: number, patch: { status?: UnknownFormatStatus; adminNotes?: string | null }) =>
        request<UnknownFormatSample>(`/admin/unknown-formats/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }),
    },
  },

  billing: {
    status: () => request<{
      status: string | null;
      plan: string | null;
      tier: string | null;
      seats: number | null;
      trialEndsAt: string | null;
      currentPeriodEnd: string | null;
      daysRemaining: number | null;
      hasPaymentMethod: boolean;
      last4: string | null;
      aiLifetimeCount: number | null;
      aiLifetimeLimit: number | null;
    }>('/billing/status'),
    setupIntent: () => request<{ clientSecret: string }>('/billing/setup-intent', { method: 'POST' }),
    subscribe: (params: {
      paymentMethodId: string;
      tier: 'business' | 'org';
      interval: 'monthly' | 'annual';
      seats?: number;
      promoCode?: string;
    }) =>
      request<{ ok: boolean; status: string }>('/billing/subscribe', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    cancel: () => request<{ ok: boolean }>('/billing/cancel', { method: 'POST' }),
    reactivate: () => request<{ ok: boolean }>('/billing/reactivate', { method: 'POST' }),
  },

  auth: {
    me: () => request<{ user: User | null }>('/auth/me'),
    logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
    loginUrl: (provider: string) => `${BASE}/auth/${provider}`,

    local: {
      register: (username: string, password: string, email: string) =>
        request<{ user: User }>('/auth/local/register', {
          method: 'POST',
          body: JSON.stringify({ username, password, email, acceptTos: true }),
        }),
      login: (username: string, password: string) =>
        request<{ user?: User; mfaRequired?: boolean }>('/auth/local/login', {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        }),
      verifyMfa: (code: string) =>
        request<{ user: User }>('/auth/local/verify-mfa', {
          method: 'POST',
          body: JSON.stringify({ code }),
        }),
      updateEmail: (email: string) =>
        request<{ user: User }>('/auth/local/email', {
          method: 'PATCH',
          body: JSON.stringify({ email }),
        }),
      forgotPassword: (email: string) =>
        request<{ ok: boolean }>('/auth/local/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email }),
        }),
      resetPassword: (token: string, password: string) =>
        request<{ ok: boolean }>('/auth/local/reset-password', {
          method: 'POST',
          body: JSON.stringify({ token, password }),
        }),
    },

    totp: {
      status: () => request<{ enabled: boolean; hasSecret: boolean }>('/auth/totp/status'),
      setup: () =>
        request<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }>('/auth/totp/setup'),
      enable: (code: string) =>
        request<{ ok: boolean }>('/auth/totp/enable', {
          method: 'POST',
          body: JSON.stringify({ code }),
        }),
      disable: (code: string) =>
        request<{ ok: boolean }>('/auth/totp/disable', {
          method: 'POST',
          body: JSON.stringify({ code }),
        }),
    },
  },

  orgs: {
    list: () => request<Org[]>('/orgs'),
    create: (name: string) => request<Org>('/orgs', { method: 'POST', body: JSON.stringify({ name }) }),
    listMembers: (orgId: string) => request<OrgMember[]>(`/orgs/${orgId}/members`),
    removeMember: (orgId: string, userId: string) =>
      request<void>(`/orgs/${orgId}/members/${userId}`, { method: 'DELETE' }),
  },

  businesses: {
    list: (orgId: string) => request<Business[]>(`/orgs/${orgId}/businesses`),
    create: (orgId: string, name: string) =>
      request<Business>(`/orgs/${orgId}/businesses`, { method: 'POST', body: JSON.stringify({ name }) }),
    rename: (orgId: string, id: number, name: string) =>
      request<Business>(`/orgs/${orgId}/businesses/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
    delete: (orgId: string, id: number) =>
      request<void>(`/orgs/${orgId}/businesses/${id}`, { method: 'DELETE' }),
    /** Upload (or replace) a logo. Accepts PNG/JPEG/WebP, max 1 MB. */
    uploadLogo: async (orgId: string, id: number, file: File): Promise<Business> => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${BASE}/orgs/${orgId}/businesses/${id}/logo`, {
        method: 'POST',
        body: form,
        credentials: 'include',
        headers: activeBusinessId !== null ? { 'x-business-id': String(activeBusinessId) } : undefined,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        throw new Error(body.error ?? res.statusText);
      }
      return res.json() as Promise<Business>;
    },
    deleteLogo: (orgId: string, id: number) =>
      request<void>(`/orgs/${orgId}/businesses/${id}/logo`, { method: 'DELETE' }),
    /** Resolves a fresh signed URL for the logo (server issues a 302 to the storage). */
    logoUrl: (orgId: string, id: number) => `${BASE}/orgs/${orgId}/businesses/${id}/logo`,
  },

  invites: {
    list: (orgId: string) => request<OrgInvite[]>(`/orgs/${orgId}/invites`),
    create: (orgId: string, email: string, role?: 'owner' | 'member') =>
      request<OrgInvite>(`/orgs/${orgId}/invites`, { method: 'POST', body: JSON.stringify({ email, role }) }),
    expire: (orgId: string, inviteId: string) =>
      request<void>(`/orgs/${orgId}/invites/${inviteId}`, { method: 'DELETE' }),
  },
};
