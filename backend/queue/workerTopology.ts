/**
 * F-07 / W1-3 — Canonical shared worker registration (Foundation Batch B).
 *
 * ONE function, consumed by BOTH bootstraps (prod: backend/workers/main.ts,
 * dev: backend/queue/startWorkers.ts), registering every queue the manifest
 * declares `consumedVia: 'shared'`. This eliminates the incident class where
 * a queue is consumed on localhost but not in production (B-02): a new shared
 * consumer added here is automatically live in both.
 *
 * Design rules:
 *   - PROMOTION: registration reuses the exact same authorities dev already
 *     used (startContentWorkers, startCreatorContentWorkers, getWorker, …) —
 *     no second implementation of any worker.
 *   - NON-FATAL + LOUD per family (the proven main.ts remediation pattern):
 *     one family failing to register cannot stop the others, and the gap is
 *     never silent.
 *   - Processors are lazy-imported so importing this module stays cheap and
 *     side-effect-free (manifest consumers, tests).
 */
import { getWorker } from './bullmqClient';
import type { Worker } from 'bullmq';
import {
  initializeContentQueues,
  startContentWorkers,
  startCreatorContentWorkers,
  startWhatsAppBroadcastWorker,
  startWhatsAppWebhookWorker,
  startAnalyticsIngestionWorker,
} from './contentGenerationQueues';

export interface SharedConsumerHandles {
  /** getWorker-based handles that callers should close on shutdown. */
  workers: Worker[];
  /** Families that failed to register (already logged loudly). */
  failures: Array<{ family: string; error: string }>;
}

export interface RegisterSharedConsumersOptions {
  bootstrap: 'prod' | 'dev';
  /** Optional diagnostic hook (dev bootstrap passes its _diag sentinel). */
  onStage?: (stage: string, extra?: Record<string, unknown>) => void;
}

/**
 * Register every `consumedVia: 'shared'` queue from the topology manifest.
 * Idempotence is the caller's responsibility (each bootstrap calls once).
 */
export async function registerSharedConsumers(
  opts: RegisterSharedConsumersOptions,
): Promise<SharedConsumerHandles> {
  const handles: SharedConsumerHandles = { workers: [], failures: [] };
  const stage = (s: string, extra?: Record<string, unknown>) => {
    try { opts.onStage?.(s, extra); } catch { /* diagnostics never throw */ }
  };
  const family = async (name: string, impact: string, register: () => Promise<void>): Promise<void> => {
    try {
      await register();
      console.info(`[worker-topology] ${name} registered (${opts.bootstrap})`);
      stage(`workerTopology:${name}-registered`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      handles.failures.push({ family: name, error: message });
      console.error(`[worker-topology] ${name} registration FAILED — ${impact}:`, message);
      stage(`workerTopology:${name}-FAILED`, { error: message });
    }
  };

  // Content-generation queue init (pre-flight, rate limiting, backpressure)
  // must run before the content workers attach — same order dev always used.
  await family('content-queues-init', 'content generation queues not initialized', async () => {
    await initializeContentQueues();
  });

  await family('content-workers', 'text content generation (blog/post/whitepaper/story/newsletter/engagement/refinement) will NOT process', async () => {
    const { processContentGenerationJob } = await import('./jobProcessors/contentGenerationProcessor');
    await startContentWorkers(processContentGenerationJob);
  });

  await family('creator-content-workers', 'creator asset rendering (video/carousel/story) will NOT work', async () => {
    const { processCreatorContentJob } = await import('./jobProcessors/creatorContentProcessor');
    await startCreatorContentWorkers(processCreatorContentJob);
  });

  await family('whatsapp-broadcast-worker', 'WhatsApp broadcasts will NOT send', async () => {
    const { processWhatsAppBroadcastJob } = await import('./jobProcessors/whatsappBroadcastProcessor');
    await startWhatsAppBroadcastWorker(processWhatsAppBroadcastJob);
  });

  await family('whatsapp-webhook-worker', 'inbound WhatsApp events will NOT process', async () => {
    const { processWhatsAppWebhookJob } = await import('./jobProcessors/whatsappWebhookProcessor');
    await startWhatsAppWebhookWorker(processWhatsAppWebhookJob);
  });

  await family('analytics-ingestion-worker', 'analytics ingestion will NOT run', async () => {
    const { processAnalyticsIngestionJob } = await import('./jobProcessors/analyticsIngestionProcessor');
    await startAnalyticsIngestionWorker(processAnalyticsIngestionJob);
  });

  // Async planner refinement. Consumer attaches even while the enqueue flag
  // (ASYNC_REFINEMENT_ENABLED) is off so jobs from an enabled period drain —
  // the documented dev semantics, now true in prod too (W1-3).
  await family('planner-refinement-worker', 'queued planner refinements will NOT drain', async () => {
    const { processAsyncRefinementJob } = await import('./jobProcessors/asyncRefinementProcessor');
    const concurrency = Math.max(1, Number(process.env.PLANNER_REFINEMENT_CONCURRENCY || 2));
    const worker = getWorker('planner-refinement', async (job) => {
      await processAsyncRefinementJob(job as never);
    }, { concurrency });
    worker.on('error', (err) => console.error('[planner-refinement] worker error:', err?.message ?? err));
    worker.on('failed', (job, err) => console.warn('[planner-refinement] job failed:', {
      job_id: job?.id, attempts: job?.attemptsMade, error: err?.message,
    }));
    worker.on('stalled', (jobId) => console.warn('[planner-refinement] job stalled, will retry:', { job_id: jobId }));
    handles.workers.push(worker);
  });

  await family('listening-executions-worker', 'listening executions will NOT process', async () => {
    const { LISTENING_EXECUTION_QUEUE_NAME } = await import('./listeningExecutionQueue');
    const { processListeningExecution } = await import('../services/listeningExecutionService');
    const worker = getWorker(LISTENING_EXECUTION_QUEUE_NAME, async (job) => {
      const data = job.data as { executionId?: string } | undefined;
      if (!data?.executionId) return;
      await processListeningExecution(data.executionId);
    }, { concurrency: 2 });
    handles.workers.push(worker);
  });

  await family('semantic-indexing-worker', 'semantic index partitions will NOT process', async () => {
    const { SEMANTIC_PARTITION_QUEUE_NAME } = await import('./semanticIndexingQueue');
    const { processSemanticPartition } = await import('../services/asyncSemanticRuntimeService');
    const worker = getWorker(SEMANTIC_PARTITION_QUEUE_NAME, async (job) => {
      const data = job.data as { partitionId?: string } | undefined;
      if (!data?.partitionId) return;
      await processSemanticPartition(data.partitionId);
    }, { concurrency: 2 });
    handles.workers.push(worker);
  });

  await family('replay-partition-worker', 'replay partitions will NOT process', async () => {
    const { REPLAY_PARTITION_QUEUE_NAME } = await import('./replayPartitionQueue');
    const { processReplayPartition } = await import('../services/replayCoordinationService');
    const worker = getWorker(REPLAY_PARTITION_QUEUE_NAME, async (job) => {
      const data = job.data as { partitionId?: string } | undefined;
      if (!data?.partitionId) return;
      await processReplayPartition(data.partitionId);
    }, { concurrency: 2 });
    handles.workers.push(worker);
  });

  console.info('[worker-topology] shared consumer registration complete', {
    bootstrap: opts.bootstrap,
    workers: handles.workers.length,
    failures: handles.failures.map((f) => f.family),
  });
  return handles;
}
