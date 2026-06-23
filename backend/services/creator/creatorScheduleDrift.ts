/**
 * PHASE SCHEDULER-WRITE-ATOMICITY-HARDENING — pure drift + visibility core.
 *
 * Dependency-light (only the lifecycle-state constant) so it is unit-testable
 * without dragging in the scheduler / queue / redis import chain. The DB-backed
 * detection + repair authority lives in `creatorScheduleReconciler.ts`; the
 * autonomous skip annotation that consumes `buildAutonomousScheduleDiagnostic`
 * lives in `creatorRowScheduler.ts`.
 */

import { CREATOR_LIFECYCLE_STATES } from '../../../lib/shared/creatorGovernanceRegistry';

/** A `scheduled_posts` row as seen by the reconciler (only the keys it needs). */
export type CreatorScheduledPostRow = {
  id: string;
  idempotency_key?: string | null;
};

/** A `daily_content_plans` row as seen by the reconciler. */
export type CreatorDailyPlanRow = {
  id: string;
  content_status?: string | null;
  scheduled_post_id?: string | null;
};

export type OrphanedScheduledPost = {
  scheduledPostId: string;
  dailyPlanId: string;
  /** the deterministic creator idempotency_key that links the two rows. */
  key: string;
  /** 'render' (autonomous) | 'upload' (attachment) — selects the repair entry point. */
  lane: 'render' | 'upload';
  reason: string;
};

export type DanglingDailyPlan = {
  dailyPlanId: string;
  scheduledPostId: string;
  reason: string;
};

export type ScheduleDrift = {
  /** write A landed, write B did not — recoverable. */
  orphanedScheduledPosts: OrphanedScheduledPost[];
  /** daily claims scheduled but the scheduled_posts row is missing — detect-only. */
  danglingDailyPlans: DanglingDailyPlan[];
};

/**
 * Only `scheduled_posts` rows inserted by the creator scheduler carry these
 * deterministic keys (`creator-upload:<id>` / `creator-render:<id>`). Text /
 * block / allocation rows use different keys (or none) and are deliberately
 * ignored so campaign-completion and text scheduling are never touched.
 */
export const CREATOR_IDEMPOTENCY_RE = /^creator-(upload|render):(.+)$/;

/**
 * PURE drift classifier — no I/O, fully unit-testable. Given the campaign's
 * scheduled_posts + daily_content_plans rows, returns both drift directions.
 */
export function classifyCreatorScheduleDrift(input: {
  scheduledPosts: CreatorScheduledPostRow[];
  dailyPlans: CreatorDailyPlanRow[];
}): ScheduleDrift {
  const scheduledPosts = Array.isArray(input.scheduledPosts) ? input.scheduledPosts : [];
  const dailyPlans = Array.isArray(input.dailyPlans) ? input.dailyPlans : [];

  const planById = new Map<string, CreatorDailyPlanRow>();
  for (const plan of dailyPlans) planById.set(String(plan.id), plan);
  const scheduledPostIds = new Set<string>(scheduledPosts.map((s) => String(s.id)));

  const orphanedScheduledPosts: OrphanedScheduledPost[] = [];
  const danglingDailyPlans: DanglingDailyPlan[] = [];

  // Forward drift: a creator scheduled_posts row exists, but its daily plan
  // never received the `scheduled` flip / back-pointer (write B was lost).
  for (const sp of scheduledPosts) {
    const key = String(sp.idempotency_key || '');
    const match = key.match(CREATOR_IDEMPOTENCY_RE);
    if (!match) continue; // not a creator-scheduled row — ignore (text/block/allocation).
    const lane = match[1] === 'render' ? 'render' : 'upload';
    const dailyPlanId = match[2];
    const plan = planById.get(dailyPlanId);
    if (!plan) {
      orphanedScheduledPosts.push({
        scheduledPostId: String(sp.id),
        dailyPlanId,
        key,
        lane,
        reason: 'daily_plan_missing_for_scheduled_post',
      });
      continue;
    }
    const flipped = String(plan.content_status || '') === CREATOR_LIFECYCLE_STATES.SCHEDULED;
    const backPointed = String(plan.scheduled_post_id || '') === String(sp.id);
    if (!flipped && !backPointed) {
      orphanedScheduledPosts.push({
        scheduledPostId: String(sp.id),
        dailyPlanId,
        key,
        lane,
        reason: 'scheduled_post_without_daily_flip',
      });
    }
  }

  // Reverse drift: a daily plan claims `scheduled` with a back-pointer, but the
  // referenced scheduled_posts row is gone. Detect-only (no fabrication).
  for (const plan of dailyPlans) {
    const spId = String(plan.scheduled_post_id || '');
    if (!spId) continue;
    if (String(plan.content_status || '') !== CREATOR_LIFECYCLE_STATES.SCHEDULED) continue;
    if (!scheduledPostIds.has(spId)) {
      danglingDailyPlans.push({
        dailyPlanId: String(plan.id),
        scheduledPostId: spId,
        reason: 'daily_scheduled_without_scheduled_post',
      });
    }
  }

  return { orphanedScheduledPosts, danglingDailyPlans };
}

/**
 * Deterministic diagnostic marker for an autonomous schedule attempt that
 * skipped or errored without scheduling. Pure — the reason is the same
 * deterministic string the scheduler already returns to its caller. Used to
 * make a row that would otherwise be silently stuck observable in its own
 * content JSON. Does NOT change lifecycle, eligibility, or content_status.
 */
export function buildAutonomousScheduleDiagnostic(
  reason: string,
  atIso: string,
): { auto_schedule_diagnostic: { reason: string; at: string } } {
  return { auto_schedule_diagnostic: { reason: String(reason || 'unknown'), at: atIso } };
}
