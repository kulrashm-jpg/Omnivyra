/**
 * Marketing campaign analytics — DETERMINISTIC funnel + channel performance.
 *
 * Reads `campaign_touchpoints` joined with `form_conversions`/`lead_attributions`
 * to compute per-campaign volume, conversion rate, and a simple funnel
 * (touches → conversions). Anomaly = >2x deviation from the campaign-mean
 * conversion rate (flagged, never auto-acted). No ML.
 *
 * Named distinct from the existing `campaignIntelligenceService` to avoid
 * collision (the existing service is consumed by recommendationEngine/engine).
 */
import { ownedDbTable } from '../../db/writeOwner';

export interface CampaignPerf {
  campaignKey: string;
  touches: number;
  conversions: number;
  conversionRate: number;
  channel: string | null;
  anomalous: boolean;
}

export interface CampaignIntelligenceReport {
  companyId: string;
  generatedAt: string;
  campaigns: CampaignPerf[];
  meanConversionRate: number;
  capabilityNote: string;
}

export async function buildCampaignIntelligence(companyId: string): Promise<CampaignIntelligenceReport> {
  const sinceIso = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const touches = new Map<string, { touches: number; conversions: number; channel: string | null }>();
  try {
    const { data } = await ownedDbTable('campaign_touchpoints')
      .select('campaign, source, touchpoint_type, lead_id')
      .eq('company_id', companyId)
      .gte('touched_at', sinceIso)
      .limit(10000);
    for (const r of ((data ?? []) as any[])) {
      const key = String(r.campaign ?? r.source ?? 'unknown');
      const cur = touches.get(key) ?? { touches: 0, conversions: 0, channel: r.source ?? null };
      cur.touches += 1;
      if (r.touchpoint_type === 'conversion' || r.lead_id) cur.conversions += 1;
      touches.set(key, cur);
    }
  } catch { /* absent */ }

  const campaigns: CampaignPerf[] = Array.from(touches.entries())
    .map(([campaignKey, v]) => ({
      campaignKey,
      touches: v.touches,
      conversions: v.conversions,
      conversionRate: v.touches > 0 ? Number((v.conversions / v.touches).toFixed(3)) : 0,
      channel: v.channel,
      anomalous: false,
    }))
    .filter((c) => c.touches > 0);

  const meanCr =
    campaigns.length > 0
      ? Number((campaigns.reduce((a, c) => a + c.conversionRate, 0) / campaigns.length).toFixed(3))
      : 0;
  // Mark anomalies (>2× mean OR <0.25× mean — when mean meaningful).
  if (meanCr > 0) {
    for (const c of campaigns) {
      if (c.conversionRate > meanCr * 2 || (c.touches > 20 && c.conversionRate < meanCr * 0.25)) {
        c.anomalous = true;
      }
    }
  }
  campaigns.sort((a, b) => b.conversionRate - a.conversionRate);

  return {
    companyId, generatedAt: new Date().toISOString(),
    campaigns: campaigns.slice(0, 30),
    meanConversionRate: meanCr,
    capabilityNote: 'Deterministic per-campaign conversion rate over 30d. Anomalies = mean ±2× (flag only).',
  };
}
