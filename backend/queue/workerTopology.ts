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
import { sharedConsumedQueues } from './workerTopologyManifest';
import {
  closeContentQueues,
  initializeContentQueues,
  startContentWorkers,
  startCreatorContentWorkers,
  startWhatsAppBroadcastWorker,
  startWhatsAppWebhookWorker,
  startAnalyticsIngestionWorker,
} from './contentGenerationQueues';

export interface SharedConsumerHandles {
  /**
   * EVERY consumer Worker this registrar constructed, in registration order —
   * the AUTHORITATIVE set the bootstraps drain on shutdown (WS-1, 3AH-132).
   *
   * It is not a hand-maintained list: `family()` below is the only place a
   * handle is collected, and it collects whatever the registration returns, so
   * a family cannot attach a consumer without also handing back its handle.
   * With the corrected topology this is exactly one handle per
   * `consumedVia: 'shared'` queue in workerTopologyManifest.ts — see
   * auditSharedHandleCoverage().
   */
  workers: Worker[];
  /**
   * WS-1: closes the producer `Queue` objects opened by content-queues-init
   * (and by any lazy getContentQueue caller in the same process). Those had no
   * close path at all, so their Redis connections outlived every shutdown.
   */
  closeQueues: () => Promise<void>;
  /** Families that failed to register (already logged loudly). */
  failures: Array<{ family: string; error: string }>;
}

/**
 * Reconciliation of the handle set against the manifest. Exported so the
 * bootstraps and the shutdown gate can assert coverage from the SAME source
 * the registrar uses — never from a second, drifting list.
 */
export interface SharedHandleCoverage {
  /** `consumedVia: 'shared'` queues, from workerTopologyManifest.ts. */
  expected: string[];
  /** Queue name of every returned handle, in registration order. */
  registered: string[];
  /** Declared shared, but no handle came back (gap, or a failed family). */
  missing: string[];
  /** More than one handle for the same queue — a duplicate consumer. */
  duplicated: string[];
  /** A handle for a queue the manifest does not declare shared. */
  unexpected: string[];
}

export function auditSharedHandleCoverage(handles: SharedConsumerHandles): SharedHandleCoverage {
  const expected = sharedConsumedQueues().map((q) => q.queue);
  const registered = handles.workers.map((w) => w.name);
  const seen = new Map<string, number>();
  for (const name of registered) seen.set(name, (seen.get(name) ?? 0) + 1);
  return {
    expected,
    registered,
    missing: expected.filter((q) => !seen.has(q)),
    duplicated: [...seen.entries()].filter(([, n]) => n > 1).map(([q]) => q),
    unexpected: [...seen.keys()].filter((q) => !expected.includes(q)),
  };
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
  const handles: SharedConsumerHandles = { workers: [], closeQueues: closeContentQueues, failures: [] };
  const stage = (s: string, extra?: Record<string, unknown>) => {
    try { opts.onStage?.(s, extra); } catch { /* diagnostics never throw */ }
  };
  // WS-1 (3AH-132): the ONE place a shutdown handle is collected. Whatever a
  // registration returns — one Worker, several, or nothing (content-queues-init
  // opens producer Queues, not consumers) — is what the host drains. Six
  // families used to `await start…()` and discard the result, so 13 live
  // consumers had no close path; returning is now the only way to register.
  const family = async (
    name: string,
    impact: string,
    register: () => Promise<Worker | Worker[] | void>,
  ): Promise<void> => {
    try {
      const registered = await register();
      if (registered) {
        handles.workers.push(...(Array.isArray(registered) ? registered : [registered]));
      }
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
    return startContentWorkers(processContentGenerationJob);
  });

  await family('creator-content-workers', 'creator asset rendering (video/carousel/story) will NOT work', async () => {
    const { processCreatorContentJob } = await import('./jobProcessors/creatorContentProcessor');
    return startCreatorContentWorkers(processCreatorContentJob);
  });

  await family('whatsapp-broadcast-worker', 'WhatsApp broadcasts will NOT send', async () => {
    const { processWhatsAppBroadcastJob } = await import('./jobProcessors/whatsappBroadcastProcessor');
    return startWhatsAppBroadcastWorker(processWhatsAppBroadcastJob);
  });

  await family('whatsapp-webhook-worker', 'inbound WhatsApp events will NOT process', async () => {
    const { processWhatsAppWebhookJob } = await import('./jobProcessors/whatsappWebhookProcessor');
    return startWhatsAppWebhookWorker(processWhatsAppWebhookJob);
  });

  await family('analytics-ingestion-worker', 'analytics ingestion will NOT run', async () => {
    const { processAnalyticsIngestionJob } = await import('./jobProcessors/analyticsIngestionProcessor');
    return startAnalyticsIngestionWorker(processAnalyticsIngestionJob);
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
    return worker;
  });

  await family('listening-executions-worker', 'listening executions will NOT process', async () => {
    const { LISTENING_EXECUTION_QUEUE_NAME } = await import('./listeningExecutionQueue');
    const { processListeningExecution } = await import('../services/listeningExecutionService');
    const worker = getWorker(LISTENING_EXECUTION_QUEUE_NAME, async (job) => {
      const data = job.data as { executionId?: string } | undefined;
      if (!data?.executionId) return;
      await processListeningExecution(data.executionId);
    }, { concurrency: 2 });
    return worker;
  });

  await family('semantic-indexing-worker', 'semantic index partitions will NOT process', async () => {
    const { SEMANTIC_PARTITION_QUEUE_NAME } = await import('./semanticIndexingQueue');
    const { processSemanticPartition } = await import('../services/asyncSemanticRuntimeService');
    const worker = getWorker(SEMANTIC_PARTITION_QUEUE_NAME, async (job) => {
      const data = job.data as { partitionId?: string } | undefined;
      if (!data?.partitionId) return;
      await processSemanticPartition(data.partitionId);
    }, { concurrency: 2 });
    return worker;
  });

  await family('replay-partition-worker', 'replay partitions will NOT process', async () => {
    const { REPLAY_PARTITION_QUEUE_NAME } = await import('./replayPartitionQueue');
    const { processReplayPartition } = await import('../services/replayCoordinationService');
    const worker = getWorker(REPLAY_PARTITION_QUEUE_NAME, async (job) => {
      const data = job.data as { partitionId?: string } | undefined;
      if (!data?.partitionId) return;
      await processReplayPartition(data.partitionId);
    }, { concurrency: 2 });
    return worker;
  });

  // WS-6E — Automation tasks. The consumer attaches even though NO producer
  // exists yet (WS-6F wires the orchestrator enqueue), mirroring the documented
  // planner-refinement precedent: attaching first means enabling the producer can
  // never strand queued work.
  await family('automation-task-worker', 'automation tasks will NOT process', async () => {
    const { runAutomationTaskJob, automationTaskConcurrency } = await import('../workers/automationTaskWorker');
    // Queue name as a LITERAL, matching planner-refinement: workerTopologyParity
    // resolves shared-registrar coverage by finding the literal here, so an
    // imported constant would read as "declared shared but never registered".
    const worker = getWorker('automation-tasks', async (job) => {
      await runAutomationTaskJob(job as never);
    }, { concurrency: automationTaskConcurrency() });
    worker.on('error', (err) => console.error('[automation-tasks] worker error:', err?.message ?? err));
    worker.on('failed', (job, err) => console.warn('[automation-tasks] job failed:', {
      job_id: job?.id, attempts: job?.attemptsMade, error: err?.message,
    }));
    return worker;
  });

  // Reconcile the handle set against the manifest. A family that FAILED
  // legitimately explains its own missing handle; anything else missing is a
  // consumer that would be left running through shutdown, and a duplicate is
  // two consumers competing for one queue. Loud, never fatal: a shutdown-
  // bookkeeping mismatch must not stop the worker from starting.
  const coverage = auditSharedHandleCoverage(handles);
  const anyFamilyFailed = handles.failures.length > 0;
  if (coverage.duplicated.length > 0 || coverage.unexpected.length > 0
      || (coverage.missing.length > 0 && !anyFamilyFailed)) {
    console.error('[worker-topology] shutdown handle set does NOT match the manifest', {
      missing: coverage.missing,
      duplicated: coverage.duplicated,
      unexpected: coverage.unexpected,
    });
    stage('workerTopology:handle-coverage-MISMATCH', {
      missing: coverage.missing,
      duplicated: coverage.duplicated,
      unexpected: coverage.unexpected,
    });
  }

  console.info('[worker-topology] shared consumer registration complete', {
    bootstrap: opts.bootstrap,
    workers: handles.workers.length,
    expectedWorkers: coverage.expected.length,
    failures: handles.failures.map((f) => f.family),
  });
  return handles;
}
