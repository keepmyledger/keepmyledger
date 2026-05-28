import { useEffect } from 'react';
import brandConfig from '@content/brand/config';

const SUFFIX = ` · ${brandConfig.name}`;

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const prev = document.title;
    document.title = title.endsWith(SUFFIX) ? title : `${title}${SUFFIX}`;
    return () => { document.title = prev; };
  }, [title]);
}
