/**
 * BLOCK-2 — what actually stands between a finalized campaign and execution.
 *
 * The reported symptom was "campaign_readiness has 1 row, not_ready, so the
 * campaign cannot execute". That premise is false, and this file proves it
 * from the shipped code rather than asserting it.
 *
 * Since R2-IMPL B1, `campaign_readiness` authorizes nothing. Campaign-global
 * readiness demanded the WHOLE campaign be 100% planned and 100% scheduled,
 * which made partial release impossible and was satisfied by zero campaigns
 * in production. It was replaced by the per-post predicate
 * `lib/campaign/publishAuthorization`, and readiness was kept as a
 * planning/diagnostic metric.
 *
 * The real execution gate is `campaigns.status === 'active'`.
 *
 *   planner-finalize writes  { status: 'planning', current_stage: 'execution_ready' }
 *   the release seam writes  { status: 'active',   current_stage: 'schedule' }
 *
 * So finalize alone can never authorize a publish — by design. Release is the
 * handoff, and `POST /api/campaigns/[id]/release` is the ONLY writer of
 * status='active' a planner-built campaign can reach.
 *
 * These tests pin that chain so a future change cannot quietly reintroduce a
 * campaign-global gate or make finalize skip the release seam.
 */

import {
  authorizePostPublish,
  RELEASABLE_POST_STATUSES,
} from '../../../lib/campaign/publishAuthorization';
import { resolveCampaignStage, isFinalizedStage } from '../../../lib/campaign/campaignStage';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Strip comments so a docblock mentioning a symbol cannot satisfy a scan. */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Exactly what planner-finalize writes on success (planner-finalize.ts:788). */
const AFTER_FINALIZE = {
  status: 'planning',
  current_stage: 'execution_ready',
  blueprint_status: 'ACTIVE',
};
/** Exactly what the release seam writes on success (release.ts:392). */
const AFTER_RELEASE = {
  status: 'active',
  current_stage: 'schedule',
  blueprint_status: 'ACTIVE',
};

const CAMPAIGN_A = 'campaign-a';
const CAMPAIGN_B = 'campaign-b';

/** A released execution record for a post belonging to `campaignId`. */
const scheduledPost = (campaignId: string, campaignStatus: string | null) => ({
  campaign_id: campaignId,
  campaign_status: campaignStatus,
  post_status: 'scheduled',
  has_content: true,
});

/* ── 1. The lifecycle the campaign actually walks ─────────────────────── */

describe('the canonical stage after each transition', () => {
  it('finalize lands the campaign at "ready" — finalized, but NOT active', () => {
    const resolved = resolveCampaignStage(AFTER_FINALIZE);
    expect(resolved.stage).toBe('ready');
    expect(isFinalizedStage(resolved.stage)).toBe(true);
    // The distinction that matters: "finalized" is a PLANNING verdict.
    // Execution reads `status`, and it is still 'planning'.
    expect(AFTER_FINALIZE.status).not.toBe('active');
  });

  it('release advances it to "scheduling" and makes it active', () => {
    expect(resolveCampaignStage(AFTER_RELEASE).stage).toBe('scheduling');
    expect(AFTER_RELEASE.status).toBe('active');
  });
});

/* ── 2. The gate that actually blocks execution ───────────────────────── */

describe('publish authorization across the handoff', () => {
  it('a finalized-but-unreleased campaign CANNOT publish — and the reason is the campaign, not readiness', () => {
    const verdict = authorizePostPublish(scheduledPost(CAMPAIGN_A, AFTER_FINALIZE.status));
    expect(verdict.authorized).toBe(false);
    expect(verdict.code).toBe('PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE');
  });

  it('after release the SAME post is authorized — nothing else had to change', () => {
    const verdict = authorizePostPublish(scheduledPost(CAMPAIGN_A, AFTER_RELEASE.status));
    expect(verdict.authorized).toBe(true);
    expect(verdict.code).toBe('AUTHORIZED');
  });

  it('release does not blanket-authorize: an unreleased post on an active campaign is still refused', () => {
    // This is the structural guarantee behind partial release: week 2 being
    // active never authorizes week 5's draft row.
    const verdict = authorizePostPublish({
      campaign_id: CAMPAIGN_A,
      campaign_status: AFTER_RELEASE.status,
      post_status: 'draft',
      has_content: true,
    });
    expect(verdict.authorized).toBe(false);
    expect(verdict.code).toBe('PUBLISH_BLOCKED_POST_NOT_RELEASED');
    expect(RELEASABLE_POST_STATUSES.has('draft')).toBe(false);
  });

  it('campaign B does not inherit campaign A’s activation', () => {
    // Authorization is evaluated per post from ITS OWN campaign's status, so
    // releasing A can never carry B across the gate.
    expect(authorizePostPublish(scheduledPost(CAMPAIGN_A, AFTER_RELEASE.status)).authorized).toBe(true);
    expect(authorizePostPublish(scheduledPost(CAMPAIGN_B, AFTER_FINALIZE.status)).authorized).toBe(false);
    expect(authorizePostPublish(scheduledPost(CAMPAIGN_B, AFTER_FINALIZE.status)).code)
      .toBe('PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE');
  });
});

/* ── 3. Readiness authorizes nothing (the premise under test) ─────────── */

describe('campaign_readiness is a metric, not a gate', () => {
  it('the publish predicate takes no readiness input at all', () => {
    const src = code('lib/campaign/publishAuthorization.ts');
    expect(src).not.toContain('campaign_readiness');
    expect(src).not.toContain('readiness_state');
    expect(src).not.toContain('readiness');
  });

  it('neither the scheduler nor the publish worker consults it', () => {
    expect(code('backend/scheduler/schedulerService.ts')).not.toContain('campaign_readiness');
    expect(code('backend/queue/jobProcessors/publishProcessor.ts')).not.toContain('campaign_readiness');
  });

  it('the release seam refreshes readiness AFTER scheduling, and never gates on it', () => {
    const src = code('pages/api/campaigns/[id]/release.ts');
    // Fire-and-forget: a readiness failure must never invalidate a valid
    // scheduled post.
    expect(src).toContain('void evaluateCampaignReadiness(');
    // It is never read back to make a decision.
    expect(src).not.toContain('getCampaignReadiness');
    expect(src).not.toContain('readiness_state');
  });

  it('so a finalized-but-unreleased campaign reading not_ready is CORRECT, not a defect', () => {
    // Readiness counts scheduled slots. Before release there are none, so
    // not_ready is the accurate description of a campaign that has been
    // planned but not handed to execution. It is not what blocks publishing —
    // the campaign-active gate above is.
    const blocked = authorizePostPublish(scheduledPost(CAMPAIGN_A, AFTER_FINALIZE.status));
    expect(blocked.code).toBe('PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE');
    expect(blocked.reason).not.toMatch(/readiness/i);
  });
});

/* ── 4. Release is the ONLY reachable activation ──────────────────────── */

describe('the release seam is the single handoff into execution', () => {
  it('it writes the activating transition', () => {
    const src = code('pages/api/campaigns/[id]/release.ts');
    expect(src).toContain("status: 'active'");
    expect(src).toContain("current_stage: 'schedule'");
  });

  it('planner-finalize deliberately does NOT activate the campaign', () => {
    const src = code('pages/api/campaigns/planner-finalize.ts');
    expect(src).toContain("current_stage: 'execution_ready'");
    // Finalize must never short-circuit the release seam by activating
    // directly: nothing would be scheduled, so an "active" campaign would
    // have no scheduled_posts to publish.
    expect(src).not.toContain("status: 'active'");
  });
});
