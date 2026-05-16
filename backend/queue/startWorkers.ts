/**
 * Unified Worker Bootstrap
 *
 * Starts publish, engagement-polling, bolt-execution, and intelligence-polling workers.
 * Can be run standalone (npm run start:workers) or auto-started via instrumentation.
 *
 * BOLT worker concurrency: min(4, cpu_cores) to prevent overload on smaller machines.
 */

import os from 'os';
import * as _diag_fs3 from 'fs';
import * as _diag_path3 from 'path';
// TEMP diagnostic — same sentinel file as instrumentation hook.
function _diag(stage: string, extra?: Record<string, unknown>): void {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), stage, ...extra }) + '\n';
    _diag_fs3.appendFileSync(_diag_path3.join(process.cwd(), '.worker-bootstrap.log'), line);
  } catch { /* never throw from diagnostics */ }
}
_diag('startWorkers.ts:module-loaded');
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
let listeningExecutionWorker: ReturnType<typeof getWorker>;
let semanticIndexingWorker: ReturnType<typeof getWorker>;
let replayPartitionWorker: ReturnType<typeof getWorker>;

const shutdown = async () => {
  await publishWorker?.close?.();
  await engagementWorker?.close?.();
  await boltWorker?.close?.();
  await engineWorker?.close?.();
  await intelligencePollingWorker?.close?.();
  await listeningExecutionWorker?.close?.();
  await semanticIndexingWorker?.close?.();
  await replayPartitionWorker?.close?.();
  process.exit(0);
};

/**
 * Start all background workers. Call during server bootstrap.
 */
export async function startWorkers(): Promise<void> {
  _diag('startWorkers:entered');
  const boltConcurrency = Math.min(4, Math.max(1, os.cpus().length));

  // BUG#21 fix: await first usage-protection poll before registering workers.
  // This ensures _level is known and protection is enforced from job #1.
  try { await getUsageProtectionReady(); _diag('startWorkers:after-getUsageProtectionReady'); }
  catch (e) { _diag('startWorkers:getUsageProtectionReady-THREW', { error: e instanceof Error ? e.message : String(e) }); throw e; }

  // Initialize content generation queues (pre-flight checks, rate limiting, backpressure)
  try { await initializeContentQueues(); _diag('startWorkers:after-initializeContentQueues'); }
  catch (e) { _diag('startWorkers:initializeContentQueues-THREW', { error: e instanceof Error ? e.message : String(e) }); throw e; }

  // Start content generation workers (unified processor for all text content types)
  try { await startContentWorkers(processContentGenerationJob); _diag('startWorkers:after-startContentWorkers'); }
  catch (e) { _diag('startWorkers:startContentWorkers-THREW', { error: e instanceof Error ? e.message : String(e) }); throw e; }

  // Start creator content workers (video, carousel, story)
  try { await startCreatorContentWorkers(processCreatorContentJob); _diag('startWorkers:after-startCreatorContentWorkers'); }
  catch (e) { _diag('startWorkers:startCreatorContentWorkers-THREW', { error: e instanceof Error ? e.message : String(e) }); throw e; }

  // Start BOLT content job workers (async per-topic master+variant+schedule)
  try { await startBoltContentWorkers(processBoltContentJob); _diag('startWorkers:after-startBoltContentWorkers'); }
  catch (e) { _diag('startWorkers:startBoltContentWorkers-THREW', { error: e instanceof Error ? e.message : String(e) }); throw e; }

  // Start WhatsApp broadcast workers (batched sends, tier-aware chunking)
  try { await startWhatsAppBroadcastWorker(processWhatsAppBroadcastJob); _diag('startWorkers:after-startWhatsAppBroadcastWorker'); }
  catch (e) { _diag('startWorkers:startWhatsAppBroadcastWorker-THREW', { error: e instanceof Error ? e.message : String(e) }); throw e; }

  // Start WhatsApp webhook event workers (async processing of Meta webhook payloads)
  try { await startWhatsAppWebhookWorker(processWhatsAppWebhookJob); _diag('startWorkers:after-startWhatsAppWebhookWorker'); }
  catch (e) { _diag('startWorkers:startWhatsAppWebhookWorker-THREW', { error: e instanceof Error ? e.message : String(e) }); throw e; }

  // Start analytics ingestion worker (daily growth + post-metric polls)
  try { await startAnalyticsIngestionWorker(processAnalyticsIngestionJob); _diag('startWorkers:after-startAnalyticsIngestionWorker'); }
  catch (e) { _diag('startWorkers:startAnalyticsIngestionWorker-THREW', { error: e instanceof Error ? e.message : String(e) }); throw e; }

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

  // Phase 0 — structured failure metadata for LEAD jobs. Emits one log line
  // per attempt; on final attempt the metadata can be picked up by a future
  // DLQ producer. No DLQ producer yet (Phase 0 ships the foundation only),
  // and MARKET_PULSE failures retain their existing logging.
  try {
    const { buildLeadJobFailureMetadata } = await import('./leadQueueHardening');
    const { recordLeadJobFailure } = await import('./leadQueueObservability');
    engineWorker.on('failed', (job, err) => {
      if (!job) return;
      const data = job.data as { type?: string } | undefined;
      if (data?.type !== 'LEAD') return;
      const meta = buildLeadJobFailureMetadata({
        jobId: String(job.id ?? 'unknown'),
        jobName: job.name,
        attemptsMade: job.attemptsMade,
        attemptsAllowed: job.opts?.attempts ?? 1,
        failedReason: err?.message ?? 'unknown',
        stack: err?.stack ?? null,
        data: job.data,
      });
      const { category } = recordLeadJobFailure({
        jobId: String(job.id ?? 'unknown'),
        reason: err?.message ?? null,
      });
      console.warn(
        '[lead-job-failed]',
        JSON.stringify({ category, ...meta }),
      );
    });
  } catch (e) {
    _diag('startWorkers:lead-failed-handler-attach-failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  intelligencePollingWorker = getIntelligencePollingWorker();

  // Phase 3 — listening-executions worker. Bounded; one execution per source
  // at a time per the DB UNIQUE partial index. Concurrency 2 across the org
  // pool keeps a single rogue source from starving others.
  try {
    const { LISTENING_EXECUTION_QUEUE_NAME } = await import('./listeningExecutionQueue');
    const { processListeningExecution } = await import('../services/listeningExecutionService');
    listeningExecutionWorker = getWorker(
      LISTENING_EXECUTION_QUEUE_NAME,
      async (job) => {
        const data = job.data as { executionId?: string } | undefined;
        if (!data?.executionId) return;
        await processListeningExecution(data.executionId);
      },
      { concurrency: 2 },
    );
    console.log('[workers] listening-executions worker started');
  } catch (e) {
    _diag('startWorkers:listeningExecutionWorker-attach-failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Phase 9 — semantic indexing partition worker. Bounded concurrency so a
  // single large job cannot starve the rest of the system; per-partition
  // jobId is deterministic so re-enqueue is idempotent.
  try {
    const { SEMANTIC_PARTITION_QUEUE_NAME } = await import('./semanticIndexingQueue');
    const { processSemanticPartition } = await import('../services/asyncSemanticRuntimeService');
    semanticIndexingWorker = getWorker(
      SEMANTIC_PARTITION_QUEUE_NAME,
      async (job) => {
        const data = job.data as { partitionId?: string } | undefined;
        if (!data?.partitionId) return;
        await processSemanticPartition(data.partitionId);
      },
      { concurrency: 2 },
    );
    console.log('[workers] semantic-indexing worker started');
  } catch (e) {
    _diag('startWorkers:semanticIndexingWorker-attach-failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Phase 9 — replay partition worker. Same bounded-concurrency model;
  // partitions hold their own checkpoints so failures are recoverable.
  try {
    const { REPLAY_PARTITION_QUEUE_NAME } = await import('./replayPartitionQueue');
    const { processReplayPartition } = await import('../services/replayCoordinationService');
    replayPartitionWorker = getWorker(
      REPLAY_PARTITION_QUEUE_NAME,
      async (job) => {
        const data = job.data as { partitionId?: string } | undefined;
        if (!data?.partitionId) return;
        await processReplayPartition(data.partitionId);
      },
      { concurrency: 2 },
    );
    console.log('[workers] replay-partition worker started');
  } catch (e) {
    _diag('startWorkers:replayPartitionWorker-attach-failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

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
