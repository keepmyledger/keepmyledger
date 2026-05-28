export interface BrandConfig {
  name: string;
  supportEmail: string;
  privacyEmail: string;
  legalEmail: string;
  parentEntity: string;
  canonicalUrl: string;
  heroImagePath: string;
  ogImage: string;
  twitterHandle: string | null;
  appDescription: string;
}

const config: BrandConfig = {
  name: 'Your App',
  supportEmail: 'support@example.com',
  privacyEmail: 'privacy@example.com',
  legalEmail: 'legal@example.com',
  parentEntity: 'Your Organization',
  canonicalUrl: 'https://example.com',
  heroImagePath: '/hero.png',
  ogImage: 'https://example.com/og-image.png',
  twitterHandle: null,
  appDescription:
    'Privacy-first bookkeeping. Import bank statements, auto-categorize with smart rules and AI, and get tax-ready reports without handing your data to anyone.',
};

export default config;
