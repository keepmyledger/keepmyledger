import React from 'react';
import { colors } from '../styles/tokens';

export function AboutPage() {
  return (
    <div style={{ maxWidth: 640, margin: '64px auto', padding: '0 24px', color: colors.darkSlate }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>KeepMyLedger</h1>
      <p style={{ color: colors.mutedGray, marginBottom: 24 }}>
        An open-source personal finance tracker. Import bank and credit card
        statements, categorize transactions, and generate tax-ready reports.
        Self-hostable - your data stays on your own server.
      </p>
      <ul style={{ lineHeight: 2, paddingLeft: 20, marginBottom: 32 }}>
        <li>Import CSV, QIF, and PDF statements</li>
        <li>Rule-based and AI-assisted categorization</li>
        <li>SQLite (default) or Postgres backend</li>
        <li>AGPL-3.0-or-later licensed</li>
      </ul>
      <div style={{ display: 'flex', gap: 16 }}>
        <a
          href="https://github.com/keepmyledger/keepmyledger"
          style={{ color: colors.goldRich, textDecoration: 'none', fontWeight: 600 }}
        >
            GitHub {'->'}
        </a>
        <a
          href="https://github.com/keepmyledger/keepmyledger/blob/main/LICENSE"
          style={{ color: colors.mutedGray, textDecoration: 'none' }}
        >
          License (AGPL-3.0)
        </a>
      </div>
    </div>
  );
}
