/**
 * Withdrawing what a journey prepared and no longer wants: a whole run when it ends, and
 * one step when it is skipped or settled by a person. WS-3's dispatcher does not check the
 * run, so a task left live here can still be approved and sent.
 *
 * ORDER MATTERS. A run withdraws its tasks BEFORE it goes terminal, because a terminal run
 * is never swept again and a failed withdrawal could not be retried. If withdrawal cannot
 * be confirmed this throws and the run stays open: the sweep tries again, and a person's
 * cancel gets an error rather than a false success. It withdraws once more afterwards,
 * because only the ended run stops the bridge from creating another task.
 *
 * A task already dispatching or sent is left to its engine. Each withdrawal is a
 * compare-and-set, re-read if it loses a race to another transition.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { cancelExecutionRun } from '../workflowExecution/stepProgressionStore';
import { listInstanceHandoffs } from '../outreachBridge/outreachBridgeStore';
import { getOutreachTaskById, transitionOutreachTaskState } from '../leadOutreachExecution';

const WITHDRAW_ATTEMPTS = 3;
const LIVE_STATUSES = ['pending', 'awaiting_approval', 'approved', 'queued'] as const;
type LiveStatus = typeof LIVE_STATUSES[number];
const isLive = (s: unknown): s is LiveStatus => (LIVE_STATUSES as readonly unknown[]).includes(s);
const ACTED_STATUSES: readonly unknown[] = ['dispatching', 'sent', 'delivered', 'completed'];

const incomplete = (what: string): Error =>
  Object.assign(new Error(`${what} could not be confirmed withdrawn; the journey stays open`), { code: 'withdrawal_incomplete' });

/** Throws when the outcome cannot be confirmed. A handoff's task always exists, so null is a failed read. */
async function withdrawTask(organizationId: string, outreachTaskId: string): Promise<'withdrawn' | 'engine_holds' | 'nothing_live'> {
  for (let i = 0; i < WITHDRAW_ATTEMPTS; i += 1) {
    const task = await getOutreachTaskById(organizationId, outreachTaskId);
    if (task === null) break;
    if (ACTED_STATUSES.includes(task.status)) return 'engine_holds';
    if (!isLive(task.status)) return 'nothing_live';
    if ((await transitionOutreachTaskState(organizationId, outreachTaskId, task.status, 'cancelled')).changed) return 'withdrawn';
  }
  throw incomplete('an outreach task');
}

export async function withdrawUnsentTasks(organizationId: string, executionInstanceId: string): Promise<void> {
  for (const h of await listInstanceHandoffs(organizationId, executionInstanceId)) {
    await withdrawTask(organizationId, h.outreachTaskId);
  }
}

/**
 * Before a step is skipped or settled: withdraw its unsent WS-3 task, and say whether an
 * engine already holds the action. If one does, conditions no longer decide this step,
 * because skipping it would let the next candidate contact the same person a second time.
 */
export async function withdrawStepAction(organizationId: string, executionInstanceId: string, executionTaskId: string): Promise<'none' | 'engine_holds'> {
  const requests = await ownedDbTable('execution_engine_requests')
    .select('state')
    .eq('organization_id', organizationId)
    .eq('execution_task_id', executionTaskId);
  if (requests.error) throw incomplete('an engine request');
  const rows = (requests.data ?? []) as unknown as Array<{ state: string }>;
  if (rows.some((r) => r.state !== 'skipped')) return 'engine_holds';

  const handoff = (await listInstanceHandoffs(organizationId, executionInstanceId)).find((h) => h.executionTaskId === executionTaskId);
  if (handoff === undefined) return 'none';
  return (await withdrawTask(organizationId, handoff.outreachTaskId)) === 'engine_holds' ? 'engine_holds' : 'none';
}

export async function exitJourney(organizationId: string, executionInstanceId: string): Promise<number> {
  await withdrawUnsentTasks(organizationId, executionInstanceId);
  const cancelled = await cancelExecutionRun({ organizationId, executionInstanceId });
  await withdrawUnsentTasks(organizationId, executionInstanceId);
  return cancelled;
}
