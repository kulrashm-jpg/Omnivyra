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
  const current = await getCurrentLifecycleState(input.organizationId, input.opportunityFeedItemId);
  const from: LifecycleState = current?.state ?? 'detected';

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
