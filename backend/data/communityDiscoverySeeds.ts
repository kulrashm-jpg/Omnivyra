/**
 * Phase 4 — Curated discovery seed dataset.
 *
 * This is the ONLY source of community recommendations in Phase 4. The
 * discovery engine intersects org-profile signals (industry, keywords)
 * against these seeds and returns a ranked, explained list. There is NO
 * pathway in Phase 4 that invents a subreddit, queries an external search
 * API, or "explores" Reddit for new communities. All recommendations come
 * from this file.
 *
 * Each entry includes:
 *   • signal_quality:  prior on how often this community surfaces useful
 *                      buyer-intent / decision-maker signal (0–1).
 *   • intent_density:  prior on how often posts express explicit intent (0–1).
 *   • noise:           prior on spam / off-topic / shitposting (0–1; higher = more noise).
 *   • verticals[]:     vertical tags used for matching.
 *   • keywords[]:      anchor terms used by the discovery service for
 *                      keyword-density matching against the org profile.
 *   • decision_maker:  prior on whether decision-makers / buyers (vs. end
 *                      users / hobbyists) frequent the community (0–1).
 *
 * Numbers are conservative. Phase 4 does NOT self-tune them; that's a
 * later phase backed by historical signal conversion data.
 */

export type SubredditSeed = {
  source_identifier: string;
  display_name: string;
  verticals: string[];
  keywords: string[];
  signal_quality: number;
  intent_density: number;
  noise: number;
  decision_maker: number;
  rationale: string;
};

export const SUBREDDIT_SEEDS: SubredditSeed[] = [
  // ---------- Generic founder / SMB ----------
  {
    source_identifier: 'SaaS',
    display_name: 'r/SaaS',
    verticals: ['saas', 'b2b', 'software'],
    keywords: ['saas', 'mrr', 'churn', 'pricing', 'onboarding', 'integrations'],
    signal_quality: 0.72,
    intent_density: 0.55,
    noise: 0.25,
    decision_maker: 0.65,
    rationale: 'SaaS founders and operators routinely surface tool-replacement, pricing-pressure, and integration-need posts here.',
  },
  {
    source_identifier: 'Entrepreneur',
    display_name: 'r/Entrepreneur',
    verticals: ['saas', 'b2b', 'smb', 'ecommerce'],
    keywords: ['business', 'startup', 'looking for', 'tools', 'software'],
    signal_quality: 0.55,
    intent_density: 0.45,
    noise: 0.45,
    decision_maker: 0.55,
    rationale: 'Broad founder community — high volume, moderate signal-to-noise. Best for early-stage buyer intent.',
  },
  {
    source_identifier: 'startups',
    display_name: 'r/startups',
    verticals: ['saas', 'b2b', 'venture'],
    keywords: ['startup', 'fundraising', 'product-market fit', 'stack'],
    signal_quality: 0.6,
    intent_density: 0.4,
    noise: 0.35,
    decision_maker: 0.6,
    rationale: 'Founders discussing stack choices and growth — frequent migration and integration signals.',
  },
  {
    source_identifier: 'smallbusiness',
    display_name: 'r/smallbusiness',
    verticals: ['smb', 'ecommerce', 'b2b'],
    keywords: ['software', 'tool', 'help me find', 'recommend'],
    signal_quality: 0.6,
    intent_density: 0.6,
    noise: 0.35,
    decision_maker: 0.7,
    rationale: 'Owner-operators with explicit buyer intent. Frequent "recommend a [tool]" posts.',
  },

  // ---------- Marketing / Sales ----------
  {
    source_identifier: 'marketing',
    display_name: 'r/marketing',
    verticals: ['marketing', 'martech', 'b2b'],
    keywords: ['marketing', 'campaign', 'attribution', 'crm'],
    signal_quality: 0.55,
    intent_density: 0.4,
    noise: 0.45,
    decision_maker: 0.5,
    rationale: 'Marketing practitioners discuss tooling choices and pain points — moderate intent density.',
  },
  {
    source_identifier: 'PPC',
    display_name: 'r/PPC',
    verticals: ['marketing', 'paid_ads'],
    keywords: ['ads', 'google ads', 'meta', 'ppc', 'bid'],
    signal_quality: 0.6,
    intent_density: 0.5,
    noise: 0.35,
    decision_maker: 0.6,
    rationale: 'Paid-ads practitioners regularly post about platform shortcomings and switching tools.',
  },
  {
    source_identifier: 'SEO',
    display_name: 'r/SEO',
    verticals: ['marketing', 'seo', 'content'],
    keywords: ['seo', 'ranking', 'backlink', 'ahrefs', 'semrush'],
    signal_quality: 0.55,
    intent_density: 0.45,
    noise: 0.4,
    decision_maker: 0.55,
    rationale: 'SEO practitioners actively compare tools and surface migration intent.',
  },
  {
    source_identifier: 'sales',
    display_name: 'r/sales',
    verticals: ['sales', 'b2b'],
    keywords: ['sales', 'crm', 'pipeline', 'prospect', 'outreach'],
    signal_quality: 0.55,
    intent_density: 0.55,
    noise: 0.4,
    decision_maker: 0.6,
    rationale: 'Salespeople discuss CRM and prospecting tooling; intent density elevated.',
  },

  // ---------- Devtools / engineering ----------
  {
    source_identifier: 'programming',
    display_name: 'r/programming',
    verticals: ['devtools', 'engineering'],
    keywords: ['library', 'framework', 'language', 'open source'],
    signal_quality: 0.45,
    intent_density: 0.3,
    noise: 0.5,
    decision_maker: 0.4,
    rationale: 'Large, generalist developer community. Useful for migration signals around frameworks and libraries.',
  },
  {
    source_identifier: 'webdev',
    display_name: 'r/webdev',
    verticals: ['devtools', 'frontend', 'backend'],
    keywords: ['stack', 'framework', 'hosting', 'database'],
    signal_quality: 0.5,
    intent_density: 0.35,
    noise: 0.45,
    decision_maker: 0.45,
    rationale: 'Working web developers — frequent integration and tooling questions.',
  },
  {
    source_identifier: 'devops',
    display_name: 'r/devops',
    verticals: ['devtools', 'infra'],
    keywords: ['infrastructure', 'kubernetes', 'observability', 'ci/cd'],
    signal_quality: 0.55,
    intent_density: 0.45,
    noise: 0.4,
    decision_maker: 0.55,
    rationale: 'Infra practitioners frequently surface migration and observability buying intent.',
  },

  // ---------- AI / ML ----------
  {
    source_identifier: 'MachineLearning',
    display_name: 'r/MachineLearning',
    verticals: ['ai', 'ml'],
    keywords: ['model', 'training', 'inference', 'gpu', 'transformer'],
    signal_quality: 0.4,
    intent_density: 0.25,
    noise: 0.5,
    decision_maker: 0.4,
    rationale: 'Researcher-heavy; buyer intent is sparser but high quality when present.',
  },
  {
    source_identifier: 'LocalLLaMA',
    display_name: 'r/LocalLLaMA',
    verticals: ['ai', 'llm'],
    keywords: ['llm', 'local', 'inference', 'quantisation', 'finetune'],
    signal_quality: 0.5,
    intent_density: 0.4,
    noise: 0.4,
    decision_maker: 0.45,
    rationale: 'Practitioners running local LLM stacks — frequent integration and tool-comparison posts.',
  },

  // ---------- Finance / fintech ----------
  {
    source_identifier: 'fintech',
    display_name: 'r/fintech',
    verticals: ['fintech', 'finance'],
    keywords: ['payments', 'kyc', 'banking', 'crypto', 'rails'],
    signal_quality: 0.55,
    intent_density: 0.45,
    noise: 0.35,
    decision_maker: 0.6,
    rationale: 'Fintech operators discuss compliance and payment-rail tooling — buyer-intent friendly.',
  },

  // ---------- Customer success / support ----------
  {
    source_identifier: 'CustomerSuccess',
    display_name: 'r/CustomerSuccess',
    verticals: ['customer_success', 'saas'],
    keywords: ['cs', 'onboarding', 'retention', 'health score'],
    signal_quality: 0.55,
    intent_density: 0.4,
    noise: 0.35,
    decision_maker: 0.55,
    rationale: 'CS practitioners share tool stacks and frustrations — moderate buyer intent.',
  },

  // ---------- Recruiting / hiring ----------
  {
    source_identifier: 'recruiting',
    display_name: 'r/recruiting',
    verticals: ['hr', 'recruiting'],
    keywords: ['hiring', 'ats', 'sourcing', 'recruiter'],
    signal_quality: 0.5,
    intent_density: 0.4,
    noise: 0.4,
    decision_maker: 0.55,
    rationale: 'Recruiter community — useful for ATS / sourcing-tool buying intent and hiring-signal detection.',
  },
];

// Keyword-stream seeds: free-form topic streams the user can subscribe to.
// These don't map 1:1 to a platform — they're cross-platform topic monitors
// that a future connector phase will fan out across multiple sources.
// Phase 4 only generates these as RECOMMENDATIONS; activation creates a
// listening_source with source_type='keyword_stream' that no connector
// currently consumes (intentional — Phase 5+ work).
export type KeywordStreamSeed = {
  source_identifier: string;
  display_name: string;
  verticals: string[];
  keywords: string[];
  rationale: string;
};

export const KEYWORD_STREAM_SEEDS: KeywordStreamSeed[] = [
  {
    source_identifier: 'tool_migrations',
    display_name: 'Tool migration mentions',
    verticals: ['saas', 'devtools', 'martech'],
    keywords: ['migrating from', 'switched from', 'moving off', 'replacing'],
    rationale: 'Cross-platform migration intent — users actively in the process of swapping vendors.',
  },
  {
    source_identifier: 'recommendation_requests',
    display_name: 'Recommendation requests',
    verticals: ['saas', 'smb', 'devtools'],
    keywords: ['recommend a', 'best tool for', 'looking for a', 'alternatives to'],
    rationale: 'Explicit buyer-intent requests across the web.',
  },
  {
    source_identifier: 'integration_needs',
    display_name: 'Integration needs',
    verticals: ['saas', 'devtools'],
    keywords: ['integrate with', 'connect to', 'api for', 'webhook for'],
    rationale: 'Integration-need signals — frequently lead to vendor selection.',
  },
];

export type CompetitorDomainSeed = {
  source_identifier: string;
  display_name: string;
  rationale: string;
};

// Competitor-domain seeds are CONFIGURATION-DRIVEN. There is no curated
// list; the discovery service derives candidates from the org's
// `companies.competitors` field if present, otherwise returns none. This
// keeps recommendations tied to user-supplied data rather than guessed.
export function deriveCompetitorDomainSeeds(competitors: string[]): CompetitorDomainSeed[] {
  return competitors
    .filter((c) => typeof c === 'string' && c.trim().length > 0)
    .slice(0, 10)
    .map((c) => ({
      source_identifier: c.trim().toLowerCase(),
      display_name: c.trim(),
      rationale: `Listed as a competitor on the company profile — monitoring competitor mentions surfaces dissatisfaction and migration intent.`,
    }));
}
