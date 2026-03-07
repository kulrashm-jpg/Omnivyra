/**
 * Campaign Strategy Learner
 * Analyzes historical campaign performance across campaigns for a company.
 * Builds on campaign_performance_signals and company_*_performance tables.
 * No LLM calls.
 */

import { supabase } from '../db/supabaseClient';
import { calculateEngagementScore, calculateConversionScore } from '../utils/performanceScoring';

const MIN_SAMPLES = 10;
const MIN_CAMPAIGNS_FOR_CONFIDENCE = 3;
const EXPLORATION_FLOOR = 0.1;
const MAX_ADJUSTMENT_LOW_CONF = 0.1;
const MAX_ADJUSTMENT_HIGH_CONF = 0.2;

export type StrategyProfile = {
  preferred_platform_weights: Record<string, number>;
  preferred_content_type_ratios: Record<string, number>;
  preferred_theme_patterns: string[];
  underperforming_patterns: Array<{ type: 'platform' | 'content_type' | 'theme'; value: string }>;
  confidence_score: number;
  campaigns_used: number;
};

function normalizeKey(s: string): string {
  return String(s ?? '').trim().toLowerCase().replace(/^twitter$/, 'x') || 'unknown';
}

function toRatios(values: Record<string, number>): Record<string, number> {
  const entries = Object.entries(values).filter(([, v]) => v > 0);
  if (entries.length === 0) return {};
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of entries) {
    out[k] = Math.round((v / total) * 1000) / 1000;
  }
  return out;
}

/**
 * Apply safety constraints: ±20% max, 10% exploration minimum.
 */
function applySafetyConstraints(
  ratios: Record<string, number>,
  maxAdjustment: number
): Record<string, number> {
  const floor = EXPLORATION_FLOOR / Object.keys(ratios).length;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(ratios)) {
    const clamped = Math.max(floor, Math.min(1 - (Object.keys(ratios).length - 1) * floor, v));
    out[k] = Math.round(clamped * 1000) / 1000;
  }
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  if (sum <= 0) return ratios;
  for (const k of Object.keys(out)) {
    out[k] = Math.round((out[k] / sum) * 1000) / 1000;
  }
  return out;
}

/**
 * Get strategy profile for a company.
 */
export async function getStrategyProfile(
  companyId: string,
  lookbackDays = 180
): Promise<StrategyProfile> {
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);
  const sinceStr = since.toISOString();

  const empty: StrategyProfile = {
    preferred_platform_weights: {},
    preferred_content_type_ratios: {},
    preferred_theme_patterns: [],
    underperforming_patterns: [],
    confidence_score: 0,
    campaigns_used: 0,
  };

  const { data: signals, error: signalsErr } = await supabase
    .from('campaign_performance_signals')
    .select('campaign_id, theme, platform, content_type, engagement, impressions, clicks, conversions, shares, comments, created_at')
    .eq('company_id', companyId)
    .gte('created_at', sinceStr);

  if (signalsErr || !signals?.length) return empty;

  const uniqueCampaigns = new Set(
    (signals as Array<{ campaign_id?: string }>)
      .map((r) => r.campaign_id)
      .filter(Boolean)
  );
  const campaignsUsed = uniqueCampaigns.size;
  const confidenceScore = Math.min(1, campaignsUsed / MIN_CAMPAIGNS_FOR_CONFIDENCE);
  const maxAdjustment = confidenceScore >= 0.5 ? MAX_ADJUSTMENT_HIGH_CONF : MAX_ADJUSTMENT_LOW_CONF;

  const byPlatform = new Map<string, { score: number; count: number; createdAt: number }>();
  const byContentType = new Map<string, { score: number; count: number; createdAt: number }>();
  const byTheme = new Map<string, { score: number; count: number; createdAt: number }>();
  const nowMs = Date.now();
  const decayHalfLifeDays = 90;

  for (const row of signals as Array<{
    campaign_id?: string;
    theme?: string;
    platform?: string;
    content_type?: string;
    engagement?: number;
    impressions?: number;
    clicks?: number;
    conversions?: number;
    shares?: number;
    comments?: number;
    created_at?: string;
  }>) {
    const engScore = calculateEngagementScore({
      impressions: row.impressions,
      reactions: row.engagement,
      shares: row.shares,
      comments: row.comments,
    });
    const convScore = calculateConversionScore({
      clicks: row.clicks,
      conversions: row.conversions,
    });
    const score = engScore * 0.6 + convScore * 0.4;
    const createdAt = row.created_at ? new Date(row.created_at).getTime() : nowMs;
    const ageDays = (nowMs - createdAt) / (24 * 60 * 60 * 1000);
    const weight = Math.exp(-0.693 * ageDays / decayHalfLifeDays);

    if (row.platform) {
      const k = normalizeKey(row.platform);
      const c = byPlatform.get(k) ?? { score: 0, count: 0, createdAt: 0 };
      c.score += score * weight;
      c.count += 1;
      c.createdAt = Math.max(c.createdAt, createdAt);
      byPlatform.set(k, c);
    }
    if (row.content_type) {
      const k = normalizeKey(row.content_type);
      const c = byContentType.get(k) ?? { score: 0, count: 0, createdAt: 0 };
      c.score += score * weight;
      c.count += 1;
      c.createdAt = Math.max(c.createdAt, createdAt);
      byContentType.set(k, c);
    }
    if (row.theme) {
      const k = normalizeKey(row.theme);
      const c = byTheme.get(k) ?? { score: 0, count: 0, createdAt: 0 };
      c.score += score * weight;
      c.count += 1;
      c.createdAt = Math.max(c.createdAt, createdAt);
      byTheme.set(k, c);
    }
  }

  const platformWeights: Record<string, number> = {};
  for (const [k, v] of byPlatform) {
    if (v.count >= MIN_SAMPLES) platformWeights[k] = v.score;
  }

  const contentTypeWeights: Record<string, number> = {};
  for (const [k, v] of byContentType) {
    if (v.count >= MIN_SAMPLES) contentTypeWeights[k] = v.score;
  }

  const themeScores = Array.from(byTheme.entries())
    .filter(([, v]) => v.count >= MIN_SAMPLES)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 10)
    .map(([k]) => k);

  const platformRatios = applySafetyConstraints(toRatios(platformWeights), maxAdjustment);
  const contentTypeRatios = applySafetyConstraints(toRatios(contentTypeWeights), maxAdjustment);

  const globalAvg = signals.length
    ? signals.reduce(
        (s: number, r: { engagement?: number }) =>
          s + (Number((r as { engagement?: number }).engagement ?? 0) || 0),
        0
      ) / signals.length
    : 0;

  const underperforming: StrategyProfile['underperforming_patterns'] = [];
  for (const [k, v] of byPlatform) {
    if (v.count >= MIN_SAMPLES) {
      const avgEng = signals
        .filter((r: { platform?: string }) => normalizeKey((r as { platform?: string }).platform ?? '') === k)
        .reduce(
          (s: number, r: { engagement?: number }) =>
            s + (Number((r as { engagement?: number }).engagement ?? 0) || 0),
          0
        ) / v.count;
      if (avgEng < globalAvg * 0.5) underperforming.push({ type: 'platform', value: k });
    }
  }
  for (const [k, v] of byContentType) {
    if (v.count >= MIN_SAMPLES) {
      const avgEng = signals
        .filter((r: { content_type?: string }) => normalizeKey((r as { content_type?: string }).content_type ?? '') === k)
        .reduce(
          (s: number, r: { engagement?: number }) =>
            s + (Number((r as { engagement?: number }).engagement ?? 0) || 0),
          0
        ) / v.count;
      if (avgEng < globalAvg * 0.5) underperforming.push({ type: 'content_type', value: k });
    }
  }

  return {
    preferred_platform_weights: platformRatios,
    preferred_content_type_ratios: contentTypeRatios,
    preferred_theme_patterns: themeScores,
    underperforming_patterns: underperforming,
    confidence_score: Math.round(confidenceScore * 1000) / 1000,
    campaigns_used: campaignsUsed,
  };
}

export async function getStrategyProfileCached(
  companyId: string,
  lookbackDays = 180
): Promise<StrategyProfile> {
  const cached = (await import('./strategyProfileCache')).getStrategyProfileFromCache(companyId);
  if (cached) {
    console.debug('[strategyLearner] strategy_profile_cache_hit', { companyId });
    return cached;
  }
  console.debug('[strategyLearner] strategy_profile_cache_miss', { companyId });
  const profile = await getStrategyProfile(companyId, lookbackDays);
  (await import('./strategyProfileCache')).setStrategyProfileInCache(companyId, profile);
  return profile;
}
