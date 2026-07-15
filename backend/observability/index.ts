/**
 * HARDEN-001 — Observability foundation (public barrel).
 *
 * Centralized, reusable, fail-safe instrumentation for the Umniverse platform.
 * Purely additive: importing/using this module never changes application
 * behavior. See ./config for env flags and ./README-less docstrings per file.
 *
 * Import surface:
 *   import { recordDb, recordAi, withApiObservability, getObservabilitySnapshot } from '@/backend/observability';
 */
export { observabilityConfig, domainEnabled } from './config';
export { registry } from './registry';
export type { Labels } from './registry';
export {
  M, BOARD, now, startTimer, time,
  recordApi, recordDb, recordAi, recordExternal,
  recordQueueJob, recordQueueDepth, recordScheduler, recordWorker,
  recordCache, recordCacheInvalidation, recordSystem, recordClient,
  recordRawCounter, recordRawHistogram,
} from './metrics';
export { withApiObservability } from './apiObservability';
export { observeTable, timedQuery } from './dbObservability';
export { startSystemSampler } from './system';
export { observeQueueEvents, registerQueueForDepth, startQueueDepthSampler } from './queueObservability';
export { runWithRequestDbScope, getRequestDbStats } from './requestScope';
export { observeExternalCall } from './externalObservability';
export { getObservabilitySnapshot } from './snapshot';
export type { ObservabilitySnapshot } from './snapshot';
// Foundation Batch A (F-02) — exporter + trace propagation kit.
export { renderPrometheusText, PROMETHEUS_CONTENT_TYPE } from './promExporter';
export {
  TRACE_JOB_FIELD, traceMetaForEnqueue, withTraceMeta, runWithJobTraceContext,
} from './traceKit';
export type { JobTraceMeta, JobLike } from './traceKit';
