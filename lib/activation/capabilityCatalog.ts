/**
 * capabilityCatalog.ts — the canonical set of platform capabilities and the
 * EXISTING-authority signals each one needs (ONBOARD-007 §2).
 *
 * Static, deterministic metadata only. Each capability lists the prerequisite
 * "signals" it needs, expressed purely as existing authority references:
 *   - a journey stage id (e.g. 'company', 'company_review') → stage completed;
 *   - an integration catalog id (e.g. 'google_analytics', 'website_cms',
 *     'social_linkedin') → that integration connected;
 *   - a special signal ('publish_channel' = any website or social channel).
 *
 * It computes NO status and holds NO readiness — Platform Activation resolves
 * these signals at read time from the onboarding journey + integration
 * experience (see platformActivation.ts). Unlock copy is deterministic (no AI).
 */

/** A prerequisite signal resolved from existing authorities. */
export type CapabilitySignal = string;

export interface CapabilityDef {
  id: string;
  name: string;
  /** Deterministic "what this does" copy. */
  why: string;
  /** Signals that MUST be met or the capability is Requires Setup / Unavailable. */
  requiredSignals: CapabilitySignal[];
  /** Signals that improve the capability — missing → Limited (never blocking). */
  enhancingSignals: CapabilitySignal[];
  /** Deterministic "what becomes available once prerequisites are met". */
  unlocksCopy: string;
}

/** Special signal: any publishing channel (a website/CMS or any social account). */
export const SIGNAL_PUBLISH_CHANNEL = 'publish_channel';

/**
 * THE capability catalog. Ordered for display. Nearly everything needs the
 * company to exist first (the mandatory onboarding floor); integrations layer
 * additional capability on top.
 */
export const CAPABILITY_CATALOG: ReadonlyArray<CapabilityDef> = [
  {
    id: 'campaign_planning',
    name: 'Campaign Planning',
    why: 'Plan multi-channel campaigns across your content calendar.',
    requiredSignals: ['company'],
    enhancingSignals: [SIGNAL_PUBLISH_CHANNEL],
    unlocksCopy: 'Full multi-channel campaign planning tied to the channels you operate.',
  },
  {
    id: 'content_writer',
    name: 'Content Writer',
    why: 'Draft on-brand posts, emails, and pages.',
    requiredSignals: ['company'],
    // Profile review sharpens output but never gates it — surfaced as an
    // optional improvement, not a capability limiter.
    enhancingSignals: [],
    unlocksCopy: 'AI drafting across formats, grounded in your company profile.',
  },
  {
    id: 'content_creator',
    name: 'Content Creator',
    why: 'Generate on-brand visual assets and creatives.',
    requiredSignals: ['company'],
    enhancingSignals: [],
    unlocksCopy: 'Branded creative generation using your confirmed profile and assets.',
  },
  {
    id: 'publishing',
    name: 'Publishing',
    why: 'Publish and schedule content to your channels.',
    requiredSignals: ['company', SIGNAL_PUBLISH_CHANNEL],
    enhancingSignals: [],
    unlocksCopy: 'One-click publishing and scheduling to every connected channel.',
  },
  {
    id: 'analytics',
    name: 'Analytics',
    why: 'See real traffic and content performance.',
    requiredSignals: ['company', 'google_analytics'],
    enhancingSignals: [],
    unlocksCopy: 'Traffic, sources, and per-content performance from GA4.',
  },
  {
    id: 'seo',
    name: 'SEO',
    why: 'Optimize for the search queries you already rank for.',
    requiredSignals: ['company', 'google_search_console'],
    enhancingSignals: ['website_cms'],
    unlocksCopy: 'Search-query insight and on-site SEO signals for content planning.',
  },
  {
    id: 'competitor_intelligence',
    name: 'Competitor Intelligence',
    why: 'Track competitors and benchmark your positioning.',
    requiredSignals: ['company'],
    // Uses the website snapshot captured at onboarding — operational after
    // company; the CMS publish integration doesn't gate it.
    enhancingSignals: [],
    unlocksCopy: 'Competitive tracking grounded in your website and profile.',
  },
  {
    id: 'growth_intelligence',
    name: 'Growth Intelligence',
    why: 'Surface growth opportunities from your data.',
    requiredSignals: ['company'],
    enhancingSignals: ['google_analytics'],
    unlocksCopy: 'Growth signals that sharpen once analytics is connected.',
  },
  {
    id: 'recommendation_engine',
    name: 'Recommendation Engine',
    why: 'Get next-best content and campaign recommendations.',
    requiredSignals: ['company'],
    enhancingSignals: [SIGNAL_PUBLISH_CHANNEL, 'google_analytics'],
    unlocksCopy: 'Recommendations that improve as more channels and data connect.',
  },
];

export const CAPABILITY_BY_ID = new Map(CAPABILITY_CATALOG.map((c) => [c.id, c]));
