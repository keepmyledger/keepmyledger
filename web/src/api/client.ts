import type {
  Account, Category, Rule, Transaction, Statement, Receipt, DriveAuthStatus,
  CreateAccountPayload, UpdateAccountPayload,
  CreateCategoryPayload, UpdateCategoryPayload,
  CreateRulePayload, UpdateRulePayload,
  UpdateTransactionPayload,
  ImportResult, StartupCheckResult,
  ReportByCategoryRow, CashflowRow,
  AppConfig, User,
  AiSuggestion,
  PreviewResponse, CommitPayload, CsvColumnMapping,
} from '@keepmyledger/shared';

const BASE = '/api';

/** Optional handler invoked when any request returns 401. Set by AuthProvider. */
let onUnauthorized: (() => void) | undefined;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

/** Optional handler invoked when any request returns 402. Set by App. */
let onSubscriptionRequired: (() => void) | undefined;
export function setSubscriptionRequiredHandler(fn: () => void) { onSubscriptionRequired = fn; }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
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
    abandon: (token: string) =>
      request<void>(`/imports/preview/${encodeURIComponent(token)}`, { method: 'DELETE' }),
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

  billing: {
    status: () => request<{
      status: string | null;
      plan: string | null;
      trialEndsAt: string | null;
      currentPeriodEnd: string | null;
      daysRemaining: number | null;
      hasPaymentMethod: boolean;
    }>('/billing/status'),
  },

  auth: {
    me: () => request<{ user: User | null }>('/auth/me'),
    logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
    loginUrl: (provider: string) => `${BASE}/auth/${provider}`,

    local: {
      register: (username: string, password: string) =>
        request<{ user: User }>('/auth/local/register', {
          method: 'POST',
          body: JSON.stringify({ username, password }),
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
};
