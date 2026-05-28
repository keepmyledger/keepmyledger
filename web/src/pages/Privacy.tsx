import React from 'react';
import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import brandConfig from '@content/brand/config';
import { PrivacyContent } from '@content/legal/privacy-content';

const LAST_UPDATED = 'May 25, 2026';

const pageStyle: React.CSSProperties = {
  maxWidth: 760,
  margin: '0 auto',
  padding: '32px 24px 64px',
  color: '#2B2B2B',
  lineHeight: 1.6,
  fontSize: 15,
};

export function PrivacyPage() {
  useDocumentTitle('Privacy Policy');
  return (
    <div style={pageStyle}>
      <p style={{ marginBottom: 24 }}>
        <Link to="/" style={{ color: '#2E7D61', textDecoration: 'none' }}>← Back</Link>
      </p>
      <PrivacyContent
        appName={brandConfig.name}
        parentEntity={brandConfig.parentEntity}
        contactEmail={brandConfig.privacyEmail}
        lastUpdated={LAST_UPDATED}
      />
    </div>
  );
}
