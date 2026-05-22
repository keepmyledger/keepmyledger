/**
 * Lightweight user preferences stored in localStorage. Survives page reloads.
 * Read with `getSetting(key)`, write with `setSetting(key, value)`, or use the
 * `useSetting` hook for components.
 */
import { useEffect, useState } from 'react';

const PREFIX = 'keepmyledger.settings.';
const LEGACY_PREFIX = 'expense-tracker.settings.';

// One-time migration: move any legacy keys to the new prefix.
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(LEGACY_PREFIX)) {
      const suffix = k.slice(LEGACY_PREFIX.length);
      const newKey = PREFIX + suffix;
      if (localStorage.getItem(newKey) == null) {
        const v = localStorage.getItem(k);
        if (v != null) localStorage.setItem(newKey, v);
      }
      localStorage.removeItem(k);
    }
  }
} catch {
  /* ignore */
}

export interface Settings {
  transactionsPageSize: number;
}

export const DEFAULT_SETTINGS: Settings = {
  transactionsPageSize: 25,
};

export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return DEFAULT_SETTINGS[key];
    return JSON.parse(raw) as Settings[K];
  } catch {
    return DEFAULT_SETTINGS[key];
  }
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent('settings-changed', { detail: { key } }));
}

/** React hook returning [value, setValue]. Re-renders when the setting changes. */
export function useSetting<K extends keyof Settings>(
  key: K
): [Settings[K], (v: Settings[K]) => void] {
  const [value, setValue] = useState<Settings[K]>(() => getSetting(key));
  useEffect(() => {
    const onChange = (e: Event) => {
      if ((e as CustomEvent<{ key: string }>).detail?.key === key) {
        setValue(getSetting(key));
      }
    };
    window.addEventListener('settings-changed', onChange);
    return () => window.removeEventListener('settings-changed', onChange);
  }, [key]);
  return [value, (v) => setSetting(key, v)];
}
