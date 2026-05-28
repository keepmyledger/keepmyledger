import React, { useEffect, useState } from 'react';
import type { StartupCheckResult } from '@keepmyledger/shared';
import { api } from '../api/client';
import { useNavigate } from 'react-router-dom';

export function StartupPromptModal() {
  const [data, setData] = useState<StartupCheckResult | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.startupCheck().then(setData).catch(console.error);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (dismissed || !data || data.missingStatements.length === 0) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setDismissed(true); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [dismissed, data]);

  if (dismissed || !data || data.missingStatements.length === 0) return null;

  return (
    <div
      style={overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="startup-modal-title"
    >
      <div style={modal}>
        <h2 id="startup-modal-title" style={{ marginTop: 0 }}>Missing Statements</h2>
        <p>The following accounts are missing a statement for last month:</p>
        <ul style={{ paddingLeft: 20 }}>
          {data.missingStatements.map(({ account, missingPeriod }) => (
            <li key={account.id} style={{ marginBottom: 8 }}>
              <strong>{account.name}</strong>: {missingPeriod}
              <button
                style={{ marginLeft: 12 }}
                onClick={() => {
                  setDismissed(true);
                  navigate(`/import?accountId=${account.id}`);
                }}
              >
                Import now
              </button>
            </li>
          ))}
        </ul>
        <div style={{ textAlign: 'right', marginTop: 16 }}>
          <button onClick={() => setDismissed(true)}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(43, 43, 43, 0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const modal: React.CSSProperties = {
  background: '#FFFDF8', borderRadius: 14, padding: '24px 32px',
  minWidth: 360, maxWidth: 520, boxShadow: '0 12px 40px rgba(31,41,32,0.22)',
  border: '1px solid #E6DFCB',
};
