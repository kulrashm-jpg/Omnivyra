import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { withIdempotency } from '../../../../backend/middleware/withIdempotency';

/**
 * POST /api/campaigns/[id]/release — Strategic Mix P1, the Release Seam.
 *
 * THE handoff from Strategic Mix planning into the EXISTING execution pipeline.
 * Before this route the planner could finalize a campaign but nothing could
 * schedule it: `planner-finalize` stops at `current_stage='execution_ready'`
 * with `status='planning'`, and the publish worker refuses any campaign whose
 * status is not `active` (publishProcessor.ts, PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE).
 *
 * This route COMPOSES; it does not reimplement. Everything it uses already
 * existed and is already proven in production by the BOLT pipeline:
 *
 *   governance lockdown  → isGovernanceLocked
 *   authorization        → requireCampaignAccess (campaign RBAC)
 *   request replay       → withIdempotency
 *   concurrency          → acquireSchedulerLock / releaseSchedulerLock
 *   blueprint guards     → assertBlueprintActive / assertBlueprintMutable
 *   finalization guard   → assertCampaignNotFinalized
 *   creator governance   → assertNoUnschedulableCreatorDailyPlans
 *   eligibility policy   → lib/campaign/campaignRelease (pure)
 *   scheduling           → scheduleStructuredPlan  ← the ONE scheduler
 *   content adoption     → resolveWorkspaceContent (inside processBlockSchedule)
 *   post idempotency     → scheduled_posts idempotency_key unique index
 *   audit                → recordGovernanceEvent
 *
 * ── Why this route does NOT call assertSchedulerExecutable ──────────────────
 * That guard (SchedulerIntegrityGuard) requires `execution_status='ACTIVE'`
 * AND `duration_locked=true`. NOTHING in production sets either column — only
 * test fixtures do — which is precisely why `schedule-structured-plan` is
 * unreachable for a planner-built campaign. The LIVE, production-proven
 * scheduling path (boltPipelineServiceRunExecWeekly) does not call that guard
 * either: it invokes `scheduleStructuredPlan` directly and then applies
 * `{ status:'active', current_stage:'schedule', blueprint_status:'ACTIVE' }`.
 * This route mirrors that proven path exactly. No guard is weakened — the
 * guard was never on this path, and `schedule-structured-plan` keeps it
 * untouched.
 *
 * ── Status transition ───────────────────────────────────────────────────────
 * Identical to the live BOLT path and to `commit-plan`: the same three fields,
 * written once, after a successful schedule. `campaignStage.ts` remains the
 * sole INTERPRETER of those axes (it is a read model and never writes); the
 * canonical stage consequently advances ready → scheduling, and → executing
 * once execution_status is set by the execution services that own it.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { ownedDbTable } from '../../../../backend/db/writeOwner';
import { isGovernanceLocked } from '../../../../backend/services/GovernanceLockdownService';
import { requireCampaignAccess } from '../../../../backend/services/campaignAccessService';
import {
  scheduleStructuredPlan,
  ScheduleEligibilityError,
} from '../../../../backend/services/structuredPlanScheduler';
import {
  assertBlueprintActive,
  assertBlueprintMutable,
  BlueprintImmutableError,
  BlueprintExecutionFreezeError,
} from '../../../../backend/services/campaignBlueprintService';
import {
  assertCampaignNotFinalized,
  CampaignFinalizedError,
} from '../../../../backend/services/CampaignFinalizationGuard';
import { normalizeExecutionState } from '../../../../backend/governance/ExecutionStateMachine';
import {
  acquireSchedulerLock,
  releaseSchedulerLock,
  SchedulerLockError,
} from '../../../../backend/services/SchedulerLockService';
import { recordGovernanceEvent } from '../../../../backend/services/GovernanceEventService';
import { syncCampaignVersionStage } from '../../../../backend/db/campaignVersionStore';
import { checkAndCompleteCampaignIfEligible } from '../../../../backend/services/CampaignCompletionService';
import { resolveCampaignStage } from '../../../../lib/campaign/campaignStage';
import {
  deriveReleasePlan,
  parseReleaseScope,
  type ReleaseCandidateRow,
  type ReleaseScope,
} from '../../../../lib/campaign/campaignRelease';
import {
  CreatorScheduleGovernanceError,
  assertNoUnschedulableCreatorDailyPlans,
} from '../../../../lib/shared/creatorGovernanceRegistry';

const isScheduleEligibilityError = (e: unknown): e is ScheduleEligibilityError =>
  typeof ScheduleEligibilityError === 'function' && e instanceof ScheduleEligibilityError;

/** Latest campaign_versions row — company scope + the plan the planner committed. */
async function loadVersionContext(campaignId: string): Promise<{
  companyId: string | null;
  executionProfile: string;
  weeks: unknown[];
}> {
  // Fail-safe: a missing/unreadable version row degrades to text profile with
  // no snapshot plan (the daily-plan path still drives the run). It must never
  // reject the release before the guarded try block below.
  let data: Record<string, unknown> | null = null;
  try {
    const result = await supabase
      .from('campaign_versions')
      .select('company_id, campaign_snapshot')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    data = (result?.data ?? null) as Record<string, unknown> | null;
  } catch {
    data = null;
  }
  const snapshot = ((data as Record<string, unknown> | null)?.campaign_snapshot ?? {}) as Record<string, unknown>;
  const executionConfig = (snapshot.execution_config ?? snapshot.executionConfig ?? {}) as Record<string, unknown>;
  const plan = (snapshot.plan ?? snapshot.structured_plan ?? {}) as Record<string, unknown>;
  return {
    companyId: ((data as Record<string, unknown> | null)?.company_id as string | undefined) ?? null,
    executionProfile: String(
      executionConfig.campaign_mode ?? executionConfig.campaignMode ?? 'text',
    ).trim().toLowerCase(),
    weeks: Array.isArray(plan.weeks) ? (plan.weeks as unknown[]) : [],
  };
}

/**
 * The structured plan handed to the scheduler. A planner-finalized campaign
 * always has daily_content_plans rows (planner-finalize writes them), so the
 * scheduler's daily-plan path drives the run and `weeks` is only the blueprint
 * envelope. Reconstructed from the rows when the snapshot has no plan.
 */
function buildWeeksEnvelope(snapshotWeeks: unknown[], rows: ReleaseCandidateRow[]): unknown[] {
  if (snapshotWeeks.length > 0) return snapshotWeeks;
  const byWeek = new Map<number, { week_number: number; days: unknown[] }>();
  for (const row of rows) {
    const w = Number(row.week_number);
    if (!Number.isFinite(w)) continue;
    if (!byWeek.has(w)) byWeek.set(w, { week_number: w, days: [] });
  }
  return Array.from(byWeek.values()).sort((a, b) => a.week_number - b.week_number);
}

function summarizeWindow(rows: ReleaseCandidateRow[], ids: string[]): { first: string | null; last: string | null } {
  const set = new Set(ids);
  const stamps = rows
    .filter((r) => set.has(r.id) && r.date)
    .map((r) => `${String(r.date).slice(0, 10)}T${String(r.scheduled_time ?? '00:00:00').slice(0, 8)}`)
    .sort();
  return { first: stamps[0] ?? null, last: stamps[stamps.length - 1] ?? null };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (await isGovernanceLocked()) {
    return res.status(423).json({
      code: 'GOVERNANCE_LOCKED',
      message: 'Governance lockdown active. Mutations disabled.',
    });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  // AUTHORIZATION — campaign RBAC before any read, mutation, lock or event.
  const access = await requireCampaignAccess(req, res, id);
  if (!access) return;

  // NOTE: this repo compiles with `strict: false`, so discriminated-union
  // narrowing on `.ok` does not apply — read both arms explicitly.
  const parsedScope = parseReleaseScope(req.body) as {
    ok: boolean;
    scope?: ReleaseScope;
    error?: string;
  };
  if (!parsedScope.ok || !parsedScope.scope) {
    return res.status(400).json({
      code: 'INVALID_RELEASE_SCOPE',
      message: parsedScope.error ?? 'Invalid release scope',
    });
  }
  const scope: ReleaseScope = parsedScope.scope;

  let lockId: string | null = null;
  const { companyId, executionProfile, weeks: snapshotWeeks } = await loadVersionContext(id);

  try {
    // ── Guards: blueprint must be active + mutable, campaign not finalized ──
    await assertBlueprintActive(id);
    await assertBlueprintMutable(id);

    const { data: campaign, error: campErr } = await supabase
      .from('campaigns')
      .select('id, status, current_stage, execution_status, blueprint_status, thread_id, start_date')
      .eq('id', id)
      .maybeSingle();
    if (campErr || !campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const campaignRow = campaign as Record<string, unknown>;
    assertCampaignNotFinalized(normalizeExecutionState(campaignRow.execution_status as string | null));

    const stageBefore = resolveCampaignStage(campaignRow).stage;
    if (stageBefore === 'draft') {
      return res.status(409).json({
        code: 'CAMPAIGN_NOT_FINALIZED',
        message: 'Finalize the campaign in Strategic Mix before releasing it.',
        stage: stageBefore,
      });
    }
    if (!campaignRow.start_date) {
      return res.status(409).json({
        code: 'CAMPAIGN_START_DATE_MISSING',
        message: 'The campaign has no start date, so its posts cannot be placed on a calendar.',
      });
    }

    // ── Candidate rows: this campaign's finalized plan ────────────────────
    const { data: rowsRaw, error: rowsErr } = await supabase
      .from('daily_content_plans')
      .select('id, week_number, platform, content_type, date, scheduled_time, content, content_status, intent_type, scheduled_post_id')
      .eq('campaign_id', id);
    if (rowsErr) {
      return res.status(500).json({ code: 'PLAN_READ_FAILED', message: 'Could not read the campaign plan.' });
    }
    const rows = (Array.isArray(rowsRaw) ? rowsRaw : []) as unknown as ReleaseCandidateRow[];
    if (rows.length === 0) {
      return res.status(409).json({
        code: 'CAMPAIGN_HAS_NO_CONTENT',
        message: 'This campaign has no planned content to release.',
      });
    }

    // ── Eligibility policy (pure) ────────────────────────────────────────
    const plan = deriveReleasePlan(rows, scope);

    if (plan.unknown_weeks.length > 0) {
      return res.status(400).json({
        code: 'UNKNOWN_WEEKS',
        message: `Weeks not in this campaign: ${plan.unknown_weeks.join(', ')}`,
        unknown_weeks: plan.unknown_weeks,
      });
    }
    if (plan.unknown_slot_ids.length > 0) {
      return res.status(400).json({
        code: 'UNKNOWN_SLOTS',
        message: 'One or more requested slots do not belong to this campaign.',
        unknown_slot_ids: plan.unknown_slot_ids,
      });
    }
    if (plan.eligible_ids.length === 0) {
      return res.status(409).json({
        code: 'NOTHING_RELEASABLE',
        message:
          'Nothing in this selection can be released. Approve draft or in-review content in the Content Workspace first.',
        skipped_by_reason: plan.skipped_by_reason,
        skipped: plan.skipped,
      });
    }

    // ── Creator governance on the rows actually being released ───────────
    const eligibleSet = new Set(plan.eligible_ids);
    const creatorRows = rows.filter(
      (r) => eligibleSet.has(r.id) && (r as unknown as { intent_type?: unknown }).intent_type === 'creator',
    );
    if (creatorRows.length > 0) {
      assertNoUnschedulableCreatorDailyPlans(
        creatorRows as unknown as Array<{ content_type?: unknown }>,
      );
    }

    // ── Concurrency: the EXISTING scheduler lock ─────────────────────────
    lockId = await acquireSchedulerLock(id);
    if (companyId) {
      await recordGovernanceEvent({
        companyId,
        campaignId: id,
        eventType: 'SCHEDULE_STARTED',
        eventStatus: 'STARTED',
        metadata: {
          campaignId: id,
          source: 'strategic-mix-release',
          scope: scope.kind,
          eligible_count: plan.eligible_ids.length,
          approved_count: plan.approved_count,
          skipped_count: plan.skipped.length,
        },
      });
    }

    // ── Schedule through the ONE scheduler ───────────────────────────────
    const result = await scheduleStructuredPlan(
      { weeks: buildWeeksEnvelope(snapshotWeeks, rows) } as Parameters<typeof scheduleStructuredPlan>[0],
      id,
      {
        generateContent: true,
        skipExisting: true,
        executionProfile,
        restrictToDailyPlanIds: plan.eligible_ids,
      },
    );

    // ── Status transition — the SAME three fields the live BOLT path and
    //    commit-plan write. This is what unblocks the publish worker. ─────
    await ownedDbTable('campaigns')
      .update({
        status: 'active',
        current_stage: 'schedule',
        blueprint_status: 'ACTIVE',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    void syncCampaignVersionStage(id, 'schedule', companyId ?? undefined).catch(() => {});
    void checkAndCompleteCampaignIfEligible(id).catch(() => {});

    const { data: after } = await supabase
      .from('campaigns')
      .select('status, current_stage, execution_status, blueprint_status, thread_id')
      .eq('id', id)
      .maybeSingle();
    const stageAfter = resolveCampaignStage((after ?? {}) as Record<string, unknown>).stage;

    if (companyId) {
      await recordGovernanceEvent({
        companyId,
        campaignId: id,
        eventType: 'SCHEDULE_COMPLETED',
        eventStatus: 'COMPLETED',
        metadata: {
          campaignId: id,
          source: 'strategic-mix-release',
          scope: scope.kind,
          scheduled_count: result.scheduled_count,
          skipped_count: result.skipped_count,
          stage_before: stageBefore,
          stage_after: stageAfter,
        },
      });
    }

    const window = summarizeWindow(rows, plan.eligible_ids);
    return res.status(200).json({
      campaign_id: id,
      scope: scope.kind,
      requested_weeks: scope.kind === 'weeks' ? scope.weeks : null,
      requested_slot_ids: scope.kind === 'slots' ? scope.slot_ids : null,
      eligible_count: plan.eligible_ids.length,
      eligible_weeks: plan.eligible_weeks,
      approved_count: plan.approved_count,
      generated_count: plan.generate_count,
      scheduled_count: result.scheduled_count,
      skipped_count: plan.skipped.length + (result.skipped_count ?? 0),
      already_scheduled_count: result.already_scheduled_count ?? 0,
      skipped_by_reason: plan.skipped_by_reason,
      skipped: plan.skipped,
      platforms: plan.platforms,
      skipped_platforms: result.skipped_platforms ?? [],
      first_scheduled_at: window.first,
      last_scheduled_at: window.last,
      stage_before: stageBefore,
      stage: stageAfter,
    });
  } catch (error: unknown) {
    if (error instanceof SchedulerLockError) {
      if (companyId) {
        await recordGovernanceEvent({
          companyId,
          campaignId: id,
          eventType: 'SCHEDULER_LOCK_BLOCKED',
          eventStatus: 'BLOCKED',
          metadata: { campaignId: id, source: 'strategic-mix-release' },
        }).catch(() => {});
      }
      return res.status(409).json({
        code: 'SCHEDULER_ALREADY_RUNNING',
        message: 'This campaign is already being scheduled. Try again in a moment.',
      });
    }
    if (error instanceof CampaignFinalizedError) {
      return res.status(409).json({
        code: 'CAMPAIGN_FINALIZED',
        message: 'Campaign is finalized and cannot be modified.',
      });
    }
    if (error instanceof BlueprintExecutionFreezeError) {
      return res.status(409).json({
        code: 'EXECUTION_WINDOW_FROZEN',
        message: 'Blueprint changes are locked within 24 hours of execution.',
      });
    }
    if (error instanceof BlueprintImmutableError) {
      return res.status(409).json({
        code: 'BLUEPRINT_IMMUTABLE',
        message: 'The blueprint cannot be modified while the campaign is executing.',
      });
    }
    if (error instanceof CreatorScheduleGovernanceError) {
      return res.status(error.statusCode).json(error.payload);
    }
    if (isScheduleEligibilityError(error)) {
      return res.status(409).json({
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }
    const message = error instanceof Error ? error.message : 'Release failed';
    console.error('[campaign-release]', message);
    if (companyId) {
      await recordGovernanceEvent({
        companyId,
        campaignId: id,
        eventType: 'SCHEDULE_ABORTED',
        eventStatus: 'ABORTED',
        metadata: { campaignId: id, source: 'strategic-mix-release', reason: message },
      }).catch(() => {});
    }
    return res.status(500).json({ code: 'RELEASE_FAILED', message });
  } finally {
    if (lockId) {
      await releaseSchedulerLock(id, lockId).catch(() => {});
    }
  }
}

export default __createApiRoute(
  withIdempotency(handler, { methods: ['POST'], scope: 'campaign-release' }),
  { route: '/api/campaigns/:id/release' },
);
