/**
 * BOLT Execution Queue
 * Enqueues background BOLT pipeline jobs.
 */

import { Queue } from 'bullmq';
import { getRedisConfig } from './bullmqClient';

let boltQueue: Queue | null = null;

export function getBoltQueue(): Queue {
  if (!boltQueue) {
    const config = getRedisConfig();
    boltQueue = new Queue('bolt-execution', {
      connection: {
        host: config.host,
        port: config.port,
        password: config.password,
      },
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
