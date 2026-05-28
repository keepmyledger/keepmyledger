import React from 'react';
import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import brandConfig from '@content/brand/config';
import { TermsContent } from '@content/legal/terms-content';

const LAST_UPDATED = 'May 21, 2026';

const pageStyle: React.CSSProperties = {
  maxWidth: 760,
  margin: '0 auto',
  padding: '32px 24px 64px',
  color: '#2B2B2B',
  lineHeight: 1.6,
  fontSize: 15,
};

export function TermsPage() {
  useDocumentTitle('Terms of Service');
  return (
    <div style={pageStyle}>
      <p style={{ marginBottom: 24 }}>
        <Link to="/" style={{ color: '#2E7D61', textDecoration: 'none' }}>← Back</Link>
      </p>
      <TermsContent
        appName={brandConfig.name}
        parentEntity={brandConfig.parentEntity}
        contactEmail={brandConfig.legalEmail}
        appUrl={brandConfig.canonicalUrl}
        lastUpdated={LAST_UPDATED}
      />
    </div>
  );
}
