/**
 * Pre-render the public marketing/legal routes to static HTML so search
 * engines and AI answer engines see real content (not just the SPA shell).
 *
 * Runs after `vite build`. For each route, renders the page component with
 * react-dom/server, splices the result into the built dist/index.html, and
 * writes it to dist/<route>/index.html. The Express SPA fallback in the
 * server then serves these files when crawlers hit a marketing URL.
 *
 * Content slots (brand name, route titles, etc.) are resolved via the same
 * .local.* > .template.* precedence as the Vite alias in vite.config.ts, so
 * fork operators only need to create their .local.* overrides once and both
 * the Vite build and this script pick them up.
 *
 * Limitations:
 *  - Only renders pages that don't depend on auth/network state.
 *  - useEffect doesn't run during SSR, so components that only set
 *    document.title or fetch data in effects are safe.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';

import { AboutPage } from '../src/pages/About';
import { PrivacyPage } from '../src/pages/Privacy';
import { TermsPage } from '../src/pages/Terms';
import { AccessibilityPage } from '../src/pages/Accessibility';

/** Resolves a content slot the same way vite.config.ts does at build time. */
function resolveContent(slot: string): string {
  const contentDir = fileURLToPath(new URL('../src/content', import.meta.url));
  const base = path.join(contentDir, slot);
  for (const ext of ['.local.tsx', '.local.ts', '.template.tsx', '.template.ts']) {
    const candidate = `${base}${ext}`;
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  throw new Error(`No content file found for slot: ${slot}`);
}

interface Route {
  path: string;
  Page: React.ComponentType;
  title: string;
  description: string;
}

async function main() {
  const { PRERENDER_ROUTES } = await import(resolveContent('seo/prerender-routes')) as {
    PRERENDER_ROUTES: { path: string; title: string; description: string }[];
  };

  const routeMap = new Map(PRERENDER_ROUTES.map((r) => [r.path, r]));

  const ROUTES: Route[] = [
    { path: '/about',         Page: AboutPage,         ...routeMap.get('/about')! },
    { path: '/privacy',       Page: PrivacyPage,       ...routeMap.get('/privacy')! },
    { path: '/terms',         Page: TermsPage,         ...routeMap.get('/terms')! },
    { path: '/accessibility', Page: AccessibilityPage, ...routeMap.get('/accessibility')! },
  ];

  const distDir = path.resolve(fileURLToPath(import.meta.url), '../../dist');
  const indexHtml = readFileSync(path.join(distDir, 'index.html'), 'utf8');

  const ROOT_RE = /<div id="root">[\s\S]*?<\/div>/;
  const TITLE_RE = /<title>[\s\S]*?<\/title>/;
  const DESC_RE  = /<meta name="description" content="[^"]*"[^>]*\/?>/;

  let rendered = 0;
  for (const { path: route, Page, title, description } of ROUTES) {
    const body = renderToString(
      React.createElement(StaticRouter, { location: route }, React.createElement(Page))
    );

    const html = indexHtml
      .replace(ROOT_RE, `<div id="root">${body}</div>`)
      .replace(TITLE_RE, `<title>${escapeHtml(title)}</title>`)
      .replace(DESC_RE, `<meta name="description" content="${escapeHtml(description)}" />`);

    const outDir = path.join(distDir, route.slice(1));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'index.html'), html);
    rendered++;
    console.log(`  prerendered ${route} -> dist${route}/index.html`);
  }

  console.log(`\nPre-rendered ${rendered} marketing route(s).`);
}

main();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
