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
 * NOT COUNTED (review of 2026-11-09; each is a separate decision, not part of this change):
 *   - In-flight requests (`submitting`, `submitted`: queued, not yet confirmed). Two journeys
 *     due together can both send within minutes (measured). Counting them is proposed as
 *     D-2 for owner decision; its cost is a deferral of at most the policy gap when the
 *     queued message is then never sent.
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

/** The last contact the frequency policy counts, and whether it is unconfirmed. */
export interface SubjectContactAction {
  readonly at: string;
  /** True when the latest counted action is an `uncertain` engine request: it MAY have reached the person. */
  readonly unconfirmed: boolean;
}

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

  let uncertain: string | null = null;
  if (taskIds.length > 0) {
    const requests = await ownedDbTable(ENGINE_REQUESTS_TABLE)
      .select('updated_at')
      .eq('organization_id', organizationId)        // TENANT FIRST
      .in('execution_task_id', taskIds)
      .eq('state', 'uncertain')
      .order('updated_at', { ascending: false })
      .limit(1);
    if (requests.error || !Array.isArray(requests.data)) throw unreadable('the engine request ledger');
    const v = (requests.data[0] as Record<string, unknown> | undefined)?.updated_at;
    uncertain = typeof v === 'string' && v ? v : null;
  }

  if (completed === null && uncertain === null) return null;
  if (uncertain === null) return { at: completed as string, unconfirmed: false };
  if (completed === null) return { at: uncertain, unconfirmed: true };
  // Both: the later one. A tie is one moment, read as the confirmed action.
  return Date.parse(uncertain) > Date.parse(completed)
    ? { at: uncertain, unconfirmed: true }
    : { at: completed, unconfirmed: false };
}
