/**
 * PHASE SCHEDULER-WRITE-ATOMICITY-HARDENING — drift classification + autonomous
 * skip visibility. Targets the PURE core (no DB / queue / redis) so the
 * scheduling/publishing chain is never imported. The DB-backed
 * `detectCreatorScheduleDrift` / `reconcileCreatorScheduleWrites` compose this
 * classifier verbatim, so proving the classifier proves the detection.
 */
import {
  classifyCreatorScheduleDrift,
  buildAutonomousScheduleDiagnostic,
  type CreatorScheduledPostRow,
  type CreatorDailyPlanRow,
} from '../../services/creator/creatorScheduleDrift';

const SCHEDULED = 'scheduled';
const RENDER_READY = 'render_ready';
const AWAITING_UPLOAD = 'awaiting_media_upload';

describe('classifyCreatorScheduleDrift — write A/B consistency', () => {
  // (A) scheduled_posts success + activity update success → no drift.
  it('A. both writes landed (flipped + back-pointed) → no drift', () => {
    const scheduledPosts: CreatorScheduledPostRow[] = [{ id: 'sp1', idempotency_key: 'creator-render:dp1' }];
    const dailyPlans: CreatorDailyPlanRow[] = [{ id: 'dp1', content_status: SCHEDULED, scheduled_post_id: 'sp1' }];
    const drift = classifyCreatorScheduleDrift({ scheduledPosts, dailyPlans });
    expect(drift.orphanedScheduledPosts).toHaveLength(0);
    expect(drift.danglingDailyPlans).toHaveLength(0);
  });

  // (B) scheduled_posts success + activity update FAILURE → forward drift (orphan).
  it('B. write A landed, write B lost → orphan detected with repair lane', () => {
    const scheduledPosts: CreatorScheduledPostRow[] = [{ id: 'sp1', idempotency_key: 'creator-render:dp1' }];
    // daily still at render_ready, no back-pointer (write B never happened).
    const dailyPlans: CreatorDailyPlanRow[] = [{ id: 'dp1', content_status: RENDER_READY, scheduled_post_id: null }];
    const drift = classifyCreatorScheduleDrift({ scheduledPosts, dailyPlans });
    expect(drift.orphanedScheduledPosts).toHaveLength(1);
    expect(drift.orphanedScheduledPosts[0]).toMatchObject({
      scheduledPostId: 'sp1',
      dailyPlanId: 'dp1',
      lane: 'render',
      reason: 'scheduled_post_without_daily_flip',
    });
    expect(drift.danglingDailyPlans).toHaveLength(0);
  });

  // (C) process interruption simulation — identical persistence shape to (B):
  //     the INSERT committed, the process died before the UPDATE. The upload
  //     lane resolves to the attachment repair entry point.
  it('C. interruption after INSERT (upload lane) → orphan flagged for upload repair', () => {
    const scheduledPosts: CreatorScheduledPostRow[] = [{ id: 'spV', idempotency_key: 'creator-upload:dpV' }];
    const dailyPlans: CreatorDailyPlanRow[] = [{ id: 'dpV', content_status: 'ready_for_schedule', scheduled_post_id: null }];
    const drift = classifyCreatorScheduleDrift({ scheduledPosts, dailyPlans });
    expect(drift.orphanedScheduledPosts).toHaveLength(1);
    expect(drift.orphanedScheduledPosts[0].lane).toBe('upload');
    expect(drift.orphanedScheduledPosts[0].dailyPlanId).toBe('dpV');
  });

  it('orphan where the daily plan no longer exists → flagged unrepairable-by-id reason', () => {
    const scheduledPosts: CreatorScheduledPostRow[] = [{ id: 'sp1', idempotency_key: 'creator-render:ghost' }];
    const drift = classifyCreatorScheduleDrift({ scheduledPosts, dailyPlans: [] });
    expect(drift.orphanedScheduledPosts[0].reason).toBe('daily_plan_missing_for_scheduled_post');
  });
});

describe('classifyCreatorScheduleDrift — reverse drift + reconciliation detection (E)', () => {
  it('E. daily scheduled but scheduled_posts missing → dangling detected', () => {
    const scheduledPosts: CreatorScheduledPostRow[] = []; // the post is gone
    const dailyPlans: CreatorDailyPlanRow[] = [{ id: 'dp1', content_status: SCHEDULED, scheduled_post_id: 'sp-gone' }];
    const drift = classifyCreatorScheduleDrift({ scheduledPosts, dailyPlans });
    expect(drift.danglingDailyPlans).toHaveLength(1);
    expect(drift.danglingDailyPlans[0]).toMatchObject({
      dailyPlanId: 'dp1',
      scheduledPostId: 'sp-gone',
      reason: 'daily_scheduled_without_scheduled_post',
    });
    expect(drift.orphanedScheduledPosts).toHaveLength(0);
  });

  it('E. both drift directions surface together in one pass', () => {
    const scheduledPosts: CreatorScheduledPostRow[] = [
      { id: 'spA', idempotency_key: 'creator-render:dpA' }, // orphan (daily not flipped)
    ];
    const dailyPlans: CreatorDailyPlanRow[] = [
      { id: 'dpA', content_status: RENDER_READY, scheduled_post_id: null },     // forward drift
      { id: 'dpB', content_status: SCHEDULED, scheduled_post_id: 'sp-missing' }, // reverse drift
    ];
    const drift = classifyCreatorScheduleDrift({ scheduledPosts, dailyPlans });
    expect(drift.orphanedScheduledPosts.map((o) => o.dailyPlanId)).toEqual(['dpA']);
    expect(drift.danglingDailyPlans.map((d) => d.dailyPlanId)).toEqual(['dpB']);
  });
});

describe('classifyCreatorScheduleDrift — regression isolation (F, G)', () => {
  // (F) Video scheduling unchanged: a properly-scheduled attachment row is NOT
  //     flagged; a not-yet-uploaded video (awaiting upload, no post) is NOT
  //     flagged — video isolation behaviour is untouched.
  it('F. scheduled video row → no drift; awaiting-upload video → no false drift', () => {
    const scheduledPosts: CreatorScheduledPostRow[] = [{ id: 'spVid', idempotency_key: 'creator-upload:dpVid' }];
    const dailyPlans: CreatorDailyPlanRow[] = [
      { id: 'dpVid', content_status: SCHEDULED, scheduled_post_id: 'spVid' },        // scheduled video
      { id: 'dpVid2', content_status: AWAITING_UPLOAD, scheduled_post_id: null },     // awaiting upload
    ];
    const drift = classifyCreatorScheduleDrift({ scheduledPosts, dailyPlans });
    expect(drift.orphanedScheduledPosts).toHaveLength(0);
    expect(drift.danglingDailyPlans).toHaveLength(0);
  });

  // (G) Campaign completion unchanged: text / block scheduled_posts (non-creator
  //     idempotency keys, or none) are ignored — the reconciler never touches
  //     the rows completion logic counts.
  it('G. text/block scheduled_posts (non-creator keys) are ignored', () => {
    const scheduledPosts: CreatorScheduledPostRow[] = [
      { id: 'spText1', idempotency_key: 'bolt-block:campaign:week:topic' },
      { id: 'spText2', idempotency_key: null },
      { id: 'spText3', idempotency_key: 'allocation:xyz' },
    ];
    const dailyPlans: CreatorDailyPlanRow[] = [
      { id: 'dpText', content_status: 'generated', scheduled_post_id: null },
    ];
    const drift = classifyCreatorScheduleDrift({ scheduledPosts, dailyPlans });
    expect(drift.orphanedScheduledPosts).toHaveLength(0);
    expect(drift.danglingDailyPlans).toHaveLength(0);
  });
});

describe('buildAutonomousScheduleDiagnostic — autonomous skip visibility (D)', () => {
  it('D. produces a deterministic reason marker', () => {
    const at = '2026-06-22T12:00:00.000Z';
    expect(buildAutonomousScheduleDiagnostic('no_rendered_media', at)).toEqual({
      auto_schedule_diagnostic: { reason: 'no_rendered_media', at },
    });
  });

  it('D. every deterministic skip reason round-trips into the marker', () => {
    const at = '2026-06-22T12:00:00.000Z';
    for (const reason of ['no_rendered_media', 'no_user_for_campaign', 'unrecognized_platform', 'no_social_account', 'render_not_complete']) {
      expect(buildAutonomousScheduleDiagnostic(reason, at).auto_schedule_diagnostic.reason).toBe(reason);
    }
  });

  it('D. empty/falsy reason is normalised to a deterministic sentinel', () => {
    expect(buildAutonomousScheduleDiagnostic('', '2026-06-22T12:00:00.000Z').auto_schedule_diagnostic.reason).toBe('unknown');
  });
});
