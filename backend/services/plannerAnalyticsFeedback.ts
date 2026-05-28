/**
 * Analytics feedback / ROI optimization.
 *
 * Builds on `plannerCostGovernance` by adding ENGAGEMENT-aware ROI
 * signals. Where cost-governance asks "is refinement worth the spend?",
 * this layer asks "is refinement actually improving downstream campaign
 * outcomes?".
 *
 * Sources (each optional — module degrades to cost-only signals when
 * absent):
 *   - publish_success_rate  : % of scheduled posts that actually published
 *   - engagement_lift       : per-campaign engagement metric (impressions
 *                              / likes / etc.) — pulled from the
 *                              analytics ingestion table
 *   - click_through_rate    : per-campaign CTR
 *   - conversion_rate       : per-campaign conversion (when tracked)
 *   - regeneration_frequency: how often a campaign needed re-planning
 *   - refinement_effectiveness: outcome-weighted refinement win-rate
 *   - scheduling_adherence  : did the publish times match the plan
 *   - provider_quality      : per-provider success / error rate
 *
 * All signals are PRIVACY-SAFE (only aggregate metrics, never per-user
 * content). Stored in Redis ZSETs keyed by (org, campaign) with 30-day
 * rolling windows.
 *
 * Output: `getRefinementGuidance` returns the next-step decision the
 * orchestrator can read alongside `getCostGuidance`. Stricter wins.
 *
 * Adaptive provider/model selection: `recommendProviderModel` returns a
 * suggestion based on rolling per-provider success + latency. The
 * orchestrator's existing model routing remains authoritative; this is
 * advisory.
 *
 * No runtime regression: the entire layer is OFF by default
 * (`ANALYTICS_FEEDBACK_ENABLED=false`).
 */

import type IORedis from 'ioredis';
import { logger } from './logger';
import { getRequestContext } from './requestContext';

const KEY_PREFIX = 'planner:analytics:';
const ROLLING_WINDOW_MS = 30 * 24 * 60 * 60_000;
const FAILURE_DISABLE_THRESHOLD = 5;
let _failureCount = 0;
let _client: IORedis | null = null;

function enabled(): boolean {
  return String(process.env.ANALYTICS_FEEDBACK_ENABLED ?? 'false').toLowerCase() === 'true';
}

function getRedisOrNull(): IORedis | null {
  if (!enabled()) return null;
  if (_failureCount >= FAILURE_DISABLE_THRESHOLD) return null;
  if (_client) return _client;
  try {
    const { getInstrumentedStandaloneRedisClient } =
      require('../queue/standaloneRedisClient') as typeof import('../queue/standaloneRedisClient');
    _client = getInstrumentedStandaloneRedisClient('planner-analytics-feedback');
    return _client;
  } catch (err) {
    _failureCount = FAILURE_DISABLE_THRESHOLD;
    logger.warn('analytics_feedback_unavailable', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/* ───────────────────────────────────────────────────────────────────────
 * Recording.
 * ────────────────────────────────────────────────────────────────────── */

export type CampaignOutcomeSignal =
  | 'publish_success' | 'publish_failure'
  | 'engagement_lift'
  | 'click_through'
  | 'conversion'
  | 'regeneration_triggered'
  | 'schedule_adhered' | 'schedule_drift';

/**
 * Record one campaign-outcome sample. `value` semantics depend on the
 * signal:
 *   - publish_success / publish_failure / regeneration_triggered: 1 per occurrence
 *   - engagement_lift / click_through / conversion: numeric rate (0..1)
 *   - schedule_adhered / schedule_drift: 1 per occurrence
 *
 * Fire-and-forget: never blocks the caller.
 */
export async function recordOutcomeSignal(
  campaignId: string,
  signal: CampaignOutcomeSignal,
  value: number = 1,
): Promise<void> {
  if (!campaignId || !Number.isFinite(value)) return;
  const client = getRedisOrNull();
  if (!client) return;
  try {
    const now = Date.now();
    const key = `${KEY_PREFIX}signal:${signal}:${campaignId}`;
    const member = `${now}:${Math.random().toString(36).slice(2, 8)}:${value}`;
    const pipeline = client.multi();
    pipeline.zadd(key, now, member);
    pipeline.zremrangebyscore(key, '-inf', now - ROLLING_WINDOW_MS);
    pipeline.pexpire(key, ROLLING_WINDOW_MS * 2);
    await pipeline.exec();
  } catch (err) {
    _failureCount += 1;
    logger.warn('analytics_feedback_record_failed', {
      signal, campaign_id: campaignId, error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function recordProviderQuality(
  provider: string,
  outcome: 'success' | 'error' | 'timeout',
  latencyMs?: number,
): Promise<void> {
  const client = getRedisOrNull();
  if (!client) return;
  try {
    const now = Date.now();
    const key = `${KEY_PREFIX}provider:${provider}:${outcome}`;
    const member = `${now}:${Math.random().toString(36).slice(2, 8)}:${latencyMs ?? 0}`;
    const pipeline = client.multi();
    pipeline.zadd(key, now, member);
    pipeline.zremrangebyscore(key, '-inf', now - ROLLING_WINDOW_MS);
    pipeline.pexpire(key, ROLLING_WINDOW_MS * 2);
    await pipeline.exec();
  } catch { /* best-effort */ }
}

/* ───────────────────────────────────────────────────────────────────────
 * Reading + scoring.
 * ────────────────────────────────────────────────────────────────────── */

async function readZsetCount(client: IORedis, key: string): Promise<number> {
  try {
    await client.zremrangebyscore(key, '-inf', Date.now() - ROLLING_WINDOW_MS);
    return await client.zcard(key);
  } catch {
    return 0;
  }
}

async function readZsetAvgValue(client: IORedis, key: string): Promise<number> {
  try {
    await client.zremrangebyscore(key, '-inf', Date.now() - ROLLING_WINDOW_MS);
    const members = await client.zrange(key, 0, -1);
    if (members.length === 0) return 0;
    let sum = 0;
    for (const m of members) {
      const parts = m.split(':');
      const v = parseFloat(parts[parts.length - 1]);
      if (Number.isFinite(v)) sum += v;
    }
    return sum / members.length;
  } catch {
    return 0;
  }
}

export interface CampaignOutcomeSnapshot {
  campaignId: string;
  publishSuccessRate: number;
  engagementLiftAvg: number;
  clickThroughAvg: number;
  conversionAvg: number;
  regenerationCount: number;
  schedulingAdherenceRate: number;
}

export async function getCampaignOutcomeSnapshot(campaignId: string): Promise<CampaignOutcomeSnapshot | null> {
  if (!enabled() || !campaignId) return null;
  const client = getRedisOrNull();
  if (!client) return null;
  const [succ, fail, lift, ctr, conv, regen, adh, drift] = await Promise.all([
    readZsetCount(client, `${KEY_PREFIX}signal:publish_success:${campaignId}`),
    readZsetCount(client, `${KEY_PREFIX}signal:publish_failure:${campaignId}`),
    readZsetAvgValue(client, `${KEY_PREFIX}signal:engagement_lift:${campaignId}`),
    readZsetAvgValue(client, `${KEY_PREFIX}signal:click_through:${campaignId}`),
    readZsetAvgValue(client, `${KEY_PREFIX}signal:conversion:${campaignId}`),
    readZsetCount(client, `${KEY_PREFIX}signal:regeneration_triggered:${campaignId}`),
    readZsetCount(client, `${KEY_PREFIX}signal:schedule_adhered:${campaignId}`),
    readZsetCount(client, `${KEY_PREFIX}signal:schedule_drift:${campaignId}`),
  ]);
  const totalPublishes = succ + fail;
  const totalSchedule = adh + drift;
  return {
    campaignId,
    publishSuccessRate: totalPublishes > 0 ? succ / totalPublishes : 1,
    engagementLiftAvg: lift,
    clickThroughAvg: ctr,
    conversionAvg: conv,
    regenerationCount: regen,
    schedulingAdherenceRate: totalSchedule > 0 ? adh / totalSchedule : 1,
  };
}

export interface RefinementGuidance {
  shouldRefine: boolean;
  refinementValueScore: number; // 0..1
  shouldRegenerate: boolean;
  reasons: string[];
}

/**
 * Engagement-aware refinement decision. Returns `shouldRefine: false`
 * when:
 *   - publish-success rate is HIGH (>0.9) AND engagement lift is LOW (<0.3)
 *     → user audience doesn't care; refinement isn't moving outcomes
 *   - regeneration rate is HIGH → the campaign keeps getting reworked
 *     anyway; spend the refinement budget after the next stable plan
 *
 * Returns `shouldRegenerate: true` when:
 *   - publish-success rate is LOW (<0.6) AND engagement is FLAT → plan
 *     is failing at execution; suggest regeneration over refinement
 *
 * The orchestrator combines this with `getCostGuidance` and the cluster
 * overload policy — stricter wins. Returns advisory `reasons` for the
 * explainability UX.
 */
export async function getRefinementGuidance(campaignId: string): Promise<RefinementGuidance> {
  const reasons: string[] = [];
  if (!enabled() || !campaignId) {
    return { shouldRefine: true, refinementValueScore: 0.5, shouldRegenerate: false, reasons: ['analytics_feedback_disabled'] };
  }
  const snap = await getCampaignOutcomeSnapshot(campaignId);
  if (!snap) return { shouldRefine: true, refinementValueScore: 0.5, shouldRegenerate: false, reasons: ['no_outcome_data'] };

  let score = 0.5;
  let shouldRefine = true;
  let shouldRegenerate = false;

  if (snap.publishSuccessRate > 0.9 && snap.engagementLiftAvg < 0.3) {
    shouldRefine = false;
    score = 0.2;
    reasons.push('high_publish_low_engagement_refinement_low_value');
  }
  if (snap.regenerationCount > 5) {
    shouldRefine = false;
    score = Math.min(score, 0.3);
    reasons.push(`high_regeneration_count:${snap.regenerationCount}`);
  }
  if (snap.publishSuccessRate < 0.6 && snap.engagementLiftAvg < 0.2) {
    shouldRegenerate = true;
    reasons.push('low_publish_low_engagement_regenerate_recommended');
  }
  if (snap.engagementLiftAvg > 0.6) {
    score = 0.8;
    reasons.push('strong_engagement_refinement_high_value');
  }
  if (reasons.length === 0) reasons.push('outcomes_neutral');
  return { shouldRefine, refinementValueScore: score, shouldRegenerate, reasons };
}

/* ───────────────────────────────────────────────────────────────────────
 * Adaptive provider / model selection.
 *
 * Per-provider rolling success rate + avg latency. When success rate
 * falls below `PLANNER_PROVIDER_SUCCESS_FLOOR` (default 0.95), the
 * recommendation flips to the alternate provider. The orchestrator's
 * existing gateway routing keeps final authority.
 * ────────────────────────────────────────────────────────────────────── */

export interface ProviderRecommendation {
  preferredProvider: 'openai' | 'anthropic';
  reason: string;
  metrics: {
    openai: { success: number; error: number; timeout: number; successRate: number };
    anthropic: { success: number; error: number; timeout: number; successRate: number };
  };
}

export async function recommendProviderModel(): Promise<ProviderRecommendation | null> {
  if (!enabled()) return null;
  const client = getRedisOrNull();
  if (!client) return null;
  const stats = async (provider: 'openai' | 'anthropic') => {
    const [s, e, t] = await Promise.all([
      readZsetCount(client, `${KEY_PREFIX}provider:${provider}:success`),
      readZsetCount(client, `${KEY_PREFIX}provider:${provider}:error`),
      readZsetCount(client, `${KEY_PREFIX}provider:${provider}:timeout`),
    ]);
    const total = s + e + t;
    return { success: s, error: e, timeout: t, successRate: total > 0 ? s / total : 1 };
  };
  const [openai, anthropic] = await Promise.all([stats('openai'), stats('anthropic')]);
  const floor = Number(process.env.PLANNER_PROVIDER_SUCCESS_FLOOR ?? 0.95);
  let preferred: 'openai' | 'anthropic' = 'openai';
  let reason = 'default_openai';
  if (openai.successRate < floor && anthropic.successRate >= floor) {
    preferred = 'anthropic';
    reason = `openai_success_rate_${openai.successRate.toFixed(2)}_below_floor`;
  } else if (anthropic.successRate > openai.successRate + 0.05) {
    preferred = 'anthropic';
    reason = 'anthropic_outperforming_openai';
  }
  return { preferredProvider: preferred, reason, metrics: { openai, anthropic } };
}

void getRequestContext; // reserved for future per-request tagging
