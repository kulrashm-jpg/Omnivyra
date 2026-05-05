/**
 * Lead Jobs Queue
 * Production-safe queue for lead job processing. API enqueues; worker executes.
 *
 * Env: REDIS_URL
 */

import { Queue } from 'bullmq';
import { REDIS_URL } from '../config/env';

function getConnection() {
  if (REDIS_URL && REDIS_URL.includes('://')) {
    const parsed = new URL(REDIS_URL);
    const needsTls = parsed.hostname.includes('upstash.io');
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
      ...(needsTls ? { tls: {} } : {}),
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    };
  }
  throw new Error('REDIS_URL_INVALID');
}

export const leadQueueConnection = getConnection();

export const leadQueue = new Queue('lead-jobs', {
  connection: leadQueueConnection,
  defaultJobOptions: {
    attempts: 1,
    backoff: {
      type: 'exponential',
      delay: 60000,
    },
    removeOnComplete: {
      age: 24 * 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600,
    },
  },
});
