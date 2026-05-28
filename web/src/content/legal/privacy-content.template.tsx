/**
 * TEMPLATE — replace this with your actual Privacy Policy.
 * Create web/src/content/legal/privacy-content.local.tsx with your real content;
 * it will be picked up automatically over this template at build time.
 */
import React from 'react';

export interface PrivacyContentProps {
  appName: string;
  parentEntity: string;
  contactEmail: string;
  lastUpdated: string;
}

const h2: React.CSSProperties = { marginTop: 32, marginBottom: 8, fontSize: 20, color: '#1F5C4A' };
const h3: React.CSSProperties = { marginTop: 20, marginBottom: 4, fontSize: 16, color: '#2E7D61' };

export function PrivacyContent({ appName, parentEntity, contactEmail, lastUpdated }: PrivacyContentProps) {
  return (
    <>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Privacy Policy</h1>
      <p style={{ color: '#5E5E5E', marginTop: 0 }}>Last updated: {lastUpdated}</p>

      <p>
        <strong style={{ color: '#c0392b' }}>
          ⚠ This is a placeholder Privacy Policy. Replace this file with your actual policy before
          deploying publicly. Create{' '}
          <code>web/src/content/legal/privacy-content.local.tsx</code> with your real content.
        </strong>
      </p>

      <p>
        {appName} is a product of {parentEntity}, a personal-finance tool that lets you import bank
        and credit-card statements, categorize transactions, and attach receipts. This page explains
        what data we collect, why we collect it, and the third parties involved.
      </p>

      <h2 style={h2}>1. Information we collect</h2>
      <h3 style={h3}>Account information</h3>
      <p>
        When you sign in via OAuth, we receive your public profile information (user ID, email
        address, display name). We use this to create and identify your account. We do not receive
        your provider password.
      </p>
      <p>
        If you register with an email and password, we store your email address and a bcrypt hash of
        your password. The plaintext password is never stored or logged.
      </p>

      <h3 style={h3}>Financial data you provide</h3>
      <p>
        When you import a statement we extract and store transaction date, description, amount, and
        running balance. The original file is processed in memory and not retained after parsing.
      </p>

      <h2 style={h2}>2. How we use your data</h2>
      <ul>
        <li>To operate the service and display your transactions.</li>
        <li>To authenticate you and keep you signed in.</li>
        <li>To answer AI Assist requests when you initiate them.</li>
      </ul>
      <p>We do not sell your personal data.</p>

      <h2 style={h2}>3. Data retention and deletion</h2>
      <p>
        We retain your data for as long as your account is active. To request export or deletion,
        email{' '}
        <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
      </p>

      <h2 style={h2}>4. Contact</h2>
      <p>
        Questions: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
      </p>
    </>
  );
}
