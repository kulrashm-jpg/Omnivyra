/**
 * BLOCK-2 — where a campaign goes the moment it is finalized.
 *
 * Finalize is NOT the handoff to execution. It writes
 * `{ status: 'planning', current_stage: 'execution_ready' }`, and the publish
 * pipeline gates on `campaigns.status === 'active'` — so a finalized campaign
 * still cannot publish a single post (PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE).
 *
 * The handoff is the RELEASE seam, `POST /api/campaigns/[id]/release`, which
 * schedules the plan and then writes `{ status: 'active', current_stage:
 * 'schedule' }`. It is the only writer of status='active' a planner-built
 * campaign can reach, and it is surfaced in exactly one place: the planner's
 * Board tab (`CampaignReleasePanel`, inside `CampaignBoardTab`).
 *
 * Finalize used to navigate to `/campaign-calendar/<id>`, which has no release
 * affordance, and nothing anywhere links back into the planner scoped to a
 * campaign — every entry point is `?mode=direct`. The campaign was therefore
 * stranded at 'planning' with its own handoff unreachable.
 *
 * This resolves the destination to the surface that OWNS the next lifecycle
 * step. The campaign id rides the URL (not just session state) so the
 * destination survives a reload and can be linked or bookmarked — and because
 * `campaignId` is present, the planner treats it as an existing-campaign entry
 * and does not bootstrap a draft, leaving BLOCK-1's draft lifecycle untouched.
 *
 * Pure: same id in, same path out. No router, no I/O.
 */

/** Where the CMO lands after a campaign is finalized. */
export function campaignReleaseHandoffPath(campaignId: string): string {
  const id = String(campaignId ?? '').trim();
  if (!id) {
    // Nothing to hand off — the caller has no campaign to release.
    throw new Error('campaignReleaseHandoffPath requires a campaign id');
  }
  return `/campaign-planner?campaignId=${encodeURIComponent(id)}&tab=board`;
}
