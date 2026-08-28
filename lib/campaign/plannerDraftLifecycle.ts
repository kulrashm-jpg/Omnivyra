/**
 * BLOCK-1 — the draft-bootstrap lifecycle decision.
 *
 * The invariant this module exists to enforce:
 *
 *   A finalized campaign must never remain the active draft for a new
 *   direct planner session.
 *
 * Before this, `plannerSessionStore` bootstrapped with
 * `urlDraftId || localDraftIdRef.current` and, whenever that produced an id,
 * SKIPPED `create-or-resume` entirely. The id is cached in company-scoped
 * localStorage and survives finalize, so re-entering the planner re-adopted
 * the finalized campaign — its planner_state included — and the next
 * finalize attempt answered `400 Campaign already finalized`. A second
 * campaign could not be created at all.
 *
 * The server side was never wrong: `/api/campaigns/planner-draft` filters
 * `status='draft'`, and finalize moves the row to current_stage
 * 'execution_ready', so create-or-resume would have minted a fresh draft.
 * The client simply never asked.
 *
 * Deterministic, I/O-free, no clock — the probe outcome is supplied by the
 * caller. Lifecycle INTERPRETATION stays where it already lives
 * (`resolveCampaignStage` / `isFinalizedStage`, consulted server-side by
 * the planner-draft-state route); this module only decides what the client
 * does with the answer.
 */

/**
 * What the server said about a candidate draft id.
 *
 *  - `usable`      — the campaign is still a draft; its state may be resumed.
 *  - `finalized`   — the campaign is at or past the execution handoff. It is
 *                    no longer a draft and must not own a planner session.
 *  - `unreachable` — the probe itself failed (offline, transient 5xx). This
 *                    is NOT evidence about the lifecycle.
 */
export type DraftProbeOutcome = 'usable' | 'finalized' | 'unreachable';

export type DraftBootstrapAction = 'resume' | 'create';

export interface DraftBootstrapDecision {
  action: DraftBootstrapAction;
  /**
   * True only when the candidate id is proven unusable. The caller must then
   * drop the cached draft id AND purge the cached planner state — a fresh
   * draft that inherited the finalized campaign's spine/structure would be
   * campaign A's plan wearing campaign B's id.
   */
  invalidateCache: boolean;
  reason: 'no_candidate' | 'candidate_usable' | 'candidate_finalized' | 'probe_unreachable';
}

/**
 * Decide how a direct planner session starts.
 *
 * A transient probe failure deliberately RESUMES rather than invalidating:
 * destroying a user's cached session on a network blip is a worse failure
 * than carrying a possibly-stale id for one more entry, and the same
 * principle already governs `enforceCompanyAccess`'s TENANT_LOOKUP_ERROR
 * 503 (a lookup error is never reported as a denial).
 */
export function decideDraftBootstrap(input: {
  candidateId: string | null | undefined;
  probe: DraftProbeOutcome | null | undefined;
}): DraftBootstrapDecision {
  const candidateId = typeof input.candidateId === 'string' ? input.candidateId.trim() : '';
  if (!candidateId) {
    return { action: 'create', invalidateCache: false, reason: 'no_candidate' };
  }
  if (input.probe === 'finalized') {
    return { action: 'create', invalidateCache: true, reason: 'candidate_finalized' };
  }
  if (input.probe === 'unreachable') {
    return { action: 'resume', invalidateCache: false, reason: 'probe_unreachable' };
  }
  return { action: 'resume', invalidateCache: false, reason: 'candidate_usable' };
}

/** Map a draft-state probe response onto the lifecycle outcome. `null` means
 *  the request itself failed — explicitly not a lifecycle verdict. */
export function probeOutcomeFromDraftState(
  result: { finalized?: boolean } | null | undefined,
): DraftProbeOutcome {
  if (!result) return 'unreachable';
  return result.finalized === true ? 'finalized' : 'usable';
}

/** The error code the planner-draft-state route returns (409) when a
 *  campaign is no longer a draft. Shared by route and client so the two
 *  cannot drift. */
export const DRAFT_FINALIZED_CODE = 'DRAFT_FINALIZED';
