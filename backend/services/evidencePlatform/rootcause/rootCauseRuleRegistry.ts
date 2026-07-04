/**
 * Root Cause Rule Registry  (BETA-ENGINE-010, Phase 3)
 *
 * The canonical registry of deterministic diagnostic rules — NO engine-specific reasoning, NO AI. Every
 * rule declares participating evidence, required correlations, required conditions, root-cause type,
 * evaluation logic, explanation, and decision consumers. Rules consume the `CorrelatedEvidence` produced by
 * BETA-ENGINE-009 (keyed by correlation ruleId); they never re-derive raw evidence.
 */
import type { RootCauseType } from './rootCauseModel';
import type { CorrelatedEvidence } from '../correlation/correlationModel';

export interface RootCauseOutcome {
  causeType: RootCauseType;
  title: string;
  severity: number; // 0..100
  explanation: string;
  reasonCode: string;
  supportingEvidence: string[];
  supportingCorrelations: string[]; // correlation ruleIds
  blockingDependencies: string[];
  conflictingEvidence: string[];
}

export interface RootCauseRuleContext {
  /** Correlations asserted for this subject (confidence > 0), keyed by correlation ruleId. */
  asserted: Map<string, CorrelatedEvidence>;
  /** All correlations (incl. missing_supporting_evidence + non-asserted), keyed by ruleId. */
  all: Map<string, CorrelatedEvidence>;
}

export interface RootCauseRule {
  id: string;
  description: string;
  rootCauseType: RootCauseType;
  /** Correlation ruleIds this diagnosis participates in. */
  participatingCorrelations: string[];
  /** Correlation ruleIds that MUST be asserted for the cause to fire. */
  requiredCorrelations: string[];
  decisionConsumers: string[];
  rationale: { why: string; consumes: string; improves: string; prevents: string };
  /** Deterministic evaluation. Returns the diagnosis, or null when it does not apply. Pure. */
  evaluate: (ctx: RootCauseRuleContext) => RootCauseOutcome | null;
}

const asserted = (ctx: RootCauseRuleContext, id: string): CorrelatedEvidence | null => ctx.asserted.get(id) ?? null;
const anyAsserted = (ctx: RootCauseRuleContext, ids: string[]): boolean => ids.some((id) => ctx.asserted.has(id));
const allAsserted = (ctx: RootCauseRuleContext, ids: string[]): boolean => ids.every((id) => ctx.asserted.has(id));
const relOf = (c: CorrelatedEvidence | null): string => c?.relationshipType ?? '';
const strengthOf = (ctx: RootCauseRuleContext, id: string): number => ctx.asserted.get(id)?.strength ?? 0;

export const ROOT_CAUSE_RULES: RootCauseRule[] = [
  {
    id: 'authority_deficit',
    description: 'Weak authority is the blocking cause of weak rankings + weak organic reach.',
    rootCauseType: 'blocking_cause',
    participatingCorrelations: ['authority_ranking_dependency', 'backlinks_search_reinforcement'],
    requiredCorrelations: ['authority_ranking_dependency'],
    decisionConsumers: ['authority', 'seo'],
    rationale: {
      why: 'When rankings depend on authority (dependency correlation) — and organic reach agrees the constraint is authority — the root cause is an authority deficit that blocks ranking improvement, not on-page SEO.',
      consumes: 'authority_ranking_dependency (+ backlinks_search both-weak agreement)',
      improves: 'Authority + SEO recommendations become "close the authority/backlink gap" rather than generic SEO advice.',
      prevents: 'Recommending "improve SEO" / on-page tactics while the underlying authority deficit is the real blocker — a symptom-driven recommendation.',
    },
    evaluate: (ctx) => {
      const dep = asserted(ctx, 'authority_ranking_dependency');
      if (!dep || relOf(dep) !== 'dependency') return null;
      const both = asserted(ctx, 'backlinks_search_reinforcement');
      const reinforced = both && (relOf(both) === 'agreement'); // both-weak agreement corroborates
      const severity = Math.round(60 + strengthOf(ctx, 'authority_ranking_dependency') * 30 + (reinforced ? 10 : 0));
      return {
        causeType: 'blocking_cause', title: 'Authority Deficit', severity: Math.min(100, severity),
        explanation: `Rankings depend on authority and authority is weak${reinforced ? ' (organic reach agrees the constraint is authority)' : ''} — authority is the blocking cause, not on-page SEO.`,
        reasonCode: 'RC_AUTHORITY_DEFICIT',
        supportingEvidence: ['domain_authority', 'avg_position', ...(reinforced ? ['referring_domains', 'impressions'] : [])],
        supportingCorrelations: ['authority_ranking_dependency', ...(reinforced ? ['backlinks_search_reinforcement'] : [])],
        blockingDependencies: ['domain_authority'], conflictingEvidence: [],
      };
    },
  },
  {
    id: 'search_snippet_quality',
    description: 'Strong reach + poor CTR → the snippet/title is the primary cause of lost clicks.',
    rootCauseType: 'primary_cause',
    participatingCorrelations: ['search_visibility_ctr_contradiction'],
    requiredCorrelations: ['search_visibility_ctr_contradiction'],
    decisionConsumers: ['seo'],
    rationale: {
      why: 'High impressions with low CTR (contradiction correlation) means reach is fine but the listing does not earn the click — the primary cause is snippet/title/intent quality, not visibility.',
      consumes: 'search_visibility_ctr_contradiction',
      improves: 'SEO recommendations become "improve titles/meta/intent match" rather than "increase visibility".',
      prevents: 'Recommending more visibility/keywords when reach is already strong and the true cause is a weak snippet — a symptom-driven recommendation.',
    },
    evaluate: (ctx) => {
      const c = asserted(ctx, 'search_visibility_ctr_contradiction');
      if (!c || relOf(c) !== 'contradiction') return null;
      return {
        causeType: 'primary_cause', title: 'Search Snippet Quality', severity: Math.min(100, Math.round(50 + c.strength * 40)),
        explanation: 'Impressions are strong but CTR is low — the primary cause is snippet/title quality, not visibility.',
        reasonCode: 'RC_SNIPPET_QUALITY', supportingEvidence: ['impressions', 'ctr'],
        supportingCorrelations: ['search_visibility_ctr_contradiction'], blockingDependencies: [], conflictingEvidence: [],
      };
    },
  },
  {
    id: 'ai_optimization_gap',
    description: 'Recognised entity that AI does not retrieve → an answer-engine-optimisation gap.',
    rootCauseType: 'primary_cause',
    participatingCorrelations: ['entity_present_ai_gap'],
    requiredCorrelations: ['entity_present_ai_gap'],
    decisionConsumers: ['trust', 'authority'],
    rationale: {
      why: 'A knowledge-graph-present entity that AI answers rarely cite (contradiction correlation) is an AEO gap — the brand is recognised but not retrieved by answer engines.',
      consumes: 'entity_present_ai_gap',
      improves: 'Trust/authority recommendations become "close the AI-retrieval / AEO gap" rather than "build brand awareness".',
      prevents: 'Recommending brand-awareness work when the brand is already a recognised entity and the real gap is AI retrieval — a symptom-driven recommendation.',
    },
    evaluate: (ctx) => {
      const c = asserted(ctx, 'entity_present_ai_gap');
      if (!c || relOf(c) !== 'contradiction') return null;
      return {
        causeType: 'primary_cause', title: 'AI Optimization Gap', severity: Math.min(100, Math.round(45 + c.strength * 40)),
        explanation: 'The entity is knowledge-graph present but AI answers rarely cite it — the primary cause is an AI-retrieval (AEO) gap, not brand recognition.',
        reasonCode: 'RC_AI_OPTIMIZATION_GAP', supportingEvidence: ['knowledge_graph_presence', 'ai_answer_presence'],
        supportingCorrelations: ['entity_present_ai_gap'], blockingDependencies: [], conflictingEvidence: [],
      };
    },
  },
  {
    id: 'thin_trust_base',
    description: 'High rating on a thin review base → trust is a contributing weakness.',
    rootCauseType: 'contributing_cause',
    participatingCorrelations: ['reviews_brand_support'],
    requiredCorrelations: ['reviews_brand_support'],
    decisionConsumers: ['trust', 'brandTrust'],
    rationale: {
      why: 'A high average rating on few reviews (weak_support correlation) means the trust base is thin — a contributing cause of soft brand confidence.',
      consumes: 'reviews_brand_support (weak_support)',
      improves: 'Trust recommendations become "grow the review base" rather than "reputation is strong".',
      prevents: 'Reporting brand trust as strong when it rests on a handful of reviews — an over-stated, symptom-blind conclusion.',
    },
    evaluate: (ctx) => {
      const c = asserted(ctx, 'reviews_brand_support');
      if (!c || relOf(c) !== 'weak_support') return null;
      return {
        causeType: 'contributing_cause', title: 'Thin Trust Base', severity: Math.min(100, Math.round(35 + c.strength * 30)),
        explanation: 'A high rating rests on too few reviews — the trust base is thin (a contributing weakness).',
        reasonCode: 'RC_THIN_TRUST_BASE', supportingEvidence: ['review_count', 'avg_rating'],
        supportingCorrelations: ['reviews_brand_support'], blockingDependencies: [], conflictingEvidence: [],
      };
    },
  },
  {
    id: 'entity_authority_strength',
    description: 'Entity + AI reinforcement → authority/recognition is a strength (resolved, not a gap).',
    rootCauseType: 'resolved_cause',
    participatingCorrelations: ['entity_ai_reinforcement'],
    requiredCorrelations: ['entity_ai_reinforcement'],
    decisionConsumers: ['authority', 'trust'],
    rationale: {
      why: 'A knowledge-graph entity reinforced by AI retrieval (reinforcement correlation) is a confirmed strength — recommending authority work here would waste effort.',
      consumes: 'entity_ai_reinforcement',
      improves: 'Prioritisation — this area is de-prioritised as a strength, focusing recommendations on genuine gaps.',
      prevents: 'Recommending entity/authority work when the correlated evidence confirms it is already strong — a misallocated recommendation.',
    },
    evaluate: (ctx) => {
      const c = asserted(ctx, 'entity_ai_reinforcement');
      if (!c || relOf(c) !== 'reinforcement') return null;
      return {
        causeType: 'resolved_cause', title: 'Entity & AI Recognition Strength', severity: 0,
        explanation: 'Entity presence and AI retrieval reinforce each other — recognition is a strength, not a gap; de-prioritise authority work here.',
        reasonCode: 'RC_ENTITY_AUTHORITY_STRENGTH', supportingEvidence: ['knowledge_graph_presence', 'ai_answer_presence'],
        supportingCorrelations: ['entity_ai_reinforcement'], blockingDependencies: [], conflictingEvidence: [],
      };
    },
  },
  {
    id: 'conflicting_entity_signals',
    description: 'Entity reinforcement AND AI gap both asserted → conflicting signals; cannot diagnose cleanly.',
    rootCauseType: 'conflicting_cause',
    participatingCorrelations: ['entity_ai_reinforcement', 'entity_present_ai_gap'],
    requiredCorrelations: ['entity_ai_reinforcement', 'entity_present_ai_gap'],
    decisionConsumers: ['trust', 'authority'],
    rationale: {
      why: 'If both the entity/AI reinforcement AND the entity/AI gap correlations are asserted, the signals conflict — the cause cannot be asserted cleanly and the conflict must be surfaced, not resolved by guessing.',
      consumes: 'entity_ai_reinforcement + entity_present_ai_gap (mutually exclusive)',
      improves: 'Prevents a confident-but-wrong diagnosis; flags the conflict for review.',
      prevents: 'Fabricating a single root cause from contradictory correlations — a false-confidence recommendation.',
    },
    evaluate: (ctx) => {
      if (!allAsserted(ctx, ['entity_ai_reinforcement', 'entity_present_ai_gap'])) return null;
      return {
        causeType: 'conflicting_cause', title: 'Conflicting Entity/AI Signals', severity: 0,
        explanation: 'Both entity/AI reinforcement and entity/AI gap are asserted — the signals conflict; no clean root cause can be diagnosed.',
        reasonCode: 'RC_CONFLICTING_ENTITY_SIGNALS', supportingEvidence: ['knowledge_graph_presence', 'ai_answer_presence'],
        supportingCorrelations: ['entity_ai_reinforcement', 'entity_present_ai_gap'], blockingDependencies: [],
        conflictingEvidence: ['ai_answer_presence'],
      };
    },
  },
];

export function rootCauseRulesForConsumer(consumer: string): RootCauseRule[] {
  return ROOT_CAUSE_RULES.filter((r) => r.decisionConsumers.includes(consumer));
}

export { anyAsserted };
