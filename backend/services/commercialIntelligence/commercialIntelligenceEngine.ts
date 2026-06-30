/**
 * Commercial / Revenue Intelligence domain scoring (Phase 23). Pure, deterministic,
 * evidence-backed. Composes EXISTING lead-intelligence repositories (cohort funnel,
 * conversion prediction, customer journey, attribution aggregation, lead stats) into
 * commercial modules + raw recommendation inputs. Owns NO generic intelligence (executive
 * summary, business impact, recommendations merge, roadmap, confidence, freshness,
 * presentation, renderers all belong to Platform Intelligence). No LLM. No ML forecast.
 * Unknown stays Unknown — unevidenced commercial signals are reported not-available.
 */
import type { PluginModule } from '../platformIntelligence/registry';
import type { RawRecommendationInput } from '../platformIntelligence/recommendations';

export interface CommercialInputs {
  cohort: any | null;        // cohortFunnelRepository.getCohortFunnelIntelligence
  conversion: any | null;    // conversionPredictionRepository.getMarketingConversionPrediction
  journey: any | null;       // customerJourneyRepository.getCustomerJourneyIntelligence
  attribution: any | null;   // attributionRepository.getAttributionAggregation
  leadStats: any | null;     // leadIntelligenceReadService.getLeadStats
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const statusFromScore = (s: number | null): PluginModule['status'] => (s == null ? 'unavailable' : s >= 75 ? 'ready' : 'partial');
const topKeys = (rec: Record<string, number> | undefined, n = 3): string[] =>
  Object.entries(rec ?? {}).filter(([k]) => k !== '(none)').sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}: ${v}`);

export interface CommercialResult {
  modules: PluginModule[];
  recommendationInputs: RawRecommendationInput[];
  score: number;
  lastUpdated: string | null;
  maturityLevel: number;
}

export function scoreCommercialIntelligence(inputs: CommercialInputs): CommercialResult {
  const { cohort, conversion, journey, attribution, leadStats } = inputs;
  const total = Number(leadStats?.total ?? 0);
  const qualified = Number(leadStats?.intentBands?.high ?? 0);
  const revenueUsd = Number(cohort?.totalRevenueUsd ?? 0);
  const lastUpdated = cohort?.generatedAt ?? attribution?.generatedAt ?? null;

  // Aggregate opportunity / closed-won counts from cohort funnel stages.
  let opportunities = 0, won = 0;
  for (const c of (cohort?.cohorts ?? [])) for (const st of (c.stages ?? [])) {
    if (st.stage === 'opportunity') opportunities += Number(st.count ?? 0);
    if (st.stage === 'closed_won') won += Number(st.count ?? 0);
  }
  const dist = conversion?.distribution ?? null;
  const totalPred = dist ? dist.high + dist.medium + dist.low + dist.cold : 0;
  const forecastQuality = totalPred > 0 ? clamp((dist.high * 100 + dist.medium * 60 + dist.low * 30) / totalPred) : null;
  const attrLeads = Number(attribution?.totals?.leads ?? 0);
  const attrComplete = attrLeads > 0 ? clamp((Number(attribution?.totals?.leadsWithAttribution ?? 0) / attrLeads) * 100) : null;
  const breakRate = Number(journey?.attributionBreakRate ?? cohort?.attributionBreakRate ?? 0); // 0..1
  const winRate = opportunities > 0 ? clamp((won / opportunities) * 100) : null;
  const hasRevenueLineage = revenueUsd > 0;

  const M: PluginModule[] = [];
  const add = (key: string, label: string, score: number | null, source: string, findings: string[]) =>
    M.push({ key, label, source, score, status: statusFromScore(score), available: score != null, findings: findings.slice(0, 3), lastUpdated });

  // --- Commercial health (Phase B) ---
  add('pipeline_health', 'Pipeline Health', total > 0 ? clamp(Math.min(100, total * 4) * 0.6 + (opportunities > 0 ? 40 : 0)) : 0, 'leadIntelligence', [`${total} leads`, `${opportunities} opportunities`]);
  add('revenue_health', 'Revenue Health', hasRevenueLineage ? clamp(50 + Math.min(50, revenueUsd / 1000)) : null, 'cohortFunnelRepository', hasRevenueLineage ? [`$${revenueUsd.toFixed(0)} attributed revenue`] : ['No revenue lineage — Unknown']);
  add('sales_health', 'Sales Health', winRate, 'cohortFunnelRepository', winRate != null ? [`${won}/${opportunities} won (${winRate}%)`] : ['No opportunities — Unknown']);
  add('forecast_health', 'Forecast Health', forecastQuality, 'conversionPredictionRepository', forecastQuality != null ? [`${dist.high} high / ${dist.medium} medium of ${totalPred} predicted`] : ['No prediction sample — Unknown']);
  add('commercial_readiness', 'Commercial Readiness', clamp((total > 0 ? 40 : 0) + (opportunities > 0 ? 30 : 0) + (hasRevenueLineage ? 30 : 0)), 'derived', [`Pipeline:${total > 0} Opps:${opportunities > 0} Revenue:${hasRevenueLineage}`]);
  add('revenue_confidence', 'Revenue Confidence', attrComplete, 'attributionRepository', attrComplete != null ? [`${attrComplete}% leads attributed`] : ['No attribution data — Unknown']);
  add('opportunity_quality', 'Opportunity Quality', totalPred > 0 ? clamp((dist.high / totalPred) * 100) : null, 'conversionPredictionRepository', totalPred > 0 ? [`${dist.high} high-tier of ${totalPred}`] : ['Unknown']);
  add('sales_capacity', 'Sales Capacity', null, 'commercialIntelligence', ['No rep/capacity data — Unknown']);
  add('revenue_risk', 'Revenue Risk (inverse)', clamp(100 - breakRate * 100), 'customerJourneyRepository', [`Attribution-break rate ${(breakRate * 100).toFixed(0)}%`]);

  // --- Revenue funnel (Phase C) — known stages scored; CRM stages Unknown ---
  add('funnel', 'Revenue Funnel', total > 0 ? clamp((qualified / total) * 100) : null, 'leadIntelligence', [
    `Lead ${total} → Qualified ${qualified}`, `Opportunity ${opportunities} → Won ${won}`,
    'SQL / Proposal / Negotiation / Expansion / Retention: Unknown (no CRM stage data)',
  ]);

  // --- Pipeline intelligence (Phase D) ---
  add('pipeline', 'Pipeline Intelligence', total > 0 ? clamp(Math.min(100, total * 4)) : 0, 'leadIntelligence', [
    `Size ${total} · opportunities ${opportunities}`, `Leakage (attribution break) ${(breakRate * 100).toFixed(0)}%`,
    'Coverage / velocity / aging / stalled: Unknown (no quota/stage timestamps)',
  ]);

  // --- Attribution intelligence (Phase E) — by channel/source/campaign (lead counts; $ Unknown) ---
  add('revenue_attribution', 'Revenue Attribution', attrComplete, 'attributionRepository', [
    `Top channels: ${topKeys(attribution?.channelBreakdown).join(', ') || 'Unknown'}`,
    `Top campaigns: ${topKeys(attribution?.campaignBreakdown).join(', ') || 'Unknown'}`,
    hasRevenueLineage ? `Attributed revenue $${revenueUsd.toFixed(0)}` : 'Revenue-by-channel: Unknown (no per-channel revenue lineage)',
  ]);

  // --- Forecast (Phase F) — confidence-backed; dollar forecast Unknown (no deal sizes) ---
  add('forecast', 'Forecast', forecastQuality, 'conversionPredictionRepository', forecastQuality != null ? [`Forecast confidence from ${totalPred} predictions`, 'Dollar forecast: Unknown (no deal-size evidence)'] : ['Unknown']);

  // --- Commercial maturity (Phase G) ---
  const signals = [total > 0, qualified > 0, opportunities > 0, hasRevenueLineage, attrComplete != null && attrComplete > 0].filter(Boolean).length;
  const maturityLevel = signals >= 5 ? 5 : signals >= 4 ? 4 : signals >= 3 ? 3 : signals >= 2 ? 2 : 1;
  add('commercial_maturity', 'Commercial Maturity', maturityLevel * 20, 'commercialIntelligence', [`Level ${maturityLevel}/5 (${signals}/5 commercial capabilities evidenced)`]);

  // --- Recommendation inputs (Phase H) ---
  const recInputs: RawRecommendationInput[] = [];
  const rec = (key: string, text: string, module: string, impactLevel: 'high' | 'medium' | 'low', confidence: number) => recInputs.push({ key, text, source: 'commercialIntelligence', module, impactLevel, confidence });
  if (total === 0) rec('build_pipeline', 'Build pipeline — no leads to convert to revenue.', 'pipeline', 'high', 0.9);
  if (opportunities === 0 && total > 0) rec('create_opportunities', 'Advance qualified leads into opportunities.', 'funnel', 'high', 0.85);
  if (!hasRevenueLineage) rec('instrument_revenue_lineage', 'Instrument revenue lineage (link revenue events to leads) to unlock revenue & forecast.', 'revenue_health', 'high', 0.8);
  if (breakRate > 0.3) rec('fix_attribution', 'Fix attribution breaks to trust revenue attribution.', 'revenue_attribution', 'medium', 0.8);
  if (total > 0 && qualified / total < 0.2) rec('improve_qualification', 'Improve lead qualification to feed the revenue funnel.', 'funnel', 'medium', 0.8);
  if (forecastQuality == null || forecastQuality < 50) rec('increase_pipeline_volume', 'Increase pipeline volume to strengthen forecast confidence.', 'forecast', 'medium', 0.75);
  rec('instrument_sales_capacity', 'Instrument sales capacity/quota to measure coverage and velocity.', 'sales_capacity', 'medium', 0.7);

  const scored = M.map((m) => m.score).filter((s): s is number => s != null);
  const score = scored.length ? Math.round(scored.reduce((a, x) => a + x, 0) / scored.length) : 0;
  return { modules: M, recommendationInputs: recInputs, score, lastUpdated, maturityLevel };
}
