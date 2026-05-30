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
 *
 * PR-CAR-5: every seed now also carries persona_tags (primary audience)
 * and opportunity_priors (6 dimension baselines). These drive the
 * "Why this matches your company" persona-overlap bullet and refine the
 * per-source opportunity scoring without changing the scoring formula,
 * thresholds, or ranking architecture.
 */

/**
 * Opportunity-discovery priors per seed. Consumed by
 * sourceRecommendationEngine to score how likely each opportunity
 * type is to surface in this source.
 */
export type OpportunityPriorsBySeed = Partial<{
  buying_intent: number;
  competitor_dissatisfaction: number;
  migration_signal: number;
  hiring_signal: number;
  growth_signal: number;
  integration_need: number;
}>;

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
  /** PR-CAR-5: primary audience personas (decision-makers / buyers / influencers). */
  persona_tags?: string[];
  /** PR-CAR-5: explicit per-type priors; overrides the derivation from signal_quality/intent_density/decision_maker/noise. */
  opportunity_priors?: OpportunityPriorsBySeed;
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
    persona_tags: ['founders', 'product managers', 'marketing leaders'],
    opportunity_priors: {
      buying_intent: 0.65,
      competitor_dissatisfaction: 0.55,
      migration_signal: 0.55,
      hiring_signal: 0.30,
      growth_signal: 0.40,
      integration_need: 0.55,
    },
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
    persona_tags: ['founders', 'solopreneurs', 'early operators'],
    opportunity_priors: {
      buying_intent: 0.50,
      competitor_dissatisfaction: 0.40,
      migration_signal: 0.45,
      hiring_signal: 0.25,
      growth_signal: 0.45,
      integration_need: 0.40,
    },
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
    persona_tags: ['founders', 'co-founders', 'early operators'],
    opportunity_priors: {
      buying_intent: 0.45,
      competitor_dissatisfaction: 0.40,
      migration_signal: 0.50,
      hiring_signal: 0.55,
      growth_signal: 0.65,
      integration_need: 0.45,
    },
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
    persona_tags: ['small business owners', 'owner-operators'],
    opportunity_priors: {
      buying_intent: 0.70,
      competitor_dissatisfaction: 0.40,
      migration_signal: 0.50,
      hiring_signal: 0.30,
      growth_signal: 0.35,
      integration_need: 0.40,
    },
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
    persona_tags: ['marketing leaders', 'marketing managers', 'demand gen'],
    opportunity_priors: {
      buying_intent: 0.50,
      competitor_dissatisfaction: 0.45,
      migration_signal: 0.50,
      hiring_signal: 0.25,
      growth_signal: 0.30,
      integration_need: 0.40,
    },
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
    persona_tags: ['paid ads specialists', 'performance marketers', 'marketing leaders'],
    opportunity_priors: {
      buying_intent: 0.55,
      competitor_dissatisfaction: 0.55,
      migration_signal: 0.55,
      hiring_signal: 0.20,
      growth_signal: 0.25,
      integration_need: 0.40,
    },
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
    persona_tags: ['seo specialists', 'content marketers', 'agency owners'],
    opportunity_priors: {
      buying_intent: 0.50,
      competitor_dissatisfaction: 0.50,
      migration_signal: 0.55,
      hiring_signal: 0.20,
      growth_signal: 0.30,
      integration_need: 0.40,
    },
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
    persona_tags: ['sales leaders', 'account executives', 'sdrs', 'revops leaders'],
    opportunity_priors: {
      buying_intent: 0.55,
      competitor_dissatisfaction: 0.50,
      migration_signal: 0.50,
      hiring_signal: 0.30,
      growth_signal: 0.30,
      integration_need: 0.45,
    },
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
    persona_tags: ['developers', 'software engineers'],
    opportunity_priors: {
      buying_intent: 0.30,
      competitor_dissatisfaction: 0.30,
      migration_signal: 0.45,
      hiring_signal: 0.20,
      growth_signal: 0.20,
      integration_need: 0.55,
    },
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
    persona_tags: ['developers', 'frontend engineers', 'full-stack developers'],
    opportunity_priors: {
      buying_intent: 0.35,
      competitor_dissatisfaction: 0.35,
      migration_signal: 0.50,
      hiring_signal: 0.20,
      growth_signal: 0.20,
      integration_need: 0.65,
    },
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
    persona_tags: ['devops engineers', 'sre', 'platform engineers'],
    opportunity_priors: {
      buying_intent: 0.50,
      competitor_dissatisfaction: 0.45,
      migration_signal: 0.55,
      hiring_signal: 0.20,
      growth_signal: 0.25,
      integration_need: 0.65,
    },
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
    persona_tags: ['ml engineers', 'data scientists', 'ai researchers'],
    opportunity_priors: {
      buying_intent: 0.25,
      competitor_dissatisfaction: 0.25,
      migration_signal: 0.30,
      hiring_signal: 0.15,
      growth_signal: 0.20,
      integration_need: 0.35,
    },
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
    persona_tags: ['ai engineers', 'ml practitioners', 'developers'],
    opportunity_priors: {
      buying_intent: 0.40,
      competitor_dissatisfaction: 0.30,
      migration_signal: 0.40,
      hiring_signal: 0.15,
      growth_signal: 0.25,
      integration_need: 0.55,
    },
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
    persona_tags: ['fintech operators', 'compliance leaders', 'product managers'],
    opportunity_priors: {
      buying_intent: 0.50,
      competitor_dissatisfaction: 0.45,
      migration_signal: 0.45,
      hiring_signal: 0.25,
      growth_signal: 0.30,
      integration_need: 0.50,
    },
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
    persona_tags: ['cs leaders', 'customer success managers', 'onboarding specialists'],
    opportunity_priors: {
      buying_intent: 0.45,
      competitor_dissatisfaction: 0.40,
      migration_signal: 0.45,
      hiring_signal: 0.30,
      growth_signal: 0.25,
      integration_need: 0.45,
    },
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
    persona_tags: ['recruiters', 'talent leaders', 'hr leaders', 'sourcers'],
    opportunity_priors: {
      buying_intent: 0.45,
      competitor_dissatisfaction: 0.40,
      migration_signal: 0.45,
      hiring_signal: 0.70,
      growth_signal: 0.40,
      integration_need: 0.35,
    },
  },

  // ---------- Services / professional / consulting (PR-CAR-6) ----------
  {
    source_identifier: 'consulting',
    display_name: 'r/consulting',
    verticals: ['consulting', 'services', 'professional_services', 'b2b'],
    keywords: ['consultant', 'engagement', 'client', 'partner', 'rfp', 'practice'],
    signal_quality: 0.75,
    intent_density: 0.60,
    noise: 0.25,
    decision_maker: 0.80,
    rationale: 'Consultants and partners discuss client engagements, vendor selections, and tooling stacks — buyer intent + competitor adjacency are common.',
    persona_tags: ['consultants', 'partners', 'principals', 'operations leaders'],
    opportunity_priors: {
      buying_intent: 0.75,
      competitor_dissatisfaction: 0.60,
      migration_signal: 0.60,
      hiring_signal: 0.40,
      growth_signal: 0.35,
      integration_need: 0.45,
    },
  },
  {
    source_identifier: 'AgencyOwners',
    display_name: 'r/AgencyOwners',
    verticals: ['agency', 'services', 'marketing', 'b2b'],
    keywords: ['agency', 'retainer', 'pricing', 'team', 'client work'],
    signal_quality: 0.72,
    intent_density: 0.55,
    noise: 0.25,
    decision_maker: 0.78,
    rationale: 'Agency owners discuss tooling, pricing, hiring, and competitor agencies — high decision-maker density.',
    persona_tags: ['agency owners', 'agency operators', 'managing partners'],
    opportunity_priors: {
      buying_intent: 0.72,
      competitor_dissatisfaction: 0.60,
      migration_signal: 0.55,
      hiring_signal: 0.45,
      growth_signal: 0.40,
      integration_need: 0.45,
    },
  },
  {
    source_identifier: 'freelance',
    display_name: 'r/freelance',
    verticals: ['freelance', 'services', 'solo', 'consulting'],
    keywords: ['freelance', 'contractor', 'rates', 'invoicing', 'client'],
    signal_quality: 0.45,
    intent_density: 0.4,
    noise: 0.45,
    decision_maker: 0.5,
    rationale: 'Independent contractors share tooling, payment, and client-acquisition tactics — moderate buyer intent.',
    persona_tags: ['freelancers', 'contractors', 'solo consultants'],
    opportunity_priors: {
      buying_intent: 0.50,
      competitor_dissatisfaction: 0.35,
      migration_signal: 0.45,
      hiring_signal: 0.20,
      growth_signal: 0.30,
      integration_need: 0.40,
    },
  },
  {
    source_identifier: 'operations',
    display_name: 'r/operations',
    verticals: ['operations', 'ops', 'b2b', 'services', 'rev_ops'],
    keywords: ['operations', 'process', 'workflow', 'sop', 'efficiency', 'rev ops'],
    signal_quality: 0.72,
    intent_density: 0.58,
    noise: 0.25,
    decision_maker: 0.78,
    rationale: 'Operations leaders discuss process tooling, workflow automation, and vendor selection.',
    persona_tags: ['operations leaders', 'coo', 'ops managers', 'revops leaders'],
    opportunity_priors: {
      buying_intent: 0.72,
      competitor_dissatisfaction: 0.50,
      migration_signal: 0.65,
      hiring_signal: 0.30,
      growth_signal: 0.30,
      integration_need: 0.65,
    },
  },

  // ---------- Procurement / compliance (PR-CAR-6) ----------
  {
    source_identifier: 'procurement',
    display_name: 'r/procurement',
    verticals: ['procurement', 'supply_chain', 'b2b', 'sourcing'],
    keywords: ['procurement', 'vendor', 'rfp', 'sourcing', 'spend', 'contract'],
    signal_quality: 0.75,
    intent_density: 0.65,
    noise: 0.25,
    decision_maker: 0.80,
    rationale: 'Procurement professionals discuss vendor evaluations, contract negotiations, and switching — buyer intent is the daily activity.',
    persona_tags: ['procurement leaders', 'sourcing managers', 'cpo', 'category managers'],
    opportunity_priors: {
      buying_intent: 0.80,
      competitor_dissatisfaction: 0.70,
      migration_signal: 0.70,
      hiring_signal: 0.25,
      growth_signal: 0.30,
      integration_need: 0.50,
    },
  },
  {
    source_identifier: 'Compliance',
    display_name: 'r/Compliance',
    verticals: ['compliance', 'grc', 'b2b', 'risk', 'audit'],
    keywords: ['compliance', 'audit', 'soc2', 'iso 27001', 'gdpr', 'hipaa'],
    signal_quality: 0.72,
    intent_density: 0.60,
    noise: 0.25,
    decision_maker: 0.78,
    rationale: 'Compliance, GRC, and risk professionals discuss audit tooling, control frameworks, and vendor selection.',
    persona_tags: ['compliance officers', 'grc leaders', 'risk managers', 'security ops'],
    opportunity_priors: {
      buying_intent: 0.72,
      competitor_dissatisfaction: 0.55,
      migration_signal: 0.60,
      hiring_signal: 0.30,
      growth_signal: 0.25,
      integration_need: 0.60,
    },
  },

  // ---------- Manufacturing / supply chain / industrial (PR-CAR-6) ----------
  {
    source_identifier: 'manufacturing',
    display_name: 'r/manufacturing',
    verticals: ['manufacturing', 'industrial', 'b2b', 'oem'],
    keywords: ['manufacturing', 'production', 'plant', 'mes', 'erp', 'shop floor'],
    signal_quality: 0.5,
    intent_density: 0.45,
    noise: 0.4,
    decision_maker: 0.6,
    rationale: 'Plant managers and manufacturing leaders discuss MES/ERP tooling, equipment sourcing, and supplier management.',
    persona_tags: ['plant managers', 'manufacturing engineers', 'operations leaders', 'production leaders'],
    opportunity_priors: {
      buying_intent: 0.50,
      competitor_dissatisfaction: 0.40,
      migration_signal: 0.45,
      hiring_signal: 0.35,
      growth_signal: 0.30,
      integration_need: 0.55,
    },
  },
  {
    source_identifier: 'supplychain',
    display_name: 'r/supplychain',
    verticals: ['supply_chain', 'logistics', 'b2b', 'wholesale', 'distribution'],
    keywords: ['supply chain', 'logistics', 'freight', 'wms', 'tms', 'fulfillment'],
    signal_quality: 0.72,
    intent_density: 0.60,
    noise: 0.25,
    decision_maker: 0.76,
    rationale: 'Supply chain and logistics professionals discuss WMS/TMS tooling, carrier evaluation, and operational tooling.',
    persona_tags: ['supply chain managers', 'logistics leaders', 'fulfillment leaders', 'procurement'],
    opportunity_priors: {
      buying_intent: 0.72,
      competitor_dissatisfaction: 0.60,
      migration_signal: 0.65,
      hiring_signal: 0.30,
      growth_signal: 0.30,
      integration_need: 0.65,
    },
  },
  {
    source_identifier: 'industrialautomation',
    display_name: 'r/industrialautomation',
    verticals: ['industrial', 'iot', 'manufacturing', 'b2b', 'embedded', 'automation'],
    keywords: ['plc', 'scada', 'automation', 'iot', 'sensor', 'controls'],
    signal_quality: 0.5,
    intent_density: 0.4,
    noise: 0.4,
    decision_maker: 0.55,
    rationale: 'Automation engineers discuss PLC/SCADA vendors, IoT platforms, and integration projects.',
    persona_tags: ['automation engineers', 'controls engineers', 'plant ops', 'iot leaders'],
    opportunity_priors: {
      buying_intent: 0.45,
      competitor_dissatisfaction: 0.40,
      migration_signal: 0.50,
      hiring_signal: 0.25,
      growth_signal: 0.25,
      integration_need: 0.65,
    },
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
  /** PR-CAR-5: primary audience personas (search-intent originators for this stream). */
  persona_tags?: string[];
  /** PR-CAR-5: explicit per-type priors; overrides the source-type defaults. */
  opportunity_priors?: OpportunityPriorsBySeed;
};

export const KEYWORD_STREAM_SEEDS: KeywordStreamSeed[] = [
  {
    source_identifier: 'tool_migrations',
    display_name: 'Tool migration mentions',
    // Cross-platform stream — verticals deliberately broad because tool-switching
    // language appears in every industry that uses vendor tooling.
    verticals: ['saas', 'devtools', 'martech', 'services', 'consulting', 'agency', 'b2b', 'marketing', 'operations', 'professional_services'],
    keywords: ['migrating from', 'switched from', 'moving off', 'replacing'],
    rationale: 'Cross-platform migration intent — users actively in the process of swapping vendors.',
    persona_tags: ['founders', 'product managers', 'operations leaders'],
    opportunity_priors: {
      buying_intent: 0.50,
      competitor_dissatisfaction: 0.55,
      migration_signal: 0.80,
      hiring_signal: 0.20,
      growth_signal: 0.25,
      integration_need: 0.40,
    },
  },
  {
    source_identifier: 'recommendation_requests',
    display_name: 'Recommendation requests',
    // Cross-platform — "looking for X" / "recommend a Y" is industry-agnostic
    // buyer intent. Verticals broad on purpose.
    verticals: ['saas', 'smb', 'devtools', 'services', 'consulting', 'agency', 'b2b', 'marketing', 'operations', 'enterprise'],
    keywords: ['recommend a', 'best tool for', 'looking for a', 'alternatives to'],
    rationale: 'Explicit buyer-intent requests across the web.',
    persona_tags: ['founders', 'small business owners', 'product managers'],
    opportunity_priors: {
      buying_intent: 0.85,
      competitor_dissatisfaction: 0.35,
      migration_signal: 0.45,
      hiring_signal: 0.20,
      growth_signal: 0.25,
      integration_need: 0.45,
    },
  },
  {
    source_identifier: 'integration_needs',
    display_name: 'Integration needs',
    // Cross-platform — integration questions appear in every workflow-tooling
    // context.
    verticals: ['saas', 'devtools', 'services', 'b2b', 'operations', 'enterprise'],
    keywords: ['integrate with', 'connect to', 'api for', 'webhook for'],
    rationale: 'Integration-need signals — frequently lead to vendor selection.',
    persona_tags: ['developers', 'product managers', 'integration leads'],
    opportunity_priors: {
      buying_intent: 0.55,
      competitor_dissatisfaction: 0.30,
      migration_signal: 0.40,
      hiring_signal: 0.15,
      growth_signal: 0.20,
      integration_need: 0.85,
    },
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
