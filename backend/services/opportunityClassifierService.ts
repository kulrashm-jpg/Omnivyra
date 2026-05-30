/**
 * Phase 4 — Opportunity classification.
 *
 * Deterministic, explainable, no AI calls. Given a signal's content + base
 * scores, returns:
 *   - the opportunity_type (one of 8 enum values, including a fallback
 *     'generic_interest' when no specific signal pattern matches),
 *   - the matched keywords that drove the classification,
 *   - a structured score breakdown so the UI explanation layer can show
 *     exactly why each component score landed where it did.
 *
 * Resolution rule when multiple groups match (specificity-first, per
 * PR-OPQ-1):
 *   1. SPECIFICITY  — a more specific opportunity type beats a more
 *                     generic one (Integration Need > Buying Intent,
 *                     Hiring Signal > Buying Intent,
 *                     Competitor Dissatisfaction > Product Research).
 *   2. MATCH DENSITY — within the same specificity, more matched
 *                     patterns wins.
 *   3. PRIORITY      — final tiebreaker; preserves the prior ordering
 *                     for signals where only specificity ties don't
 *                     resolve cleanly.
 *
 * The `priority` field is retained for the tiebreaker — its absolute
 * values are unchanged from before this refactor, so any external
 * consumers that read it observe the same ordering.
 */

import type { OpportunityType } from '../types/opportunityFeed';

type PatternGroup = {
  type: OpportunityType;
  /**
   * Specificity rank — higher means the type describes a more specific
   * scenario. integration_need / migration_signal / hiring_signal /
   * support_frustration all describe a concrete action or pain that's
   * harder to confuse with generic chatter; product_research and
   * buying_intent are intentionally most generic because their anchors
   * fire on many natural-language constructions.
   */
  specificity: number;
  priority: number;
  patterns: RegExp[];
  type_multiplier: number;
};

const PATTERN_GROUPS: PatternGroup[] = [
  // 1. Integration need — connect X to Y (MOST SPECIFIC)
  {
    type: 'integration_need',
    specificity: 7,
    priority: 70,
    type_multiplier: 0.8,
    patterns: [
      /\b(integrat(e|ing|ion)|connect(ing|ed)? [a-z]+ (to|with))\b/i,
      /\b(api for|webhook for|sync(s|ing|ed)? (between|with))\b/i,
    ],
  },

  // 2. Migration signal — actively switching off / onto
  {
    type: 'migration_signal',
    specificity: 6,
    priority: 95,
    type_multiplier: 0.95,
    patterns: [
      /\b(migrating from|moving (off|away from|to)|switch(ed|ing) from|leaving [a-z]+ for)\b/i,
      /\b(replac(e|ing|ed) [a-z]+ with|swap(ped|ping) out)\b/i,
    ],
  },

  // 3. Hiring signal — "we're hiring" / "looking for a [role]"
  {
    type: 'hiring_signal',
    specificity: 5,
    priority: 60,
    type_multiplier: 0.75,
    patterns: [
      /\b(we('?re| are) hiring|growing the team|looking for a (senior |staff |lead )?[a-z]+ (engineer|developer|designer|manager|director))\b/i,
      /\bopen (role|position|req)\b/i,
    ],
  },

  // 4. Support frustration — explicit support pain
  {
    type: 'support_frustration',
    specificity: 4,
    priority: 50,
    type_multiplier: 0.7,
    patterns: [
      /\b(support (is|has been) (awful|terrible|broken|silent|missing))\b/i,
      /\b(no response from support|ticket (open|sitting) for|stuck in support hell)\b/i,
    ],
  },

  // 5. Competitor dissatisfaction — anti-brand language about a competitor
  {
    type: 'competitor_dissatisfaction',
    specificity: 3,
    priority: 90,
    type_multiplier: 0.9,
    patterns: [
      /\b(hate (using )?[a-z]+|fed up with|frustrated (by|with) [a-z]+)\b/i,
      /\b([a-z]+ is (terrible|garbage|awful|broken|slow|expensive))\b/i,
      /\balternatives? to\b/i,
    ],
  },

  // 6. Product research — explicit comparison / "differences between"
  {
    type: 'product_research',
    specificity: 2,
    priority: 80,
    type_multiplier: 0.85,
    patterns: [
      /\b(comparing|compar(e|ing) [a-z]+ (vs|with|and|to))\b/i,
      /\b(differences? between|what('?| i)s the difference|pros and cons of)\b/i,
      /\b([a-z]+ vs\.? [a-z]+)\b/i,
      // PR-OPQ-3.1 — "versus" word form and inflected "compared"
      /\b([a-z]+ versus [a-z]+)\b/i,
      /\bcompared (to|with|against) [a-z]+\b/i,
    ],
  },

  // 7. Buying intent — explicit "want to buy / looking for" (MOST GENERIC)
  {
    type: 'buying_intent',
    specificity: 1,
    priority: 100,
    type_multiplier: 1.0,
    patterns: [
      /\b(looking for|need a|need an|need recommendations?|recommend a|any (good|great) [a-z]+|what('?| i)s the best)\b/i,
      /\b(in the market for|shopping for|evaluat(ing|ed) [a-z]+)\b/i,
      /\b(budget for|approved budget|signed off on|just got budget)\b/i,
      // PR-OPQ-3.1 — recommendation-seeking anchors beyond the verb form
      /\b(got (a|any) [a-z]+ (recommendations?|suggestions?))\b/i,
      /\b(any (recommendations?|suggestions?|alternatives?))\b/i,
      /\b((recommendations?|suggestions?|alternatives?|options) for [a-z]+)\b/i,
      /\b(seeking (recommendations?|suggestions?|alternatives?|options))\b/i,
    ],
  },
];

export type OpportunityClassification = {
  opportunity_type: OpportunityType;
  type_multiplier: number;
  matched_keywords: string[];
  matched_patterns: string[];
};

/**
 * PR-OPQ-2 — Business-context guard.
 *
 * After the specificity-first winner is selected, the classifier verifies
 * that the signal text contains at least one business-context indicator.
 * If not, the result falls back to `generic_interest` regardless of which
 * anchor pattern matched. This prevents adversarial natural-language
 * phrasings ("looking for a workout buddy", "hiring a babysitter",
 * "switching from coffee to tea", "moving to Austin") from being surfaced
 * as specific buyer-intent opportunities.
 *
 * The vocabulary is grouped per the PR-OPQ-2 spec but flattened into a
 * single anchor list — any match counts as business context.
 *
 * Word-boundary regex by default. Stem patterns (`migrat[a-z]*`,
 * `replac[a-z]*`, etc.) cover singular/plural and -ing / -ed variants
 * for the most common business verbs without enumerating each form.
 */
const BUSINESS_CONTEXT_PATTERNS: RegExp[] = [
  // ---- Technology ----
  /\bsoftware\b/i, /\bplatforms?\b/i, /\bapis?\b/i,
  /\bintegrations?\b/i, /\bintegrating\b/i, /\bintegrated\b/i,
  /\bcrm\b/i, /\banalytics\b/i, /\bsaas\b/i,
  /\btools?(ing)?\b/i, /\bsdks?\b/i, /\bwebhooks?\b/i,
  /\bdatabases?\b/i, /\bdb\b/i, /\bframeworks?\b/i, /\blibrar(y|ies)\b/i,
  /\bautomation\b/i, /\bauth\b/i, /\bsso\b/i, /\boauth\b/i,
  /\bats\b/i, /\bmes\b/i, /\berp\b/i,
  /\bcloud\b/i, /\bdevops\b/i, /\bml\b/i, /\bllm\b/i, /\bai\b/i,
  /\bmonorepos?\b/i, /\bproduction\b/i,
  // ---- Business ----
  /\bvendors?\b/i, /\bsuppliers?\b/i, /\bprocurement\b/i,
  /\boperations\b/i, /\bops\b/i, /\bcompliance\b/i, /\bsales\b/i,
  /\bmarketing\b/i, /\brevops\b/i, /\bfinance\b/i,
  /\baccounting\b/i, /\blegal\b/i, /\benterprise\b/i, /\bb2b\b/i,
  /\bcustomers?\b/i, /\bworkflows?\b/i,
  /\bpricing\b/i, /\bbilling\b/i, /\bcontracts?\b/i,
  /\bonboarding\b/i, /\bretention\b/i, /\bsupport\b/i,
  // ---- Hiring ----
  /\bengineers?\b/i, /\bdevelopers?\b/i, /\bmanagers?\b/i,
  /\bdirectors?\b/i, /\banalysts?\b/i, /\brecruiters?\b/i,
  /\bspecialists?\b/i, /\bdesigners?\b/i,
  /\broles?\b/i, /\bpositions?\b/i, /\bsenior\b/i, /\bstaff\b/i,
  /\bexecutives?\b/i,
  // ---- Migration ----
  /\bmigrat[a-z]*\b/i, /\breplac[a-z]*\b/i, /\bswap(ped|ping)?\b/i,
  /\btransition(ing|ed|s)?\b/i,
  /\bmoving off\b/i, /\bswitching vendors\b/i,
];

/**
 * PR-OPQ-3 — Business entity dictionary.
 *
 * Curated list of well-known B2B SaaS products / vendors / platforms.
 * A signal that mentions one of these by name passes the business
 * context guard even when no general vocabulary word is present, so
 * short brand-only signals ("Datadog is expensive.", "Zendesk is
 * broken.") classify correctly.
 *
 * Match policy: CASE-SENSITIVE word-boundary regex. Most SaaS brand
 * mentions in real-world content are capitalized (formal posts, X
 * threads, blog comments). Case sensitivity is what keeps common
 * English nouns ("segment of customers", "outreach effort",
 * "Mondays are terrible") from triggering the guard via the same
 * letters. Trade-off accepted: casual lowercase mentions of brands
 * won't pass via the entity path — they'd need to be caught by the
 * vocabulary path instead.
 *
 * No external service. No LLM. Just a curated dictionary that can be
 * extended as new SaaS products become relevant.
 */
const KNOWN_BUSINESS_ENTITIES: string[] = [
  // Spec acceptance examples
  'Datadog', 'Zendesk', 'Vanta', 'Mixpanel', 'Segment',
  'Stripe', 'QuickBooks', 'Outreach', 'Salesloft',
  // CRM / marketing
  'HubSpot', 'Salesforce', 'Pipedrive', 'Mailchimp',
  'Marketo', 'Pardot', 'ActiveCampaign', 'ConvertKit',
  'Klaviyo', 'Iterable', 'Braze', 'Customer.io',
  // Sales engagement / intel
  'Apollo', 'Gong', 'Chorus', 'ZoomInfo', 'Lusha',
  'Clearbit', '6sense', 'Drift', 'Qualified',
  // Auth / security / compliance
  'Auth0', 'Clerk', 'Okta', 'OneLogin', 'Drata',
  'Secureframe', 'CrowdStrike', 'SentinelOne',
  // Observability / devtools
  'NewRelic', 'Splunk', 'Honeycomb', 'Sentry', 'Grafana',
  'PagerDuty', 'Opsgenie',
  'CircleCI', 'Jenkins', 'Vercel', 'Netlify',
  'Cloudflare', 'Fastly',
  'GitHub', 'GitLab', 'Bitbucket',
  // Data / analytics
  'Snowflake', 'Databricks', 'Amplitude', 'Heap',
  'RudderStack', 'PostHog', 'Looker', 'Tableau', 'Metabase',
  // Database / infra
  'Postgres', 'PostgreSQL', 'MongoDB', 'Redis',
  'Neon', 'PlanetScale', 'Supabase', 'Firebase',
  'CockroachDB', 'DynamoDB',
  // LLM / ML / vector
  'OpenAI', 'Anthropic', 'Cohere', 'Mistral',
  'Pinecone', 'Weaviate', 'Qdrant', 'Chroma',
  'LangChain', 'LlamaIndex',
  // Feature flags / experimentation
  'LaunchDarkly', 'Optimizely', 'Statsig', 'Eppo',
  // Helpdesk / support
  'Intercom', 'Freshdesk', 'Kustomer',
  // Project management
  'Jira', 'Asana', 'Linear', 'ClickUp', 'Notion',
  'Trello', 'Basecamp', 'Airtable',
  // Communication
  'Slack', 'Discord', 'Zoom', 'Loom',
  // HR / ATS / payroll
  'Greenhouse', 'Lever', 'Workday', 'Rippling', 'Gusto',
  'BambooHR', 'Deel', 'Justworks',
  // Finance / fintech
  'Xero', 'Brex', 'Ramp', 'Plaid', 'Mercury',
  // Procurement / enterprise
  'Coupa', 'Ariba', 'Jaggaer',
  // E-commerce
  'Shopify', 'WooCommerce',
  // Storage / files
  'Dropbox', 'Box',
  // Design
  'Figma', 'Sketch', 'InVision', 'Framer',
];

const BUSINESS_ENTITY_PATTERNS: RegExp[] = KNOWN_BUSINESS_ENTITIES.map(
  (entity) => new RegExp(`\\b${entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
);

function hasBusinessContext(content: string): boolean {
  for (const pattern of BUSINESS_CONTEXT_PATTERNS) {
    if (pattern.test(content)) return true;
  }
  for (const pattern of BUSINESS_ENTITY_PATTERNS) {
    if (pattern.test(content)) return true;
  }
  return false;
}

export function classifyOpportunity(content: string): OpportunityClassification {
  type Candidate = {
    group: PatternGroup;
    matchedPatterns: string[];
    matchedKeywords: string[];
  };

  // Collect every group that has at least one matching pattern.
  const candidates: Candidate[] = [];
  for (const group of PATTERN_GROUPS) {
    const matchedPatterns: string[] = [];
    const matchedKeywords: string[] = [];
    for (const pattern of group.patterns) {
      const m = content.match(pattern);
      if (m) {
        matchedPatterns.push(pattern.source);
        matchedKeywords.push(m[0]);
      }
    }
    if (matchedPatterns.length > 0) {
      candidates.push({ group, matchedPatterns, matchedKeywords });
    }
  }

  if (candidates.length === 0) {
    return {
      opportunity_type: 'generic_interest',
      type_multiplier: 0.5,
      matched_keywords: [],
      matched_patterns: [],
    };
  }

  // Resolution rule (PR-OPQ-1):
  //   1. specificity DESC
  //   2. match density DESC
  //   3. priority DESC
  candidates.sort((a, b) => {
    if (a.group.specificity !== b.group.specificity) {
      return b.group.specificity - a.group.specificity;
    }
    if (a.matchedPatterns.length !== b.matchedPatterns.length) {
      return b.matchedPatterns.length - a.matchedPatterns.length;
    }
    return b.group.priority - a.group.priority;
  });

  const winner = candidates[0];

  // PR-OPQ-2: business-context guard. Specific opportunity types require
  // a business-context indicator in addition to an anchor match. If the
  // content has no business vocabulary at all, the result falls back to
  // generic_interest so the feed doesn't surface "looking for a workout
  // buddy" as a buying-intent opportunity.
  if (!hasBusinessContext(content)) {
    return {
      opportunity_type: 'generic_interest',
      type_multiplier: 0.5,
      matched_keywords: [],
      matched_patterns: [],
    };
  }

  return {
    opportunity_type: winner.group.type,
    type_multiplier: winner.group.type_multiplier,
    matched_keywords: [...new Set(winner.matchedKeywords.map((k) => k.toLowerCase()))],
    matched_patterns: winner.matchedPatterns,
  };
}
