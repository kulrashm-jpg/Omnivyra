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
 *   - Snooze never reads or changes the lifecycle status.
 *
 * PURE: no database, no clock (`asOf` is always passed in), no randomness.
 */

import type { OpportunityDisposition } from '../../backend/types/opportunityWorkflow';

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

/** Validates a requested deadline: a real instant strictly after `now`. */
export function validateSnoozeDeadline(until: string, now: string): string {
  const u = ms(until);
  if (u <= ms(now)) throw new Error('snooze_until_must_be_in_the_future');
  return new Date(u).toISOString();
}
