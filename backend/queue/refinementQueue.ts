/**
 * BullMQ queue + worker bootstrap for async campaign refinement.
 *
 * The synchronous planner returns the base alignment-recovered plan. This
 * queue picks up the refinement work (postProcessGeneratedPlan call +
 * persist) in the background so the user gets a campaign object faster.
 *
 * One queue, one worker per process. Jobs are idempotent by jobId
 * (see asyncRefinement.ts).
 */

import { Queue } from 'bullmq';
import { getConnectionConfig, getQueuePrefix } from './bullmqClient';

let refinementQueue: Queue | null = null;

export function getRefinementQueue(): Queue {
  if (!refinementQueue) {
    refinementQueue = new Queue('planner-refinement', {
      connection: getConnectionConfig(),
      prefix: getQueuePrefix(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 86400, count: 500 },
        removeOnFail: { age: 604800 },
      },
    });
    refinementQueue.on('error', (err) => console.error('[planner-refinement-queue]', err));
  }
  return refinementQueue;
}
