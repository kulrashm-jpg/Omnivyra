/**
 * Design Performance Service — rolls EXISTING analytics up to Template /
 * Collection / Campaign Design System via the asset attribution stamp, then
 * scores deterministically. Reuses `content_analytics` (the existing analytics
 * pipeline) — no duplicate analytics model. Best-effort: missing tables / no
 * data yield empty results so the rest of the surface is unaffected.
 */

import { supabase } from '../../db/supabaseClient';
import {
  type AssetPerformance,
  type PerfRollup,
  type PerformanceScore,
  aggregateTemplateMetrics,
  aggregateCollectionMetrics,
  aggregateCampaignDesignMetrics,
  aggregateFamilyMetrics,
  scorePerformance,
  weakAssetFamilies,
  toHistoricalCompatibility,
  performanceReasons,
} from '../../../lib/creator-templates/designPerformance';
import { buildDesignAttribution, type DesignAttribution } from '../../../lib/creator-templates/designAttribution';
import { getCampaignDesignSystem } from './campaignDesignSystemService';

/* ── Pure orchestration (testable without DB) ──────────────────────────── */

export interface ScoredRollup extends PerfRollup { performance: PerformanceScore }
export interface CampaignPerformance {
  assetCount: number;
  templates: ScoredRollup[];
  collections: ScoredRollup[];
  campaignDesign: ScoredRollup | null;
  weakFamilies: string[];
  recommendations: string[];
}

function scoreSort(rollups: PerfRollup[]): ScoredRollup[] {
  return rollups
    .map((r) => ({ ...r, performance: scorePerformance(r) }))
    .sort((a, b) => (b.performance.score - a.performance.score) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function buildRecommendations(templates: ScoredRollup[], collections: ScoredRollup[], weakFamilies: string[], assetCount: number): string[] {
  const out: string[] = [];
  if (assetCount === 0) return ['No measured performance yet — publish assets to build design-system intelligence.'];
  const topCollection = collections[0];
  if (topCollection && topCollection.performance.score >= 60) out.push(`Reuse your strongest collection — ${topCollection.performance.score}/100 measured performance.`);
  const weakTemplate = [...templates].reverse().find((t) => t.impressions > 0 && t.performance.score < 40);
  if (weakTemplate) out.push(`Replace under-performing templates (lowest scored ${weakTemplate.performance.score}/100).`);
  for (const f of weakFamilies) out.push(`Strengthen ${f}: missing or under-performing in this campaign.`);
  if (!out.length) out.push('Performance is healthy across templates and families.');
  return out;
}

/** Build the deterministic dashboard payload from measured assets. */
export function buildCampaignPerformance(assets: AssetPerformance[], requiredFamilies: string[] = []): CampaignPerformance {
  const templates = scoreSort(aggregateTemplateMetrics(assets));
  const collections = scoreSort(aggregateCollectionMetrics(assets));
  const campaignDesign = scoreSort(aggregateCampaignDesignMetrics(assets));
  const families = aggregateFamilyMetrics(assets);
  const weakFamilies = weakAssetFamilies(families, requiredFamilies);
  return {
    assetCount: assets.length,
    templates,
    collections,
    campaignDesign: campaignDesign[0] ?? null,
    weakFamilies,
    recommendations: buildRecommendations(templates, collections, weakFamilies, assets.length),
  };
}

/* ── Analytics reader (reuses content_analytics; best-effort) ──────────── */

function mapRow(attribution: DesignAttribution, post: Record<string, unknown>, r: Record<string, unknown>): AssetPerformance {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const pm = (r.platform_metrics && typeof r.platform_metrics === 'object' ? r.platform_metrics : {}) as Record<string, unknown>;
  const engagement = n(r.likes) + n(r.comments) + n(r.shares) + n(r.reactions) + n(r.saves);
  return {
    attribution,
    assetFamily: typeof post.content_type === 'string' ? post.content_type : undefined,
    platform: String(r.platform ?? post.platform ?? 'unknown'),
    impressions: n(r.impressions),
    reach: n(r.reach),
    engagement,
    clicks: n(pm.clicks),
    saves: n(r.saves),
    shares: n(r.shares),
    comments: n(r.comments),
    conversions: n(pm.conversions),
  };
}

const ANALYTICS_PAGE_SIZE = 1000;
const CAMPAIGN_IN_CHUNK = 100; // bound the IN-list size for company-wide rollups

/**
 * Canonical campaign→company join (campaigns.company_id, indexed). Returns the
 * campaign ids a company owns — the company-wide rollups aggregate ONLY these,
 * so there is zero cross-company leakage.
 */
async function resolveCompanyCampaignIds(companyId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase.from('campaigns').select('id').eq('company_id', companyId);
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map((r) => String(r.id)).filter(Boolean);
  } catch { return []; }
}

/**
 * Single-JOIN asset performance for a SET of campaigns (campaign-scoped = a
 * one-element list; company-wide = the company's campaign ids). One query per
 * 1000-row page; the IN-list is chunked so a company with many campaigns still
 * issues a bounded number of queries. content_analytics ⋈ scheduled_posts via
 * the FK (content_analytics.scheduled_post_id → scheduled_posts.id), filtered on
 * the embedded scheduled_posts.campaign_id. The dedicated `design_attribution`
 * column is read directly — no transformation. Rows map to the SAME
 * AssetPerformance objects; the unchanged pure aggregation produces byte-
 * identical rollups (no SQL-side score recomputation).
 */
async function loadAssetPerformanceForCampaigns(campaignIds: string[]): Promise<AssetPerformance[]> {
  if (!campaignIds.length) return [];
  try {
    const out: AssetPerformance[] = [];
    for (let ci = 0; ci < campaignIds.length; ci += CAMPAIGN_IN_CHUNK) {
      const chunk = campaignIds.slice(ci, ci + CAMPAIGN_IN_CHUNK);
      for (let offset = 0; ; offset += ANALYTICS_PAGE_SIZE) {
        const { data, error } = await supabase
          .from('content_analytics')
          .select('*, scheduled_posts!inner(design_attribution, content_type, platform)')
          .in('scheduled_posts.campaign_id', chunk)
          .order('id', { ascending: true })
          .range(offset, offset + ANALYTICS_PAGE_SIZE - 1);
        if (error || !data?.length) break;
        for (const r of data as Record<string, unknown>[]) {
          const post = (r.scheduled_posts && typeof r.scheduled_posts === 'object' ? r.scheduled_posts : {}) as Record<string, unknown>;
          const raw = (post.design_attribution && typeof post.design_attribution === 'object' ? post.design_attribution : {}) as Partial<DesignAttribution>;
          const attribution = buildDesignAttribution(raw);
          // Include the asset if it carries ANY rollup dimension (template /
          // collection / campaign-design-system) — template id may be null while
          // collection/design-system attribution is still present.
          if (!(attribution.templateId || attribution.collectionId || attribution.campaignDesignSystemId)) continue;
          out.push(mapRow(attribution, post, r));
        }
        if (data.length < ANALYTICS_PAGE_SIZE) break;
      }
    }
    return out;
  } catch {
    return [];
  }
}

/* ── Public API ────────────────────────────────────────────────────────── */

export async function getCampaignDesignPerformance(campaignId: string): Promise<CampaignPerformance> {
  const ds = await getCampaignDesignSystem(campaignId);
  const assets = await loadAssetPerformanceForCampaigns([campaignId]);
  return buildCampaignPerformance(assets, ds?.requiredFamilies ?? []);
}

/**
 * Company-wide performance — resolves the company's campaigns via the canonical
 * campaign→company join, then runs the IDENTICAL aggregation pipeline used by
 * campaign dashboards. Empty only when the company has no measured assets.
 */
export async function getCompanyDesignPerformance(companyId: string): Promise<CampaignPerformance> {
  const campaignIds = await resolveCompanyCampaignIds(companyId);
  const assets = await loadAssetPerformanceForCampaigns(campaignIds);
  return buildCampaignPerformance(assets);
}

/**
 * Strategist feed — REAL historical compatibility + measured reasons per
 * collection, company-wide. Replaces the previous placeholder.
 */
export async function getStrategistPerformanceSignals(companyId: string): Promise<{ historicalCompatibility: Record<string, number>; performanceReasons: Record<string, string[]> }> {
  const campaignIds = await resolveCompanyCampaignIds(companyId);
  const assets = await loadAssetPerformanceForCampaigns(campaignIds);
  if (!assets.length) return { historicalCompatibility: {}, performanceReasons: {} };

  const collections = aggregateCollectionMetrics(assets);
  const historicalCompatibility = toHistoricalCompatibility(collections);

  // Top performer = highest-scoring collection (deterministic).
  const ranked = collections.map((r) => ({ r, score: scorePerformance(r).score })).sort((a, b) => (b.score - a.score) || (a.r.key < b.r.key ? -1 : 1));
  const topId = ranked[0]?.r.key ?? null;
  const reasons: Record<string, string[]> = {};
  for (const r of collections) reasons[r.key] = performanceReasons(r, { isTopPerformer: r.key === topId });
  return { historicalCompatibility, performanceReasons: reasons };
}
