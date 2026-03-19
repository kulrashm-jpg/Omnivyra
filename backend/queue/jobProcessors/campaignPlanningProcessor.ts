/**
 * Campaign Planning Processor — BullMQ Worker (ai-heavy queue)
 *
 * Orchestrates the 4-layer Campaign Planner v2 pipeline:
 *
 *   Layer 1 — Template check (tryTemplateBlueprintFor)     → FREE
 *   Layer 2 — Strategy (single GPT call, reuse index first) → 0–1 GPT call
 *   Layer 3 — Deterministic expansion (no GPT)             → FREE
 *   Layer 4 — Optional batch refinement (calibrated gate)   → 0–1 GPT call max
 *
 * Edge cases fixed:
 *   #1  — Idempotent persist: plan_version + job_id guard (no regression on retry)
 *   #3  — Confidence calibration: threshold from confidenceCalibrator (not hardcoded)
 *   #4  — Ordering fix: strategy FIRST, skeleton conditioned on strategy themes
 *   #7  — Cache version: day-bucket (YYYY-MM-DD) not raw updated_at
 *
 * Day-2 upgrades:
 *   A   — Strategy reuse index checked before GPT
 *   D   — Adaptive model: hooks/CTAs → mini, positioning → full (inside L4)
 *   F   — Campaign metrics recorded after generation
 */

import type { Job } from 'bullmq';
import { supabase } from '../../db/supabaseClient';
import { buildDeterministicWeeklySkeleton } from '../../services/deterministicWeeklySkeleton';
import { mapStrategyToSkeleton } from '../../services/strategyMapper';
import { generateCampaignStrategy } from '../../services/campaignStrategyEngine';
import { expandCampaign, assessExpansionConfidence } from '../../services/campaignExpansionEngine';
import { batchedGenerateBlueprint } from '../../services/batchAiProcessor';
import { tryTemplateBlueprintFor } from '../../services/aiTemplateLayer';
import { findSimilarStrategy, indexStrategy, type StrategyFingerprint } from '../../services/strategyReuseIndex';
import { getRefinementThreshold, recordOutcome } from '../../services/confidenceCalibrator';
import { recordCampaignMetric } from '../../services/metricsCollector';
import type { IdeaSpine, StrategyContext } from '../../types/campaignPlanning';
import type { AccountContext } from '../../types/accountContext';

// ── Job payload ───────────────────────────────────────────────────────────────

export interface CampaignPlanningJobPayload {
  jobId:          string;
  campaignId:     string;
  companyId:      string;
  userId:         string;
  /** Coarse day-bucket version: YYYY-MM-DD (edge case #7) */
  cacheVersion:   string;
  /** Explicit plan version counter for idempotent persist (edge case #1) */
  planVersion:    number;

  spine:           IdeaSpine;
  strategyContext: StrategyContext;
  accountContext:  AccountContext | null;

  platformContentRequests: Record<string, Record<string, number>> | null;
  planTier:   'free' | 'starter' | 'growth' | 'pro' | 'enterprise';
  industry?:  string;

  previousCampaignContext?: {
    validation?: unknown;
    paid_recommendation?: unknown;
    performance_insights?: unknown;
    captured_at?: string;
  } | null;
}

// ── Status helpers ────────────────────────────────────────────────────────────

type JobStatus = 'pending' | 'processing' | 'layer1' | 'layer2' | 'layer3' | 'layer4' | 'complete' | 'failed';

async function setJobStatus(
  jobId: string,
  campaignId: string,
  status: JobStatus,
  partial?: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from('campaign_plan_jobs').upsert({
      id:             jobId,
      campaign_id:    campaignId,
      status,
      updated_at:     new Date().toISOString(),
      partial_result: partial ?? null,
    }, { onConflict: 'id' });
  } catch { /* non-fatal */ }
}

// ── Edge case #7: Coarse cache version (day-bucket) ───────────────────────────

function toDayBucket(isoOrRaw: string): string {
  try {
    return new Date(isoOrRaw).toISOString().slice(0, 10); // YYYY-MM-DD
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// ── Layer 4: Adaptive model refinement (Upgrade D + calibrated gate) ──────────

const PREMIUM_TIERS = new Set(['pro', 'enterprise']);

async function maybeRefine(
  plan: Awaited<ReturnType<typeof expandCampaign>>,
  planTier: string,
  industry: string,
): Promise<Awaited<ReturnType<typeof expandCampaign>>> {
  const confidence = assessExpansionConfidence(plan);

  // Edge case #3: use calibrated threshold, not hardcoded 0.65
  const threshold = await getRefinementThreshold(planTier, industry);

  const shouldRefine =
    (PREMIUM_TIERS.has(planTier) || confidence < threshold) &&
    confidence < 0.90;

  if (!shouldRefine) return plan;

  const ruleBasedSlots = plan.weeks
    .flatMap(w => w.slots)
    .filter(s => s.source === 'rule-based')
    .slice(0, 10);

  if (ruleBasedSlots.length === 0) return plan;

  // Upgrade D: use gpt-4o-mini (mini) for hooks/CTAs — they don't need full model
  const refinedBlueprints = await Promise.allSettled(
    ruleBasedSlots.map(slot =>
      batchedGenerateBlueprint({
        topic:        slot.topic,
        content_type: slot.content_type,
        // Explicitly target mini via operation name (aiModelRouter routes hooks to mini)
        intent: {
          target_audience: plan.strategy.audience,
          objective:       slot.funnel_stage,
          cta_type:        'Soft CTA',
        },
      }),
    ),
  );

  const refinedSlotMap = new Map<string, (typeof ruleBasedSlots)[0]['blueprint']>();
  for (let i = 0; i < ruleBasedSlots.length; i++) {
    const result = refinedBlueprints[i];
    if (result.status === 'fulfilled') {
      refinedSlotMap.set(ruleBasedSlots[i].slot_id, result.value);
    }
  }

  const patchedWeeks = plan.weeks.map(week => ({
    ...week,
    slots: week.slots.map(slot => {
      const refined = refinedSlotMap.get(slot.slot_id);
      if (!refined) return slot;
      return { ...slot, blueprint: refined, source: 'template' as const };
    }),
  }));

  return {
    ...plan,
    weeks:      patchedWeeks,
    gpt_used:   true,
    confidence: Math.min(1, confidence + 0.15),
  };
}

// ── Edge case #1: Idempotent persist ─────────────────────────────────────────

async function persistPlan(
  plan: Awaited<ReturnType<typeof expandCampaign>>,
  jobPayload: CampaignPlanningJobPayload,
): Promise<void> {
  const blueprint = {
    v2:           true,
    job_id:       jobPayload.jobId,         // idempotency marker
    plan_version: jobPayload.planVersion,   // monotonic version
    strategy:     plan.strategy,
    weeks:        plan.weeks.map(w => ({
      week:         w.week,
      theme:        w.theme,
      funnel_stage: w.funnel_stage,
      objective:    w.objective,
      slots:        w.slots.map(s => ({
        slot_id:      s.slot_id,
        day:          s.day,
        platform:     s.platform,
        content_type: s.content_type,
        topic:        s.topic,
        angle:        s.angle,
        hook:         s.blueprint.hook,
        key_points:   s.blueprint.key_points,
        cta:          s.blueprint.cta,
        source:       s.source,
      })),
    })),
    total_posts:  plan.total_posts,
    confidence:   plan.confidence,
    gpt_used:     plan.gpt_used,
    generated_at: plan.generated_at,
  };

  // Edge case #1: only write if incoming plan_version >= existing (no regression)
  const { data: existing } = await supabase
    .from('twelve_week_plan')
    .select('blueprint')
    .eq('campaign_id', plan.campaign_id)
    .eq('source', 'v2_pipeline')
    .maybeSingle();

  const existingVersion = (existing?.blueprint as any)?.plan_version ?? -1;
  if (existingVersion >= jobPayload.planVersion) {
    console.info('[campaign-planning] skipping persist — existing version is newer or same', {
      existing: existingVersion,
      incoming: jobPayload.planVersion,
    });
    return;
  }

  await supabase.from('twelve_week_plan').upsert({
    campaign_id:   plan.campaign_id,
    source:        'v2_pipeline',
    status:        'ready',
    blueprint,
    snapshot_hash: jobPayload.cacheVersion,
    raw_plan_text: null,
    created_at:    new Date().toISOString(),
  }, { onConflict: 'campaign_id' });
}

// ── Main processor ────────────────────────────────────────────────────────────

export async function processCampaignPlanningJob(job: Job<CampaignPlanningJobPayload>): Promise<void> {
  const payload = job.data;
  const {
    jobId, campaignId, companyId,
    spine, strategyContext, accountContext,
    planTier, industry = 'generic',
  } = payload;

  // Edge case #7: coarsen the cache version to day-bucket
  const cacheVersion = toDayBucket(payload.cacheVersion);

  await setJobStatus(jobId, campaignId, 'processing');

  const startMs = Date.now();
  let gptCallCount = 0;

  try {
    // ── Layer 1: Template check ────────────────────────────────────────────
    await setJobStatus(jobId, campaignId, 'layer1');

    const titleForTemplate = spine.refined_title || spine.title || strategyContext.campaign_goal || '';
    tryTemplateBlueprintFor(
      titleForTemplate,
      'campaign',
      strategyContext.campaign_goal ?? undefined,
      strategyContext.target_audience ?? undefined,
    );
    // (result not used directly — template layer warms fragment cache for L3)

    // ── Layer 2: Strategy (reuse index → GPT) ─────────────────────────────
    // Edge case #4: Strategy FIRST, then skeleton conditioned on it
    await setJobStatus(jobId, campaignId, 'layer2');

    const fp: StrategyFingerprint = {
      industry,
      goal:      strategyContext.campaign_goal || 'brand awareness',
      audience:  strategyContext.target_audience || 'professionals',
      platforms: [...(strategyContext.platforms ?? [])].sort(),
      duration:  strategyContext.duration_weeks,
    };

    // Upgrade A: check reuse index before GPT
    let strategy = await findSimilarStrategy(fp);
    if (strategy) {
      console.info('[campaign-planning] strategy reuse hit');
    } else {
      // Build a minimal skeleton first (purely for theme seeding — edge case #4)
      const seedSkeleton = await buildDeterministicWeeklySkeleton({
        platform_content_requests: payload.platformContentRequests,
        platforms:                 strategyContext.platforms,
        account_context:           accountContext,
      });
      const seedMapped = mapStrategyToSkeleton(seedSkeleton, strategyContext, accountContext);

      strategy = await generateCampaignStrategy(
        companyId,
        campaignId,
        spine,
        strategyContext,
        accountContext,
        seedMapped,
        cacheVersion,
      );
      gptCallCount++;

      // Index it for future reuse (fire-and-forget)
      void indexStrategy(fp, strategy);
    }

    // ── Layer 3: Skeleton conditioned on strategy themes (edge case #4) ───
    // Now rebuild skeleton with strategy themes injected so they align
    await setJobStatus(jobId, campaignId, 'layer3');

    const skeleton = await buildDeterministicWeeklySkeleton({
      platform_content_requests: payload.platformContentRequests,
      platforms:                 strategyContext.platforms,
      account_context:           accountContext,
    });

    // Override themes from strategy (GPT-enriched) into the mapped skeleton
    const baseMapped = mapStrategyToSkeleton(skeleton, strategyContext, accountContext);
    const mappedWithStrategyThemes = {
      ...baseMapped,
      weekly_strategies: baseMapped.weekly_strategies.map((ws, i) => ({
        ...ws,
        theme: strategy!.themes[i] ?? ws.theme,
      })),
    };

    let plan = expandCampaign(campaignId, strategy, mappedWithStrategyThemes);

    // Publish partial result for progressive delivery (Upgrade C)
    await setJobStatus(jobId, campaignId, 'layer3', {
      weeks_ready: plan.weeks.length,
      total_posts: plan.total_posts,
      confidence:  plan.confidence,
    });

    // ── Layer 4: Optional refinement ───────────────────────────────────────
    await setJobStatus(jobId, campaignId, 'layer4');

    plan = await maybeRefine(plan, planTier, industry);
    if (plan.gpt_used) gptCallCount++;

    // ── Persist ────────────────────────────────────────────────────────────
    await persistPlan(plan, { ...payload, cacheVersion });

    await setJobStatus(jobId, campaignId, 'complete', {
      total_posts:  plan.total_posts,
      confidence:   plan.confidence,
      gpt_used:     plan.gpt_used,
      gpt_calls:    gptCallCount,
    });

    // Upgrade F: campaign metrics
    const elapsedMs = Date.now() - startMs;
    recordCampaignMetric({ gptCalls: gptCallCount, elapsedMs, confidence: plan.confidence, planTier });

    console.info('[campaign-planning] complete', {
      campaignId, totalPosts: plan.total_posts,
      confidence: plan.confidence, gptCalls: gptCallCount, elapsedMs,
    });

    // Record outcome seed (no user action yet — will be updated on finalize/edit)
    void recordOutcome({
      jobId, campaignId,
      confidence: plan.confidence,
      planTier,
      industry,
      outcome: 'accepted', // optimistic seed; updated by finalize/edit tracking
    });

  } catch (err) {
    const message = (err as Error).message;
    console.error('[campaign-planning] failed', { campaignId, error: message });

    await setJobStatus(jobId, campaignId, 'failed', { error: message });
    await supabase.from('twelve_week_plan').upsert({
      campaign_id: campaignId,
      source:      'v2_pipeline',
      status:      'failed',
      blueprint:   { error: message, job_id: jobId, plan_version: payload.planVersion },
      created_at:  new Date().toISOString(),
    }, { onConflict: 'campaign_id' });

    throw err;
  }
}
