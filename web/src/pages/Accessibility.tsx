import React from 'react';
import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import brandConfig from '@content/brand/config';

const LAST_UPDATED = 'May 23, 2026';

const pageStyle: React.CSSProperties = {
  maxWidth: 760,
  margin: '0 auto',
  padding: '32px 24px 64px',
  color: '#2B2B2B',
  lineHeight: 1.6,
  fontSize: 15,
};

const h2Style: React.CSSProperties = {
  marginTop: 32,
  marginBottom: 8,
  fontSize: 20,
  color: '#1F5C4A',
};

export function AccessibilityPage() {
  useDocumentTitle('Accessibility');
  return (
    <div style={pageStyle}>
      <p style={{ marginBottom: 24 }}>
        <Link to="/" style={{ color: '#2E7D61', textDecoration: 'none' }}>← Back</Link>
      </p>

      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Accessibility Statement</h1>
      <p style={{ color: '#5E5E5E', marginTop: 0 }}>Last updated: {LAST_UPDATED}</p>

      <p>
        {brandConfig.name} is committed to making our personal-finance tools usable by everyone,
        including people who rely on assistive technologies. We aim to conform to the{' '}
        <a
          href="https://www.w3.org/TR/WCAG21/"
          target="_blank"
          rel="noreferrer"
        >
          Web Content Accessibility Guidelines (WCAG) 2.1
        </a>{' '}
        at the AA level.
      </p>

      <h2 style={h2Style}>Conformance target</h2>
      <p>
        Our target is WCAG 2.1 Level AA. We test against this standard during development and
        review reported issues against it. {brandConfig.name} is currently in beta and we have not yet
        completed a formal third-party audit.
      </p>

      <h2 style={h2Style}>What works well today</h2>
      <ul>
        <li>All primary navigation and interactive controls are reachable via the keyboard.</li>
        <li>Buttons, links, and form fields show a visible focus indicator when tabbed to.</li>
        <li>Form fields have associated labels or accessible names.</li>
        <li>Modal dialogs are marked up with <code>role=&quot;dialog&quot;</code> and{' '}
          <code>aria-modal=&quot;true&quot;</code>, and trap focus while open.</li>
        <li>Decorative icons are hidden from screen readers; meaningful icons have accessible
          names.</li>
        <li>Each page sets a descriptive document title to aid screen-reader navigation.</li>
      </ul>

      <h2 style={h2Style}>Known gaps</h2>
      <p>
        We are honest about where we still have work to do. As of the last-updated date above:
      </p>
      <ul>
        <li>
          We have not yet had a third-party audit or independent VPAT assessment.
        </li>
        <li>
          Some data-dense tables (transactions, reports) rely on visual layout; we are still
          improving the screen-reader experience for sortable headers and row grouping.
        </li>
        <li>
          Color contrast has been spot-checked against WCAG AA but not exhaustively verified for
          every chart and badge variant.
        </li>
        <li>
          We do not currently offer a dedicated high-contrast theme. The app respects your OS-level
          font-size and zoom settings up to 200%.
        </li>
      </ul>

      <h2 style={h2Style}>Assistive technology compatibility</h2>
      <p>
        We design and test against current versions of:
      </p>
      <ul>
        <li>Chrome, Firefox, Safari, and Edge on desktop</li>
        <li>Safari on iOS and Chrome on Android</li>
        <li>VoiceOver (macOS / iOS) and NVDA (Windows) where practical</li>
      </ul>

      <h2 style={h2Style}>Reporting an accessibility issue</h2>
      <p>
        If you run into a barrier using {brandConfig.name}, we want to hear about it. Please email{' '}
        <a href={`mailto:${brandConfig.supportEmail}?subject=${encodeURIComponent('Accessibility issue')}`}>
          {brandConfig.supportEmail}
        </a>{' '}
        with:
      </p>
      <ul>
        <li>The page or feature where you encountered the issue (a URL helps)</li>
        <li>What you were trying to do</li>
        <li>The assistive technology, browser, and operating system you were using, if known</li>
      </ul>
      <p>
        We aim to acknowledge accessibility reports within five business days and to prioritize
        fixes that block core tasks (importing statements, categorizing transactions, viewing
        reports).
      </p>

      <h2 style={h2Style}>Formal complaints</h2>
      <p>
        If you are not satisfied with our response, you may also contact us at{' '}
        <a href={`mailto:${brandConfig.supportEmail}`}>{brandConfig.supportEmail}</a> and we will
        escalate your report internally. {brandConfig.name} is a product of {brandConfig.parentEntity}.
      </p>
    </div>
  );
}
