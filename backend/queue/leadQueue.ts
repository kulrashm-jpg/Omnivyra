/**
 * Lead Jobs Queue
 * Production-safe queue for lead job processing. API enqueues; worker executes.
 *
 * Env: REDIS_HOST, REDIS_PORT, REDIS_PASSWORD (optional) or REDIS_URL
 */

import { Queue } from 'bullmq';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_URL = process.env.REDIS_URL;

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
  return {
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
  };
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
