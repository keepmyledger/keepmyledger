import { useEffect, useState } from 'react';

/** Returns true when the given media query matches. SSR-safe (returns false on first render server-side). */
export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== 'undefined' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState<boolean>(get);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const handler = () => setMatches(mql.matches);
    handler();
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

/** Convenience: true when viewport width <= 720px. */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 720px)');
}
