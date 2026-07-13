/**
 * integrationCatalog.ts — the ONE canonical Integration model (ONBOARD-006 §1/§2/§6).
 *
 * Static, deterministic provider metadata: the single catalog of integrations
 * the platform exposes, grouped into the canonical categories. It carries ONLY
 * metadata (name, category, why-it-matters, learn-more, estimated setup time,
 * required/optional, and how each entry links to the canonical status +
 * dependency authority). It computes NO status and holds NO connection state —
 * status and dependencies are resolved at read time from the onboarding journey
 * authority (see integrationExperience.ts).
 *
 * Provider identifiers mirror the existing authorities (cms/registry provider
 * types, analytics GA4/GSC, the social platform keys the journey emits) so the
 * catalog reuses — never fabricates — providers. Connect/learn-more links point
 * at the EXISTING setup surfaces (no new OAuth, no new endpoint).
 */

/** The onboarding journey integration stage ids this catalog links to. */
export type JourneyStageId =
  | 'social_accounts' | 'website_cms' | 'google_analytics' | 'google_search_console';

/** §2 — the canonical integration categories (the single taxonomy). */
export type IntegrationCategory =
  | 'Website'
  | 'CMS'
  | 'Analytics'
  | 'Search'
  | 'Social'
  | 'Advertising'
  | 'CRM'
  | 'Communication'
  | 'Other';

/** Deterministic category display order. */
export const CATEGORY_ORDER: ReadonlyArray<IntegrationCategory> = [
  'CMS', 'Analytics', 'Search', 'Social', 'Advertising', 'CRM', 'Communication', 'Website', 'Other',
];

export interface IntegrationDef {
  id: string;
  name: string;
  category: IntegrationCategory;
  /** Canonical provider identifier (mirrors existing authorities). */
  provider: string;
  /** Required integrations gate more of the platform; all onboarding integrations are optional. */
  required: boolean;
  /** Deterministic "why it matters" copy (no AI). */
  why: string;
  /** Existing setup surface — connect/reconnect route here (no new OAuth). */
  connectHref: string;
  /** Where to read more (an existing surface / hub). */
  learnMoreHref: string;
  /** Rough setup estimate in minutes. */
  estimatedMinutes: number;
  /**
   * Links this catalog entry to the canonical status + dependency authority.
   * `journeyStage` → the whole stage status/dependencies come from that stage.
   * `socialPlatform` → per-platform status comes from the social stage's
   * `providers[]`. Entries with neither are catalog-only ("Available").
   */
  journeyStage?: JourneyStageId;
  socialPlatform?: string;
  /** §6 — supported providers shown as metadata (mirrors cms/registry etc.). */
  supportedProviders?: string[];
  /** Catalog-only entries with no live authority signal (status is "Available"). */
  catalogOnly?: boolean;
}

const INTEGRATIONS_HUB = '/integrations';

/**
 * THE catalog. Every integration the Integration Experience can show. Ordered
 * within its category; the experience groups by CATEGORY_ORDER.
 */
export const INTEGRATION_CATALOG: ReadonlyArray<IntegrationDef> = [
  // ── Website / CMS ─────────────────────────────────────────────────────────
  {
    id: 'website_cms',
    name: 'Website / CMS',
    category: 'CMS',
    provider: 'website_cms',
    required: false,
    why: 'Lets Omnivyra publish blogs to your site and track visitor engagement.',
    connectHref: '/website-setup',
    learnMoreHref: '/website-setup',
    estimatedMinutes: 5,
    journeyStage: 'website_cms',
    // Mirrors backend/services/cms/registry provider types.
    supportedProviders: ['WordPress', 'Shopify', 'Ghost', 'Drupal', 'Joomla', 'Webflow', 'Wix', 'Squarespace', 'Custom'],
  },

  // ── Analytics ─────────────────────────────────────────────────────────────
  {
    id: 'google_analytics',
    name: 'Google Analytics (GA4)',
    category: 'Analytics',
    provider: 'GA4',
    required: false,
    why: 'Ties content performance to real traffic so reports show actual outcomes.',
    connectHref: '/integrations?focus=data',
    learnMoreHref: INTEGRATIONS_HUB,
    estimatedMinutes: 3,
    journeyStage: 'google_analytics',
  },

  // ── Search ────────────────────────────────────────────────────────────────
  {
    id: 'google_search_console',
    name: 'Google Search Console',
    category: 'Search',
    provider: 'GSC',
    required: false,
    why: 'Surfaces the search queries you already rank for — fuel for content planning.',
    connectHref: '/integrations?focus=data',
    learnMoreHref: INTEGRATIONS_HUB,
    estimatedMinutes: 3,
    journeyStage: 'google_search_console',
  },

  // ── Social (per-platform status from the social stage's providers[]) ───────
  socialDef('linkedin', 'LinkedIn'),
  socialDef('facebook', 'Facebook'),
  socialDef('instagram', 'Instagram'),
  socialDef('x', 'X'),
  socialDef('youtube', 'YouTube'),
  socialDef('tiktok', 'TikTok'),
  socialDef('pinterest', 'Pinterest'),
  socialDef('reddit', 'Reddit'),

  // ── Advertising / CRM / Communication (catalog-only → "Available") ─────────
  {
    id: 'google_ads', name: 'Google Ads', category: 'Advertising', provider: 'google_ads',
    required: false, why: 'Connect ad performance to your content and campaigns.',
    connectHref: INTEGRATIONS_HUB, learnMoreHref: INTEGRATIONS_HUB, estimatedMinutes: 5, catalogOnly: true,
  },
  {
    id: 'meta_ads', name: 'Meta Ads', category: 'Advertising', provider: 'meta_ads',
    required: false, why: 'Bring Facebook & Instagram ad results alongside organic content.',
    connectHref: INTEGRATIONS_HUB, learnMoreHref: INTEGRATIONS_HUB, estimatedMinutes: 5, catalogOnly: true,
  },
  {
    id: 'hubspot', name: 'HubSpot', category: 'CRM', provider: 'hubspot',
    required: false, why: 'Sync leads and contacts so content maps to pipeline.',
    connectHref: INTEGRATIONS_HUB, learnMoreHref: INTEGRATIONS_HUB, estimatedMinutes: 5, catalogOnly: true,
  },
  {
    id: 'mailchimp', name: 'Mailchimp', category: 'Communication', provider: 'mailchimp',
    required: false, why: 'Turn content into newsletters and track email engagement.',
    connectHref: INTEGRATIONS_HUB, learnMoreHref: INTEGRATIONS_HUB, estimatedMinutes: 5, catalogOnly: true,
  },
];

function socialDef(platform: string, name: string): IntegrationDef {
  return {
    id: `social_${platform}`,
    name,
    category: 'Social',
    provider: platform,
    required: false,
    why: 'Publishing, campaigns, and engagement monitoring need at least one connected channel.',
    connectHref: '/social-platforms',
    learnMoreHref: '/social-platforms',
    estimatedMinutes: 2,
    journeyStage: 'social_accounts',
    socialPlatform: platform,
  };
}

/** Lookup by catalog id. */
export const INTEGRATION_BY_ID = new Map(INTEGRATION_CATALOG.map((d) => [d.id, d]));
