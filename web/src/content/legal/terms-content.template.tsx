/**
 * TEMPLATE — replace this with your actual Terms of Service.
 * Create web/src/content/legal/terms-content.local.tsx with your real content;
 * it will be picked up automatically over this template at build time.
 */
import React from 'react';

export interface TermsContentProps {
  appName: string;
  parentEntity: string;
  contactEmail: string;
  appUrl: string;
  lastUpdated: string;
}

const h2: React.CSSProperties = { marginTop: 32, marginBottom: 8, fontSize: 20, color: '#1F5C4A' };
const h3: React.CSSProperties = { marginTop: 20, marginBottom: 4, fontSize: 16, color: '#2E7D61' };

export function TermsContent({ appName, parentEntity, contactEmail, appUrl, lastUpdated }: TermsContentProps) {
  return (
    <>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Terms of Service</h1>
      <p style={{ color: '#5E5E5E', marginTop: 0 }}>Last updated: {lastUpdated}</p>

      <p>
        <strong style={{ color: '#c0392b' }}>
          ⚠ This is a placeholder Terms of Service. Replace this file with your actual terms before
          deploying publicly. Create{' '}
          <code>web/src/content/legal/terms-content.local.tsx</code> with your real content.
        </strong>
      </p>

      <p>
        These Terms of Service govern your access to and use of {appName} (&ldquo;the
        Service&rdquo;), operated by {parentEntity}. By creating an account or using the Service you
        agree to these Terms.
      </p>

      <h2 style={h2}>1. Description of the Service</h2>
      <p>
        {appName} is a personal-finance tool available at{' '}
        <a href={appUrl} style={{ color: '#2E7D61' }}>{appUrl}</a>.
      </p>

      <h2 style={h2}>2. Eligibility</h2>
      <p>
        You must be at least 18 years old and capable of forming a binding contract to use the
        Service.
      </p>

      <h2 style={h2}>3. Your data</h2>
      <p>
        You retain ownership of all financial data and files you upload. We do not sell your data.
      </p>

      <h2 style={h2}>4. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; WITHOUT WARRANTIES OF ANY KIND. {appName} is a
        financial organization tool, not a financial advisor.
      </p>

      <h2 style={h2}>5. Contact</h2>
      <p>
        Questions: <a href={`mailto:${contactEmail}`} style={{ color: '#2E7D61' }}>{contactEmail}</a>.
      </p>

      <h3 style={h3}>Self-hosted deployments</h3>
      <p>
        This software is available under an open-source license. If you are running a self-hosted
        instance, these template terms apply only to that installation&apos;s operator. Update this
        file with terms appropriate for your deployment.
      </p>
    </>
  );
}
