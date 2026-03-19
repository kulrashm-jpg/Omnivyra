/**
 * Campaign Planner v2 — Async Enqueue Endpoint
 *
 * POST /api/campaigns/ai/plan-v2
 *
 * Edge cases fixed:
 *   #2 — Race condition: DB "existing job" check removed — BullMQ jobId dedup is the lock
 *   #6 — 429 UX contract: product-friendly response shape with suggestion
 *   #7 — Cache version: day-bucket (YYYY-MM-DD) not raw updated_at
 *
 * Response: 202 { jobId, pollUrl, estimatedMs }
 * Error codes: 400 | 402 | 429 | 500
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getAiHeavyQueue, makeStableJobId } from '../../../../backend/queue/bullmqClient';
import { safeEnqueue } from '../../../../backend/middleware/queueBackpressure';
import { quickEstimateCost } from '../../../../backend/services/jobCostEstimator';
import { resolveOrganizationPlanLimits } from '../../../../backend/services/planResolutionService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getUserCompanyRole } from '../../../../backend/services/rbacService';
import type { CampaignPlanningJobPayload } from '../../../../backend/queue/jobProcessors/campaignPlanningProcessor';

const BLOCKED_PLANS = new Set(['free', 'trial']);

// ── Edge case #7: coarse day-bucket version ───────────────────────────────────

function toDayBucket(isoDate?: string | null): string {
  try {
    return new Date(isoDate ?? Date.now()).toISOString().slice(0, 10); // YYYY-MM-DD
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// ── Input validation ──────────────────────────────────────────────────────────

function validateInput(body: unknown): body is Record<string, unknown> {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  if (typeof b.campaignId !== 'string' || !b.campaignId) return false;
  if (typeof b.companyId  !== 'string' || !b.companyId)  return false;
  if (!b.spine || typeof b.spine !== 'object')             return false;
  if (!b.strategyContext || typeof b.strategyContext !== 'object') return false;
  const ctx = b.strategyContext as Record<string, unknown>;
  if (!Array.isArray(ctx.platforms) || ctx.platforms.length === 0) return false;
  if (typeof ctx.duration_weeks !== 'number' || ctx.duration_weeks < 1) return false;
  return true;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const body = req.body || {};
  const companyIdRaw = typeof body.companyId === 'string' ? body.companyId.trim() : '';
  if (!companyIdRaw) return res.status(400).json({ error: 'companyId is required' });

  const access = await getUserCompanyRole(req, companyIdRaw);
  const userId = access.userId;
  if (!userId) return res.status(401).json({ error: 'UNAUTHORIZED' });

  // ── Validate input ────────────────────────────────────────────────────────
  if (!validateInput(body)) {
    return res.status(400).json({
      error: 'Invalid input: campaignId, companyId, spine, and strategyContext (with platforms[] and duration_weeks) are required.',
    });
  }

  const {
    campaignId,
    companyId,
    spine,
    strategyContext,
    accountContext,
    platformContentRequests,
    previousCampaignContext,
    industry,
  } = body as Record<string, unknown>;

  // ── Plan tier ─────────────────────────────────────────────────────────────
  let planTier = 'growth';
  try {
    const resolved = await resolveOrganizationPlanLimits(companyId as string);
    planTier = (resolved.plan_key ?? 'growth').toLowerCase();
  } catch { /* fail open */ }

  if (BLOCKED_PLANS.has(planTier)) {
    return res.status(402).json({
      status:      'blocked',
      error:       `The ${planTier} plan does not support async campaign generation.`,
      code:        'PLAN_NOT_SUPPORTED',
      suggestion:  'Upgrade to Starter or above to unlock async campaign planning.',
    });
  }

  // ── Cost estimation ───────────────────────────────────────────────────────
  const estimatedUsd = quickEstimateCost(
    process.env.OPENAI_MODEL || 'gpt-4o-mini',
    JSON.stringify({ spine, strategyContext }),
    'generateCampaignPlan',
  );

  // ── Stable job ID — this IS the deduplication lock (edge case #2) ─────────
  // BullMQ silently ignores add() when a job with this jobId already exists
  // in waiting/active/delayed. No separate DB check needed.
  const jobId = makeStableJobId('campaign-plan', {
    campaignId,
    companyId,
    duration:  (strategyContext as any).duration_weeks,
    platforms: [...((strategyContext as any).platforms ?? [])].sort(),
    goal:      (strategyContext as any).campaign_goal ?? '',
  });

  // ── Edge case #7: day-bucket cache version ────────────────────────────────
  let cacheVersion = toDayBucket();
  try {
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('updated_at')
      .eq('id', campaignId as string)
      .maybeSingle();
    if (campaign?.updated_at) cacheVersion = toDayBucket(campaign.updated_at);
  } catch { /* use today's bucket */ }

  // ── Plan version: increment over existing (idempotent persist, edge case #1) ─
  let planVersion = 1;
  try {
    const { data: existingPlan } = await supabase
      .from('twelve_week_plan')
      .select('blueprint')
      .eq('campaign_id', campaignId as string)
      .eq('source', 'v2_pipeline')
      .maybeSingle();
    const existingVersion = (existingPlan?.blueprint as any)?.plan_version ?? 0;
    planVersion = existingVersion + 1;
  } catch { /* default to 1 */ }

  // ── Create job status row (advisory — poller can find it immediately) ──────
  // OK if concurrent request also upserts — idempotent by design
  try {
    await supabase.from('campaign_plan_jobs').upsert({
      id:          jobId,
      campaign_id: campaignId,
      status:      'pending',
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'id' });
  } catch { /* advisory — non-fatal */ }

  // ── Build payload ─────────────────────────────────────────────────────────
  const payload: CampaignPlanningJobPayload = {
    jobId,
    campaignId:    campaignId as string,
    companyId:     companyId as string,
    userId,
    cacheVersion,
    planVersion,
    spine:                   spine as CampaignPlanningJobPayload['spine'],
    strategyContext:         strategyContext as CampaignPlanningJobPayload['strategyContext'],
    accountContext:          (accountContext ?? null) as CampaignPlanningJobPayload['accountContext'],
    platformContentRequests: (platformContentRequests ?? null) as CampaignPlanningJobPayload['platformContentRequests'],
    planTier:                planTier as CampaignPlanningJobPayload['planTier'],
    industry:                typeof industry === 'string' ? industry : undefined,
    previousCampaignContext: previousCampaignContext as CampaignPlanningJobPayload['previousCampaignContext'],
  };

  // ── Enqueue (BullMQ drops duplicate jobId silently — edge case #2) ────────
  const queue    = getAiHeavyQueue();
  const enqueued = await safeEnqueue(
    queue,
    'ai-heavy',
    'campaign-planning',
    payload as unknown as Record<string, unknown>,
    { jobId, priority: 10 },
  );

  // Edge case #6: product-friendly 429 response
  if (!enqueued) {
    return res.status(429).json({
      status:       'delayed',
      error:        'Service is currently at capacity.',
      code:         'QUEUE_FULL',
      retryAfterMs: 60_000,
      suggestion:   'Try again in ~1 minute. Pro and Enterprise plans get priority queue access.',
    });
  }

  return res.status(202).json({
    jobId,
    status:       'pending',
    estimatedMs:  15_000,
    estimatedUsd,
    pollUrl:      `/api/campaigns/ai/plan-status/${jobId}`,
  });
}
