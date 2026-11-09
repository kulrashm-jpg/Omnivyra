/**
 * Orchestration, Follow-up D (owner GO 2026-11-09) — the frequency policy's read of "when was
 * this person last contacted, or MAY have been", across all of their journeys.
 *
 * Counted, within this tenant and on channels that contact the person only:
 *   - a completed plan step: the existing `lastCompletedActionAtForSubject`, unchanged;
 *   - an engine request settled `uncertain` (`execution_engine_requests`: WhatsApp,
 *     community), at the moment it was settled (`updated_at`; the ledger guard never moves a
 *     settled row, so that moment is fixed). It may have reached the person, so a concurrent
 *     or later journey must not treat them as uncontacted. It is NEVER read as sent or
 *     delivered, and its state is not touched. `failed` (a confirmed refusal) is not counted.
 *   - D-2 (owner design GO 2026-11-09): an engine request IN FLIGHT, `submitting` (claimed,
 *     being created) or `submitted` (queued with the engine, not yet confirmed), from its
 *     IMMUTABLE queue timestamp `queued_at` (migration 20270129000001: set once by trigger when
 *     the request first became a possible contact; retries, reconciliation and settlement
 *     never move it). It may be sent at any moment, so a journey due in the same sweep, or
 *     soon after, must wait. An `uncertain` request is counted from the same `queued_at`.
 *     It stops counting as soon as the engine's outcome is recorded on the ledger: `completed`
 *     (then the step's `completed_at` counts instead), `skipped` (blocked by governance),
 *     `failed` (blocked by a send control, or refused), or `requested` (a stale claim released:
 *     nothing was created). Until the owning run's next sweep records that outcome, the
 *     request still counts: the lag is that sweep interval, and a deferral it causes is never
 *     longer than the policy gap, because the timestamp is fixed.
 *
 * FAILS CLOSED (owner decision 2026-11-09). A counted request whose `queued_at` is missing or
 * unreadable, or a completed step whose time is unreadable, is NOT dropped from the history:
 * the answer is `invalid`, and the sweeper defers external contact with that reason.
 *
 * Only the LATEST counts: one communication that shows both ways (a step a person settled
 * `completed` over its uncertain request) is one contact, never two.
 *
 * `excludeTaskId` is the task being decided: a step is never deferred by its own uncertain
 * request, which would hide its "a person reviews it" signal behind a frequency wait.
 *
 * WHAT THE TIME MEANS. `updated_at` of an uncertain request is a CONSERVATIVE PROXY for a
 * possible contact: the moment the engine recorded that it could not tell whether it acted.
 * It is not proof that anything was sent or delivered, and not the provider's send time; a
 * batch whose queue acknowledgement was lost may still be sent by the queue later than this.
 *
 * The in-flight timestamp is likewise a proxy for possible contact, never proof of a send.
 *
 * CONCURRENCY. This read is the sweeper's early check, not the guarantee. The guarantee is the
 * engine's claim: public.orch_claim_engine_request takes the person's lock, re-reads this same
 * history and makes the claim in one transaction (engineRequestClaim.ts), so two workers can
 * never both pass the gap and both claim WhatsApp or community work for one person.
 *
 * NOT COUNTED (review of 2026-11-09; a separate decision, not part of this change):
 *   - WS-3 email whose dispatch timed out (`timeout`, may have acted). Its record lives in
 *     Outreach-owned stores (`outreach_attempts` and related). Counting it is an OUTREACH
 *     INTEGRATION DEPENDENCY: it needs Outreach's agreement on an owned read or signal; this
 *     module never queries those stores.
 *
 * Why a module of its own: `executionPlanStore.ts` is PI-036's frozen artefact (byte-pinned by
 * PI's 037/040 suites), so it is reused, not edited. The cost is one more tenant-first read
 * of the person's tasks.
 *
 * Throws on any failed read: an unknown history must never read as "not contacted".
 */

import { ownedDbTable } from '../../db/writeOwner';
import { lastCompletedActionAtForSubject } from '../executionPlans/executionPlanStore';
import { NON_CONTACT_CHANNELS } from './journeyPolicy';

/** The engine request ledger (orchestration engines without their own per-task record). */
const ENGINE_REQUESTS_TABLE = 'execution_engine_requests';

/** What the latest counted action is: a confirmed step, an uncertain request, or one in flight. */
export type ContactBasis = 'completed' | 'uncertain' | 'in_flight';

/** The last contact the frequency policy counts, and whether it is unconfirmed. */
export interface SubjectContactAction {
  /** null only when `invalid`. */
  readonly at: string | null;
  /** True unless the latest counted action is a completed step: it MAY have reached the person, or may yet. */
  readonly unconfirmed: boolean;
  readonly basis: ContactBasis;
  /** A counted record's time is missing or unreadable: the history cannot be trusted; fail closed. */
  readonly invalid?: true;
}

const readable = (v: unknown): v is string => typeof v === 'string' && v !== '' && !Number.isNaN(Date.parse(v));

/** Ledger states counted as possible contact, and what each one means. */
const POSSIBLE_CONTACT_STATES: Readonly<Record<string, ContactBasis>> = {
  uncertain: 'uncertain',
  submitting: 'in_flight',
  submitted: 'in_flight',
};

const unreadable = (what: string): Error =>
  Object.assign(new Error(`${what} could not be read; the frequency policy cannot be evaluated`), { code: 'frequency_unreadable' });

export async function lastContactActionAtForSubject(
  organizationId: string,
  subjectKind: 'lead' | 'prospect',
  subjectId: string,
  options: { excludeTaskId?: string } = {},
): Promise<SubjectContactAction | null> {
  // Validates the tenant and subject, and throws on a failed read.
  const completed = await lastCompletedActionAtForSubject(organizationId, subjectKind, subjectId);

  const tasks = await ownedDbTable('execution_tasks')
    .select('id, channel')
    .eq('organization_id', organizationId)          // TENANT FIRST
    .eq('subject_kind', subjectKind)
    .eq('subject_id', subjectId)
    .limit(1000);
  if (tasks.error || !Array.isArray(tasks.data)) throw unreadable('the person\'s tasks');
  const taskIds = (tasks.data as Array<Record<string, unknown>>)
    .filter((t) => !NON_CONTACT_CHANNELS.includes(String(t.channel)))
    .map((t) => String(t.id))
    .filter((id) => id !== options.excludeTaskId);

  let possible: { at: string; basis: ContactBasis } | null = null;
  if (taskIds.length > 0) {
    // Newest first, a missing queue time first of all, so a contradictory row is never hidden.
    const requests = await ownedDbTable(ENGINE_REQUESTS_TABLE)
      .select('queued_at, state')
      .eq('organization_id', organizationId)        // TENANT FIRST
      .in('execution_task_id', taskIds)
      .in('state', Object.keys(POSSIBLE_CONTACT_STATES))
      .order('queued_at', { ascending: false, nullsFirst: true })
      .limit(1);
    if (requests.error || !Array.isArray(requests.data)) throw unreadable('the engine request ledger');
    const row = requests.data[0] as Record<string, unknown> | undefined;
    if (row !== undefined) {
      const basis = POSSIBLE_CONTACT_STATES[String(row.state)] ?? 'in_flight';
      if (!readable(row.queued_at)) return { at: null, unconfirmed: true, basis, invalid: true };
      possible = { at: row.queued_at, basis };
    }
  }
  if (completed !== null && !readable(completed)) return { at: null, unconfirmed: false, basis: 'completed', invalid: true };

  if (completed === null && possible === null) return null;
  if (possible === null) return { at: completed as string, unconfirmed: false, basis: 'completed' };
  if (completed === null) return { at: possible.at, unconfirmed: true, basis: possible.basis };
  // Both: the later one. A tie is one moment, read as the confirmed action.
  return Date.parse(possible.at) > Date.parse(completed)
    ? { at: possible.at, unconfirmed: true, basis: possible.basis }
    : { at: completed, unconfirmed: false, basis: 'completed' };
}
