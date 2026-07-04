/**
 * Correlation Rule Registry  (BETA-ENGINE-009, Phase 3)
 *
 * The canonical registry of deterministic cross-evidence rules — NO engine-specific logic, NO AI. Every
 * rule declares its participating evidence, required measurements, relationship, evaluation logic,
 * explanation, confidence effect, and decision consumers. Rules operate on LOGICAL measurements resolved
 * from one or more physical canonical evidence keys (provider-agnostic aliases), so a rule works whether
 * the search signal came from GSC or Bing.
 */
import type { RelationshipType, ConfidenceEffect } from './correlationModel';

/** Logical measurement → physical canonical evidence key aliases (first present wins). */
export const MEASUREMENT_ALIASES: Record<string, string[]> = {
  impressions: ['impressions', 'bing_impressions'],
  clicks: ['clicks', 'bing_clicks'],
  ctr: ['ctr', 'bing_ctr'],
  avg_position: ['avg_position', 'bing_avg_position'],
  ai_answer_presence: ['ai_answer_presence'],
  ai_citation_rate: ['ai_citation_rate'],
  knowledge_graph_presence: ['knowledge_graph_presence'],
  sameas_count: ['sameas_count'],
  schema_completeness: ['schema_completeness'],
  avg_rating: ['avg_rating'],
  review_count: ['review_count'],
  referring_domains: ['referring_domains'],
  domain_authority: ['domain_authority'],
};

export interface CorrelationOutcome {
  relationshipType: RelationshipType;
  strength: number; // 0..1
  explanation: string;
  reasonCode: string;
  supporting: string[];
  contradictions: string[];
  dependencies: string[];
}

export interface CorrelationRule {
  id: string;
  description: string;
  /** Logical measurements this rule participates in (subset of MEASUREMENT_ALIASES keys). */
  participatingMeasurements: string[];
  /** Logical measurements that MUST be present to assert the relationship. */
  requiredMeasurements: string[];
  confidenceEffect: ConfidenceEffect;
  decisionConsumers: string[];
  rationale: { why: string; combines: string; consumers: string; prevents: string };
  /** Deterministic evaluation over the present logical measurement values. Pure. */
  evaluate: (vals: Record<string, number>) => CorrelationOutcome;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export const CORRELATION_RULES: CorrelationRule[] = [
  {
    id: 'search_visibility_ctr_contradiction',
    description: 'High search impressions with low CTR — visibility without engagement.',
    participatingMeasurements: ['impressions', 'ctr'],
    requiredMeasurements: ['impressions', 'ctr'],
    confidenceEffect: 'contradict',
    decisionConsumers: ['seo'],
    rationale: {
      why: 'Impressions measure reach; CTR measures whether the listing earns the click. High reach + low CTR is a title/meta/intent-mismatch signal, not a visibility win.',
      combines: 'search impressions + CTR (GSC or Bing)',
      consumers: 'SEO intelligence',
      prevents: 'Celebrating high impressions while a poor CTR silently caps traffic — and recommending "more visibility" when the real fix is the snippet.',
    },
    evaluate: (v) => {
      const contradiction = v.impressions >= 1000 && v.ctr < 0.02;
      const strength = contradiction ? clamp01((0.02 - v.ctr) / 0.02) : 0;
      return contradiction
        ? { relationshipType: 'contradiction', strength, explanation: `High impressions (${v.impressions}) with low CTR (${(v.ctr * 100).toFixed(2)}%) — reach is not converting to clicks.`, reasonCode: 'CORR_IMPRESSIONS_CTR_CONTRADICTION', supporting: ['impressions', 'ctr'], contradictions: ['ctr'], dependencies: [] }
        : { relationshipType: 'agreement', strength: 0, explanation: 'Impressions and CTR are consistent.', reasonCode: 'CORR_IMPRESSIONS_CTR_OK', supporting: ['impressions', 'ctr'], contradictions: [], dependencies: [] };
    },
  },
  {
    id: 'authority_ranking_dependency',
    description: 'Weak domain authority gating weak rankings.',
    participatingMeasurements: ['domain_authority', 'avg_position'],
    requiredMeasurements: ['domain_authority', 'avg_position'],
    confidenceEffect: 'support',
    decisionConsumers: ['authority', 'seo'],
    rationale: {
      why: 'Average position is strongly gated by domain authority. When both are weak, ranking recommendations cannot succeed without first improving authority — a dependency, not two separate facts.',
      combines: 'backlink domain authority + search average position',
      consumers: 'Authority + SEO intelligence',
      prevents: 'Recommending on-page ranking tactics that cannot move rankings while the underlying authority gap is the true blocker.',
    },
    evaluate: (v) => {
      const dependency = v.domain_authority < 30 && v.avg_position > 10;
      const strength = dependency ? clamp01(((30 - v.domain_authority) / 30 + Math.min(1, (v.avg_position - 10) / 20)) / 2) : 0;
      return dependency
        ? { relationshipType: 'dependency', strength, explanation: `Weak authority (DA ${v.domain_authority.toFixed(0)}) gates weak rankings (avg position ${v.avg_position.toFixed(1)}) — rankings depend on authority.`, reasonCode: 'CORR_AUTHORITY_RANKING_DEPENDENCY', supporting: ['domain_authority', 'avg_position'], contradictions: [], dependencies: ['domain_authority'] }
        : { relationshipType: 'agreement', strength: 0, explanation: 'Authority and rankings are not in a limiting dependency.', reasonCode: 'CORR_AUTHORITY_RANKING_OK', supporting: ['domain_authority', 'avg_position'], contradictions: [], dependencies: [] };
    },
  },
  {
    id: 'entity_ai_reinforcement',
    description: 'Knowledge-graph presence reinforced by AI retrieval.',
    participatingMeasurements: ['knowledge_graph_presence', 'ai_answer_presence'],
    requiredMeasurements: ['knowledge_graph_presence', 'ai_answer_presence'],
    confidenceEffect: 'reinforce',
    decisionConsumers: ['authority', 'trust'],
    rationale: {
      why: 'A resolved knowledge-graph entity and frequent AI answer presence mutually confirm the brand is a recognised, retrievable entity — together far stronger than either alone.',
      combines: 'entity KG presence + AI answer presence',
      consumers: 'Authority + Trust intelligence',
      prevents: 'Treating entity and AI-visibility as two separate weak signals when their agreement is a strong authority/credibility confirmation.',
    },
    evaluate: (v) => {
      const reinforce = v.knowledge_graph_presence >= 1 && v.ai_answer_presence >= 0.5;
      const strength = reinforce ? clamp01(v.ai_answer_presence) : 0;
      return reinforce
        ? { relationshipType: 'reinforcement', strength, explanation: `Entity is knowledge-graph present and AI answers cite it (${(v.ai_answer_presence * 100).toFixed(0)}%) — mutually reinforcing recognition.`, reasonCode: 'CORR_ENTITY_AI_REINFORCEMENT', supporting: ['knowledge_graph_presence', 'ai_answer_presence'], contradictions: [], dependencies: [] }
        : { relationshipType: 'weak_support', strength: 0, explanation: 'Entity and AI presence do not mutually reinforce at measured levels.', reasonCode: 'CORR_ENTITY_AI_WEAK', supporting: ['knowledge_graph_presence', 'ai_answer_presence'], contradictions: [], dependencies: [] };
    },
  },
  {
    id: 'entity_present_ai_gap',
    description: 'Recognised entity that AI systems fail to retrieve — an AEO gap.',
    participatingMeasurements: ['knowledge_graph_presence', 'ai_answer_presence'],
    requiredMeasurements: ['knowledge_graph_presence', 'ai_answer_presence'],
    confidenceEffect: 'contradict',
    decisionConsumers: ['trust'],
    rationale: {
      why: 'A knowledge-graph-present entity that AI answers rarely cite is a genuine answer-engine-optimisation gap — the brand exists but is not being retrieved.',
      combines: 'entity KG presence + AI answer presence',
      consumers: 'Trust intelligence',
      prevents: 'Assuming that entity presence guarantees AI visibility, and missing a real AEO gap.',
    },
    evaluate: (v) => {
      const gap = v.knowledge_graph_presence >= 1 && v.ai_answer_presence < 0.2;
      const strength = gap ? clamp01((0.2 - v.ai_answer_presence) / 0.2) : 0;
      return gap
        ? { relationshipType: 'contradiction', strength, explanation: `Entity is knowledge-graph present but AI answers rarely cite it (${(v.ai_answer_presence * 100).toFixed(0)}%) — an AEO retrieval gap.`, reasonCode: 'CORR_ENTITY_AI_GAP', supporting: ['knowledge_graph_presence'], contradictions: ['ai_answer_presence'], dependencies: [] }
        : { relationshipType: 'agreement', strength: 0, explanation: 'No entity-vs-AI retrieval gap at measured levels.', reasonCode: 'CORR_ENTITY_AI_NO_GAP', supporting: ['knowledge_graph_presence', 'ai_answer_presence'], contradictions: [], dependencies: [] };
    },
  },
  {
    id: 'reviews_brand_support',
    description: 'Review corpus supporting brand trust — strong vs thin base.',
    participatingMeasurements: ['review_count', 'avg_rating'],
    requiredMeasurements: ['review_count', 'avg_rating'],
    confidenceEffect: 'support',
    decisionConsumers: ['trust', 'brandTrust'],
    rationale: {
      why: 'A high rating only supports brand trust when it rests on a sufficient review base. High rating + few reviews is weak support; high rating + many reviews is strong support.',
      combines: 'review count + average rating',
      consumers: 'Trust + Brand-trust intelligence',
      prevents: 'Overstating brand trust from a high average rating that rests on a handful of reviews.',
    },
    evaluate: (v) => {
      const strong = v.avg_rating >= 4 && v.review_count >= 50;
      const weak = v.avg_rating >= 4 && v.review_count < 10;
      if (strong) return { relationshipType: 'strong_support', strength: clamp01(Math.min(1, v.review_count / 200)), explanation: `Rating ${v.avg_rating.toFixed(1)} on ${v.review_count} reviews — a robust trust base.`, reasonCode: 'CORR_REVIEWS_STRONG_SUPPORT', supporting: ['review_count', 'avg_rating'], contradictions: [], dependencies: [] };
      if (weak) return { relationshipType: 'weak_support', strength: clamp01(v.review_count / 10), explanation: `Rating ${v.avg_rating.toFixed(1)} on only ${v.review_count} reviews — a thin trust base.`, reasonCode: 'CORR_REVIEWS_WEAK_SUPPORT', supporting: ['avg_rating'], contradictions: ['review_count'], dependencies: [] };
      return { relationshipType: 'agreement', strength: 0, explanation: 'Review base and rating are consistent.', reasonCode: 'CORR_REVIEWS_OK', supporting: ['review_count', 'avg_rating'], contradictions: [], dependencies: [] };
    },
  },
  {
    id: 'backlinks_search_reinforcement',
    description: 'Referring-domain authority reinforcing organic search reach.',
    participatingMeasurements: ['referring_domains', 'impressions'],
    requiredMeasurements: ['referring_domains', 'impressions'],
    confidenceEffect: 'reinforce',
    decisionConsumers: ['authority', 'seo'],
    rationale: {
      why: 'Referring-domain breadth and organic impressions move together; when both are strong they reinforce an authority-driven growth story, when both are weak they agree the constraint is authority/backlinks — not content.',
      combines: 'backlink referring domains + search impressions',
      consumers: 'Authority + SEO intelligence',
      prevents: 'Attributing weak organic reach to content quality when the correlated evidence points to an authority/backlink gap.',
    },
    evaluate: (v) => {
      const reinforce = v.referring_domains >= 50 && v.impressions >= 1000;
      const bothWeak = v.referring_domains < 20 && v.impressions < 500;
      if (reinforce) return { relationshipType: 'reinforcement', strength: clamp01(Math.min(1, v.referring_domains / 200)), explanation: `Strong referring domains (${v.referring_domains}) and organic impressions (${v.impressions}) reinforce authority-driven reach.`, reasonCode: 'CORR_BACKLINKS_SEARCH_REINFORCEMENT', supporting: ['referring_domains', 'impressions'], contradictions: [], dependencies: [] };
      if (bothWeak) return { relationshipType: 'agreement', strength: clamp01(1 - v.referring_domains / 20), explanation: `Weak referring domains (${v.referring_domains}) and low impressions (${v.impressions}) agree the constraint is authority, not content.`, reasonCode: 'CORR_BACKLINKS_SEARCH_BOTH_WEAK', supporting: ['referring_domains', 'impressions'], contradictions: [], dependencies: ['referring_domains'] };
      return { relationshipType: 'weak_support', strength: 0, explanation: 'Backlinks and organic reach do not strongly correlate at measured levels.', reasonCode: 'CORR_BACKLINKS_SEARCH_WEAK', supporting: ['referring_domains', 'impressions'], contradictions: [], dependencies: [] };
    },
  },
];

/** All rules that a given decision engine consumes. */
export function rulesForConsumer(consumer: string): CorrelationRule[] {
  return CORRELATION_RULES.filter((r) => r.decisionConsumers.includes(consumer));
}
