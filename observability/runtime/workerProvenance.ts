import { firstNonEmptyEnv } from '../../config/provenanceEnv';

/**
 * Worker / runtime provenance — module-level cache.
 *
 * Provides a single resolved snapshot of deployment metadata so log
 * emitters elsewhere in the codebase can reference it without
 * re-reading `process.env` on every log line. Reading env vars is
 * cheap but not free, and module-level caching also makes the
 * provenance contract explicit (one place answers "what deployment
 * am I?").
 *
 * Resolution order for each field favors Railway (the worker host)
 * with Vercel as a secondary source for any code paths that also
 * run in the Vercel runtime. Defaults to 'unknown' so consumers
 * never see undefined in log output.
 *
 * Importantly: this module reads env vars ONCE at first import. Any
 * env mutation after that point (e.g. in tests) is invisible. That's
 * intentional — provenance shouldn't move during process lifetime,
 * and the cost-of-recompute would defeat the purpose.
 */

export interface WorkerProvenance {
  /** Best-effort deployment identifier. Railway preferred, Vercel fallback. */
  deploymentId: string;
  /** Git commit SHA at deploy time. */
  gitSha: string;
  /** Git branch at deploy time. */
  gitBranch: string;
  /** Railway / Vercel environment name (production / preview / development). */
  runtimeEnv: string;
  /** Process PID — proxy for worker_id within a single host. */
  workerPid: number;
}

/**
 * Resolved once at first import. All subsequent reads return the
 * same snapshot (no allocation, no env lookup).
 */
export const WORKER_PROVENANCE: Readonly<WorkerProvenance> = Object.freeze({
  // firstNonEmptyEnv, not ??: a platform may DEFINE these as an empty string
  // rather than leave them unset, and an empty value must not win the chain.
  deploymentId:
    firstNonEmptyEnv('RAILWAY_DEPLOYMENT_ID', 'VERCEL_DEPLOYMENT_ID') ?? 'unknown',
  gitSha:
    firstNonEmptyEnv('RAILWAY_GIT_COMMIT_SHA', 'VERCEL_GIT_COMMIT_SHA', 'GIT_COMMIT_SHA') ?? 'unknown',
  gitBranch:
    firstNonEmptyEnv('RAILWAY_GIT_BRANCH', 'VERCEL_GIT_COMMIT_REF') ?? 'unknown',
  runtimeEnv:
    firstNonEmptyEnv('RAILWAY_ENVIRONMENT_NAME', 'VERCEL_ENV', 'NODE_ENV') ?? 'unknown',
  workerPid: process.pid,
});
