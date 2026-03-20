/**
 * BOLT Execution Queue
 * Enqueues background BOLT pipeline jobs.
 */

import { Queue } from 'bullmq';
import { getConnectionConfig } from './bullmqClient';

let boltQueue: Queue | null = null;

export function getBoltQueue(): Queue {
  if (!boltQueue) {
    boltQueue = new Queue('bolt-execution', {
      connection: getConnectionConfig(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 86400, count: 500 },
        removeOnFail: { age: 604800 },
      },
    });
    boltQueue.on('error', (err) => console.error('[bolt-queue]', err));
  }
  return boltQueue;
}
