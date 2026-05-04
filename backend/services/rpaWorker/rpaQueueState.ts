import { createServiceRoleMigrationProxy } from '../../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { rpaEnvReady, isProbeFailure } from './rpaEnv';

/**
 * Per-organization RPA backpressure state machine.
 *
 *   READY     — admission open, full throughput.
 *   DEGRADED  — admission open but recent failure rate ≥ SOFT_THRESHOLD;
 *               callers are advised (state is observable) but not blocked.
 *   BLOCKED   — admission closed. New tasks from this organization are
 *               deferred to rpa_retry_queue instead of executed inline.
 *               Enters BLOCKED on RPA_ENV_NOT_READY (global signal) or
 *               failure rate ≥ HARD_THRESHOLD within the org window.
 *
 * Isolation model:
 *   - state, observer, cache, and admission are ALL keyed by
 *     organization_id. One tenant cannot push another into BLOCKED.
 *   - the environment probe is the only global signal; when Playwright
 *     is not installed/launchable, every org is BLOCKED (correctly —
 *     the worker cannot run any task).
 */

export type RpaQueueStatus = 'READY' | 'DEGRADED' | 'BLOCKED';

const SOFT_THRESHOLD = 0.4; // ≥ 40% failures → DEGRADED
const HARD_THRESHOLD = 0.7; // ≥ 70% failures → BLOCKED
const WINDOW_SECONDS = 15 * 60;
const MIN_WINDOW_SAMPLES = 5;

export type OrgStateRow = {
  organization_id: string;
  status: RpaQueueStatus;
  reason?: string | null;
  failure_rate?: number | null;
  window_size?: number | null;
  observed_at: string;
};

const READ_CACHE_MS = 15 * 1000;

/** Per-org in-memory cache of the most recent read. Keyed by org id. */
const cache: Map<string, { row: OrgStateRow; at: number }> = new Map();

function cacheGet(orgId: string): OrgStateRow | null {
  const entry = cache.get(orgId);
  if (!entry) return null;
  if (Date.now() - entry.at > READ_CACHE_MS) {
    cache.delete(orgId);
    return null;
  }
  return entry.row;
}

function cacheSet(orgId: string, row: OrgStateRow): void {
  cache.set(orgId, { row, at: Date.now() });
}

function cacheInvalidate(orgId?: string): void {
  if (orgId) cache.delete(orgId);
  else cache.clear();
}

async function fetchStateFromDb(orgId: string): Promise<OrgStateRow | null> {
  try {
    const { data } = await supabase
      .from('rpa_queue_state')
      .select('organization_id, status, reason, failure_rate, window_size, observed_at')
      .eq('organization_id', orgId)
      .maybeSingle();
    return (data as OrgStateRow | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the current state for an organization. Missing row → READY
 * (no observations yet = fail-open; the observer will backfill).
 */
export async function getRpaQueueState(
  organizationId: string,
  options?: { bypassCache?: boolean },
): Promise<OrgStateRow> {
  if (!options?.bypassCache) {
    const hit = cacheGet(organizationId);
    if (hit) return hit;
  }
  const row = await fetchStateFromDb(organizationId);
  const resolved: OrgStateRow = row ?? {
    organization_id: organizationId,
    status: 'READY',
    reason: 'unobserved',
    failure_rate: 0,
    window_size: 0,
    observed_at: new Date().toISOString(),
  };
  cacheSet(organizationId, resolved);
  return resolved;
}

async function upsertState(row: OrgStateRow): Promise<void> {
  try {
    await supabase
      .from('rpa_queue_state')
      .upsert(
        {
          organization_id: row.organization_id,
          status: row.status,
          reason: row.reason ?? null,
          failure_rate: row.failure_rate ?? null,
          window_size: row.window_size ?? null,
          observed_at: row.observed_at,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id' },
      );
    cacheInvalidate(row.organization_id);
  } catch (err: any) {
    console.warn('[rpaQueueState] upsert failed:', err?.message || err);
  }
}

async function countMetric(orgId: string, eventType: string, sinceIso: string): Promise<number> {
  try {
    const { count } = await supabase
      .from('community_ai_execution_metric_events')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('execution_mode', 'rpa')
      .eq('event_type', eventType)
      .gte('created_at', sinceIso);
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Observer pass for ONE organization. Computes the recent failure rate
 * from community_ai_execution_metric_events filtered by org, combines
 * with the env readiness probe, and upserts the org's row.
 */
export async function observeRpaQueueState(organizationId: string): Promise<OrgStateRow> {
  // 1. Environment probe: global BLOCKED signal overrides per-org metrics.
  const env = await rpaEnvReady();
  if (isProbeFailure(env)) {
    const row: OrgStateRow = {
      organization_id: organizationId,
      status: 'BLOCKED',
      reason: `env:${env.reason}`,
      failure_rate: null,
      window_size: null,
      observed_at: new Date().toISOString(),
    };
    await upsertState(row);
    console.info('[rpaQueueState]', {
      organization_id: organizationId,
      status: row.status,
      reason: row.reason,
    });
    return row;
  }

  // 2. Per-org failure-rate window.
  const since = new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString();
  const [failures, successes] = await Promise.all([
    countMetric(organizationId, 'execution_failed', since),
    countMetric(organizationId, 'execution_success', since),
  ]);
  const windowSize = failures + successes;
  const rate = windowSize > 0 ? failures / windowSize : 0;

  let status: RpaQueueStatus = 'READY';
  let reason: string | null = 'within_bounds';
  if (windowSize >= MIN_WINDOW_SAMPLES) {
    if (rate >= HARD_THRESHOLD) { status = 'BLOCKED';  reason = `failure_rate:${rate.toFixed(2)}`; }
    else if (rate >= SOFT_THRESHOLD) { status = 'DEGRADED'; reason = `failure_rate:${rate.toFixed(2)}`; }
  } else {
    reason = `insufficient_samples:${windowSize}`;
  }

  const row: OrgStateRow = {
    organization_id: organizationId,
    status,
    reason,
    failure_rate: Number(rate.toFixed(4)),
    window_size: windowSize,
    observed_at: new Date().toISOString(),
  };
  await upsertState(row);

  // Per-org observability log line.
  console.info('[rpaQueueState]', {
    organization_id: organizationId,
    status,
    failure_rate: row.failure_rate,
    window_size: row.window_size,
    reason,
  });
  return row;
}

/**
 * Enumerate all organizations with recent RPA activity (success or
 * failure in the observation window) and observe each. Used by the
 * scheduler worker so an org whose volume dropped to zero doesn't keep
 * a stale BLOCKED row.
 */
export async function observeAllActiveOrgs(options?: { windowSeconds?: number }): Promise<{
  observed: number;
  blocked: number;
  degraded: number;
  ready: number;
  errors: number;
}> {
  const env = await rpaEnvReady();
  if (isProbeFailure(env)) {
    // When the env is down, mark every recent org BLOCKED en masse so
    // the admission gate reads fresh state.
    const orgs = await listRecentlyActiveOrgs(options?.windowSeconds ?? WINDOW_SECONDS);
    let blocked = 0, errors = 0;
    for (const orgId of orgs) {
      try {
        await observeRpaQueueState(orgId);
        blocked += 1;
      } catch (err: any) {
        errors += 1;
        console.warn('[rpaQueueState] observe error:', orgId, err?.message || err);
      }
    }
    return { observed: orgs.length, blocked, degraded: 0, ready: 0, errors };
  }

  const orgs = await listRecentlyActiveOrgs(options?.windowSeconds ?? WINDOW_SECONDS);
  let blocked = 0, degraded = 0, ready = 0, errors = 0;
  for (const orgId of orgs) {
    try {
      const row = await observeRpaQueueState(orgId);
      if (row.status === 'BLOCKED') blocked += 1;
      else if (row.status === 'DEGRADED') degraded += 1;
      else ready += 1;
    } catch (err: any) {
      errors += 1;
      console.warn('[rpaQueueState] observe error:', orgId, err?.message || err);
    }
  }
  return { observed: orgs.length, blocked, degraded, ready, errors };
}

/**
 * Fetch distinct organization_ids that emitted RPA-mode metric events
 * in the last `windowSeconds`. Used by the bulk observer AND by the
 * retry flusher to cap attention to orgs with actual backlog.
 */
export async function listRecentlyActiveOrgs(windowSeconds: number): Promise<string[]> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  try {
    const { data } = await supabase
      .from('community_ai_execution_metric_events')
      .select('organization_id')
      .eq('execution_mode', 'rpa')
      .gte('created_at', since)
      .limit(5000);
    const seen = new Set<string>();
    for (const r of (data || []) as Array<{ organization_id: string }>) {
      if (r.organization_id) seen.add(r.organization_id);
    }
    return Array.from(seen);
  } catch {
    return [];
  }
}

/** Per-org admission gate for executeRpaTask. */
export async function admitRpaTask(input: { organization_id: string }): Promise<{
  admit: boolean;
  defer: boolean;
  status: RpaQueueStatus;
  reason: string | null;
}> {
  const row = await getRpaQueueState(input.organization_id);
  if (row.status === 'BLOCKED') {
    return { admit: false, defer: true, status: 'BLOCKED', reason: row.reason ?? null };
  }
  return { admit: true, defer: false, status: row.status, reason: row.reason ?? null };
}
