/**
 * Opportunity-level snooze — pure derivation (owner decision 2026-10-30:
 * snooze belongs to the OPPORTUNITY, not the prospect).
 *
 * Carrier: `opportunity_dispositions.snoozed_until` (migration
 * 20270108000000_pi_opportunity_snooze.sql). A snooze is a `revisit_later`
 * disposition row with a typed deadline; the database CHECK
 * `opp_disposition_snooze_requires_revisit_later` forbids a deadline on any
 * other disposition.
 *
 * Rules (one implementation, used by the service and the prospect view):
 *   - Only the LATEST disposition of the opportunity counts (created_at, then
 *     id, as the deterministic tiebreaker). A later disposition of any kind —
 *     including an untimed `revisit_later` written by an early unsnooze —
 *     supersedes the snooze.
 *   - `active`  : latest is revisit_later and snoozed_until >  asOf.
 *   - `expired` : latest is revisit_later and snoozed_until <= asOf. Expiry is
 *                 by time alone: nothing has to run to wake the opportunity.
 *   - `none`    : anything else.
 *   - Rows of another tenant or another opportunity are ignored here; the
 *     callers filter by tenant and the composite FK makes them unstorable.
 *   - Snooze never CHANGES the lifecycle status. Writing a snooze is refused
 *     when the status is snooze-terminal (SNOOZE_TERMINAL_LIFECYCLE_STATES,
 *     20270109000003); deriving one never consults the status.
 *
 * PURE: no database, no clock (`asOf` is always passed in), no randomness.
 */

import type { OpportunityDisposition } from '../../backend/types/opportunityWorkflow';
import type { LifecycleState } from '../../backend/types/opportunityLifecycle';

export type OpportunitySnoozeState =
  | {
      kind: 'active' | 'expired';
      until: string;
      dispositionId: string;
      setAt: string;
      setBy: string | null;
      reason: string | null;
    }
  | { kind: 'none' };

export interface SnoozeSubject {
  organizationId: string;
  opportunityFeedItemId: string;
}

const ms = (iso: string): number => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`snooze_invalid_timestamp:${iso}`);
  return t;
};

/** Latest-first, deterministic: created_at DESC, then id DESC. */
export function compareDispositionsLatestFirst(a: OpportunityDisposition, b: OpportunityDisposition): number {
  const t = ms(b.created_at) - ms(a.created_at);
  if (t !== 0) return t;
  return b.id.localeCompare(a.id);
}

/** The disposition rows of exactly this opportunity in this tenant. */
export function dispositionsOf(rows: readonly OpportunityDisposition[], s: SnoozeSubject): OpportunityDisposition[] {
  return rows.filter((d) => d.organization_id === s.organizationId && d.opportunity_feed_item_id === s.opportunityFeedItemId);
}

export function deriveOpportunitySnooze(
  rows: readonly OpportunityDisposition[],
  subject: SnoozeSubject,
  asOf: string,
): OpportunitySnoozeState {
  const own = dispositionsOf(rows, subject).sort(compareDispositionsLatestFirst);
  const latest = own[0];
  if (!latest || latest.disposition !== 'revisit_later' || !latest.snoozed_until) return { kind: 'none' };
  return {
    kind: ms(latest.snoozed_until) > ms(asOf) ? 'active' : 'expired',
    until: latest.snoozed_until,
    dispositionId: latest.id,
    setAt: latest.created_at,
    setBy: latest.set_by_user_id,
    reason: latest.reason,
  };
}

/** Snooze history of one opportunity: every revisit_later row, oldest first. */
export function snoozeHistory(rows: readonly OpportunityDisposition[], subject: SnoozeSubject): OpportunityDisposition[] {
  return dispositionsOf(rows, subject)
    .filter((d) => d.disposition === 'revisit_later')
    .sort((a, b) => compareDispositionsLatestFirst(b, a));
}

// ---------------------------------------------------------------------------
// Snooze-terminal states (closure-D, migration 20270109000003)
// ---------------------------------------------------------------------------

/**
 * Lifecycle states in which an opportunity can NOT be snoozed: it is no longer
 * being worked, so "come back to this later" has no meaning. A subset of the
 * existing 9-state vocabulary (no new state). Three senses of "terminal" exist
 * in the repo and this is deliberately named for its purpose:
 *   - transition graph (backend/types/opportunityLifecycle.ts): converted and
 *     archived; dismissed may be reopened to triaged;
 *   - account deletion (FR-A38, isResolvedForAccountDeletion): archived only;
 *   - snooze (here): converted, dismissed, archived. A dismissed opportunity
 *     must be reopened (dismissed -> triaged) before it can be snoozed.
 * The database guard `trg_opp_disposition_snooze_guard` lists the same three;
 * a unit test pins the two lists equal.
 */
export const SNOOZE_TERMINAL_LIFECYCLE_STATES = ['converted', 'dismissed', 'archived'] as const satisfies readonly LifecycleState[];

export function isSnoozeTerminalState(state: unknown): boolean {
  return typeof state === 'string' && (SNOOZE_TERMINAL_LIFECYCLE_STATES as readonly string[]).includes(state);
}

/** The constraint name the database guard raises (SQLSTATE 23514). */
export const SNOOZE_TERMINAL_CONSTRAINT = 'opp_disposition_snooze_not_terminal';

export type SnoozeRefusalReason = 'terminal' | 'lifecycle_unreadable';

/**
 * One error for "this opportunity may not be snoozed", whether the service
 * refused before writing or the database refused the insert. `message` is
 * `snooze_refused_terminal:<state>` or `snooze_refused_lifecycle_unreadable:<detail>`.
 */
export class OpportunitySnoozeRefusedError extends Error {
  constructor(
    public readonly reason: SnoozeRefusalReason,
    public readonly state: LifecycleState | null,
    public readonly source: 'application' | 'database',
    detail?: string,
  ) {
    super(reason === 'terminal'
      ? `snooze_refused_terminal:${state ?? 'unknown'}`
      : `snooze_refused_lifecycle_unreadable:${detail ?? 'unknown'}`);
    this.name = 'OpportunitySnoozeRefusedError';
  }
}

/**
 * Maps the database guard's refusal to the application error. Recognised only
 * when BOTH the SQLSTATE is 23514 and the message carries the constraint name,
 * so the revisit_later CHECK (also 23514) is never mistaken for it.
 */
export function snoozeRefusalFromDbError(error: unknown): OpportunitySnoozeRefusedError | null {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';
  if (e.code !== '23514' || !message.includes(SNOOZE_TERMINAL_CONSTRAINT)) return null;
  const m = / is ([a-z_]+);/.exec(message);
  const state = m && isSnoozeTerminalState(m[1]) ? (m[1] as LifecycleState) : null;
  return new OpportunitySnoozeRefusedError('terminal', state, 'database');
}

/** Validates a requested deadline: a real instant strictly after `now`. */
export function validateSnoozeDeadline(until: string, now: string): string {
  const u = ms(until);
  if (u <= ms(now)) throw new Error('snooze_until_must_be_in_the_future');
  return new Date(u).toISOString();
}
