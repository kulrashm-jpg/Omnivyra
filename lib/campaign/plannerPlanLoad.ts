/**
 * CP-STRUCT-002 — when may a server-loaded plan replace canonical planner state?
 *
 * `PlanLoader` re-fetches `/api/campaigns/retrieve-plan` and writes the result
 * into the planner session. Both of the setters it uses — `setCampaignStructure`
 * and `setCalendarPlan` — deliberately reset `skeleton_confirmed` to false,
 * because replacing the skeleton must invalidate a confirmation made against
 * the old one. That is correct. What was wrong is WHEN the loader wrote.
 *
 * Two failures came out of writing unconditionally:
 *
 *   1. `weeksToCalendarPlan([])` never returns null — an empty server response
 *      yields a well-formed but EMPTY plan. Writing it erased a skeleton the
 *      user had just accepted locally (the draft's weeks are persisted through
 *      a different path and may not exist server-side yet), and reset
 *      `skeleton_confirmed`, dropping the planner back to the generation
 *      controls.
 *
 *   2. The converter allocates fresh objects on every call, so each write
 *      changed the identity of the very state the effect depended on, which
 *      re-ran the effect, which fetched and wrote again — a self-sustaining
 *      refetch loop.
 *
 * This module owns only the decision. It performs no I/O, holds no state, and
 * introduces no new planner model — the load path, the fetch, and the setters
 * are all unchanged.
 */

export type PlanAdoptionReason =
  /** Startup load: nothing local to protect, so adopt whatever the server has. */
  | 'initial_load'
  /** An explicit refresh returned a plan with content. */
  | 'server_plan_has_content'
  /** Local state already exists and this is the initial (non-refresh) pass. */
  | 'local_plan_preserved'
  /** The server returned no weeks — never allow that to erase local work. */
  | 'empty_server_plan';

export interface PlanAdoptionDecision {
  adopt: boolean;
  reason: PlanAdoptionReason;
}

/** True when a retrieve-plan payload carries at least one week. */
export function serverPlanHasContent(weeks: unknown): boolean {
  return Array.isArray(weeks) && weeks.length > 0;
}

/**
 * Decide whether a fetched plan may overwrite canonical planner state.
 *
 * `refreshTrigger === 0` is the first pass after mount; anything higher is an
 * explicit refresh requested by a caller (e.g. after accepting a structure).
 */
export function decidePlanAdoption(input: {
  refreshTrigger: number;
  /** Does the session already hold a calendar plan or campaign structure? */
  hasLocalPlan: boolean;
  /** `weeks` as returned by retrieve-plan (committed, draft, or top-level). */
  weeks: unknown;
}): PlanAdoptionDecision {
  const hasContent = serverPlanHasContent(input.weeks);

  // An empty server plan is never authoritative over local state. It means
  // "the server has nothing yet", not "the campaign has no skeleton".
  if (!hasContent) {
    return input.hasLocalPlan
      ? { adopt: false, reason: 'empty_server_plan' }
      // Nothing locally either — adopting an empty plan is a no-op that would
      // still churn object identity, so decline it too.
      : { adopt: false, reason: 'empty_server_plan' };
  }

  if (!input.hasLocalPlan) {
    return { adopt: true, reason: 'initial_load' };
  }

  // Local state exists. Only an explicit refresh may replace it; the initial
  // pass must leave a resumed session's own state alone.
  return input.refreshTrigger > 0
    ? { adopt: true, reason: 'server_plan_has_content' }
    : { adopt: false, reason: 'local_plan_preserved' };
}
