/**
 * HARDEN-INT-002 (3) — Intelligence platform health indicators.
 *
 * Four independent probes answering the questions Production Runtime Validation
 * left unanswerable at runtime:
 *   migration   — does the persistence table actually exist? (the #1 blocker:
 *                 without it the whole stack silently no-ops)
 *   persistence — can we read/write it right now?
 *   generation  — are generations succeeding, and how fast? (from the
 *                 in-process HARDEN-001 registry — no extra queries)
 *   freshness   — what is the stale / pending / never backlog?
 *
 * Read-only: probes never generate intelligence and never write. Every probe
 * fails CLOSED to a reported 'unhealthy'/'unknown' rather than throwing, so the
 * health endpoint is always answerable.
 */

import { ownedDbTable } from '../db/writeOwner';
import { getObservabilitySnapshot } from '../observability';
import { LEAD_INTELLIGENCE_PROFILES_TABLE } from './leadIntelligenceOrchestration/persistence';
import { ENGINE_VERSION, INTELLIGENCE_SCHEMA_VERSION } from './leadIntelligenceOrchestration/engineVersion';
import { INTEL_METRICS } from './leadIntelligenceTelemetry';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface HealthIndicator {
  name: string;
  status: HealthStatus;
  detail: string;
  data?: Record<string, unknown>;
}

export interface IntelligenceHealthReport {
  status: HealthStatus;
  checkedAt: string;
  engineVersion: string;
  schemaVersion: number;
  /** Metrics are per-process; on serverless this reflects THIS instance only. */
  processScoped: true;
  indicators: HealthIndicator[];
}

const WORST: HealthStatus[] = ['healthy', 'unknown', 'degraded', 'unhealthy'];
const worseOf = (a: HealthStatus, b: HealthStatus): HealthStatus =>
  WORST.indexOf(b) > WORST.indexOf(a) ? b : a;

/** Missing-relation is the signature of an unapplied migration. */
const isMissingRelation = (message: string): boolean =>
  /does not exist|undefined_table|42P01|could not find the table|schema cache/i.test(message);

/**
 * MIGRATION HEALTH — probe the table with the cheapest possible query.
 * `limit(1)` on the tenant-scoped index; reads at most one row and never
 * inspects its contents.
 */
export async function checkMigrationHealth(): Promise<HealthIndicator> {
  try {
    const { error } = await ownedDbTable(LEAD_INTELLIGENCE_PROFILES_TABLE).select('lead_id').limit(1);
    if (!error) {
      return { name: 'migration', status: 'healthy', detail: `${LEAD_INTELLIGENCE_PROFILES_TABLE} is present` };
    }
    const message = String((error as { message?: string }).message ?? error);
    if (isMissingRelation(message)) {
      return {
        name: 'migration',
        status: 'unhealthy',
        detail:
          `${LEAD_INTELLIGENCE_PROFILES_TABLE} does not exist — migration 20260907000000 is not applied. ` +
          'Every generation is computing intelligence and discarding it; every read returns never_generated.',
        data: { remediation: 'apply supabase/migrations/20260907000000_lead_intelligence_profiles.sql' },
      };
    }
    return { name: 'migration', status: 'degraded', detail: `probe failed: ${message}` };
  } catch (e) {
    return { name: 'migration', status: 'unknown', detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * PERSISTENCE HEALTH — recent write/read failure counters from this process,
 * plus the live read probe result. No writes are performed.
 */
export function checkPersistenceHealth(): HealthIndicator {
  try {
    const counters = readCounters();
    const failures = sumMatching(counters, INTEL_METRICS.persistence.failures);
    const upsertFailures = sumMatching(counters, INTEL_METRICS.persistence.failures, 'upsert');
    if (upsertFailures > 0) {
      return {
        name: 'persistence',
        status: 'unhealthy',
        detail: `${upsertFailures} write failure(s) in this process — generated intelligence is being discarded`,
        data: { failures, upsertFailures },
      };
    }
    if (failures > 0) {
      return {
        name: 'persistence',
        status: 'degraded',
        detail: `${failures} read failure(s) in this process — reads are degrading to never_generated`,
        data: { failures },
      };
    }
    return { name: 'persistence', status: 'healthy', detail: 'no persistence failures recorded in this process' };
  } catch (e) {
    return { name: 'persistence', status: 'unknown', detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * GENERATION HEALTH — success/failure mix observed by this process. 'unknown'
 * when nothing has been generated yet (a cold instance is not unhealthy).
 */
export function checkGenerationHealth(): HealthIndicator {
  try {
    const counters = readCounters();
    const total = sumMatching(counters, INTEL_METRICS.generation.count);
    const failures = sumMatching(counters, INTEL_METRICS.generation.failures);
    const skipped = sumMatching(counters, INTEL_METRICS.generation.skipped);
    const snapshotFailures = sumMatching(counters, INTEL_METRICS.snapshot.failures);
    if (total === 0) {
      return {
        name: 'generation',
        status: 'unknown',
        detail: 'no generations observed in this process yet',
        data: { total, failures, skipped },
      };
    }
    const failureRate = failures / total;
    const data = { total, failures, skipped, snapshotFailures, failureRate: Math.round(failureRate * 1000) / 1000 };
    if (failureRate >= 0.5) {
      return { name: 'generation', status: 'unhealthy', detail: `${Math.round(failureRate * 100)}% of generations failed`, data };
    }
    if (failureRate > 0 || snapshotFailures > 0) {
      return {
        name: 'generation',
        status: 'degraded',
        detail: `${failures} failure(s), ${snapshotFailures} snapshot read failure(s) — inputs may be partial`,
        data,
      };
    }
    return { name: 'generation', status: 'healthy', detail: `${total} generation(s), no failures`, data };
  } catch (e) {
    return { name: 'generation', status: 'unknown', detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * FRESHNESS HEALTH — the stale/pending backlog for one tenant, or fleet-wide
 * when no tenant is given. Uses HEAD counts (no row bodies transferred) and is
 * the only probe that touches data volume; it is capped and read-only.
 */
export async function checkFreshnessHealth(companyId?: string): Promise<HealthIndicator> {
  try {
    /** Minimal structural view of the count query — avoids depending on the
     *  driver's deep generic types while staying type-safe at the call sites. */
    interface CountQuery extends PromiseLike<{ count?: number | null; error?: unknown }> {
      eq(column: string, value: string): CountQuery;
      neq(column: string, value: string): CountQuery;
      not(column: string, operator: string, value: unknown): CountQuery;
    }

    // HEAD + exact count: the server returns the count only, never row bodies.
    const base = (): CountQuery => {
      const q = ownedDbTable(LEAD_INTELLIGENCE_PROFILES_TABLE).select('lead_id', {
        count: 'exact',
        head: true,
      }) as unknown as CountQuery;
      return companyId ? q.eq('company_id', companyId) : q;
    };

    const countOf = async (build: (q: CountQuery) => CountQuery): Promise<number | null> => {
      const res = await build(base());
      if (res?.error) return null;
      return typeof res?.count === 'number' ? res.count : null;
    };

    const total = await countOf((q) => q);
    const pending = await countOf((q) => q.not('rebuild_requested_at', 'is', null));
    const staleVersion = await countOf((q) => q.neq('engine_version', ENGINE_VERSION));

    if (total === null) {
      return { name: 'freshness', status: 'unknown', detail: 'freshness counts unavailable (probe failed)' };
    }
    const data = { total, pendingRegeneration: pending, staleEngineVersion: staleVersion, currentEngineVersion: ENGINE_VERSION };
    const stale = staleVersion ?? 0;
    const staleRatio = total > 0 ? stale / total : 0;
    if (total === 0) {
      return { name: 'freshness', status: 'unknown', detail: 'no intelligence records exist yet', data };
    }
    if (staleRatio >= 0.5) {
      return {
        name: 'freshness',
        status: 'degraded',
        detail: `${stale}/${total} records are on an older engine version — regeneration wave incomplete`,
        data,
      };
    }
    return { name: 'freshness', status: 'healthy', detail: `${total} record(s), ${stale} stale, ${pending ?? 0} pending`, data };
  } catch (e) {
    return { name: 'freshness', status: 'unknown', detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Compose all four probes into one report. Never throws. */
export async function getIntelligenceHealth(companyId?: string): Promise<IntelligenceHealthReport> {
  const migration = await checkMigrationHealth();
  // Freshness needs the table; skip the query entirely when it is absent.
  const freshness =
    migration.status === 'unhealthy'
      ? { name: 'freshness', status: 'unknown' as HealthStatus, detail: 'skipped — persistence table unavailable' }
      : await checkFreshnessHealth(companyId);
  const indicators = [migration, checkPersistenceHealth(), checkGenerationHealth(), freshness];
  return {
    status: indicators.map((i) => i.status).reduce(worseOf, 'healthy' as HealthStatus),
    checkedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    processScoped: true,
    indicators,
  };
}

// ── registry helpers ────────────────────────────────────────────────────────

type CounterEntry = { name: string; value: number; labels?: Record<string, unknown> };

function readCounters(): CounterEntry[] {
  const snap = getObservabilitySnapshot() as unknown as { counters?: CounterEntry[] };
  return Array.isArray(snap?.counters) ? snap.counters : [];
}

/** Sum every counter series whose name matches, optionally filtered by a label value. */
function sumMatching(counters: CounterEntry[], name: string, labelValue?: string): number {
  let total = 0;
  for (const c of counters) {
    if (typeof c?.name !== 'string' || !c.name.startsWith(name)) continue;
    if (labelValue) {
      const labels = c.labels ?? {};
      const hit = Object.values(labels).some((v) => String(v) === labelValue) || c.name.includes(labelValue);
      if (!hit) continue;
    }
    if (typeof c.value === 'number' && Number.isFinite(c.value)) total += c.value;
  }
  return total;
}
