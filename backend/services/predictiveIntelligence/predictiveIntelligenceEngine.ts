/**
 * Predictive Intelligence domain scoring (Phase 36). Deterministic, evidence-derived forecast
 * — NO AI, NO LLM, NO fabrication. The only genuine forward-looking evidence is the
 * conversion-prediction tier distribution (a deterministic heuristic); growth/lead/cohort/
 * readiness give current-state outlook proxies. TREND / MOMENTUM / DIRECTION / STABILITY
 * require historical snapshots that are NOT persisted per company, so they remain Unknown.
 * Each module's forecast value is explained in findings (PluginModule carries no forecast field).
 */
import type { PluginModule } from '../platformIntelligence/registry';
import type { RawRecommendationInput } from '../platformIntelligence/recommendations';

export interface PredictiveInputs {
  conversion: any | null; // conversionPredictionRepository.getMarketingConversionPrediction
  growth: any | null;     // growthIntelligenceService.getGrowthIntelligenceSummary
  cohort: any | null;     // cohortFunnelRepository.getCohortFunnelIntelligence
  leadStats: any | null;  // leadIntelligenceReadService.getLeadStats
  readiness: any | null;  // activationReadinessService.buildActivationReadiness
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const statusFromScore = (s: number | null): PluginModule['status'] => (s == null ? 'unavailable' : s >= 75 ? 'ready' : 'partial');

export interface PredictiveResult {
  modules: PluginModule[];
  recommendationInputs: RawRecommendationInput[];
  score: number;
  lastUpdated: string | null;
  maturityLevel: number;
}

export function scorePredictiveIntelligence(inputs: PredictiveInputs): PredictiveResult {
  const { conversion, growth, cohort, leadStats, readiness } = inputs;
  const dist = conversion?.distribution ?? null;
  const totalPred = dist ? dist.high + dist.medium + dist.low + dist.cold : 0;
  const hasPred = totalPred > 0;
  const growthScore = typeof growth?.growthScore === 'number' ? growth.growthScore : null;
  const checks: any[] = readiness?.checks ?? [];
  const readinessRate = checks.length ? clamp((checks.filter((c) => c.done).length / checks.length) * 100) : null;
  const revenue = Number(cohort?.totalRevenueUsd ?? 0);
  const campaigns = Number(growth?.opportunities?.campaignsFromOpportunities ?? 0);
  const lastUpdated = conversion?.generatedAt ?? cohort?.generatedAt ?? readiness?.generatedAt ?? null;

  const M: PluginModule[] = [];
  const add = (key: string, label: string, score: number | null, source: string, findings: string[]) =>
    M.push({ key, label, source, score, status: statusFromScore(score), available: score != null, findings: findings.slice(0, 3), lastUpdated });

  // --- Evidenced forward-looking forecasts (from the deterministic conversion prediction) ---
  add('conversion_forecast', 'Conversion Forecast', hasPred ? clamp((dist.high * 0.8 + dist.medium * 0.4 + dist.low * 0.1) / totalPred * 100) : null, 'conversionPredictionRepository', hasPred ? [`Projected conversion ~${clamp((dist.high * 0.8 + dist.medium * 0.4 + dist.low * 0.1) / totalPred * 100)}% (forecast)`, `${dist.high} high / ${dist.medium} medium of ${totalPred}`] : ['No prediction sample — Unknown']);
  add('qualified_lead_forecast', 'Qualified Lead Forecast', hasPred ? clamp(Math.min(100, dist.high * 10)) : null, 'conversionPredictionRepository', hasPred ? [`~${dist.high} leads forecast to qualify`] : ['Unknown']);
  add('pipeline_forecast', 'Pipeline Forecast', hasPred ? clamp(Math.min(100, (dist.high + dist.medium) * 6)) : null, 'conversionPredictionRepository', hasPred ? [`~${dist.high + dist.medium} leads forecast to enter pipeline`] : ['Unknown']);
  add('forecast_confidence', 'Forecast Confidence', hasPred ? clamp(Math.min(100, totalPred * 3)) : null, 'conversionPredictionRepository', hasPred ? [`Sample of ${totalPred} predictions`] : ['Unknown']);
  add('revenue_confidence', 'Revenue Confidence', (hasPred || revenue > 0) ? clamp((hasPred ? 40 : 0) + (revenue > 0 ? 40 : 0) + (growthScore != null ? 20 : 0)) : null, 'derived', [revenue > 0 ? `$${revenue.toFixed(0)} revenue lineage` : 'No revenue lineage', hasPred ? 'Forecast sample present' : 'No forecast sample']);

  // --- Current-state outlook proxies (explicitly proxies, not historical trend) ---
  add('marketing_outlook', 'Marketing Outlook', growthScore, 'growthIntelligenceService', growthScore != null ? [`Current growth health ${growthScore}/100 as outlook (no historical trend)`] : ['Unknown']);
  add('campaign_outlook', 'Campaign Outlook', growth ? clamp(Math.min(100, campaigns * 20)) : null, 'growthIntelligenceService', growth ? [`${campaigns} active campaigns`] : ['Unknown']);
  add('readiness_outlook', 'Readiness Outlook', readinessRate, 'activationReadinessService', readinessRate != null ? [`${readinessRate}% activation complete`] : ['Unknown']);

  // --- Honest Unknowns — require persisted historical snapshots / time-series (not captured) ---
  for (const [k, l] of [
    ['business_direction', 'Business Direction'], ['growth_direction', 'Growth Direction'], ['lead_forecast', 'Lead Volume Forecast'],
    ['website_trend', 'Website Trend'], ['business_momentum', 'Business Momentum'], ['growth_momentum', 'Growth Momentum'],
    ['operational_momentum', 'Operational Momentum'], ['business_stability', 'Business Stability'], ['growth_stability', 'Growth Stability'],
    ['execution_stability', 'Execution Stability'], ['execution_outlook', 'Execution Outlook'], ['risk_forecast', 'Risk Forecast'], ['opportunity_forecast', 'Opportunity Forecast'],
  ] as const) {
    add(k, l, null, 'predictiveIntelligence', ['Unknown — requires persisted historical snapshots / time-series']);
  }

  const evidenced = M.map((m) => m.score).filter((s): s is number => s != null);
  const predictiveHealth = evidenced.length ? clamp(evidenced.reduce((a, b) => a + b, 0) / evidenced.length) : null;
  add('predictive_health', 'Predictive Health', predictiveHealth, 'predictiveIntelligence', evidenced.length ? [`Composite of ${evidenced.length} evidenced forecast signals`] : ['Insufficient evidence — Unknown']);

  // Maturity capped at 3 — trend/momentum forecasting is uninstrumented (no time-series).
  const signals = [hasPred, growthScore != null, revenue > 0, readinessRate != null].filter(Boolean).length;
  const maturityLevel = signals >= 4 ? 3 : signals >= 2 ? 2 : 1;
  add('predictive_maturity', 'Predictive Maturity', maturityLevel * 20, 'predictiveIntelligence', [`Level ${maturityLevel}/5 (no historical time-series → trend/momentum not forecastable)`]);

  const recInputs: RawRecommendationInput[] = [];
  const rec = (key: string, text: string, module: string, impactLevel: 'high' | 'medium' | 'low', confidence: number) => recInputs.push({ key, text, source: 'predictiveIntelligence', module, impactLevel, confidence });
  rec('instrument_historical_snapshots', 'Persist periodic intelligence snapshots to unlock trend, momentum and direction forecasting.', 'business_momentum', 'high', 0.8);
  if (!hasPred) rec('increase_prediction_sample', 'Grow lead volume to produce a conversion-prediction sample for forecasting.', 'forecast_confidence', 'medium', 0.75);
  if (hasPred && (dist.high + dist.medium) / totalPred < 0.3) rec('improve_conversion_outlook', 'Improve lead quality to lift the conversion forecast.', 'conversion_forecast', 'medium', 0.8);
  if (hasPred && (dist.high + dist.medium) * 6 < 50) rec('build_pipeline_for_forecast', 'Build pipeline volume to strengthen the pipeline forecast.', 'pipeline_forecast', 'medium', 0.75);

  const score = predictiveHealth ?? 0;
  return { modules: M, recommendationInputs: recInputs, score, lastUpdated, maturityLevel };
}
