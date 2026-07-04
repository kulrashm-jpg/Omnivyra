/**
 * Recommendation Rule Registry  (BETA-ENGINE-011, Phase 3)
 *
 * The canonical registry of deterministic recommendation rules — NO engine-specific recommendation logic,
 * NO generic templates. Every rule is keyed to a validated Root Cause and declares supported root causes,
 * required evidence, execution logic (steps), priority inputs, expected outcomes, dependencies, and
 * validation criteria. A recommendation exists ONLY when its root cause is diagnosed.
 */
import type { ActionType } from './recommendationModel';

export interface RecommendationRule {
  id: string;
  title: string;
  actionType: ActionType;
  /** RootCause causeIds this rule addresses. */
  supportedRootCauses: string[];
  requiredEvidence: string[];
  decisionConsumers: string[];
  /** Static priority inputs (0..100); combined deterministically with the live root-cause severity/confidence. */
  businessImpact: number;
  technicalImpact: number;
  requiredEffort: number;
  risk: number; // 0..100 execution risk (higher = riskier)
  isBlocking: boolean; // gates other work (dependency action)
  expectedBusinessOutcome: string;
  expectedTechnicalOutcome: string;
  executionSteps: string[];
  validationSteps: string[];
  successCriteria: string[];
  prerequisites: string[];
  /** The legacy template recommendation this rule replaces. */
  replaces: string;
  rationale: { rootCause: string; requires: string; steps: string; outcome: string; replaces: string };
}

export const RECOMMENDATION_RULES: RecommendationRule[] = [
  {
    id: 'rec_close_authority_gap',
    title: 'Close the authority gap before on-page SEO',
    actionType: 'dependency',
    supportedRootCauses: ['authority_deficit'],
    requiredEvidence: ['domain_authority', 'avg_position'],
    decisionConsumers: ['authority', 'seo'],
    businessImpact: 85, technicalImpact: 60, requiredEffort: 75, risk: 40, isBlocking: true,
    expectedBusinessOutcome: 'Durable organic ranking gains once the authority floor is raised.',
    expectedTechnicalOutcome: 'Higher referring-domain count and domain authority; average position improves.',
    executionSteps: [
      'Audit current referring domains and identify authority gaps vs top-ranked competitors.',
      'Prioritise outreach to high-authority, topically-relevant referring domains.',
      'Earn links from category publications and expert networks anchored to target pages.',
    ],
    validationSteps: ['Re-measure referring_domains + domain_authority after outreach.', 'Track avg_position for target queries.'],
    successCriteria: ['referring_domains increases toward the competitive baseline', 'avg_position for target queries improves'],
    prerequisites: ['Target-page + competitor authority baseline'],
    replaces: '"Improve SEO" / generic on-page ranking tactics',
    rationale: {
      rootCause: 'authority_deficit (blocking)', requires: 'domain_authority + avg_position (backlink + search)',
      steps: 'audit referring domains → prioritise high-DA outreach → earn category links',
      outcome: 'durable ranking gains from a raised authority floor',
      replaces: 'the symptom-driven "improve SEO" recommendation that cannot work while authority blocks rankings',
    },
  },
  {
    id: 'rec_fix_search_snippet',
    title: 'Rewrite titles & meta for intent to lift CTR',
    actionType: 'optimization',
    supportedRootCauses: ['search_snippet_quality'],
    requiredEvidence: ['impressions', 'ctr'],
    decisionConsumers: ['seo'],
    businessImpact: 70, technicalImpact: 45, requiredEffort: 30, risk: 15, isBlocking: false,
    expectedBusinessOutcome: 'More clicks from existing reach — traffic rises without new visibility.',
    expectedTechnicalOutcome: 'CTR increases at constant impressions on the targeted pages.',
    executionSteps: [
      'Identify high-impression, low-CTR pages from search evidence.',
      'Rewrite titles + meta descriptions to match query intent and add a clear value proposition.',
      'Add/verify structured data so the snippet is eligible for rich results.',
    ],
    validationSteps: ['Compare CTR before/after at held-constant impressions.', 'Confirm structured-data validity.'],
    successCriteria: ['CTR improves on the targeted pages without a drop in impressions'],
    prerequisites: ['Page-level impression + CTR breakdown'],
    replaces: '"Increase visibility" / add-more-keywords advice',
    rationale: {
      rootCause: 'search_snippet_quality (primary)', requires: 'impressions + ctr',
      steps: 'find high-impression low-CTR pages → rewrite titles/meta for intent → add structured data',
      outcome: 'more clicks from existing reach', replaces: 'the "increase visibility" recommendation when reach is already strong',
    },
  },
  {
    id: 'rec_close_ai_gap',
    title: 'Close the AI-retrieval (AEO) gap',
    actionType: 'corrective',
    supportedRootCauses: ['ai_optimization_gap'],
    requiredEvidence: ['knowledge_graph_presence', 'ai_answer_presence'],
    decisionConsumers: ['trust', 'authority'],
    businessImpact: 75, technicalImpact: 55, requiredEffort: 55, risk: 30, isBlocking: false,
    expectedBusinessOutcome: 'The brand is cited by answer engines for category + branded queries.',
    expectedTechnicalOutcome: 'AI answer presence + citation rate increase for the entity.',
    executionSteps: [
      'Publish authoritative, entity-anchored content answering the category + branded questions.',
      'Strengthen schema.org Organization + sameAs so answer engines resolve the entity confidently.',
      'Ensure the answer content is crawlable and unambiguously attributed to the entity.',
    ],
    validationSteps: ['Re-probe answer engines for citation/answer presence.', 'Verify schema + sameAs completeness.'],
    successCriteria: ['ai_answer_presence increases for branded + category queries'],
    prerequisites: ['Resolved knowledge-graph entity'],
    replaces: '"Build brand awareness" advice',
    rationale: {
      rootCause: 'ai_optimization_gap (primary)', requires: 'knowledge_graph_presence + ai_answer_presence',
      steps: 'publish entity-anchored answer content → strengthen schema/sameAs → ensure crawlable attribution',
      outcome: 'the brand becomes AI-retrievable', replaces: 'the "build awareness" recommendation when the brand is already a recognised entity',
    },
  },
  {
    id: 'rec_grow_review_base',
    title: 'Grow the review base to harden brand trust',
    actionType: 'preventive',
    supportedRootCauses: ['thin_trust_base'],
    requiredEvidence: ['review_count', 'avg_rating'],
    decisionConsumers: ['trust', 'brandTrust'],
    businessImpact: 60, technicalImpact: 25, requiredEffort: 35, risk: 20, isBlocking: false,
    expectedBusinessOutcome: 'A robust, credible review base that sustains brand trust under scrutiny.',
    expectedTechnicalOutcome: 'Review count grows across platforms while the rating holds.',
    executionSteps: [
      'Launch a post-purchase review-request flow to grow verified reviews.',
      'Respond to existing reviews (owner responses) to signal engagement.',
      'Diversify across review platforms to broaden coverage.',
    ],
    validationSteps: ['Track review_count growth and platform coverage.', 'Confirm rating holds as volume grows.'],
    successCriteria: ['review_count grows past the thin-base threshold while avg_rating holds'],
    prerequisites: ['At least one connected review source'],
    replaces: '"Reputation is strong" (a thin-base over-statement)',
    rationale: {
      rootCause: 'thin_trust_base (contributing)', requires: 'review_count + avg_rating',
      steps: 'post-purchase review requests → owner responses → diversify platforms',
      outcome: 'a robust trust base', replaces: 'reporting trust as strong when it rests on a handful of reviews',
    },
  },
  {
    id: 'rec_monitor_entity_strength',
    title: 'Sustain entity & AI recognition (monitor, do not invest)',
    actionType: 'monitoring',
    supportedRootCauses: ['entity_authority_strength'],
    requiredEvidence: ['knowledge_graph_presence', 'ai_answer_presence'],
    decisionConsumers: ['authority', 'trust'],
    businessImpact: 20, technicalImpact: 15, requiredEffort: 10, risk: 5, isBlocking: false,
    expectedBusinessOutcome: 'Recognition strength is preserved; effort is redirected to genuine gaps.',
    expectedTechnicalOutcome: 'KG presence + AI citation remain stable.',
    executionSteps: ['Monitor knowledge-graph presence + AI citation on the existing cadence.', 'Keep schema + sameAs current.'],
    validationSteps: ['Confirm KG presence + AI answer presence remain stable over time.'],
    successCriteria: ['knowledge_graph_presence stays 1 and ai_answer_presence holds'],
    prerequisites: [],
    replaces: 'unnecessary authority/entity investment where the area is already strong',
    rationale: {
      rootCause: 'entity_authority_strength (resolved)', requires: 'knowledge_graph_presence + ai_answer_presence',
      steps: 'monitor presence + citation → keep schema current',
      outcome: 'sustained strength + redirected effort', replaces: 'recommending work on an area the evidence confirms is already strong',
    },
  },
  {
    id: 'rec_revalidate_entity_signals',
    title: 'Re-validate conflicting entity/AI signals before acting',
    actionType: 'validation',
    supportedRootCauses: ['conflicting_entity_signals'],
    requiredEvidence: ['knowledge_graph_presence', 'ai_answer_presence'],
    decisionConsumers: ['trust', 'authority'],
    businessImpact: 30, technicalImpact: 20, requiredEffort: 15, risk: 10, isBlocking: false,
    expectedBusinessOutcome: 'A clean, trustworthy diagnosis before any spend is committed.',
    expectedTechnicalOutcome: 'The conflicting entity/AI correlations are resolved to a single signal.',
    executionSteps: ['Re-probe answer engines and re-fetch the knowledge-graph entity.', 'Reconcile the conflicting measurements before acting.'],
    validationSteps: ['Confirm the entity/AI conflict is resolved to a consistent signal.'],
    successCriteria: ['the conflicting correlations reconcile to a single non-conflicting relationship'],
    prerequisites: [],
    replaces: 'acting on a confident-but-contradictory diagnosis',
    rationale: {
      rootCause: 'conflicting_entity_signals (conflicting)', requires: 'knowledge_graph_presence + ai_answer_presence',
      steps: 're-probe AI + re-fetch entity → reconcile',
      outcome: 'a clean diagnosis before spend', replaces: 'committing to a recommendation built on contradictory signals',
    },
  },
];

export function recommendationRulesForRootCause(causeId: string): RecommendationRule[] {
  return RECOMMENDATION_RULES.filter((r) => r.supportedRootCauses.includes(causeId));
}
