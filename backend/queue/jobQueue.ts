import { Queue } from 'bullmq';
import { getRedisConfig } from './bullmqClient';

// Uses REDIS_URL from environment (via bullmqClient), not hardcoded localhost
export const jobQueue = new Queue('engine-jobs', {
  connection: getRedisConfig(),
});
