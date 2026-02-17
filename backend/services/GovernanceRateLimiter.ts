/**
 * Stage 33 — Governance Performance Guardrails & Backpressure Control.
 * In-memory token bucket: max 100 governance events per 10 seconds per company.
 * When exceeded: log warning, drop projection update only. Event write must still succeed.
 * Event integrity must never fail due to rate limiting.
 */

/** Per-company token bucket: count of events in current window */
interface BucketState {
  count: number;
  windowStartAt: number;
}

const MAX_PER_WINDOW = 100;
const WINDOW_MS = 10_000; // 10 seconds

const buckets = new Map<string, BucketState>();

/** Count of projection updates dropped per company (for metrics). */
export const projectionDropsPerCompany = new Map<string, number>();

function getOrCreateBucket(companyId: string): BucketState {
  const now = Date.now();
  let b = buckets.get(companyId);
  if (!b || now - b.windowStartAt >= WINDOW_MS) {
    b = { count: 0, windowStartAt: now };
    buckets.set(companyId, b);
  }
  return b;
}

/**
 * Try to consume one token for projection update.
 * Returns true if allowed, false if rate limited (caller should skip projection update).
 * Never throws.
 */
export function tryConsumeProjectionToken(companyId: string): boolean {
  try {
    if (!companyId) return true;
    const b = getOrCreateBucket(companyId);
    if (b.count < MAX_PER_WINDOW) {
      b.count++;
      return true;
    }
    const dropCount = projectionDropsPerCompany.get(companyId) ?? 0;
    projectionDropsPerCompany.set(companyId, dropCount + 1);
    console.warn('GovernanceRateLimiter: projection update rate limited', {
      companyId,
      windowMs: WINDOW_MS,
      maxPerWindow: MAX_PER_WINDOW,
    });
    return false;
  } catch {
    return true; // on error, allow projection (fail open)
  }
}

/**
 * Get projection drop count for a company (for metrics). Never throws.
 */
export function getProjectionDropCount(companyId: string): number {
  try {
    return projectionDropsPerCompany.get(companyId) ?? 0;
  } catch {
    return 0;
  }
}

// --- Replay rate limiter: 20 per minute per company ---

interface ReplayWindow {
  count: number;
  windowStartAt: number;
}

const REPLAY_MAX_PER_MINUTE = 20;
const REPLAY_WINDOW_MS = 60_000;

const replayBuckets = new Map<string, ReplayWindow>();
export const replayLimitedPerCompany = new Map<string, number>();

function getReplayWindow(companyId: string): ReplayWindow {
  const now = Date.now();
  let w = replayBuckets.get(companyId);
  if (!w || now - w.windowStartAt >= REPLAY_WINDOW_MS) {
    w = { count: 0, windowStartAt: now };
    replayBuckets.set(companyId, w);
  }
  return w;
}

/**
 * Try to consume one replay token. Returns true if allowed, false if rate limited.
 * Never throws.
 */
export function tryConsumeReplayToken(companyId: string): boolean {
  try {
    if (!companyId) return true;
    const w = getReplayWindow(companyId);
    if (w.count < REPLAY_MAX_PER_MINUTE) {
      w.count++;
      return true;
    }
    const n = replayLimitedPerCompany.get(companyId) ?? 0;
    replayLimitedPerCompany.set(companyId, n + 1);
    return false;
  } catch {
    return true;
  }
}

export function getReplayLimitedCount(companyId: string): number {
  try {
    return replayLimitedPerCompany.get(companyId) ?? 0;
  } catch {
    return 0;
  }
}

// --- Snapshot restore concurrency lock per company ---

const restoreLocks = new Set<string>();
export const snapshotRestoreBlockedCount = new Map<string, number>();

export function tryAcquireRestoreLock(companyId: string): boolean {
  try {
    if (!companyId) return true;
    if (restoreLocks.has(companyId)) {
      const n = snapshotRestoreBlockedCount.get(companyId) ?? 0;
      snapshotRestoreBlockedCount.set(companyId, n + 1);
      return false;
    }
    restoreLocks.add(companyId);
    return true;
  } catch {
    return true;
  }
}

export function releaseRestoreLock(companyId: string): void {
  try {
    restoreLocks.delete(companyId);
  } catch {
    /* ignore */
  }
}

export function getSnapshotRestoreBlockedCount(companyId: string): number {
  try {
    return snapshotRestoreBlockedCount.get(companyId) ?? 0;
  } catch {
    return 0;
  }
}

// --- Projection rebuild lock per campaign ---

const rebuildLocks = new Set<string>();
export const projectionRebuildBlockedCount = new Map<string, number>();

export function tryAcquireRebuildLock(campaignId: string, companyId: string): boolean {
  try {
    if (!campaignId) return true;
    if (rebuildLocks.has(campaignId)) {
      const n = projectionRebuildBlockedCount.get(companyId) ?? 0;
      projectionRebuildBlockedCount.set(companyId, n + 1);
      return false;
    }
    rebuildLocks.add(campaignId);
    return true;
  } catch {
    return true;
  }
}

export function releaseRebuildLock(campaignId: string): void {
  try {
    rebuildLocks.delete(campaignId);
  } catch {
    /* ignore */
  }
}

export function getProjectionRebuildBlockedCount(companyId: string): number {
  try {
    return projectionRebuildBlockedCount.get(companyId) ?? 0;
  } catch {
    return 0;
  }
}
