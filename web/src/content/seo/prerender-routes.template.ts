export interface PrerenderRoute {
  path: string;
  title: string;
  description: string;
}

export const PRERENDER_ROUTES: PrerenderRoute[] = [
  {
    path: '/about',
    title: 'Your App: Privacy-first bookkeeping',
    description:
      'Privacy-first bookkeeping. Import bank statements, auto-categorize transactions, export tax-ready reports. No bank credentials, no data resale.',
  },
  {
    path: '/privacy',
    title: 'Privacy Policy · Your App',
    description: 'How Your App handles your personal and financial data: what we collect, what we never do, and how to request export or deletion.',
  },
  {
    path: '/terms',
    title: 'Terms of Service · Your App',
    description: 'Terms governing your use of Your App.',
  },
  {
    path: '/accessibility',
    title: 'Accessibility · Your App',
    description: 'Your App accessibility statement: our WCAG 2.1 AA target, what works today, known gaps, and how to report an issue.',
  },
];
