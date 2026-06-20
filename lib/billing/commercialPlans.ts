/**
 * Commercial model — SINGLE SOURCE OF TRUTH, priced in CANONICAL USD.
 *
 * Display in USD / INR / EUR is derived from these USD prices via the FX model
 * in `lib/billing/currency.ts` (with optional Super-Admin market overrides).
 * The pricing page toggles the display currency; the canonical numbers never
 * change. Presentation/config only — charges nothing, selects no gateway.
 */
import { formatPrice, type Currency, CURRENCIES } from './currency';

export type { Currency };
export { CURRENCIES, formatPrice };

export const FOUNDING_MEMBER = {
  expiryIso: '2028-03-31',
  expiryLabel: 'March 2028',
  badgeLabel: 'Founding Member',
  heading: 'Founding Member Pricing',
  explanation:
    'This pre-launch pricing expires March 2028. Customers who subscribe before the expiration date keep their Founding Member pricing through the program period.',
} as const;

export type PlanId = 'free' | 'starter' | 'growth' | 'business';

export interface CommercialPlan {
  id: PlanId;
  name: string;
  audience: string;
  /** Canonical Founding Member price in USD. 0 for Free. */
  priceFounderUsd: number;
  /** Canonical regular (post-Founding) price in USD; null for Free. */
  priceRegularUsd: number | null;
  cadenceLabel: string;
  credits: number;
  creditsLabel: string;
  usersLabel: string;
  foundingMember: boolean;
  oneTime?: boolean;
  popular?: boolean;
  note: string;
  cta: string;
  href: string;
}

export const PLANS: CommercialPlan[] = [
  {
    id: 'free',
    name: 'Free',
    audience: 'Try the full platform',
    priceFounderUsd: 0,
    priceRegularUsd: null,
    cadenceLabel: 'one-time allocation',
    credits: 300,
    creditsLabel: '300 credits',
    usersLabel: '1 company',
    foundingMember: false,
    oneTime: true,
    note: 'One-time company allocation. Website required. One company can claim once.',
    cta: 'Get Free Credits',
    href: '/get-free-credits',
  },
  {
    id: 'starter',
    name: 'Starter',
    audience: 'For creators and solo operators',
    priceFounderUsd: 39,
    priceRegularUsd: 100,
    cadenceLabel: 'per month',
    credits: 300,
    creditsLabel: '300 credits / month',
    usersLabel: '2 users',
    foundingMember: true,
    note: 'Early operating rhythm for first reports, content, and campaigns.',
    cta: 'Get Started',
    href: '/create-account?plan=starter',
  },
  {
    id: 'growth',
    name: 'Growth',
    audience: 'For startups and growth teams',
    priceFounderUsd: 79,
    priceRegularUsd: 200,
    cadenceLabel: 'per month',
    credits: 700,
    creditsLabel: '700 credits / month',
    usersLabel: '5 users',
    foundingMember: true,
    popular: true,
    note: 'Consistent operating volume for active marketing execution.',
    cta: 'Get Started',
    href: '/create-account?plan=growth',
  },
  {
    id: 'business',
    name: 'Business',
    audience: 'For SMB marketing operations',
    priceFounderUsd: 159,
    priceRegularUsd: 400,
    cadenceLabel: 'per month',
    credits: 1400,
    creditsLabel: '1,400 credits / month',
    usersLabel: '10 users',
    foundingMember: true,
    note: 'High-volume capacity for coordinated campaigns and recurring intelligence.',
    cta: 'Get Started',
    href: '/create-account?plan=business',
  },
];

/**
 * Top-up packs (canonical SKUs 250 / 500 / 1000), priced in canonical USD.
 * `id` mirrors `credit_packages.id` (seed) + `topupCatalog.ts`. Display in other
 * currencies derives via FX; the checkout charge currency is selected internally.
 */
export interface TopupOption {
  id: string;
  /** Stable SKU — mirrors credit_packages.sku and market-override keys. */
  sku: string;
  credits: number;
  priceUsd: number;
  label: string;
}

export const TOPUPS: TopupOption[] = [
  { id: '0a0a0a25-0000-4000-8000-000000000250', sku: 'topup_250', credits: 250, priceUsd: 30, label: '250 credits' },
  { id: '0a0a0500-0000-4000-8000-000000000500', sku: 'topup_500', credits: 500, priceUsd: 55, label: '500 credits' },
  { id: '0a0a1000-0000-4000-8000-000000001000', sku: 'topup_1000', credits: 1000, priceUsd: 100, label: '1,000 credits' },
];

/** Unified capability comparison — SINGLE SOURCE OF TRUTH. Cards must NOT repeat. */
export interface FeatureRow {
  label: string;
  values: Record<PlanId, string | boolean>;
}

export const FEATURE_MATRIX: FeatureRow[] = [
  { label: 'Monthly credits', values: { free: '300 (one-time)', starter: '300', growth: '700', business: '1,400' } },
  { label: 'Users / seats', values: { free: '1', starter: '2', growth: '5', business: '10' } },
  { label: 'Top-up credits (never expire)', values: { free: true, starter: true, growth: true, business: true } },
  { label: 'Content — blog, article, post, thread', values: { free: true, starter: true, growth: true, business: true } },
  { label: 'Creator assets — image, carousel, infographic', values: { free: true, starter: true, growth: true, business: true } },
  { label: 'Campaigns — BOLT & Intelligent Mix', values: { free: true, starter: true, growth: true, business: true } },
  { label: 'Market Pulse & Digital Presence reports', values: { free: true, starter: true, growth: true, business: true } },
  { label: 'Active Leads discovery', values: { free: true, starter: true, growth: true, business: true } },
  { label: 'Engagement center', values: { free: true, starter: true, growth: true, business: true } },
  { label: 'Founding Member pricing', values: { free: false, starter: true, growth: true, business: true } },
  { label: 'Support', values: { free: 'Community', starter: 'Email', growth: 'Priority', business: 'Dedicated CSM' } },
];

export interface FaqItem { q: string; a: string }

export const FAQS: FaqItem[] = [
  { q: 'What is a credit?', a: 'Credits are how you use the platform — each blog, campaign, report, creator asset, or lead-discovery run consumes credits. All plans unlock the full platform; plans differ by monthly credit volume and seats, not by which features you can access.' },
  { q: 'What is Founding Member pricing?', a: `${FOUNDING_MEMBER.explanation}` },
  { q: 'Do top-up credits expire?', a: 'No. Top-up credits never expire and are consumed only after your monthly plan credits are used.' },
  { q: 'Which currency am I charged in?', a: 'Prices are shown in USD, INR, or EUR. You are charged in the currency you select; the payment provider is chosen automatically based on that currency.' },
  { q: 'Can I change plans later?', a: 'Yes — upgrade or downgrade at any time. Founding Member pricing is preserved through the program period for members who subscribe before it expires.' },
  { q: 'Is the Free plan really one-time?', a: 'Yes — 300 credits are a one-time allocation per verified company (website required), so you can try the full platform before subscribing.' },
];

export function getPlan(id: PlanId): CommercialPlan | undefined {
  return PLANS.find((p) => p.id === id);
}
