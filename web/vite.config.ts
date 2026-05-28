import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Resolves a content slot to its `.local.*` override if present,
 * else falls back to the `.template.*` file. Fork operators create
 * `web/src/content/{slot}.local.{ts,tsx}` to customize content without
 * modifying template files, so `git pull` never overwrites their copy.
 */
function pickContent(slot: string): string {
  const base = resolve(__dirname, `src/content/${slot}`);
  for (const ext of ['.local.tsx', '.local.ts', '.template.tsx', '.template.ts']) {
    if (existsSync(`${base}${ext}`)) return `${base}${ext}`;
  }
  throw new Error(`No content file found for slot: ${slot}`);
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@content/brand/config': pickContent('brand/config'),
      '@content/marketing/about': pickContent('marketing/about'),
      '@content/cookies/consent': pickContent('cookies/consent'),
      '@content/seo/prerender-routes': pickContent('seo/prerender-routes'),
      '@content/legal/privacy-content': pickContent('legal/privacy-content'),
      '@content/legal/terms-content': pickContent('legal/terms-content'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          stripe: ['@stripe/stripe-js', '@stripe/react-stripe-js'],
        },
      },
    },
  },
});
