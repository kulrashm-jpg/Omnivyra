import { Queue } from 'bullmq';
import { getRedisConfig, getQueuePrefix } from './bullmqClient';

// Uses REDIS_URL from environment (via bullmqClient), not hardcoded localhost
export const jobQueue = new Queue('engine-jobs', {
  connection: getRedisConfig(),
  prefix: getQueuePrefix(),
  // OPS-C: bounded retention. engine-jobs had NO defaultJobOptions, so every
  // job enqueued without per-job remove options (all Market Pulse jobs) was
  // kept in Redis forever after it completed or failed — unbounded growth of
  // the `bull:engine-jobs:completed|failed` sets and one hash per job. Lead
  // jobs set their own (leadQueueHardenedDefaults: 24h/1000, 14d) and are
  // unaffected. Job state of record lives in market_pulse_jobs_v1 /
  // lead_jobs, never in the BullMQ job hash. The failed-retention window
  // matches leadQueueHardenedDefaults so DLQ inspection keeps 14 days.
  // attempts/backoff are deliberately NOT set here: retry policy stays per job.
  defaultJobOptions: {
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 14 * 24 * 3600 },
  },
});
