/**
 * Publish Queue Worker
 *
 * Consumes jobs from the 'publish' queue and runs processPublishJob.
 * Run as a separate process or via startWorkers.ts.
 */

import { getWorker } from '../bullmqClient';
import { processPublishJob } from '../jobProcessors/publishProcessor';

const worker = getWorker('publish', processPublishJob);

console.log('[publishWorker] started');

const shutdown = async () => {
  await worker.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
