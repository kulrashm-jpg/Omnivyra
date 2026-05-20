/**
 * Next-Best-Action engine — DETERMINISTIC ranking over deterministic inputs.
 *
 * Aggregates outputs from the marketing intelligence services (content / CTA /
 * conversion / timing / campaign) into a single prioritized, decayed,
 * confidence-scored action feed. NO ML, NO learned ranking. Stability bound
 * caps per-call rank volatility (no action's effective weight can move more
 * than ±0.25 from neutral).
 */
import { buildContentIntelligence } from './marketingContentIntelligenceService';
import { buildCtaIntelligence } from './marketingCtaIntelligenceService';
import { buildConversionPredictions } from './marketingConversionPredictionService';
import { buildTimingIntelligence } from './marketingTimingIntelligenceService';
import { buildCampaignIntelligence } from './marketingCampaignAnalyticsService';

export type NbaCategory = 'content' | 'cta' | 'conversion' | 'timing' | 'campaign';
export type NbaSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface NextBestAction {
  id: string;
  category: NbaCategory;
  severity: NbaSeverity;
  title: string;
  rationale: string;
  recommendedAction: string;
  confidence: number; // 0..100
  weight: number;     // bounded 0.75..1.25
  lineage: { source: string; evidence: Record<string, unknown> };
}

export interface NbaReport {
  companyId: string;
  generatedAt: string;
  actions: NextBestAction[];
  summary: { total: number; critical: number; high: number };
  capabilityNote: string;
}

const SEV_RANK: Record<NbaSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

function bound(weight: number, max = 0.25): number {
  return Number((1 + Math.max(-max, Math.min(max, weight - 1))).toFixed(3));
}

export async function buildNextBestActions(companyId: string): Promise<NbaReport> {
  const [content, cta, conversion, timing, campaign] = await Promise.all([
    buildContentIntelligence(companyId).catch(() => null),
    buildCtaIntelligence(companyId).catch(() => null),
    buildConversionPredictions(companyId, 100).catch(() => null),
    buildTimingIntelligence(companyId).catch(() => null),
    buildCampaignIntelligence(companyId).catch(() => null),
  ]);

  const actions: NextBestAction[] = [];

  // Content: top underperforming pieces get an "improve" action.
  for (const c of content?.underperforming.slice(0, 3) ?? []) {
    if (c.confidence < 20) continue; // skip cold content (insufficient data)
    actions.push({
      id: `content_improve_${c.blogId}`,
      category: 'content',
      severity: c.score < 20 ? 'high' : 'medium',
      title: `Refresh underperforming content: "${c.title}"`,
      rationale: `Score ${c.score} over 30d (views ${c.views30d}, CTAs ${c.ctaClicks30d}, submits ${c.formSubmits30d}, attribution touches ${c.attributionTouches}).`,
      recommendedAction: 'Refresh hook, add a high-intent CTA, or retire if attribution is consistently zero.',
      confidence: c.confidence,
      weight: bound(0.5 + c.score / 100),
      lineage: { source: 'marketingContentIntelligenceService', evidence: { blogId: c.blogId, score: c.score } },
    });
  }

  // CTA: under-converting CTA with meaningful clicks.
  for (const k of cta?.ctas ?? []) {
    if (k.clicks30d >= 25 && k.conversionRate < 0.02) {
      actions.push({
        id: `cta_optimize_${k.ctaKey}`,
        category: 'cta',
        severity: 'medium',
        title: `Optimize CTA: ${k.ctaKey}`,
        rationale: `${k.clicks30d} clicks, ${k.attributedSubmits30d} attributed submits (${(k.conversionRate * 100).toFixed(2)}% conv).`,
        recommendedAction: 'A/B test copy/placement; consider stronger value proposition.',
        confidence: k.confidence,
        weight: bound(0.5 + k.score / 100),
        lineage: { source: 'marketingCtaIntelligenceService', evidence: { ctaKey: k.ctaKey, rate: k.conversionRate } },
      });
    }
  }

  // Conversion: cold leads share — alert if dominant.
  const dist = conversion?.distribution;
  if (dist) {
    const total = dist.high + dist.medium + dist.low + dist.cold;
    if (total > 20 && dist.cold / total > 0.6) {
      actions.push({
        id: 'conversion_cold_share_high',
        category: 'conversion',
        severity: 'high',
        title: 'Lead quality is degrading',
        rationale: `${dist.cold}/${total} recent leads scored 'cold' (>60%).`,
        recommendedAction: 'Tighten lead-source targeting; revisit channel mix.',
        confidence: 70,
        weight: bound(1.1),
        lineage: { source: 'marketingConversionPredictionService', evidence: dist as unknown as Record<string, unknown> },
      });
    }
  }

  // Timing: clear top window with confidence ≥40 → publishing recommendation.
  if (timing?.topWindows[0] && timing.confidence >= 40) {
    const t = timing.topWindows[0];
    actions.push({
      id: 'timing_publish_window',
      category: 'timing',
      severity: 'low',
      title: 'Publish into your top engagement window',
      rationale: `${(t.share * 100).toFixed(1)}% of 30d engagement falls in UTC dow ${t.dayOfWeek} hour ${t.hour}.`,
      recommendedAction: `Schedule new content for UTC dow ${t.dayOfWeek} ~hour ${t.hour}.`,
      confidence: timing.confidence,
      weight: bound(1),
      lineage: { source: 'marketingTimingIntelligenceService', evidence: { dow: t.dayOfWeek, hour: t.hour } },
    });
  }

  // Campaign anomalies.
  for (const c of (campaign?.campaigns ?? []).filter((x) => x.anomalous)) {
    actions.push({
      id: `campaign_anomaly_${c.campaignKey}`,
      category: 'campaign',
      severity: c.conversionRate < (campaign?.meanConversionRate ?? 0) * 0.25 ? 'high' : 'medium',
      title: `Campaign anomaly: ${c.campaignKey}`,
      rationale: `Conversion rate ${(c.conversionRate * 100).toFixed(2)}% vs mean ${(campaign?.meanConversionRate ?? 0) * 100}%.`,
      recommendedAction: 'Investigate landing alignment, audience targeting, or budget skew.',
      confidence: Math.min(100, Math.round((c.touches / 10) * 5)),
      weight: bound(1),
      lineage: { source: 'marketingCampaignAnalyticsService', evidence: { campaignKey: c.campaignKey } },
    });
  }

  actions.sort(
    (a, b) =>
      SEV_RANK[b.severity] - SEV_RANK[a.severity] ||
      b.weight * b.confidence - a.weight * a.confidence,
  );

  return {
    companyId, generatedAt: new Date().toISOString(),
    actions,
    summary: {
      total: actions.length,
      critical: actions.filter((a) => a.severity === 'critical').length,
      high: actions.filter((a) => a.severity === 'high').length,
    },
    capabilityNote:
      'Deterministic aggregation/ranking of the five intelligence services. Weights bounded ±0.25 (stability). No ML, no learning, no autonomous execution.',
  };
}
