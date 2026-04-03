/**
 * Redis Failure Strategy — Deterministic failure modes per component
 *
 * Define explicitly how each system component MUST handle Redis failures.
 * No ambiguity, no silent failures, no undefined behavior.
 *
 * 🎯 PRINCIPLE: Know the failure mode in advance
 * - Every Redis dependency is mapped
 * - Every failure mode is predetermined
 * - No component guesses what to do when Redis is down
 * - All strategy is defined BEFORE deployment
 * - Strategy is implemented consistently
 *
 * 📋 COMPONENT FAILURE MODES:
 * - FAIL_FAST: Exit process, no recovery (critical path)
 * - DEGRADE: Skip feature, continue (optional path)
 * - QUEUE: Degrade to in-memory queue (BullMQ jobs)
 * - FALLBACK: Use fallback implementation (cache, rate limiting)
 */

/**
 * Failure mode enum
 */
export enum FailureMode {
  /** Exit process immediately, log error, alert ops */
  FAIL_FAST = 'FAIL_FAST',

  /** Skip the feature, log warning, continue operating */
  DEGRADE = 'DEGRADE',

  /** Use in-memory queue instead of Redis (BullMQ) */
  QUEUE_DEGRADE = 'QUEUE_DEGRADE',

  /** Use fallback implementation (in-memory cache, local rate limiter) */
  FALLBACK = 'FALLBACK',

  /** Retry with exponential backoff (transient failures only) */
  RETRY = 'RETRY',
}

/**
 * Single component's failure strategy
 */
export interface ComponentStrategy {
  /** Component name (unique identifier) */
  name: string;

  /** What this component uses Redis for */
  purpose: string;

  /** Failure mode (how to respond when Redis is down) */
  failureMode: FailureMode;

  /** If FAIL_FAST, how critical is this? (1=critical, 5=optional) */
  criticality: 1 | 2 | 3 | 4 | 5;

  /** Max time to wait for Redis before giving up (ms) */
  timeoutMs: number;

  /** If DEGRADE/FALLBACK, what's the fallback behavior? */
  fallback?: string;

  /** If FAIL_FAST, how many retries before failing? (0 = no retry) */
  maxRetries: number;

  /** Contact for this component if it fails */
  owner?: string;
}

/**
 * All registered component strategies
 */
export const COMPONENT_STRATEGIES: Record<string, ComponentStrategy> = {
  // ─── CRITICAL PATH (FAIL_FAST) ───────────────────────────────────────────

  cronScheduler: {
    name: 'cronScheduler',
    purpose: 'Redis-backed cron state persistence (last run times)',
    failureMode: FailureMode.FAIL_FAST,
    criticality: 1,
    timeoutMs: 5000,
    maxRetries: 3,
    fallback: 'None — all cron tasks will execute immediately on next restart',
    owner: 'infrastructure',
  },

  bullmqWorkers: {
    name: 'bullmqWorkers',
    purpose: 'Job queue for publish, engagement, campaign planning, etc.',
    failureMode: FailureMode.FAIL_FAST,
    criticality: 1,
    timeoutMs: 5000,
    fallback: 'None — jobs cannot be queued or processed',
    maxRetries: 3,
    owner: 'backend',
  },

  supabaseConnection: {
    name: 'supabaseConnection',
    purpose: 'Database operations (reads/writes)',
    failureMode: FailureMode.FAIL_FAST,
    criticality: 1,
    timeoutMs: 10000,
    fallback: 'None — application cannot function without database',
    maxRetries: 3,
    owner: 'database',
  },

  // ─── OPTIONAL FEATURES (DEGRADE/FALLBACK) ────────────────────────────────

  sessionCache: {
    name: 'sessionCache',
    purpose: 'User session data caching (performance optimization)',
    failureMode: FailureMode.FALLBACK,
    criticality: 3,
    timeoutMs: 2000,
    fallback: 'Use in-memory session cache (lost on restart)',
    maxRetries: 1,
    owner: 'auth',
  },

  rateLimiter: {
    name: 'rateLimiter',
    purpose: 'API rate limiting (prevent abuse)',
    failureMode: FailureMode.FALLBACK,
    criticality: 2,
    timeoutMs: 500,
    fallback: 'Use in-memory rate limiter (reset on restart)',
    maxRetries: 0,
    owner: 'security',
  },

  contentCache: {
    name: 'contentCache',
    purpose: 'Cache for content feeds, recommendations (performance)',
    failureMode: FailureMode.DEGRADE,
    criticality: 4,
    timeoutMs: 1000,
    fallback: 'Skip caching, fetch fresh from database every time',
    maxRetries: 0,
    owner: 'content',
  },

  analyticsBuffer: {
    name: 'analyticsBuffer',
    purpose: 'Buffer analytics events before batch processing',
    failureMode: FailureMode.DEGRADE,
    criticality: 5,
    timeoutMs: 500,
    fallback: 'Skip buffering, process events immediately (slower)',
    maxRetries: 0,
    owner: 'analytics',
  },

  metricsCollection: {
    name: 'metricsCollection',
    purpose: 'Collect system metrics for monitoring',
    failureMode: FailureMode.DEGRADE,
    criticality: 5,
    timeoutMs: 500,
    fallback: 'Skip metrics collection, log locally',
    maxRetries: 0,
    owner: 'operations',
  },

  featureFlags: {
    name: 'featureFlags',
    purpose: 'Cache feature flag values',
    failureMode: FailureMode.FALLBACK,
    criticality: 3,
    timeoutMs: 1000,
    fallback: 'Use default feature flag values (safe defaults)',
    maxRetries: 1,
    owner: 'platform',
  },

  // ─── NOT YET ASSIGNED (NEEDS CLARIFICATION) ─────────────────────────────

  // oauthTokenRefresh: {
  //   name: 'oauthTokenRefresh',
  //   purpose: 'Cache OAuth token refresh responses',
  //   failureMode: FailureMode.DEGRADE, // TBD
  //   criticality: 2,
  //   timeoutMs: 2000,
  //   fallback: 'Fallback to database-backed token storage',
  //   maxRetries: 1,
  // },
};

/**
 * Get strategy for a component (with fallback to DEGRADE if not registered)
 */
export function getStrategy(componentName: string): ComponentStrategy {
  const strategy = COMPONENT_STRATEGIES[componentName];
  if (!strategy) {
    console.warn(`[strategy] Unknown component: ${componentName}, using default DEGRADE strategy`);
    return {
      name: componentName,
      purpose: 'Unknown',
      failureMode: FailureMode.DEGRADE,
      criticality: 3,
      timeoutMs: 2000,
      maxRetries: 1,
      fallback: 'Features using this component may be unavailable',
    };
  }
  return strategy;
}

/**
 * List all FAIL_FAST components (critical path)
 */
export function getCriticalComponents(): ComponentStrategy[] {
  return Object.values(COMPONENT_STRATEGIES).filter(
    s => s.failureMode === FailureMode.FAIL_FAST
  );
}

/**
 * List all DEGRADE/FALLBACK components (graceful degradation)
 */
export function getDegradableComponents(): ComponentStrategy[] {
  return Object.values(COMPONENT_STRATEGIES).filter(
    s => s.failureMode === FailureMode.DEGRADE || s.failureMode === FailureMode.FALLBACK
  );
}

/**
 * Get all components by failure mode
 */
export function getComponentsByMode(mode: FailureMode): ComponentStrategy[] {
  return Object.values(COMPONENT_STRATEGIES).filter(s => s.failureMode === mode);
}

/**
 * Summary of failure strategies
 */
export function getStrategySummary() {
  const strategies = Object.values(COMPONENT_STRATEGIES);
  return {
    total: strategies.length,
    failFast: getComponentsByMode(FailureMode.FAIL_FAST).length,
    degrade: getComponentsByMode(FailureMode.DEGRADE).length,
    fallback: getComponentsByMode(FailureMode.FALLBACK).length,
    queue: getComponentsByMode(FailureMode.QUEUE_DEGRADE).length,
    retry: getComponentsByMode(FailureMode.RETRY).length,
    criticalComponents: getCriticalComponents(),
    degradableComponents: getDegradableComponents(),
  };
}

/**
 * Implementation checklist per component
 */
export const IMPLEMENTATION_CHECKLIST: Record<string, string[]> = {
  cronScheduler: [
    '✅ Try to load last run times from Redis',
    '✅ If Redis unavailable, log warning and treat all tasks as never run',
    '✅ All tasks will execute immediately on restart (acceptable behavior)',
    '❌ DO NOT silently ignore the error and return stale times',
  ],

  bullmqWorkers: [
    '✅ Workers depend on Redis completely',
    '✅ If Redis unavailable at startup, exit with clear error',
    '✅ Set REDIS_REQUIRED=true in config',
    '❌ DO NOT attempt to queue jobs in-memory',
  ],

  rateLimiter: [
    '✅ Try to use Redis rate limiter first',
    '✅ If Redis unavailable, fallback to in-memory limiter',
    '✅ Log warning when fallback is used',
    '✅ In-memory limiter resets on restart (acceptable)',
    '❌ DO NOT disable rate limiting completely',
  ],

  contentCache: [
    '✅ Try to read from Redis cache first',
    '✅ If Redis unavailable, fetch fresh from database',
    '✅ Log warning',
    '❌ DO NOT return stale cached data',
    '❌ DO NOT block on Redis timeout',
  ],

  featureFlags: [
    '✅ Try to read feature flags from Redis cache',
    '✅ If Redis unavailable, use hardcoded default values',
    '✅ Log warning',
    '❌ DO NOT silently treat missing flags as disabled',
  ],
};

/**
 * Export strategies for use in other modules
 */
export default {
  FailureMode,
  COMPONENT_STRATEGIES,
  getStrategy,
  getCriticalComponents,
  getDegradableComponents,
  getComponentsByMode,
  getStrategySummary,
  IMPLEMENTATION_CHECKLIST,
};
