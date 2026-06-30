/**
 * Revenue Operations (RevOps) domain scoring (Phase 29). Measures how EFFICIENTLY the
 * revenue engine operates (handoffs, qualification, pipeline/conversion/revenue efficiency,
 * forecast reliability, leakage, bottlenecks) — not pipeline size (that's Commercial). Pure,
 * deterministic, evidence-backed. Composes EXISTING reads (journey, attribution aggregation,
 * cohort funnel, conversion prediction, lead stats). Owns NO generic intelligence. No LLM.
 * Unknown stays Unknown — velocity / sales-cycle have no per-stage timestamps, so not-available.
 */
import type { PluginModule } from '../platformIntelligence/registry';
import type { RawRecommendationInput } from '../platformIntelligence/recommendations';

export interface RevOpsInputs {
  journey: any | null;       // customerJourneyRepository.getCustomerJourneyIntelligence
  attribution: any | null;   // attributionRepository.getAttributionAggregation
  cohort: any | null;        // cohortFunnelRepository.getCohortFunnelIntelligence
  conversion: any | null;    // conversionPredictionRepository.getMarketingConversionPrediction
  leadStats: any | null;     // leadIntelligenceReadService.getLeadStats
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const statusFromScore = (s: number | null): PluginModule['status'] => (s == null ? 'unavailable' : s >= 75 ? 'ready' : 'partial');

export interface RevOpsResult {
  modules: PluginModule[];
  recommendationInputs: RawRecommendationInput[];
  score: number;
  lastUpdated: string | null;
  maturityLevel: number;
}

export function scoreRevenueOperations(inputs: RevOpsInputs): RevOpsResult {
  const { journey, attribution, cohort, conversion, leadStats } = inputs;
  const total = Number(leadStats?.total ?? 0);
  const qualified = Number(leadStats?.intentBands?.high ?? 0);
  const attrLeads = Number(attribution?.totals?.leads ?? 0);
  const sessionLinkage = attrLeads > 0 ? Number(attribution?.totals?.leadsWithSession ?? 0) / attrLeads : null;
  const attrComplete = attrLeads > 0 ? Number(attribution?.totals?.leadsWithAttribution ?? 0) / attrLeads : null;
  const breakRate = Number(journey?.attributionBreakRate ?? cohort?.attributionBreakRate ?? 0); // 0..1
  let opp = 0, won = 0;
  for (const c of (cohort?.cohorts ?? [])) for (const st of (c.stages ?? [])) { if (st.stage === 'opportunity') opp += Number(st.count ?? 0); if (st.stage === 'closed_won') won += Number(st.count ?? 0); }
  const revenueUsd = Number(cohort?.totalRevenueUsd ?? 0);
  const dist = conversion?.distribution ?? null;
  const totalPred = dist ? dist.high + dist.medium + dist.low + dist.cold : 0;
  const forecastReliability = totalPred > 0 ? clamp(Math.min(100, totalPred * 2) * 0.5 + (dist.high + dist.medium) / totalPred * 50) : null;
  const bottleneck = (cohort?.cohorts ?? []).map((c: any) => c.bottleneckStage).find(Boolean) ?? journey?.bottleneck ?? null;
  const lastUpdated = attribution?.generatedAt ?? cohort?.generatedAt ?? journey?.generatedAt ?? null;

  const M: PluginModule[] = [];
  const add = (key: string, label: string, score: number | null, source: string, findings: string[]) =>
    M.push({ key, label, source, score, status: statusFromScore(score), available: score != null, findings: findings.slice(0, 3), lastUpdated });

  add('marketing_sales_handoff', 'Marketing → Sales Handoff', sessionLinkage != null ? clamp(sessionLinkage * 100) : null, 'attributionRepository', sessionLinkage != null ? [`${Math.round(sessionLinkage * 100)}% leads session-linked at handoff`] : ['No attribution data — Unknown']);
  add('lead_qualification_quality', 'Lead Qualification Quality', total > 0 ? clamp((qualified / total) * 100) : null, 'leadIntelligence', total > 0 ? [`${qualified}/${total} high-intent qualified`] : ['No leads — Unknown']);
  add('pipeline_efficiency', 'Pipeline Efficiency', (opp > 0 || won > 0) ? clamp((opp > 0 ? (won / opp) * 60 : 0) + (total > 0 ? (opp / total) * 40 : 0)) : (total > 0 ? 30 : null), 'cohortFunnelRepository', (opp > 0 || won > 0) ? [`${opp} opps, ${won} won`] : ['No opportunity lineage — partial']);
  add('conversion_efficiency', 'Conversion Efficiency', total > 0 ? clamp((qualified / total) * 100) : null, 'leadIntelligence', total > 0 ? [`Lead → qualified ${Math.round((qualified / total) * 100)}%`] : ['Unknown']);
  add('revenue_efficiency', 'Revenue Efficiency', revenueUsd > 0 && total > 0 ? clamp(Math.min(100, (revenueUsd / total) / 50)) : null, 'cohortFunnelRepository', revenueUsd > 0 ? [`$${Math.round(revenueUsd / Math.max(1, total))} revenue/lead`] : ['No revenue lineage — Unknown']);
  add('forecast_reliability', 'Forecast Reliability', forecastReliability, 'conversionPredictionRepository', forecastReliability != null ? [`${totalPred} predictions`] : ['No prediction sample — Unknown']);
  add('revenue_leakage', 'Revenue Leakage (inverse)', (attrLeads > 0 || journey != null) ? clamp(100 - breakRate * 100) : null, 'customerJourneyRepository', [`Attribution-break / leakage ${(breakRate * 100).toFixed(0)}%`]);
  add('operational_bottlenecks', 'Operational Bottlenecks', bottleneck ? 50 : (cohort != null ? 85 : null), 'cohortFunnelRepository', bottleneck ? [`Bottleneck at: ${bottleneck}`] : (cohort != null ? ['No single bottleneck detected'] : ['Unknown']));
  add('operational_risk', 'Operational Risk (inverse)', (attrLeads > 0 || total > 0) ? clamp(100 - breakRate * 100 * 0.5 - (total > 0 && qualified / total < 0.2 ? 30 : 0)) : null, 'derived', ['Leakage + low-qualification risk']);
  add('sales_velocity', 'Sales Velocity', null, 'revenueOperations', ['Unknown — no per-stage timestamps']);

  const evidenced = M.map((m) => m.score).filter((s): s is number => s != null);
  const revopsHealth = evidenced.length ? clamp(evidenced.reduce((a, b) => a + b, 0) / evidenced.length) : null;
  add('revops_health', 'Revenue Operations Health', revopsHealth, 'revenueOperations', evidenced.length ? [`Composite of ${evidenced.length} efficiency signals`] : ['Insufficient evidence — Unknown']);

  const signals = [attrLeads > 0, total > 0, opp > 0 || won > 0, totalPred > 0].filter(Boolean).length;
  const maturityLevel = signals >= 4 ? 4 : signals >= 3 ? 3 : signals >= 2 ? 2 : 1;
  add('operational_maturity', 'Operational Maturity', maturityLevel * 20, 'revenueOperations', [`Level ${maturityLevel}/5 (${signals}/4 RevOps signals; velocity/cycle not instrumented)`]);

  const recInputs: RawRecommendationInput[] = [];
  const rec = (key: string, text: string, module: string, impactLevel: 'high' | 'medium' | 'low', confidence: number) => recInputs.push({ key, text, source: 'revenueOperations', module, impactLevel, confidence });
  if (sessionLinkage != null && sessionLinkage < 0.5) rec('improve_handoff', 'Strengthen the marketing → sales handoff (link sessions to leads).', 'marketing_sales_handoff', 'high', 0.8);
  if (total > 0 && qualified / total < 0.2) rec('improve_qualification', 'Improve lead qualification to raise conversion efficiency.', 'conversion_efficiency', 'medium', 0.8);
  if (breakRate > 0.3) rec('fix_revenue_leakage', 'Fix attribution breaks to stop revenue leakage.', 'revenue_leakage', 'high', 0.8);
  if (bottleneck) rec('resolve_bottleneck', `Resolve the operational bottleneck at ${bottleneck}.`, 'operational_bottlenecks', 'high', 0.8);
  if (forecastReliability == null || forecastReliability < 50) rec('improve_forecast_reliability', 'Increase pipeline volume to improve forecast reliability.', 'forecast_reliability', 'medium', 0.75);
  if (revenueUsd === 0) rec('instrument_revenue_efficiency', 'Instrument revenue lineage to measure revenue efficiency per lead.', 'revenue_efficiency', 'medium', 0.7);
  rec('instrument_sales_velocity', 'Instrument per-stage timestamps to measure sales velocity and cycle time.', 'sales_velocity', 'medium', 0.7);

  const score = revopsHealth ?? 0;
  return { modules: M, recommendationInputs: recInputs, score, lastUpdated, maturityLevel };
}
