export interface Feature {
  icon: string;
  title: string;
  body: string;
}

export interface PainPoint {
  icon: string;
  title: string;
  body: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface AboutContent {
  heroTagline: string;
  heroParagraph: string;
  heroBetaNote: string | null;
  comparisonTitle: string;
  comparisonSubhead: string;
  features: Feature[];
  painPoints: PainPoint[];
  faq: FaqItem[];
}

export const ABOUT_CONTENT: AboutContent = {
  heroTagline: "Bookkeeping that doesn't sell you out.",
  heroParagraph:
    'Import your own bank statements, let smart rules and AI categorize the boring stuff, and get a clean tax-ready ledger — without handing your financial life to a company that profits from your data. No bank logins stored. No data resale. No surprises.',
  heroBetaNote: null,
  comparisonTitle: 'Why not Quicken, QuickBooks, or Mint?',
  comparisonSubhead: "Those tools get the job done, until they don't. Here's what we set out to fix:",
  features: [
    {
      icon: '📥',
      title: 'Statement imports',
      body: 'Drop in PDF or CSV statements. Transactions are extracted automatically. No bank login required.',
    },
    {
      icon: '🎯',
      title: 'Smart categorization',
      body: 'Build rules once and let them tag future transactions. AI fills the gaps for one-off purchases.',
    },
    {
      icon: '🔁',
      title: 'Duplicate-safe',
      body: 'Re-import the same statement without fear. Duplicates are detected and skipped every time.',
    },
    {
      icon: '📊',
      title: 'Tax-ready reports',
      body: 'Per-category totals, monthly cashflow, and a CSV export tuned for your accountant.',
    },
    {
      icon: '🧾',
      title: 'Receipt attachments',
      body: 'Attach receipt images or PDFs, optionally synced to Google Drive, right alongside each transaction.',
    },
    {
      icon: '🔒',
      title: 'Private by design',
      body: 'Your data is never sold or shared with advertisers. Export to CSV anytime. No vendor lock-in.',
    },
  ],
  painPoints: [
    {
      icon: '🏦',
      title: 'No stored bank credentials',
      body: 'Mint, Quicken, and most competitors ask you to hand over your banking username and password. We never do. You export a statement file from your bank and import it here.',
    },
    {
      icon: '📢',
      title: 'Your data is not our product',
      body: 'We have one revenue source: your subscription. Your transaction data is never shared with advertisers, data brokers, or marketing partners.',
    },
    {
      icon: '💸',
      title: 'No surprise price hikes',
      body: 'Our pricing is simple and published upfront.',
    },
    {
      icon: '🔌',
      title: 'No forced integrations',
      body: 'We do one thing well: clean books for solo operators and small teams who just need accurate records.',
    },
    {
      icon: '🤖',
      title: 'AI that you opt into',
      body: 'AI categorization only runs when you click "AI Assist" on a specific transaction. Bulk categorization is rule-based and deterministic.',
    },
    {
      icon: '📤',
      title: 'Always exportable',
      body: 'CSV export is a first-class feature. If you ever want to leave, your data comes with you.',
    },
  ],
  faq: [
    {
      q: 'Do you store my bank login credentials?',
      a: "Never. The app works from statement files you export yourself from your bank's website. No connection to your bank, no stored credentials.",
    },
    {
      q: 'Is my financial data sold or shared with third parties?',
      a: 'No. We have one revenue stream: your subscription. Your transaction data is used exclusively to provide the service to you. See our Privacy Policy for the full picture.',
    },
    {
      q: 'Which banks are supported?',
      a: 'PDF statements from major banks are parsed automatically. Others fall back to AI-assisted extraction (with your opt-in consent). CSV import is also supported.',
    },
    {
      q: 'Does AI see all my transactions?',
      a: 'Only when you explicitly click "AI Assist" on a specific transaction. Bulk categorization is rule-based and fully local.',
    },
    {
      q: 'How is this different from QuickBooks or Quicken?',
      a: 'Deliberately simpler: import statements, categorize transactions, get tax-ready reports. No bank-link required, no upsell ecosystem, no data-resale business model.',
    },
    {
      q: 'Can I export my data?',
      a: 'Yes. CSV export is built in for transactions and tax reports. No lock-in, no conversion fee.',
    },
    {
      q: 'Is there a mobile app?',
      a: 'The web app is a PWA; add it to your home screen on iOS or Android for a native-feeling experience.',
    },
  ],
};
