/**
 * Partner & Channel Intelligence domain scoring (Phase 35). Measures acquisition/distribution
 * channel health. Pure, deterministic, evidence-backed. Composes EXISTING reads (attribution
 * aggregation, lead stats, cohort funnel, journey). Owns NO generic intelligence. No LLM.
 * Unknown stays Unknown — per-channel revenue/pipeline lineage and distinct partner/affiliate
 * channels are not captured in the schema, so they are reported not-available (never fabricated).
 */
import type { PluginModule } from '../platformIntelligence/registry';
import type { RawRecommendationInput } from '../platformIntelligence/recommendations';

export interface PartnerChannelInputs {
  attribution: any | null; // attributionRepository.getAttributionAggregation
  leadStats: any | null;   // leadIntelligenceReadService.getLeadStats
  cohort: any | null;      // cohortFunnelRepository.getCohortFunnelIntelligence
  journey: any | null;     // customerJourneyRepository.getCustomerJourneyIntelligence
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const statusFromScore = (s: number | null): PluginModule['status'] => (s == null ? 'unavailable' : s >= 75 ? 'ready' : 'partial');

export interface PartnerChannelResult {
  modules: PluginModule[];
  recommendationInputs: RawRecommendationInput[];
  score: number;
  lastUpdated: string | null;
  maturityLevel: number;
}

/** Sum the lead counts of every breakdown key matching any of `needles`. */
const channelLeads = (breakdown: Record<string, number>, needles: string[]): number =>
  Object.entries(breakdown ?? {}).filter(([k]) => needles.some((n) => k.toLowerCase().includes(n))).reduce((a, [, v]) => a + Number(v ?? 0), 0);

export function scoreChannelIntelligence(inputs: PartnerChannelInputs): PartnerChannelResult {
  const { attribution, leadStats, cohort, journey } = inputs;
  const totals = attribution?.totals ?? null;
  const totalLeads = Number(totals?.leads ?? 0);
  const hasAttr = totalLeads > 0;
  const ch: Record<string, number> = attribution?.channelBreakdown ?? {};
  const attrConfidence = hasAttr ? clamp((Number(totals?.leadsWithAttribution ?? 0) / totalLeads) * 100) : null;
  const activeChannels = Object.values(ch).filter((v) => Number(v) > 0).length;
  const topShare = hasAttr ? Math.max(0, ...Object.values(ch).map((v) => Number(v) / totalLeads)) : 0;
  const campaignCount = Object.values(attribution?.campaignBreakdown ?? {}).filter((v) => Number(v) > 0).length;
  const qualifiedRate = leadStats?.total ? clamp((Number(leadStats.intentBands?.high ?? 0) / leadStats.total) * 100) : null;
  const lastUpdated = attribution?.generatedAt ?? cohort?.generatedAt ?? null;

  const M: PluginModule[] = [];
  const add = (key: string, label: string, score: number | null, source: string, findings: string[]) =>
    M.push({ key, label, source, score, status: statusFromScore(score), available: score != null, findings: findings.slice(0, 3), lastUpdated });

  // Per-channel health (volume-based; available only when attribution evidence exists).
  const chan = (key: string, label: string, needles: string[]) => {
    if (!hasAttr) return add(key, label, null, 'attributionRepository', ['No attribution data — Unknown']);
    const n = channelLeads(ch, needles);
    add(key, label, clamp(Math.min(100, n * 10)), 'attributionRepository', [`${n} leads (${Math.round((n / totalLeads) * 100)}% of acquisition)`]);
  };
  chan('organic_health', 'Organic Health', ['organic']);
  chan('paid_health', 'Paid Health', ['paid', 'cpc', 'ppc', 'ad']);
  chan('social_health', 'Social Health', ['social']);
  chan('email_health', 'Email Health', ['email', 'newsletter']);
  chan('referral_health', 'Referral Health', ['referral', 'referrer']);
  chan('direct_health', 'Direct Health', ['direct']);
  chan('community_health', 'Community Health', ['community']);

  add('partner_health', 'Partner / Affiliate Health', null, 'partnerChannel', ['Unknown — no distinct partner/affiliate channel captured']);
  add('campaign_health', 'Campaign Health', hasAttr ? clamp(Math.min(100, campaignCount * 20)) : null, 'attributionRepository', hasAttr ? [`${campaignCount} attributed campaigns`] : ['Unknown']);
  add('attribution_confidence', 'Attribution Confidence', attrConfidence, 'attributionRepository', attrConfidence != null ? [`${attrConfidence}% leads attributed`] : ['Unknown']);
  add('channel_diversity', 'Channel Diversity', hasAttr ? clamp(Math.min(100, activeChannels * 25)) : null, 'attributionRepository', hasAttr ? [`${activeChannels} active channels`] : ['Unknown']);
  add('channel_dependency', 'Channel Resilience (inverse dependency)', hasAttr ? clamp(100 - topShare * 100) : null, 'attributionRepository', hasAttr ? [`Top channel = ${Math.round(topShare * 100)}% of acquisition`] : ['Unknown']);
  add('acquisition_risk', 'Acquisition Risk (inverse)', hasAttr ? clamp(100 - (topShare > 0.7 ? 40 : 0) - (activeChannels < 2 ? 30 : 0)) : null, 'derived', hasAttr ? ['Concentration + diversity risk'] : ['Unknown']);

  add('lead_quality_by_channel', 'Lead Quality (overall)', qualifiedRate, 'leadIntelligence', qualifiedRate != null ? [`${qualifiedRate}% qualified overall; per-channel quality Unknown`] : ['Unknown']);
  add('qualified_lead_rate', 'Qualified Lead Rate', qualifiedRate, 'leadIntelligence', qualifiedRate != null ? [`${qualifiedRate}% high-intent`] : ['Unknown']);
  add('pipeline_contribution', 'Pipeline Contribution', leadStats?.total ? clamp(Math.min(100, leadStats.total * 4)) : null, 'leadIntelligence', leadStats?.total ? [`${leadStats.total} leads; per-channel pipeline Unknown`] : ['Unknown']);
  add('revenue_contribution', 'Revenue Contribution', null, 'partnerChannel', ['Unknown — no per-channel revenue lineage']);

  const evidenced = M.map((m) => m.score).filter((s): s is number => s != null);
  const channelHealth = evidenced.length ? clamp(evidenced.reduce((a, b) => a + b, 0) / evidenced.length) : null;
  add('channel_health', 'Channel Health', channelHealth, 'partnerChannel', evidenced.length ? [`Composite of ${evidenced.length} channel signals`] : ['Insufficient evidence — Unknown']);

  const signals = [hasAttr, activeChannels >= 2, (attrConfidence ?? 0) >= 50, campaignCount > 0].filter(Boolean).length;
  const maturityLevel = signals >= 4 ? 4 : signals >= 3 ? 3 : signals >= 2 ? 2 : 1;
  add('channel_maturity', 'Channel Maturity', maturityLevel * 20, 'partnerChannel', [`Level ${maturityLevel}/5 (per-channel revenue / partner channels not instrumented)`]);

  const recInputs: RawRecommendationInput[] = [];
  const rec = (key: string, text: string, module: string, impactLevel: 'high' | 'medium' | 'low', confidence: number) => recInputs.push({ key, text, source: 'partnerChannel', module, impactLevel, confidence });
  if (!hasAttr) rec('instrument_attribution', 'Instrument channel attribution to measure acquisition sources.', 'attribution_confidence', 'high', 0.85);
  if (attrConfidence != null && attrConfidence < 60) rec('fix_attribution', 'Improve attribution completeness for trustworthy channel data.', 'attribution_confidence', 'medium', 0.8);
  if (hasAttr && topShare > 0.7) rec('diversify_channels', 'Reduce single-channel dependency by diversifying acquisition.', 'channel_dependency', 'high', 0.8);
  if (hasAttr && activeChannels < 2) rec('add_acquisition_channels', 'Add acquisition channels to build resilience.', 'channel_diversity', 'medium', 0.8);
  rec('instrument_channel_revenue', 'Instrument per-channel revenue lineage to compute channel ROI.', 'revenue_contribution', 'medium', 0.7);

  // journey bottleneck advisory (reuse, no recompute)
  if (journey?.bottleneck) rec('resolve_channel_bottleneck', `Address the conversion bottleneck at ${journey.bottleneck}.`, 'lead_quality_by_channel', 'medium', 0.75);

  const score = channelHealth ?? 0;
  return { modules: M, recommendationInputs: recInputs, score, lastUpdated, maturityLevel };
}
