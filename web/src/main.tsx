import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import './index.css';

const SENTRY_DSN = (import.meta as unknown as { env: Record<string, string> }).env.VITE_SENTRY_DSN_WEB;
Sentry.init({
  dsn: SENTRY_DSN,
  environment: (import.meta as unknown as { env: Record<string, string> }).env.MODE ?? 'development',
  enabled: !!SENTRY_DSN,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.1,
});

// Register service worker (skip on localhost dev to avoid HMR conflicts).
const isDevHost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
if ('serviceWorker' in navigator && location.protocol === 'https:' && !isDevHost) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('SW registration failed:', err);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
