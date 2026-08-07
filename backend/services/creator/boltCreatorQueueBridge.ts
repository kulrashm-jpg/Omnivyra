/**
 * BOLT Creator Queue Bridge (Phase 2 unification).
 *
 * Lifts each BOLT renderable row's execution out of the in-process
 * BOLT pipeline worker and onto the existing `creator-content` BullMQ
 * queues. The pipeline worker enqueues N jobs and awaits each via
 * `Job.waitUntilFinished` — the work itself runs in queue workers,
 * BullMQ owns retries, and per-row failures are queue-isolated.
 *
 * Does NOT introduce a new queue. Reuses existing `creator-carousel`,
 * `creator-video`, `creator-story` queues registered by
 * `startCreatorContentWorkers`. Routing is by canonical asset family.
 *
 * `creatorContentProcessor` detects the `bolt_payload` discriminator
 * and runs the orchestrator with `origin: 'bolt'` + the daily-plan row
 * mutation that BOLT used to do inline.
 */

import { enqueueOrThrow } from '../../middleware/queueBackpressure';
import { QueueEvents } from 'bullmq';
import type { Queue } from 'bullmq';
import {
  getContentQueue,
  CONTENT_QUEUE_CONFIG,
} from '../../queue/contentGenerationQueues';
import { getConnectionConfig, getQueuePrefix } from '../../queue/bullmqClient';
import {
  normalizeCreatorAsset,
  type CanonicalAssetKey,
} from './intelligence/canonical/creatorAssetRegistry';

export type BoltCreatorRowPayload = {
  run_id?: string | null;
  campaign_id: string;
  company_id: string;
  user_id: string | null;
  /** daily_content_plans row id — bound by the worker for upserts + row mutation. */
  daily_plan_id: string;
  /** Pre-parsed `daily_content_plans.content` JSON. The worker hands this
   *  to the orchestrator as `existingContent` so FSM transitions land
   *  on the same lifecycle envelope BOLT was using before queue
   *  isolation. */
  parsed_content: Record<string, unknown>;
  topic: string;
  content_type: string;
  platform: string;
  audience: string;
  objective: string;
  summary: string;
  template_id: string | null;
  max_retries: number;
  /**
   * When true, an AUTONOMOUS row (image/carousel/infographic) is
   * auto-scheduled the moment it finishes rendering (Schedule outcomes only).
   * Set from the run mode in creatorAssetGenerationRuntime; the render worker
   * reads it to decide whether to call scheduleRenderedAutonomousRowById.
   */
  auto_schedule_on_render?: boolean;
};

export type BoltCreatorRowResult = {
  ok: boolean;
  rendered: boolean;
  awaiting_upload: boolean;
  failed: boolean;
  failure_reason: string | null;
  persisted_asset_id: string | null;
  /** The lifecycle state the worker landed the row in. */
  lifecycle_state: string | null;
};

/** Pick the queue most appropriate for the canonical asset family. */
function resolveQueueNameForContentType(contentType: string): string {
  const canonical: CanonicalAssetKey | null = normalizeCreatorAsset(contentType);
  if (canonical === 'reel' || canonical === 'short' || canonical === 'video') return 'creator-video';
  if (canonical === 'story') return 'creator-story';
  // image / carousel / infographic / creator_post and unknown all
  // funnel through creator-carousel (concurrency 2, the broadest
  // queue). Acceptable rate-limit envelope for renderable assets.
  return 'creator-carousel';
}

const queueEventsByName = new Map<string, QueueEvents>();
function getQueueEventsFor(name: string): QueueEvents {
  let qe = queueEventsByName.get(name);
  if (!qe) {
    qe = new QueueEvents(name, {
      connection: getConnectionConfig(),
      prefix: getQueuePrefix(),
    });
    queueEventsByName.set(name, qe);
  }
  return qe;
}

export type BoltCreatorRowHandle = {
  queueName: string;
  jobId: string;
};

export async function enqueueBoltCreatorRowExecution(
  payload: BoltCreatorRowPayload,
): Promise<BoltCreatorRowHandle> {
  const queueName = resolveQueueNameForContentType(payload.content_type);
  const queue: Queue = getContentQueue(queueName);
  const attemptsCfg = CONTENT_QUEUE_CONFIG[queueName]?.attempts ?? 2;
  const attempts = Math.max(attemptsCfg, payload.max_retries || 1);
  const jobName = `bolt-creator-row:${payload.daily_plan_id}`;
  // BullMQ rejects a custom jobId containing ':' ("Custom Id cannot contain
  // :") — it is BullMQ's internal key delimiter. The job NAME may contain it,
  // but the jobId must not, so we use a hyphen-delimited id. daily_plan_id is
  // a UUID, so this stays per-row idempotent — re-enqueues for the same row
  // collapse to the same job (BullMQ rejects duplicate jobIds), making the
  // pipeline's enqueue step safely re-runnable.
  const jobId = `bolt-creator-row-${payload.daily_plan_id}`;
  const job = await enqueueOrThrow(queue, 'bolt-content-jobs', jobName, {
    bolt_payload: payload,
    // legacy creatorContentProcessor fields kept null so the
    // discriminator branch is unambiguous
    company_id: payload.company_id,
    content_type: payload.content_type,
    topic: payload.topic,
    audience: payload.audience,
    user_id: payload.user_id,
    creator_context: {
      target_platforms: [payload.platform],
      campaign_description: payload.objective,
      content_theme: payload.summary,
    },
    activity_workspace: {
      campaign_id: payload.campaign_id,
      user_id: payload.user_id,
      summary: payload.summary,
    },
  }, {
    jobId,
    attempts,
  });
  return { queueName, jobId: String(job.id ?? jobId) };
}

export async function awaitBoltCreatorRowExecution(
  handle: BoltCreatorRowHandle,
  timeoutMs = 300_000,
): Promise<BoltCreatorRowResult> {
  const queue = getContentQueue(handle.queueName);
  const job = await queue.getJob(handle.jobId);
  if (!job) {
    return {
      ok: false,
      rendered: false,
      awaiting_upload: false,
      failed: true,
      failure_reason: 'job_not_found',
      persisted_asset_id: null,
      lifecycle_state: null,
    };
  }
  const qe = getQueueEventsFor(handle.queueName);
  try {
    const result = await job.waitUntilFinished(qe, timeoutMs);
    const r = (result || {}) as Record<string, unknown>;
    return {
      ok: Boolean(r.ok),
      rendered: Boolean(r.rendered),
      awaiting_upload: Boolean(r.awaiting_upload),
      failed: Boolean(r.failed),
      failure_reason: typeof r.failure_reason === 'string' ? r.failure_reason : null,
      persisted_asset_id: typeof r.persisted_asset_id === 'string' ? r.persisted_asset_id : null,
      lifecycle_state: typeof r.lifecycle_state === 'string' ? r.lifecycle_state : null,
    };
  } catch (error) {
    return {
      ok: false,
      rendered: false,
      awaiting_upload: false,
      failed: true,
      failure_reason: error instanceof Error ? error.message : String(error),
      persisted_asset_id: null,
      lifecycle_state: null,
    };
  }
}
