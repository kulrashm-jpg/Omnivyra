/**
 * PHASE SCHEDULER-WRITE-ATOMICITY-HARDENING — creator schedule reconciliation
 * authority.
 *
 * The creator scheduling core (`scheduleCreatorRowPost`) performs TWO separate
 * persistence writes that are not in a single transaction:
 *   write A — INSERT `scheduled_posts`            (creatorRowScheduler.ts:214)
 *   write B — UPDATE `daily_content_plans`        (creatorRowScheduler.ts:292)
 *
 * If the process exits between A and B the row becomes visible in one authority
 * (a scheduled_posts row exists, the scheduler sweep will publish it) but
 * invisible in the other (daily_content_plans never got the `scheduled` flip /
 * `scheduled_post_id` back-pointer, so the calendar still shows it pending).
 *
 * This module is the SMALLEST safe closure: a Reconciliation authority that is
 *   1. OBSERVABLE — `classifyCreatorScheduleDrift` (pure) + `detectCreatorScheduleDrift`
 *      (DB-backed) surface both drift directions without mutating anything.
 *   2. SELF-HEALING for the forward drift — `reconcileCreatorScheduleWrites`
 *      re-invokes the EXISTING idempotent by-id scheduler. Its INSERT collides
 *      on the deterministic `idempotency_key`, recovers the existing
 *      scheduled_post id, and completes write B. No new scheduling decision is
 *      made (eligibility still gates), no scheduled_post is created, publishing
 *      is untouched — the live path stays byte-identical.
 *
 * The reverse drift (daily_content_plans says scheduled but the scheduled_posts
 * row is gone) is DETECTED ONLY. Fabricating a scheduled_post would be a new
 * scheduling decision, which this phase forbids — it is surfaced for an
 * operator instead.
 */

import { ownedDbTable } from '../../db/writeOwner';
import {
  classifyCreatorScheduleDrift,
  type CreatorScheduledPostRow,
  type CreatorDailyPlanRow,
  type ScheduleDrift,
  type DanglingDailyPlan,
} from './creatorScheduleDrift';
import {
  autoScheduleReadyCreatorRowById,
  scheduleRenderedAutonomousRowById,
  type CreatorAttachmentScheduleResult,
} from './creatorRowScheduler';

export {
  classifyCreatorScheduleDrift,
  type CreatorScheduledPostRow,
  type CreatorDailyPlanRow,
  type ScheduleDrift,
  type OrphanedScheduledPost,
  type DanglingDailyPlan,
} from './creatorScheduleDrift';

/** Back-pointer can live in the column (post-migration) or in the content JSON. */
function readBackPointer(row: Record<string, unknown>): string | null {
  const col = row.scheduled_post_id;
  if (typeof col === 'string' && col.trim()) return col.trim();
  const content = row.content;
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const fromJson = parsed?.scheduled_post_id;
      if (typeof fromJson === 'string' && fromJson.trim()) return fromJson.trim();
    } catch {
      /* malformed content — treat as no back-pointer. */
    }
  }
  return null;
}

/**
 * DB-backed OBSERVABLE detection for one campaign. Reads only; mutates nothing.
 */
export async function detectCreatorScheduleDrift(campaignId: string): Promise<ScheduleDrift> {
  const { data: spRaw } = await ownedDbTable('scheduled_posts')
    .select('id, idempotency_key')
    .eq('campaign_id', campaignId);
  const { data: dpRaw } = await ownedDbTable('daily_content_plans')
    .select('id, content_status, scheduled_post_id, content')
    .eq('campaign_id', campaignId);

  const scheduledPosts: CreatorScheduledPostRow[] = ((spRaw as Array<Record<string, unknown>> | null) ?? []).map((r) => ({
    id: String(r.id),
    idempotency_key: (r.idempotency_key as string | null) ?? null,
  }));
  const dailyPlans: CreatorDailyPlanRow[] = ((dpRaw as Array<Record<string, unknown>> | null) ?? []).map((r) => ({
    id: String(r.id),
    content_status: (r.content_status as string | null) ?? null,
    scheduled_post_id: readBackPointer(r),
  }));

  return classifyCreatorScheduleDrift({ scheduledPosts, dailyPlans });
}

export type ReconcileRepair = {
  dailyPlanId: string;
  scheduledPostId: string | null;
  status: CreatorAttachmentScheduleResult['status'] | 'unrepairable';
  reason?: string;
};

export type ReconcileReport = {
  campaignId: string;
  drift: ScheduleDrift;
  repaired: ReconcileRepair[];
  /** detect-only — surfaced for an operator, never auto-fabricated. */
  danglingDailyPlans: DanglingDailyPlan[];
};

/**
 * Reconcile one campaign: complete the lost write B for every recoverable
 * orphan by re-invoking the EXISTING idempotent by-id scheduler. The reverse
 * drift is reported but not repaired.
 *
 * This makes no new scheduling decision and creates no scheduled_post — the
 * re-invoked entry point hits the idempotency collision on the already-present
 * row, recovers its id, and finishes the lifecycle flip + back-pointer.
 */
export async function reconcileCreatorScheduleWrites(campaignId: string): Promise<ReconcileReport> {
  const drift = await detectCreatorScheduleDrift(campaignId);
  const repaired: ReconcileRepair[] = [];

  for (const orphan of drift.orphanedScheduledPosts) {
    if (orphan.reason === 'daily_plan_missing_for_scheduled_post') {
      // The daily plan no longer exists — nothing to flip. Surface only.
      repaired.push({
        dailyPlanId: orphan.dailyPlanId,
        scheduledPostId: orphan.scheduledPostId,
        status: 'unrepairable',
        reason: orphan.reason,
      });
      continue;
    }
    const result = orphan.lane === 'render'
      ? await scheduleRenderedAutonomousRowById(orphan.dailyPlanId)
      : await autoScheduleReadyCreatorRowById(orphan.dailyPlanId);
    repaired.push({
      dailyPlanId: orphan.dailyPlanId,
      scheduledPostId: result.scheduledPostId ?? orphan.scheduledPostId,
      status: result.status,
      reason: result.reason,
    });
  }

  return {
    campaignId,
    drift,
    repaired,
    danglingDailyPlans: drift.danglingDailyPlans,
  };
}
