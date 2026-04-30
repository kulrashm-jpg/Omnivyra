/**
 * Unified Worker Bootstrap
 *
 * Starts publish, engagement-polling, bolt-execution, and intelligence-polling workers.
 * Can be run standalone (npm run start:workers) or auto-started via instrumentation.
 *
 * BOLT worker concurrency: min(4, cpu_cores) to prevent overload on smaller machines.
 */

import os from 'os';
import { getWorker, getUsageProtectionReady } from './bullmqClient';
import { processPublishJob } from './jobProcessors/publishProcessor';
import { processEngagementPollingJob } from './jobProcessors/engagementPollingProcessor';
import { processBoltJob } from './jobProcessors/boltProcessor';
import { processContentGenerationJob } from './jobProcessors/contentGenerationProcessor';
import { processCreatorContentJob } from './jobProcessors/creatorContentProcessor';
import { processBoltContentJob } from './jobProcessors/boltContentJobProcessor';
import { processWhatsAppBroadcastJob } from './jobProcessors/whatsappBroadcastProcessor';
import { processWhatsAppWebhookJob } from './jobProcessors/whatsappWebhookProcessor';
import { processAnalyticsIngestionJob } from './jobProcessors/analyticsIngestionProcessor';
import { getIntelligencePollingWorker } from '../workers/intelligencePollingWorker';
import { initializeContentQueues, startContentWorkers, startCreatorContentWorkers, startBoltContentWorkers, startWhatsAppBroadcastWorker, startWhatsAppWebhookWorker, startAnalyticsIngestionWorker } from './contentGenerationQueues';

let publishWorker: ReturnType<typeof getWorker>;
let boltWorker: ReturnType<typeof getWorker>;
let engagementWorker: ReturnType<typeof getWorker>;
let engineWorker: ReturnType<typeof getWorker>;
let intelligencePollingWorker: ReturnType<typeof getIntelligencePollingWorker>;

const shutdown = async () => {
  await publishWorker?.close?.();
  await engagementWorker?.close?.();
  await boltWorker?.close?.();
  await engineWorker?.close?.();
  await intelligencePollingWorker?.close?.();
  process.exit(0);
};

/**
 * Start all background workers. Call during server bootstrap.
 */
export async function startWorkers(): Promise<void> {
  const boltConcurrency = Math.min(4, Math.max(1, os.cpus().length));

  // BUG#21 fix: await first usage-protection poll before registering workers.
  // This ensures _level is known and protection is enforced from job #1.
  await getUsageProtectionReady();

  // Initialize content generation queues (pre-flight checks, rate limiting, backpressure)
  await initializeContentQueues();

  // Start content generation workers (unified processor for all text content types)
  await startContentWorkers(processContentGenerationJob);

  // Start creator content workers (video, carousel, story)
  await startCreatorContentWorkers(processCreatorContentJob);

  // Start BOLT content job workers (async per-topic master+variant+schedule)
  await startBoltContentWorkers(processBoltContentJob);

  // Start WhatsApp broadcast workers (batched sends, tier-aware chunking)
  await startWhatsAppBroadcastWorker(processWhatsAppBroadcastJob);

  // Start WhatsApp webhook event workers (async processing of Meta webhook payloads)
  await startWhatsAppWebhookWorker(processWhatsAppWebhookJob);

  // Start analytics ingestion worker (daily growth + post-metric polls)
  await startAnalyticsIngestionWorker(processAnalyticsIngestionJob);

  publishWorker = getWorker('publish', processPublishJob);
  boltWorker = getWorker('bolt-execution', processBoltJob, { concurrency: boltConcurrency });
  engagementWorker = getWorker(
    'engagement-polling',
    async () => {
      await processEngagementPollingJob();
    }
  );
  engineWorker = getWorker('engine-jobs', async (job) => {
    const { type, jobId } = job.data as { type?: string; jobId?: string };
    if (!jobId) return;

    if (type === 'LEAD') {
      const { processLeadJobV1 } = await import('../services/leadJobProcessor');
      await processLeadJobV1(jobId);
      return;
    }

    if (type === 'MARKET_PULSE') {
      const { processMarketPulseJobV1 } = await import('../services/marketPulseJobProcessor');
      await processMarketPulseJobV1(jobId);
    }
  }, { concurrency: 2 });
  intelligencePollingWorker = getIntelligencePollingWorker();

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('[workers] analytics ingestion worker started');
  console.log('[startup] workers initialized');
  console.log('[workers] publish worker started');
  console.log('[workers] engagement polling worker started');
  console.log('[workers] bolt-execution worker started');
  console.log('[workers] engine-jobs worker started');
  console.log('[workers] intelligence polling worker started');
  console.log('[workers] content generation workers started (blog, post, whitepaper, story, engagement)');
}

// Standalone: run when file is executed directly
if (typeof require !== 'undefined' && require.main === module) {
  startWorkers().catch((err) => {
    console.error('Failed to start workers:', err);
    process.exit(1);
  });
}
