/**
 * PI contract #10 — reading the prospect lifecycle.
 *
 * Three jobs:
 *   1. the CURRENT state — the row with the greatest `seq` for this prospect;
 *   2. deterministic RECONSTRUCTION of a state from a history, as a pure
 *      function, so the invariant is testable without a database;
 *   3. the `outreach-active` PROJECTION (Decision C) — computed here, stored
 *      nowhere.
 *
 * Every read is tenant-filtered explicitly. RLS is service-role only, so the
 * filter in the query is the boundary a reviewer can see, not a hope.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { TERMINAL_STATUSES, TRANSIENT_STATUSES } from '../leadOutreachExecution/lifecycle';
import type { OutreachTaskStatus } from '../leadOutreachExecution/types';
import { isProspectState, type EvidenceKind, type ProspectState, type TransitionOrigin } from './stateModel';

export interface ProspectTransitionRow {
  id: string;
  seq: number;
  state: ProspectState;
  previousState: ProspectState | null;
  isInitial: boolean;
  origin: TransitionOrigin;
  evidenceKind: EvidenceKind;
  evidenceOutcomeId: string | null;
  evidenceSourceRecordId: string | null;
  evidenceDetail: Record<string, unknown>;
  sourceEventKey: string | null;
  reasoning: string | null;
  actorUserId: string | null;
  modelVersion: string | null;
  transitionedAt: string;
  /**
   * A "reassessed, unchanged" row: the re-derivation ran and concluded the same
   * thing. Derived, never stored — two spellings of one fact drift.
   */
  isReassessment: boolean;
}

export interface CurrentProspectState {
  state: ProspectState;
  previousState: ProspectState | null;
  seq: number;
  transitionedAt: string;
  isInitial: boolean;
}

const SELECT_COLUMNS =
  'id, seq, state, previous_state, is_initial, origin, evidence_kind, evidence_outcome_id, '
  + 'evidence_source_record_id, evidence_detail, source_event_key, reasoning, actor_user_id, '
  + 'model_version, transitioned_at';

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

function toRow(raw: Raw): ProspectTransitionRow {
  const state = String(raw.state);
  const previous = str(raw.previous_state);
  if (!isProspectState(state)) {
    // The DB CHECK makes this unreachable; if it ever fires, the vocabulary in
    // the database and in TypeScript have diverged and that must be loud.
    throw new Error(`prospect_lifecycle_transitions holds an unknown state '${state}' — DB and TS vocabularies have diverged`);
  }
  const isInitial = raw.is_initial === true;
  return {
    id: String(raw.id),
    seq: Number(raw.seq),
    state,
    previousState: previous && isProspectState(previous) ? previous : null,
    isInitial,
    origin: raw.origin === 'human' ? 'human' : 'derived',
    evidenceKind: String(raw.evidence_kind) as EvidenceKind,
    evidenceOutcomeId: str(raw.evidence_outcome_id),
    evidenceSourceRecordId: str(raw.evidence_source_record_id),
    evidenceDetail: (raw.evidence_detail as Record<string, unknown>) ?? {},
    sourceEventKey: str(raw.source_event_key),
    reasoning: str(raw.reasoning),
    actorUserId: str(raw.actor_user_id),
    modelVersion: str(raw.model_version),
    transitionedAt: String(raw.transitioned_at),
    isReassessment: !isInitial && previous === state,
  };
}

/**
 * The prospect's state now, or null when it has no ledger.
 *
 * Ordered by `seq`, never by `transitioned_at`: business time is caller-supplied,
 * two transitions may share it, and uuid ordering is arbitrary. `seq` is a
 * table-wide identity column and the chain trigger holds a per-prospect advisory
 * lock across each insert, so sequence order is commit order. "Latest" is a
 * fact, not a tie-break.
 */
export async function readCurrentProspectState(
  organizationId: string,
  prospectId: string,
): Promise<CurrentProspectState | null> {
  const res = await ownedDbTable('prospect_lifecycle_transitions')
    .select('seq, state, previous_state, is_initial, transitioned_at')
    .eq('organization_id', organizationId)
    .eq('prospect_id', prospectId)
    .order('seq', { ascending: false })
    .limit(1);

  if (res.error) {
    throw new Error(`failed to read the prospect lifecycle state: ${(res.error as { message?: string }).message}`);
  }
  const rows = (res.data ?? []) as unknown as Raw[];
  if (!rows.length) return null;
  const row = rows[0];
  const state = String(row.state);
  if (!isProspectState(state)) {
    throw new Error(`prospect_lifecycle_transitions holds an unknown state '${state}' — DB and TS vocabularies have diverged`);
  }
  const previous = str(row.previous_state);
  return {
    state,
    previousState: previous && isProspectState(previous) ? previous : null,
    seq: Number(row.seq),
    transitionedAt: String(row.transitioned_at),
    isInitial: row.is_initial === true,
  };
}

/** The full history, oldest first. History is free: nothing is ever overwritten. */
export async function readProspectLifecycleHistory(
  organizationId: string,
  prospectId: string,
): Promise<ProspectTransitionRow[]> {
  const res = await ownedDbTable('prospect_lifecycle_transitions')
    .select(SELECT_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('prospect_id', prospectId)
    .order('seq', { ascending: true });

  if (res.error) {
    throw new Error(`failed to read the prospect lifecycle history: ${(res.error as { message?: string }).message}`);
  }
  return ((res.data ?? []) as unknown as Raw[]).map(toRow);
}

export interface ReconstructedState {
  state: ProspectState | null;
  /** Rows that actually changed the state (excludes the initial row and reassessments). */
  moves: number;
  reassessments: number;
  /** A broken chain is reported, never smoothed over. */
  brokenAt: number | null;
}

/**
 * Replay a history into a state. PURE — no database, no clock.
 *
 * DETERMINISM is the property under test: the same rows, in any input order,
 * must give the same answer. So the function sorts by `seq` itself rather than
 * trusting the caller's ordering, and verifies each row's `previous_state`
 * against the state the replay is actually in. If the chain is broken it says
 * where, rather than returning a plausible-looking answer — a ledger that
 * cannot be replayed is not an audit trail.
 */
export function reconstructProspectState(rows: readonly ProspectTransitionRow[]): ReconstructedState {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  let state: ProspectState | null = null;
  let moves = 0;
  let reassessments = 0;

  for (const row of ordered) {
    if (row.isInitial) {
      if (state !== null) return { state, moves, reassessments, brokenAt: row.seq };
      state = row.state;
      continue;
    }
    if (state === null) return { state: null, moves, reassessments, brokenAt: row.seq };
    if (row.previousState !== state) return { state, moves, reassessments, brokenAt: row.seq };
    if (row.state === state) reassessments += 1;
    else moves += 1;
    state = row.state;
  }
  return { state, moves, reassessments, brokenAt: null };
}

// ── DECISION C — `outreach-active` as a projection ──────────────────────────

/**
 * Statuses in which outreach is genuinely in flight.
 *
 * Derived from the frozen WS-3 vocabulary rather than re-listed: everything
 * that is neither terminal nor transient. Re-listing them would create a second
 * copy of `leadOutreachExecution`'s contract that could drift from it — exactly
 * the duplication PI-CONTRACT-REGISTER §5 exists to stop.
 */
export const OUTREACH_ACTIVE_STATUSES: readonly OutreachTaskStatus[] = [
  'pending', 'awaiting_approval', 'approved', 'queued', 'dispatching',
  'sent', 'delivered', 'failed', 'paused', 'escalated',
] as const;

export interface OutreachActivityProjection {
  /** The verdict the ADR's seventh state would have stored. Computed, never persisted. */
  outreachActive: boolean;
  activeTaskCount: number;
  /** Null when the prospect has no resolved person, which is the only join that is foreign-keyed. */
  personId: string | null;
  /** Why the projection could not be formed, when it could not. */
  unavailable: 'no_person_anchor' | null;
}

/**
 * Is outreach currently in flight for this prospect?
 *
 * THE DECISION: this is a projection over `outreach_tasks`, not a stored state.
 * PI decides; Outreach executes. PI is forbidden to write the outreach ledger
 * (PI-ADR-002 §3.2.3) and therefore cannot keep a stored copy current — a
 * persisted `outreach-active` would go stale the moment a task was cancelled,
 * which is the same structural failure as a stored `suppressed` verdict.
 *
 * THE JOIN: `(company_id, person_id)`, the one edge foreign-keyed on both
 * sides — `outreach_tasks.(person_id, company_id) -> unified_persons(id,
 * company_id)` from 20261011000000, and `canonical_leads.unified_person_id`.
 * NOT `outreach_tasks.lead_id`: that column is `text`, was deliberately not
 * retyped, and that migration records that it is not proven to be a lead id.
 * Joining on it would be a guess dressed as a fact.
 *
 * A prospect with no resolved person returns `unavailable: 'no_person_anchor'`
 * rather than `false`. Absence of a join is not evidence of no outreach, and
 * PI-ADR-002 §3.2.5 is explicit that absence abstains.
 */
export async function projectOutreachActivity(
  organizationId: string,
  prospectId: string,
): Promise<OutreachActivityProjection> {
  const lead = await ownedDbTable('canonical_leads')
    .select('unified_person_id')
    .eq('company_id', organizationId)
    .eq('id', prospectId)
    .limit(1);

  if (lead.error) {
    throw new Error(`failed to read the prospect person anchor: ${(lead.error as { message?: string }).message}`);
  }
  const personId = str(((lead.data ?? []) as unknown as Raw[])[0]?.unified_person_id);
  if (!personId) {
    return { outreachActive: false, activeTaskCount: 0, personId: null, unavailable: 'no_person_anchor' };
  }

  const tasks = await ownedDbTable('outreach_tasks')
    .select('id')
    .eq('company_id', organizationId)
    .eq('person_id', personId)
    .in('status', OUTREACH_ACTIVE_STATUSES as unknown as string[]);

  if (tasks.error) {
    throw new Error(`failed to project outreach activity: ${(tasks.error as { message?: string }).message}`);
  }
  const count = ((tasks.data ?? []) as unknown as Raw[]).length;
  return { outreachActive: count > 0, activeTaskCount: count, personId, unavailable: null };
}

/** Exported so a test can prove the projection stays in step with WS-3's contract. */
export const OUTREACH_INACTIVE_STATUSES: readonly OutreachTaskStatus[] = [
  ...TERMINAL_STATUSES,
  ...TRANSIENT_STATUSES,
] as const;
