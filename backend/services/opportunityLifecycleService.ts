/**
 * Phase 6 — Opportunity lifecycle state machine.
 *
 * Append-only history. The "current state" of an opportunity is the most
 * recent opportunity_lifecycle_states row by transitioned_at. The
 * `is_initial` flag + partial UNIQUE index physically prevent double-init.
 *
 * Hard contracts:
 *   • Initial transition is `detected` and is best-effort emitted by the
 *     signal pipeline after a successful opportunity write. Idempotent.
 *   • All non-initial transitions are EXPLICIT and require an actor user
 *     id. `canTransitionLifecycle` gates every move.
 *   • Append-only: DB triggers block UPDATE and DELETE on this table.
 *   • Nothing auto-transitions opportunities. No scheduler reads this table.
 */

import { ownedDbTable } from '../db/writeOwner';
import type {
  LifecycleState,
  OpportunityLifecycleRecord,
} from '../types/opportunityLifecycle';
import {
  canTransitionLifecycle,
  isLifecycleState,
} from '../types/opportunityLifecycle';

export class LifecycleTransitionError extends Error {
  constructor(
    public readonly from: LifecycleState | null,
    public readonly to: LifecycleState,
    msg: string,
  ) {
    super(msg);
    this.name = 'LifecycleTransitionError';
  }
}

/**
 * PI-C1 Phase 1 — the lifecycle evidence could not be established.
 *
 * Distinct from `LifecycleTransitionError`, which means "that move is not
 * allowed from where you are". This one means "where you are cannot be
 * determined", which is a different problem with a different remedy, and
 * conflating them is how a missing-evidence condition came to look like an
 * ordinary invalid transition.
 */
export class LifecycleEvidenceUnavailableError extends Error {
  constructor(
    public readonly reason: LifecycleUnreadableReason | 'missing',
    msg: string,
  ) {
    super(msg);
    this.name = 'LifecycleEvidenceUnavailableError';
  }
}

export type LifecycleUnreadableReason = 'read_failed' | 'unknown_state' | 'contradictory';

/**
 * The result of asking what state an opportunity is in.
 *
 * The four cases are kept apart deliberately. The previous reader answered
 * `null` for "no history" and the caller substituted `detected`, so an
 * opportunity whose history was never written was indistinguishable from one
 * genuinely at the start of its life — and FR-A39 requires the opposite: an
 * unknown state must FAIL CLOSED as non-terminal, never resolve to a valid
 * state. The substitution was reachable in production because the pipeline's
 * lifecycle init is best-effort and its failure is swallowed
 * (`listeningSignalPipeline.ts`), so `missing` is a real condition, not a
 * theoretical one.
 *
 * `present` additionally reports `isInitial`, which is what distinguishes a
 * valid initial state backed by creation evidence from valid later history.
 */
export type LifecycleReadResult =
  | {
      kind: 'present';
      state: LifecycleState;
      isInitial: boolean;
      record: OpportunityLifecycleRecord;
    }
  /** The opportunity exists but has no lifecycle history at all. */
  | { kind: 'missing' }
  /** Evidence exists but cannot be trusted to mean anything. */
  | { kind: 'unreadable'; reason: LifecycleUnreadableReason; detail: string };

/**
 * Reads the current state as a typed result, without ever inventing one.
 *
 * Nothing here writes, and nothing transitions: reading an opportunity must
 * not change it, so a `missing` or `unreadable` answer is returned for the
 * caller to handle rather than repaired by fabricating initial history.
 */
export async function readCurrentLifecycleState(
  organizationId: string,
  opportunityFeedItemId: string,
): Promise<LifecycleReadResult> {
  const { data, error } = await ownedDbTable('opportunity_lifecycle_states')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('opportunity_feed_item_id', opportunityFeedItemId)
    .order('transitioned_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // A read failure is NOT absence. Saying "missing" here would convert an
    // outage into a durable-looking fact about the opportunity.
    return { kind: 'unreadable', reason: 'read_failed', detail: error.message };
  }

  const row = (data as OpportunityLifecycleRecord | null) ?? null;
  if (!row) return { kind: 'missing' };

  if (!isLifecycleState(row.state)) {
    // Reachable after a vocabulary migration this code predates. Forward
    // compatibility is exactly the case FR-A39 names as failing closed.
    return {
      kind: 'unreadable',
      reason: 'unknown_state',
      detail: `state_not_in_vocabulary:${String(row.state)}`,
    };
  }

  // Shape contradiction. The database constrains WHICH WORDS may appear in
  // `state` and that only one row may be initial, but it does not constrain
  // an initial row to have no predecessor — so this combination is storable
  // and has to be refused in code rather than assumed away.
  if (row.is_initial && row.previous_state !== null) {
    return {
      kind: 'unreadable',
      reason: 'contradictory',
      detail: 'initial_row_has_previous_state',
    };
  }

  return { kind: 'present', state: row.state, isInitial: Boolean(row.is_initial), record: row };
}

/**
 * Is this opportunity resolved for the purpose of ORDINARY account deletion?
 *
 * FR-A38 makes `archived` the sole terminal state, and FR-A39 makes every
 * other state — including `dismissed`, `converted`, and any unknown or future
 * value — non-terminal, failing closed. Both halves are expressed here so the
 * rule has one implementation: anything that is not a readable, present
 * `archived` answers `false`.
 *
 * Deliberately a predicate over the READ RESULT, not over a bare state
 * string: that is what makes `missing` and `unreadable` fail closed instead
 * of being coerced into a state first.
 */
export function isResolvedForAccountDeletion(read: LifecycleReadResult): boolean {
  return read.kind === 'present' && read.state === 'archived';
}

/**
 * Idempotent initial-state insert. Called from the signal pipeline. The
 * partial UNIQUE index makes concurrent initialisation safe.
 */
export async function initialiseLifecycleForOpportunity(args: {
  organizationId: string;
  opportunityFeedItemId: string;
  metadata?: Record<string, unknown>;
}): Promise<OpportunityLifecycleRecord | null> {
  const { data: existing } = await ownedDbTable('opportunity_lifecycle_states')
    .select('*')
    .eq('organization_id', args.organizationId)
    .eq('opportunity_feed_item_id', args.opportunityFeedItemId)
    .eq('is_initial', true)
    .maybeSingle();
  if (existing) return existing as OpportunityLifecycleRecord;

  const { data, error } = await ownedDbTable('opportunity_lifecycle_states')
    .insert({
      organization_id: args.organizationId,
      opportunity_feed_item_id: args.opportunityFeedItemId,
      state: 'detected' as LifecycleState,
      previous_state: null,
      reasoning: 'auto_init_from_signal_pipeline',
      actor_user_id: null,
      is_initial: true,
      metadata: args.metadata ?? {},
    })
    .select('*')
    .single();
  if (error) {
    // 23505 — race: another worker init'd the row. Re-read.
    if (error.code === '23505') {
      const { data: raced } = await ownedDbTable('opportunity_lifecycle_states')
        .select('*')
        .eq('organization_id', args.organizationId)
        .eq('opportunity_feed_item_id', args.opportunityFeedItemId)
        .eq('is_initial', true)
        .maybeSingle();
      return (raced as OpportunityLifecycleRecord | null) ?? null;
    }
    throw new Error(`lifecycle_init_failed:${error.message}`);
  }
  return (data as OpportunityLifecycleRecord) ?? null;
}

export async function getCurrentLifecycleState(
  organizationId: string,
  opportunityFeedItemId: string,
): Promise<OpportunityLifecycleRecord | null> {
  const { data, error } = await ownedDbTable('opportunity_lifecycle_states')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('opportunity_feed_item_id', opportunityFeedItemId)
    .order('transitioned_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`lifecycle_current_failed:${error.message}`);
  return (data as OpportunityLifecycleRecord | null) ?? null;
}

export async function listLifecycleHistory(
  organizationId: string,
  opportunityFeedItemId: string,
): Promise<OpportunityLifecycleRecord[]> {
  const { data, error } = await ownedDbTable('opportunity_lifecycle_states')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('opportunity_feed_item_id', opportunityFeedItemId)
    .order('transitioned_at', { ascending: true });
  if (error) throw new Error(`lifecycle_history_failed:${error.message}`);
  return (data as OpportunityLifecycleRecord[]) ?? [];
}

export type TransitionLifecycleInput = {
  organizationId: string;
  opportunityFeedItemId: string;
  to: LifecycleState;
  actorUserId: string | null;
  reasoning: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Explicit transition. Validates the move against the allowlist and writes
 * a new history row. Caller (API) is responsible for RBAC checks.
 */
export async function transitionLifecycle(
  input: TransitionLifecycleInput,
): Promise<OpportunityLifecycleRecord> {
  if (!isLifecycleState(input.to)) {
    throw new LifecycleTransitionError(null, input.to, `unknown_target_state:${input.to}`);
  }
  // PI-C1 Phase 1: no default. `?? 'detected'` used to stand in here, which
  // meant an opportunity with no history was treated as validly at the start
  // of its life and the full transition graph was opened from it. FR-A39
  // requires an undetermined state to fail closed, so it is refused instead
  // — and NOT repaired by writing initial history, which would fabricate
  // evidence that the transition then cites.
  const read = await readCurrentLifecycleState(input.organizationId, input.opportunityFeedItemId);
  if (read.kind === 'missing') {
    throw new LifecycleEvidenceUnavailableError(
      'missing',
      'no lifecycle history for this opportunity — its current state cannot be established, so no transition can be validated',
    );
  }
  if (read.kind === 'unreadable') {
    throw new LifecycleEvidenceUnavailableError(
      read.reason,
      `lifecycle history cannot be interpreted (${read.reason}: ${read.detail})`,
    );
  }
  const from: LifecycleState = read.state;

  const decision = canTransitionLifecycle(from, input.to);
  if (!decision.allowed) {
    throw new LifecycleTransitionError(from, input.to, decision.reason ?? 'transition_not_permitted');
  }

  const { data, error } = await ownedDbTable('opportunity_lifecycle_states')
    .insert({
      organization_id: input.organizationId,
      opportunity_feed_item_id: input.opportunityFeedItemId,
      state: input.to,
      previous_state: from,
      reasoning: input.reasoning,
      actor_user_id: input.actorUserId,
      is_initial: false,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`lifecycle_transition_failed:${error?.message ?? 'unknown'}`);
  }
  return data as OpportunityLifecycleRecord;
}

/**
 * Aggregate current-state counts for the lifecycle board. Returns one count
 * per state plus the most recent transition timestamp for the org.
 */
export async function getLifecycleBoardCounts(
  organizationId: string,
): Promise<{ counts: Record<LifecycleState, number>; total: number }> {
  // Read all (org-scoped) lifecycle rows; for each opportunity_id keep only
  // the latest transition. Application-side reducer — small table for most
  // orgs; future phase can switch to a window-function view.
  const { data, error } = await ownedDbTable('opportunity_lifecycle_states')
    .select('opportunity_feed_item_id, state, transitioned_at')
    .eq('organization_id', organizationId)
    .order('transitioned_at', { ascending: false });
  if (error) throw new Error(`lifecycle_board_failed:${error.message}`);
  const seen = new Set<string>();
  const counts: Record<string, number> = {
    detected: 0, triaged: 0, reviewing: 0, qualified: 0, monitoring: 0,
    outreach_planned: 0, converted: 0, dismissed: 0, archived: 0,
  };
  let total = 0;
  for (const row of (data ?? []) as Array<{ opportunity_feed_item_id: string; state: LifecycleState }>) {
    if (seen.has(row.opportunity_feed_item_id)) continue;
    seen.add(row.opportunity_feed_item_id);
    counts[row.state] = (counts[row.state] ?? 0) + 1;
    total += 1;
  }
  return { counts: counts as Record<LifecycleState, number>, total };
}
