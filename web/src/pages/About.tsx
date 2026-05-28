import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { colors, radii, shadows } from '../styles/tokens';
import brandConfig from '@content/brand/config';
import { ABOUT_CONTENT } from '@content/marketing/about';

const SECTION_MAX = 1080;

const section: React.CSSProperties = {
  maxWidth: SECTION_MAX, margin: '0 auto', padding: '0 24px',
};

const featureCard: React.CSSProperties = {
  background: colors.warmWhite, borderRadius: radii.md, padding: 20,
  border: `1px solid ${colors.softLine}`, boxShadow: shadows.card,
};

const priceCard = (highlight: boolean): React.CSSProperties => ({
  background: highlight ? colors.warmWhite : colors.cream,
  border: highlight ? `2px solid ${colors.goldRich}` : `1px solid ${colors.softLine}`,
  borderRadius: radii.lg, padding: 28, boxShadow: highlight ? shadows.raised : shadows.card,
  display: 'flex', flexDirection: 'column', gap: 12,
});

export function AboutPage() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = `${brandConfig.name}: Bookkeeping that doesn't sell you out`;
    return () => { document.title = prevTitle; };
  }, []);

  return (
    <div style={{ background: colors.cream, minHeight: '100vh', color: colors.darkSlate }}>
      {/* Top bar */}
      <header style={{
        background: colors.ledgerGreen, padding: '14px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Link to="/" style={{
          color: colors.warmWhite, textDecoration: 'none', fontWeight: 600, fontSize: 19,
          fontFamily: '"Bree Serif", "Merriweather", Georgia, serif',
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
          <span aria-hidden style={{ color: colors.goldSoft }}>📒</span>{brandConfig.name}
        </Link>
        <Link to="/login" style={{
          background: colors.goldRich, color: colors.darkSlate, padding: '8px 18px',
          borderRadius: radii.sm, textDecoration: 'none', fontWeight: 600, fontSize: 14,
        }}>
          Sign in
        </Link>
      </header>

      {/* Hero */}
      <section style={{ ...section, padding: '64px 24px 48px', display: 'grid', gap: 40, alignItems: 'center', gridTemplateColumns: 'minmax(0, 1fr)' }} className="kml-about-hero">
        <div>
          <h1 style={{
            margin: 0, fontSize: 44, lineHeight: 1.15, color: colors.ledgerGreen,
            fontFamily: '"Bree Serif", "Merriweather", Georgia, serif',
          }}>
            {ABOUT_CONTENT.heroTagline}
          </h1>
          <p style={{ marginTop: 16, fontSize: 18, color: colors.mutedGray, maxWidth: 540 }}>
            {ABOUT_CONTENT.heroParagraph}
          </p>
          {ABOUT_CONTENT.heroBetaNote && (
            <p style={{ marginTop: 12, fontSize: 14, color: colors.mutedGray, maxWidth: 540, lineHeight: 1.6 }}>
              <strong>BETA</strong> — {ABOUT_CONTENT.heroBetaNote}{' '}
              <a href={`mailto:${brandConfig.supportEmail}`} style={{ color: colors.ledgerGreen, fontWeight: 600 }}>
                {brandConfig.supportEmail}
              </a>.
            </p>
          )}
          <div style={{ marginTop: 28, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link to="/login" style={{
              background: colors.ledgerGreen, color: colors.warmWhite, padding: '12px 22px',
              borderRadius: radii.sm, textDecoration: 'none', fontWeight: 600, fontSize: 15,
            }}>
              Get started, free during beta
            </Link>
            <a href="#features" style={{
              border: `1px solid ${colors.surfaceLine}`, color: colors.ledgerGreen,
              padding: '12px 22px', borderRadius: radii.sm, textDecoration: 'none',
              fontWeight: 600, fontSize: 15, background: colors.warmWhite,
            }}>
              See features
            </a>
          </div>
        </div>
        <div style={{
          borderRadius: radii.lg, overflow: 'hidden', boxShadow: shadows.raised,
          background: colors.ledgerGreen, aspectRatio: '3 / 2',
        }}>
          <img src={brandConfig.heroImagePath} alt={brandConfig.name} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      </section>

      {/* Why not the other guys */}
      <section style={{ background: colors.warmWhite, borderTop: `1px solid ${colors.softLine}`, borderBottom: `1px solid ${colors.softLine}` }}>
        <div style={{ ...section, padding: '48px 24px' }}>
          <h2 style={{
            margin: 0, fontSize: 28, color: colors.ledgerGreen,
            fontFamily: '"Bree Serif", "Merriweather", Georgia, serif',
          }}>
            {ABOUT_CONTENT.comparisonTitle}
          </h2>
          <p style={{ marginTop: 8, marginBottom: 28, color: colors.mutedGray, maxWidth: 620 }}>
            {ABOUT_CONTENT.comparisonSubhead}
          </p>
          <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {ABOUT_CONTENT.painPoints.map((p) => (
              <div key={p.title} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div style={{
                  flexShrink: 0, width: 38, height: 38, borderRadius: '50%',
                  background: colors.cream, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, border: `1px solid ${colors.softLine}`,
                }} aria-hidden>{p.icon}</div>
                <div>
                  <div style={{ fontWeight: 600, color: colors.darkSlate, marginBottom: 4 }}>{p.title}</div>
                  <div style={{ color: colors.mutedGray, fontSize: 14, lineHeight: 1.55 }}>{p.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" style={{ ...section, padding: '48px 24px' }}>
        <h2 style={{
          margin: 0, fontSize: 28, color: colors.ledgerGreen,
          fontFamily: '"Bree Serif", "Merriweather", Georgia, serif',
        }}>
          What you get
        </h2>
        <div style={{
          marginTop: 24, display: 'grid', gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        }}>
          {ABOUT_CONTENT.features.map((f) => (
            <div key={f.title} style={featureCard}>
              <div style={{ fontSize: 24 }} aria-hidden>{f.icon}</div>
              <h3 style={{ margin: '8px 0 4px', fontSize: 17, color: colors.ledgerGreen }}>{f.title}</h3>
              <p style={{ margin: 0, color: colors.mutedGray, fontSize: 14, lineHeight: 1.5 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section style={{ ...section, padding: '48px 24px' }}>
        <h2 style={{
          margin: 0, fontSize: 28, color: colors.ledgerGreen,
          fontFamily: '"Bree Serif", "Merriweather", Georgia, serif',
        }}>
          Pricing
        </h2>
        <p style={{ marginTop: 8, color: colors.mutedGray }}>
          Simple plans. No per-transaction fees. Cancel anytime.
        </p>
        <div style={{
          marginTop: 24, display: 'grid', gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}>
          <div style={priceCard(true)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 600, color: colors.ledgerGreen, fontSize: 18 }}>Hosted</div>
              <span style={{
                background: colors.goldSoft, color: colors.goldAntique, padding: '2px 10px',
                borderRadius: 999, fontSize: 12, fontWeight: 700,
              }}>Beta</span>
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, color: colors.darkSlate }}>
              Free <span style={{ fontSize: 14, color: colors.mutedGray, fontWeight: 500 }}>during beta</span>
            </div>
            <div style={{ color: colors.mutedGray, fontSize: 14 }}>We run it; you sign in and import statements.</div>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: colors.darkSlate, fontSize: 14, lineHeight: 1.6 }}>
              <li>Google / GitHub sign-in</li>
              <li>AI categorization included</li>
              <li>Automatic backups</li>
            </ul>
          </div>
          <div style={priceCard(false)}>
            <div style={{ fontWeight: 600, color: colors.ledgerGreen, fontSize: 18 }}>Pro</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: colors.mutedGray }}>TBD</div>
            <div style={{ color: colors.mutedGray, fontSize: 14 }}>Coming after beta: multi-business, higher AI limits, priority support.</div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ ...section, padding: '48px 24px 64px' }}>
        <h2 style={{
          margin: 0, fontSize: 28, color: colors.ledgerGreen,
          fontFamily: '"Bree Serif", "Merriweather", Georgia, serif',
        }}>
          Common questions
        </h2>
        <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
          {ABOUT_CONTENT.faq.map((q) => (
            <details key={q.q} style={{
              background: colors.warmWhite, border: `1px solid ${colors.softLine}`,
              borderRadius: radii.md, padding: '14px 18px',
            }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: colors.ledgerGreen }}>{q.q}</summary>
              <p style={{ margin: '10px 0 0', color: colors.darkSlate, lineHeight: 1.55 }}>{q.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        borderTop: `1px solid ${colors.softLine}`, padding: '24px',
        textAlign: 'center', color: colors.mutedGray, fontSize: 13,
      }}>
        <Link to="/privacy" style={{ color: colors.mutedGray, textDecoration: 'none', marginRight: 16 }}>Privacy</Link>
        <Link to="/terms" style={{ color: colors.mutedGray, textDecoration: 'none', marginRight: 16 }}>Terms</Link>
        <Link to="/accessibility" style={{ color: colors.mutedGray, textDecoration: 'none', marginRight: 16 }}>Accessibility</Link>
        <Link to="/login" style={{ color: colors.mutedGray, textDecoration: 'none', marginRight: 16 }}>Sign in</Link>
        <a href={`mailto:${brandConfig.supportEmail}`} style={{ color: colors.mutedGray, textDecoration: 'none' }}>
          {brandConfig.supportEmail}
        </a>
      </footer>
    </div>
  );
}
