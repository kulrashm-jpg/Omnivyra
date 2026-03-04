/**
 * Unified Worker Bootstrap
 *
 * Starts both publish and engagement-polling workers in one process.
 * Use with PM2: pm2 start backend/queue/startWorkers.ts --interpreter ts-node
 * Or: node -r ts-node/register backend/queue/startWorkers.ts
 */

import { getWorker } from './bullmqClient';
import { processPublishJob } from './jobProcessors/publishProcessor';
import { processEngagementPollingJob } from './jobProcessors/engagementPollingProcessor';

const publishWorker = getWorker('publish', processPublishJob);
const engagementWorker = getWorker(
  'engagement-polling',
  async () => {
    await processEngagementPollingJob();
  }
);

console.log('[workers] publish worker started');
console.log('[workers] engagement polling worker started');

const shutdown = async () => {
  await publishWorker.close();
  await engagementWorker.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
