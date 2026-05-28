/**
 * Planner AI cost governance.
 *
 * Tracks per-org and per-campaign planner spend in a rolling window and
 * exposes decisions for:
 *   - shouldRefine(): is this campaign's refinement worth the marginal cost?
 *   - preferCheaperModel(): should we route to a cheaper model on this run?
 *
 * The implementation is deliberately conservative:
 *   - All decisions are SUGGESTIONS to the orchestrator. The cluster
 *     overload coordinator (Part 3) and the rollout mode (Part 8 prior)
 *     have authority over actual behavior; this layer only adds a "cost
 *     signal" they can incorporate.
 *   - Spend tracking uses the existing `usageLedgerService.logUsageEvent`
 *     stream — we sum recent cost rows in Redis for fast reads, with a
 *     fallback to a per-process counter when Redis is unavailable.
 *   - Marginal-value scoring is a heuristic: refinement spend / refinement
 *     wins (where a "win" is plan_created event without partial_salvage_used
 *     AND without placeholder fallback). Below a configurable
 *     `REFINEMENT_ROI_THRESHOLD`, refinement is recommended off.
 *
 * Env:
 *   COST_GOVERNANCE_ENABLED         — master switch (default false)
 *   PLANNER_ORG_SPEND_CAP_USD       — soft cap; spend > cap → refine=false
 *                                      (default unlimited, i.e. no cap)
 *   REFINEMENT_ROI_THRESHOLD        — refinement_wins / refinement_count;
 *                                      below this → refine=false (default 0.30)
 */

import type IORedis from 'ioredis';
import { logger } from './logger';
import { getRequestContext } from './requestContext';

const REDIS_KEY_ORG_SPEND      = 'planner:cost:org:';
const REDIS_KEY_CAMPAIGN_SPEND = 'planner:cost:campaign:';
const REDIS_KEY_REFINEMENT_WIN = 'planner:cost:refine_win:';
const REDIS_KEY_REFINEMENT_RUN = 'planner:cost:refine_run:';
const ROLLING_WINDOW_MS = Number(process.env.PLANNER_COST_WINDOW_MS || 24 * 60 * 60_000); // 24h

let _client: IORedis | null = null;
let _failureCount = 0;
const FAILURE_DISABLE_THRESHOLD = 5;

// Local fallback counters (per-process).
const _localOrgSpend = new Map<string, number>();
const _localCampaignSpend = new Map<string, number>();
const _localRefinementWins = new Map<string, number>();
const _localRefinementRuns = new Map<string, number>();

function isEnabled(): boolean {
  return String(process.env.COST_GOVERNANCE_ENABLED ?? 'false').toLowerCase() === 'true';
}

function getRedisOrNull(): IORedis | null {
  if (!isEnabled()) return null;
  if (_failureCount >= FAILURE_DISABLE_THRESHOLD) return null;
  if (_client) return _client;
  try {
    const { getInstrumentedStandaloneRedisClient } =
      require('../queue/standaloneRedisClient') as typeof import('../queue/standaloneRedisClient');
    _client = getInstrumentedStandaloneRedisClient('planner-cost-governance');
    return _client;
  } catch (err) {
    _failureCount = FAILURE_DISABLE_THRESHOLD;
    logger.warn('cost_governance_unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Record a planner LLM cost sample. Called by the gateway after each
 * successful provider call. Adds to per-org + per-campaign rolling spend.
 *
 * Mirrors to Redis when enabled; local-only when not.
 */
export async function recordPlannerCost(
  orgId: string | null,
  campaignId: string | null,
  costUsd: number,
): Promise<void> {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return;
  if (orgId) {
    _localOrgSpend.set(orgId, (_localOrgSpend.get(orgId) ?? 0) + costUsd);
  }
  if (campaignId) {
    _localCampaignSpend.set(campaignId, (_localCampaignSpend.get(campaignId) ?? 0) + costUsd);
  }
  const client = getRedisOrNull();
  if (!client) return;
  try {
    const now = Date.now();
    const member = `${now}:${Math.random().toString(36).slice(2, 8)}:${costUsd}`;
    const pipeline = client.multi();
    if (orgId) {
      const key = `${REDIS_KEY_ORG_SPEND}${orgId}`;
      pipeline.zadd(key, now, member);
      pipeline.zremrangebyscore(key, '-inf', now - ROLLING_WINDOW_MS);
      pipeline.pexpire(key, ROLLING_WINDOW_MS * 2);
    }
    if (campaignId) {
      const key = `${REDIS_KEY_CAMPAIGN_SPEND}${campaignId}`;
      pipeline.zadd(key, now, member);
      pipeline.zremrangebyscore(key, '-inf', now - ROLLING_WINDOW_MS);
      pipeline.pexpire(key, ROLLING_WINDOW_MS * 2);
    }
    await pipeline.exec();
  } catch (err) {
    _failureCount += 1;
    logger.warn('cost_governance_record_failed', {
      org_id: orgId,
      campaign_id: campaignId,
      cost_usd: costUsd,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Record a refinement outcome. `win=true` when the refinement produced a
 * materially better plan (heuristic: completed without falling back to
 * placeholder AND not stale-revision-skipped). Used by `shouldRefine`'s
 * ROI calculation.
 */
export async function recordRefinementOutcome(
  campaignId: string,
  win: boolean,
): Promise<void> {
  if (!campaignId) return;
  _localRefinementRuns.set(campaignId, (_localRefinementRuns.get(campaignId) ?? 0) + 1);
  if (win) _localRefinementWins.set(campaignId, (_localRefinementWins.get(campaignId) ?? 0) + 1);
  const client = getRedisOrNull();
  if (!client) return;
  try {
    const now = Date.now();
    const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;
    const pipeline = client.multi();
    pipeline.zadd(`${REDIS_KEY_REFINEMENT_RUN}${campaignId}`, now, member);
    pipeline.pexpire(`${REDIS_KEY_REFINEMENT_RUN}${campaignId}`, ROLLING_WINDOW_MS * 2);
    if (win) {
      pipeline.zadd(`${REDIS_KEY_REFINEMENT_WIN}${campaignId}`, now, member);
      pipeline.pexpire(`${REDIS_KEY_REFINEMENT_WIN}${campaignId}`, ROLLING_WINDOW_MS * 2);
    }
    await pipeline.exec();
  } catch (err) {
    _failureCount += 1;
    logger.warn('cost_governance_outcome_record_failed', {
      campaign_id: campaignId,
      win,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function readOrgSpendUsd(orgId: string): Promise<number> {
  const client = getRedisOrNull();
  if (!client) return _localOrgSpend.get(orgId) ?? 0;
  try {
    const now = Date.now();
    const key = `${REDIS_KEY_ORG_SPEND}${orgId}`;
    await client.zremrangebyscore(key, '-inf', now - ROLLING_WINDOW_MS);
    // Cost is encoded in member as `${ts}:${rand}:${cost}`. Sum.
    const members = await client.zrange(key, 0, -1);
    let total = 0;
    for (const m of members) {
      const parts = m.split(':');
      const c = parseFloat(parts[parts.length - 1]);
      if (Number.isFinite(c)) total += c;
    }
    return total;
  } catch {
    return _localOrgSpend.get(orgId) ?? 0;
  }
}

async function readRefinementRoi(campaignId: string): Promise<{ wins: number; runs: number; roi: number }> {
  const client = getRedisOrNull();
  if (!client) {
    const runs = _localRefinementRuns.get(campaignId) ?? 0;
    const wins = _localRefinementWins.get(campaignId) ?? 0;
    return { wins, runs, roi: runs > 0 ? wins / runs : 1 };
  }
  try {
    const [runs, wins] = await Promise.all([
      client.zcard(`${REDIS_KEY_REFINEMENT_RUN}${campaignId}`),
      client.zcard(`${REDIS_KEY_REFINEMENT_WIN}${campaignId}`),
    ]);
    return { runs, wins, roi: runs > 0 ? wins / runs : 1 };
  } catch {
    const runs = _localRefinementRuns.get(campaignId) ?? 0;
    const wins = _localRefinementWins.get(campaignId) ?? 0;
    return { wins, runs, roi: runs > 0 ? wins / runs : 1 };
  }
}

export interface CostGuidance {
  shouldRefine: boolean;
  shouldPreferCheaperModel: boolean;
  rollingOrgSpendUsd: number;
  refinementRoi: number;
  reasons: string[];
}

/**
 * Returns a recommendation for the current planner request. The orchestrator
 * is free to honor or ignore — cluster overload mode wins when stricter.
 */
export async function getCostGuidance(
  orgId: string | null,
  campaignId: string | null,
): Promise<CostGuidance> {
  const reasons: string[] = [];
  if (!isEnabled()) {
    return { shouldRefine: true, shouldPreferCheaperModel: false, rollingOrgSpendUsd: 0, refinementRoi: 1, reasons: ['cost_governance_disabled'] };
  }
  let shouldRefine = true;
  let shouldPreferCheaperModel = false;
  let rollingSpend = 0;
  let roi = 1;
  if (orgId) {
    rollingSpend = await readOrgSpendUsd(orgId);
    const cap = Number(process.env.PLANNER_ORG_SPEND_CAP_USD || '');
    if (Number.isFinite(cap) && cap > 0 && rollingSpend >= cap) {
      shouldRefine = false;
      shouldPreferCheaperModel = true;
      reasons.push(`org_spend_cap_reached:${rollingSpend.toFixed(2)}/${cap}`);
    } else if (Number.isFinite(cap) && cap > 0 && rollingSpend >= cap * 0.8) {
      shouldPreferCheaperModel = true;
      reasons.push(`org_spend_approaching_cap:${rollingSpend.toFixed(2)}/${cap}`);
    }
  }
  if (campaignId) {
    const r = await readRefinementRoi(campaignId);
    roi = r.roi;
    const threshold = Number(process.env.REFINEMENT_ROI_THRESHOLD || 0.30);
    if (r.runs >= 5 && r.roi < threshold) {
      shouldRefine = false;
      reasons.push(`refinement_roi_below_threshold:${r.roi.toFixed(2)}<${threshold}`);
    }
  }
  if (reasons.length === 0) reasons.push('healthy');
  return {
    shouldRefine,
    shouldPreferCheaperModel,
    rollingOrgSpendUsd: Number(rollingSpend.toFixed(2)),
    refinementRoi: Number(roi.toFixed(2)),
    reasons,
  };
}

/**
 * Test-only: reset local counters.
 */
export function __resetCostGovernanceForTests(): void {
  _localOrgSpend.clear();
  _localCampaignSpend.clear();
  _localRefinementWins.clear();
  _localRefinementRuns.clear();
  _failureCount = 0;
}

/**
 * Snapshot for ops dashboards. Returns null when Redis is unavailable.
 */
export async function costGovernanceSnapshot(orgId: string): Promise<{
  rolling_org_spend_usd: number;
  rolling_window_ms: number;
  refinement_runs_24h: number;
  enabled: boolean;
} | null> {
  if (!isEnabled()) {
    return { rolling_org_spend_usd: 0, rolling_window_ms: ROLLING_WINDOW_MS, refinement_runs_24h: 0, enabled: false };
  }
  const spend = await readOrgSpendUsd(orgId);
  return {
    rolling_org_spend_usd: Number(spend.toFixed(2)),
    rolling_window_ms: ROLLING_WINDOW_MS,
    refinement_runs_24h: _localRefinementRuns.get(orgId) ?? 0,
    enabled: true,
  };
}

void getRequestContext; // imported for future per-request tagging
