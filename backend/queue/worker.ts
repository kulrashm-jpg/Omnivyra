/**
 * Queue Worker Entry Point
 * 
 * Starts the BullMQ worker that processes 'publish' jobs from the queue.
 * Worker reads jobs from Redis, processes them via publishProcessor, and updates DB.
 * 
 * Run: npm run start:worker
 * Or: node -r ts-node/register backend/queue/worker.ts
 * 
 * Environment Variables:
 * - REDIS_URL (required)
 * - SUPABASE_URL (required)
 * - SUPABASE_SERVICE_ROLE_KEY (required for backend)
 * - USE_MOCK_PLATFORMS=true (optional, for testing without real API keys)
 */

import { Job } from 'bullmq';
import { getWorker, closeConnections } from './bullmqClient';
import { processPublishJob } from './jobProcessors/publishProcessor';

let workerInstance: ReturnType<typeof getWorker> | null = null;

/**
 * Start the queue worker
 */
async function startWorker() {
  console.log('🚀 Starting queue worker...');

  workerInstance = getWorker('publish', async (job: Job) => {
    await processPublishJob(job);
  });

  console.log('✅ Queue worker started. Listening for jobs...');

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}. Shutting down worker...`);
    if (workerInstance) {
      await workerInstance.close();
      workerInstance = null;
    }
    await closeConnections();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });
}

// Start worker if this file is run directly
if (require.main === module) {
  startWorker().catch((err) => {
    console.error('Failed to start worker:', err);
    process.exit(1);
  });
}

export { startWorker };

