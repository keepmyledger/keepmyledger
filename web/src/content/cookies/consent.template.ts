export interface ConsentContent {
  bannerTitle: string;
  bannerDescription: string;
  analyticsLabel: string;
  analyticsDescription: string;
  adsLabel: string;
  adsDescription: string;
}

export const CONSENT_CONTENT: ConsentContent = {
  bannerTitle: 'We use cookies',
  bannerDescription:
    "Strictly necessary cookies keep you signed in and let payments work; those are always on. With your permission we'd also like to load analytics to understand which pages people use. You can change or revoke this anytime in Settings.",
  analyticsLabel: 'Analytics',
  analyticsDescription: 'Analytics cookies — page views, feature usage, source attribution.',
  adsLabel: 'Advertising',
  adsDescription: 'Not currently used. Reserved for future re-targeting / conversion tracking.',
};
