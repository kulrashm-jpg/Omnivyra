/**
 * Engagement Polling Worker
 *
 * Processes jobs from the engagement-polling queue (concurrency 1).
 * Run this process alongside the cron so that enqueued engagement polling jobs are processed.
 *
 * Usage: node -r ts-node/register backend/queue/workers/engagementPollingWorker.ts
 * Or integrate into an existing worker process that also runs getWorker('publish', ...).
 */

import { getEngagementPollingWorker } from '../bullmqClient';

const worker = getEngagementPollingWorker();

console.log('✅ Engagement polling worker started (queue: engagement-polling, concurrency: 1)');

const shutdown = async () => {
  console.log('Shutting down engagement polling worker...');
  await worker.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
