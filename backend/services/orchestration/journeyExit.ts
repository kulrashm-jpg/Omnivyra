/**
 * Ending a journey, for everyone who can end one: the sweeper on a response, and a
 * person cancelling a run. Both must leave nothing behind that a later approval or
 * dispatch could still send.
 *
 * Cancels the workflow records through the existing RPC, then withdraws any WS-3 task
 * that has not started sending. A task already dispatching or sent is left to its
 * engine. Each withdrawal is a compare-and-set, so losing a race to a dispatch is not a
 * failure.
 */
import { cancelExecutionRun } from '../workflowExecution/stepProgressionStore';
import { listInstanceHandoffs } from '../outreachBridge/outreachBridgeStore';
import { getOutreachTaskById, transitionOutreachTaskState } from '../leadOutreachExecution';

export async function exitJourney(organizationId: string, executionInstanceId: string): Promise<number> {
  const cancelled = await cancelExecutionRun({ organizationId, executionInstanceId });
  await withdrawUnsentTasks(organizationId, executionInstanceId);
  return cancelled;
}

export async function withdrawUnsentTasks(organizationId: string, executionInstanceId: string): Promise<void> {
  for (const h of await listInstanceHandoffs(organizationId, executionInstanceId)) {
    const task = await getOutreachTaskById(organizationId, h.outreachTaskId);
    const status = task?.status;
    if (status === 'pending' || status === 'awaiting_approval' || status === 'approved' || status === 'queued') {
      await transitionOutreachTaskState(organizationId, h.outreachTaskId, status, 'cancelled');
    }
  }
}
