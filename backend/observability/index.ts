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
  recordCache, recordCacheInvalidation, recordSystem,
  recordRawCounter, recordRawHistogram,
} from './metrics';
export { withApiObservability } from './apiObservability';
export { observeTable, timedQuery } from './dbObservability';
export { startSystemSampler } from './system';
export { getObservabilitySnapshot } from './snapshot';
export type { ObservabilitySnapshot } from './snapshot';
