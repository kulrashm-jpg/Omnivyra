/**
 * Business Rule Registry  (BETA-ENGINE-012, Phase 3)
 *
 * The canonical registry of deterministic business-impact rules — NO engine-specific prioritization, NO
 * invented revenue. Every rule is keyed to a Root Cause / Execution Plan and declares its business, impact,
 * opportunity, dependency, and ROI-classification logic. The ROI classifier is honest by construction: it
 * returns `measured` only with revenue evidence (never available today), `estimated` only when a
 * deterministic native-unit opportunity exists, else `not_determinable`.
 */
import type { ROIAssessment } from './businessImpactModel';

/** Documented deterministic benchmark used ONLY to size a native-unit opportunity (not revenue). */
export const ACHIEVABLE_CTR_BENCHMARK = 0.05; // 5% — a conservative, documented achievable CTR target.
export const ROBUST_REVIEW_BASE = 50; // reviews considered a robust trust base (matches the correlation rule).

export interface BusinessRuleContext {
  /** Measured evidence values by canonical key (only what is genuinely present). */
  values: Record<string, number>;
  /** BETA-PROVIDER-008: authenticated commercial-outcome values (revenue_per_conversion, conversion_rate,
   *  revenue, …) — present ONLY when the commercial provider supplied them. Enables MEASURED ROI. */
  commercial: Record<string, number>;
}

/** Commercial-evidence keys the ROI classifier consults to upgrade to MEASURED (from the commercial + GA4
 *  providers). Presence is what turns Not-Determinable/Estimated into Measured — never an assumption. */
export const COMMERCIAL_CONTEXT_KEYS = [
  'revenue_per_conversion', 'conversion_rate', 'revenue', 'conversions', 'conversion_value',
  'avg_order_value', 'lead_to_customer_rate', 'pipeline_value', 'customer_lifetime_value',
] as const;

export interface BusinessRule {
  id: string;
  title: string;
  supportedRootCauses: string[];
  /** Execution-plan ruleIds this business rule prioritizes. */
  supportedPlans: string[];
  requiredEvidence: string[];
  decisionConsumers: string[];
  // Static deterministic dimension inputs (0..100); combined with live severity/confidence in the engine.
  businessImpact: number;
  technicalImpact: number;
  customerImpact: number;
  executionCost: number;
  executionComplexity: number;
  riskReduction: number;
  dependencyUnlock: number;
  timeSensitivity: number;
  rationale: { rootCause: string; requires: string; opportunity: string; prioritizesPlan: string; prevents: string; roi: string };
  /** Deterministic opportunity size 0..100 (from severity + a native-unit quantity where computable). */
  opportunity: (ctx: BusinessRuleContext, severity: number) => number;
  /** Honest ROI classification — never fabricates revenue. */
  roi: (ctx: BusinessRuleContext) => ROIAssessment;
}

const clamp100 = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
const notDeterminable = (basis: string): ROIAssessment => ({ status: 'not_determinable', basis, quantified: null });

export const BUSINESS_RULES: BusinessRule[] = [
  {
    id: 'biz_authority_deficit',
    title: 'Authority Deficit — unlock durable organic growth',
    supportedRootCauses: ['authority_deficit'], supportedPlans: ['rec_close_authority_gap'],
    requiredEvidence: ['domain_authority', 'avg_position'],
    decisionConsumers: ['authority', 'seo'],
    businessImpact: 85, technicalImpact: 55, customerImpact: 40, executionCost: 75, executionComplexity: 70,
    riskReduction: 40, dependencyUnlock: 90, timeSensitivity: 55,
    rationale: {
      rootCause: 'authority_deficit', requires: 'domain_authority + avg_position',
      opportunity: 'Recoverable ranking positions gated by authority — a large, durable growth lever.',
      prioritizesPlan: 'rec_close_authority_gap', prevents: 'Prioritising cheap on-page tactics over the blocking authority investment that actually unlocks growth.',
      roi: 'not_determinable — no revenue-per-position evidence exists; the position gap is real but its revenue value cannot be computed without conversion-value data.',
    },
    opportunity: (ctx, severity) => clamp100(severity * 0.6 + (ctx.values.avg_position > 10 ? Math.min(40, (ctx.values.avg_position - 10) * 2) : 0)),
    roi: () => notDeterminable('No revenue-per-position / conversion-value evidence. Position recovery is real but non-monetisable deterministically.'),
  },
  {
    id: 'biz_search_snippet',
    title: 'Snippet Quality — capture clicks already within reach',
    supportedRootCauses: ['search_snippet_quality'], supportedPlans: ['rec_fix_search_snippet'],
    requiredEvidence: ['impressions', 'ctr'],
    decisionConsumers: ['seo'],
    businessImpact: 70, technicalImpact: 40, customerImpact: 55, executionCost: 30, executionComplexity: 25,
    riskReduction: 20, dependencyUnlock: 20, timeSensitivity: 70,
    rationale: {
      rootCause: 'search_snippet_quality', requires: 'impressions + ctr',
      opportunity: 'Additional clicks = impressions × (achievable CTR benchmark − current CTR) — a deterministic native-unit opportunity from measured evidence.',
      prioritizesPlan: 'rec_fix_search_snippet', prevents: 'Under-prioritising a high-value, low-cost click-capture win in favour of expensive visibility work.',
      roi: 'estimated — the opportunity is quantifiable in CLICKS (not revenue) from measured impressions + CTR vs a documented achievable-CTR benchmark; revenue remains not determinable.',
    },
    opportunity: (ctx, severity) => {
      const gap = Math.max(0, ACHIEVABLE_CTR_BENCHMARK - (ctx.values.ctr ?? ACHIEVABLE_CTR_BENCHMARK));
      const addlClicks = (ctx.values.impressions ?? 0) * gap;
      // Size 0..100: blend severity with a log-scaled click volume (deterministic, bounded).
      const volumeScore = addlClicks > 0 ? Math.min(60, Math.log10(addlClicks + 1) * 20) : 0;
      return clamp100(severity * 0.4 + volumeScore);
    },
    roi: (ctx) => {
      const gap = Math.max(0, ACHIEVABLE_CTR_BENCHMARK - (ctx.values.ctr ?? ACHIEVABLE_CTR_BENCHMARK));
      const addlClicks = Math.round((ctx.values.impressions ?? 0) * gap);
      if (addlClicks <= 0) return notDeterminable('CTR already at/above the achievable benchmark — no additional-click opportunity.');
      // BETA-PROVIDER-008: with authenticated commercial evidence (measured conversion_rate +
      // revenue_per_conversion) the additional clicks convert deterministically to MEASURED revenue —
      // upgrading ROI from Estimated (clicks) to Measured (revenue). No estimate, no forecast: every factor
      // is measured. Without commercial evidence this stays Estimated in clicks (the honest fallback).
      const cvr = ctx.commercial.conversion_rate;
      const rpc = ctx.commercial.revenue_per_conversion;
      if (cvr != null && cvr > 0 && rpc != null && rpc > 0) {
        const measuredRevenue = Math.round(addlClicks * cvr * rpc * 100) / 100;
        return {
          status: 'measured',
          basis: `Measured revenue = additional_clicks(${addlClicks}) × conversion_rate(${cvr}) × revenue_per_conversion(${rpc}) — every factor authenticated (search evidence + commercial provider).`,
          quantified: { value: measuredRevenue, unit: 'revenue_per_period' },
        };
      }
      return {
        status: 'estimated',
        basis: `Estimated additional clicks = impressions(${ctx.values.impressions}) × (benchmark ${ACHIEVABLE_CTR_BENCHMARK} − ctr ${ctx.values.ctr}). Clicks only — revenue not determinable without commercial (conversion_rate + revenue_per_conversion) evidence.`,
        quantified: { value: addlClicks, unit: 'additional_clicks_per_period' },
      };
    },
  },
  {
    id: 'biz_ai_gap',
    title: 'AI Optimization Gap — capture answer-engine visibility',
    supportedRootCauses: ['ai_optimization_gap'], supportedPlans: ['rec_close_ai_gap'],
    requiredEvidence: ['knowledge_graph_presence', 'ai_answer_presence'],
    decisionConsumers: ['trust', 'authority'],
    businessImpact: 75, technicalImpact: 50, customerImpact: 60, executionCost: 55, executionComplexity: 55,
    riskReduction: 30, dependencyUnlock: 45, timeSensitivity: 75,
    rationale: {
      rootCause: 'ai_optimization_gap', requires: 'knowledge_graph_presence + ai_answer_presence',
      opportunity: 'Recoverable AI answer-presence for a recognised entity — a strategically time-sensitive visibility lever.',
      prioritizesPlan: 'rec_close_ai_gap', prevents: 'Treating AI visibility as low priority when the brand is a recognised entity being left out of answers.',
      roi: 'not_determinable — no measured attribution from AI citations to revenue exists; the presence gap is real but non-monetisable deterministically.',
    },
    opportunity: (ctx, severity) => clamp100(severity * 0.6 + Math.max(0, (0.5 - (ctx.values.ai_answer_presence ?? 0.5)) * 80)),
    roi: () => notDeterminable('No AI-citation → revenue attribution evidence. Answer-presence recovery is real but non-monetisable deterministically.'),
  },
  {
    id: 'biz_thin_trust',
    title: 'Thin Trust Base — harden brand trust',
    supportedRootCauses: ['thin_trust_base'], supportedPlans: ['rec_grow_review_base'],
    requiredEvidence: ['review_count', 'avg_rating'],
    decisionConsumers: ['trust', 'brandTrust'],
    businessImpact: 60, technicalImpact: 20, customerImpact: 70, executionCost: 35, executionComplexity: 25,
    riskReduction: 45, dependencyUnlock: 25, timeSensitivity: 50,
    rationale: {
      rootCause: 'thin_trust_base', requires: 'review_count + avg_rating',
      opportunity: 'Reviews needed to reach a robust trust base = max(0, robust_base − review_count) — a deterministic native-unit opportunity.',
      prioritizesPlan: 'rec_grow_review_base', prevents: 'Reporting trust as strong and under-investing in a thin review base that fails under scrutiny.',
      roi: 'estimated — the opportunity is quantifiable in REVIEWS to a robust base (not revenue) from measured review_count; revenue remains not determinable.',
    },
    opportunity: (ctx, severity) => {
      const needed = Math.max(0, ROBUST_REVIEW_BASE - (ctx.values.review_count ?? ROBUST_REVIEW_BASE));
      return clamp100(severity * 0.5 + Math.min(50, needed));
    },
    roi: (ctx) => {
      const needed = Math.round(Math.max(0, ROBUST_REVIEW_BASE - (ctx.values.review_count ?? ROBUST_REVIEW_BASE)));
      if (needed <= 0) return notDeterminable('Review base already robust — no additional-review opportunity.');
      return { status: 'estimated', basis: `Estimated reviews to a robust base = robust(${ROBUST_REVIEW_BASE}) − review_count(${ctx.values.review_count}). Reviews only — revenue is not determinable.`, quantified: { value: needed, unit: 'additional_reviews_to_robust_base' } };
    },
  },
  {
    id: 'biz_entity_strength',
    title: 'Entity/AI Strength — sustain, do not invest',
    supportedRootCauses: ['entity_authority_strength'], supportedPlans: ['rec_monitor_entity_strength'],
    requiredEvidence: ['knowledge_graph_presence', 'ai_answer_presence'],
    decisionConsumers: ['authority', 'trust'],
    businessImpact: 15, technicalImpact: 10, customerImpact: 15, executionCost: 10, executionComplexity: 10,
    riskReduction: 10, dependencyUnlock: 5, timeSensitivity: 15,
    rationale: {
      rootCause: 'entity_authority_strength', requires: 'knowledge_graph_presence + ai_answer_presence',
      opportunity: 'No new opportunity — this is a strength to sustain; effort is better spent on genuine gaps.',
      prioritizesPlan: 'rec_monitor_entity_strength', prevents: 'Spending budget on an area the evidence confirms is already strong.',
      roi: 'not_determinable — a monitoring action has no revenue opportunity to quantify.',
    },
    opportunity: () => 5,
    roi: () => notDeterminable('Monitoring a strength — no opportunity to quantify.'),
  },
  {
    id: 'biz_conflicting_signals',
    title: 'Conflicting Signals — re-validate before spend',
    supportedRootCauses: ['conflicting_entity_signals'], supportedPlans: ['rec_revalidate_entity_signals'],
    requiredEvidence: ['knowledge_graph_presence', 'ai_answer_presence'],
    decisionConsumers: ['trust', 'authority'],
    businessImpact: 25, technicalImpact: 20, customerImpact: 15, executionCost: 15, executionComplexity: 15,
    riskReduction: 60, dependencyUnlock: 20, timeSensitivity: 40,
    rationale: {
      rootCause: 'conflicting_entity_signals', requires: 'knowledge_graph_presence + ai_answer_presence',
      opportunity: 'The opportunity is risk reduction — a clean diagnosis before committing spend.',
      prioritizesPlan: 'rec_revalidate_entity_signals', prevents: 'Committing budget on a contradictory diagnosis (high risk of wasted spend).',
      roi: 'not_determinable — the value is avoided-waste (risk reduction), not a positive revenue opportunity.',
    },
    opportunity: () => 15,
    roi: () => notDeterminable('Re-validation reduces risk of mis-spend; there is no positive revenue opportunity to quantify.'),
  },
];

export function businessRulesForPlan(planRuleId: string): BusinessRule[] {
  return BUSINESS_RULES.filter((r) => r.supportedPlans.includes(planRuleId));
}
