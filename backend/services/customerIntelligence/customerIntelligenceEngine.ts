/**
 * Customer Intelligence domain scoring (Phase 28). Post-conversion — begins where Lead
 * Intelligence ends. Pure, deterministic, evidence-backed. Composes EXISTING reads (cohort
 * funnel closed-won + attributed revenue; community sentiment for advocacy). Owns NO generic
 * intelligence (executive summary, business impact, recommendations merge, roadmap,
 * confidence, freshness, presentation, renderers belong to Platform Intelligence). No LLM.
 * Unknown stays Unknown — retention/renewal/expansion/adoption/LTV/NPS are reported
 * not-available because that data is not captured anywhere in the repo (never fabricated).
 */
import type { PluginModule } from '../platformIntelligence/registry';
import type { RawRecommendationInput } from '../platformIntelligence/recommendations';

export interface CustomerInputs {
  cohort: any | null; // cohortFunnelRepository.getCohortFunnelIntelligence (closed_won + revenue)
  community: { total: number; positive: number; negative: number; neutral: number } | null;
  lastUpdated: string | null;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const statusFromScore = (s: number | null): PluginModule['status'] => (s == null ? 'unavailable' : s >= 75 ? 'ready' : 'partial');

export interface CustomerResult {
  modules: PluginModule[];
  recommendationInputs: RawRecommendationInput[];
  score: number;
  lastUpdated: string | null;
  maturityLevel: number;
}

export function scoreCustomerIntelligence(inputs: CustomerInputs): CustomerResult {
  const { cohort, community, lastUpdated } = inputs;
  let won = 0;
  for (const c of (cohort?.cohorts ?? [])) for (const st of (c.stages ?? [])) if (st.stage === 'closed_won') won += Number(st.count ?? 0);
  const revenueUsd = Number(cohort?.totalRevenueUsd ?? 0);
  const hasCohort = cohort != null;
  const hasRevenue = revenueUsd > 0;
  const cTotal = Number(community?.total ?? 0);
  const positiveRate = cTotal > 0 ? (community!.positive / cTotal) : null;
  const negativeRate = cTotal > 0 ? (community!.negative / cTotal) : null;

  const M: PluginModule[] = [];
  const add = (key: string, label: string, score: number | null, source: string, findings: string[]) =>
    M.push({ key, label, source, score, status: statusFromScore(score), available: score != null, findings: findings.slice(0, 3), lastUpdated });

  // Evidenced where data exists; Unknown otherwise.
  add('customer_base', 'Customer Base', hasCohort ? (won > 0 ? clamp(Math.min(100, won * 10)) : 20) : null, 'cohortFunnelRepository', hasCohort ? [`${won} closed-won customers`] : ['No customer lineage — Unknown']);
  add('customer_revenue', 'Customer Revenue', hasRevenue ? clamp(50 + Math.min(50, revenueUsd / 1000)) : null, 'cohortFunnelRepository', hasRevenue ? [`$${revenueUsd.toFixed(0)} attributed revenue`] : ['No revenue lineage — Unknown']);
  add('advocacy', 'Advocacy', positiveRate != null ? clamp(positiveRate * 100) : null, 'community_ai_actions', positiveRate != null ? [`${community!.positive}/${cTotal} positive community signals`] : ['No community signals — Unknown']);
  add('relationship_strength', 'Relationship Strength', cTotal > 0 ? clamp(50 + ((community!.positive - community!.negative) / cTotal) * 50) : null, 'community_ai_actions', cTotal > 0 ? [`Net sentiment over ${cTotal} signals`] : ['Unknown']);
  add('customer_risk', 'Customer Risk (inverse)', negativeRate != null ? clamp(100 - negativeRate * 100) : null, 'community_ai_actions', negativeRate != null ? [`${(negativeRate * 100).toFixed(0)}% negative sentiment`] : ['Unknown']);
  add('retention_health', 'Retention Health', null, 'customerIntelligence', ['Unknown — no churn/renewal data captured']);
  add('renewal_readiness', 'Renewal Readiness', null, 'customerIntelligence', ['Unknown — no subscription/renewal data per customer']);
  add('expansion_readiness', 'Expansion Readiness', null, 'customerIntelligence', ['Unknown — no upsell/usage signal']);
  add('product_adoption', 'Product Adoption', null, 'customerIntelligence', ['Unknown — no per-customer usage data']);
  add('lifetime_value', 'Lifetime Value', null, 'customerIntelligence', ['Unknown — no per-customer revenue history']);

  // Customer success health = composite of evidenced modules.
  const evidenced = M.map((m) => m.score).filter((s): s is number => s != null);
  const successHealth = evidenced.length ? clamp(evidenced.reduce((a, b) => a + b, 0) / evidenced.length) : null;
  add('customer_success_health', 'Customer Success Health', successHealth, 'customerIntelligence', evidenced.length ? [`Composite of ${evidenced.length} evidenced signals`] : ['Insufficient evidence — Unknown']);

  const signals = [won > 0, hasRevenue, cTotal > 0].filter(Boolean).length;
  const maturityLevel = signals >= 3 ? 3 : signals >= 2 ? 2 : 1; // capped at 3 — most CS data uninstrumented
  add('customer_maturity', 'Customer Maturity', maturityLevel * 20, 'customerIntelligence', [`Level ${maturityLevel}/5 (${signals}/3 evidenced; renewals/usage/NPS not instrumented)`]);

  const recInputs: RawRecommendationInput[] = [];
  const rec = (key: string, text: string, module: string, impactLevel: 'high' | 'medium' | 'low', confidence: number) => recInputs.push({ key, text, source: 'customerIntelligence', module, impactLevel, confidence });
  if (!hasCohort || won === 0) rec('build_customer_base', 'Convert qualified pipeline into closed-won customers.', 'customer_base', 'high', 0.85);
  if (cTotal === 0) rec('instrument_advocacy', 'Capture community/advocacy signals to measure customer sentiment.', 'advocacy', 'medium', 0.75);
  if (negativeRate != null && negativeRate > 0.28) rec('address_customer_sentiment', 'Address negative customer sentiment to reduce churn risk.', 'customer_risk', 'high', 0.8);
  rec('instrument_retention', 'Instrument renewals/churn to measure retention health.', 'retention_health', 'medium', 0.7);
  rec('instrument_product_adoption', 'Instrument per-customer usage to measure product adoption.', 'product_adoption', 'medium', 0.7);
  rec('instrument_ltv', 'Instrument per-customer revenue history to compute LTV.', 'lifetime_value', 'medium', 0.7);

  const allScored = M.map((m) => m.score).filter((s): s is number => s != null);
  const score = allScored.length ? Math.round(allScored.reduce((a, b) => a + b, 0) / allScored.length) : 0;
  return { modules: M, recommendationInputs: recInputs, score, lastUpdated, maturityLevel };
}
