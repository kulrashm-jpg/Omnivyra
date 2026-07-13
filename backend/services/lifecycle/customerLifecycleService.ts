/**
 * customerLifecycleService.ts — the ONE canonical Customer Lifecycle authority
 * (CSA-004).
 *
 * Reuses the CSA-003 health authority (buildAllCustomerHealth) — which itself
 * composes CSA-002 evolution, CSA-001 usage, readiness, and Platform Ready — so
 * lifecycle consumes existing signals and NEVER recomputes health/readiness. It
 * loads the prior persisted stage to detect deterministic transitions, runs the
 * pure lifecycle model, persists the daily lifecycle time-series idempotently,
 * and exposes the read authority. Every future Customer Success capability reads
 * lifecycle here — there is no second lifecycle model.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../../db/supabaseClient';
import {
  buildAllCustomerHealth,
  type HealthResult,
} from '../health/customerHealthService';
import {
  computeCustomerLifecycle,
  type CustomerLifecycle,
  type LifecycleStage,
} from '../../../lib/lifecycle/customerLifecycle';

export const LIFECYCLE_SNAPSHOT_VERSION = 'lifecycle-snapshot-v1';

/** The prior persisted stage for a company (for transition detection). */
export interface PriorStage {
  stage: LifecycleStage;
  stageSince: string | null;
}

function integrationCoverageOf(h: HealthResult): number {
  const c = h.health.contributors.find((x) => x.key === 'integration');
  return c ? c.value : 0;
}

/**
 * Compute lifecycle for every company. Deterministic given its inputs; consumes
 * only existing authorities. No writes.
 */
export interface LifecycleGatherDeps {
  buildHealth?: (opts: { now: string }) => Promise<HealthResult[]>;
  loadPrevious?: (ids: string[]) => Promise<Map<string, PriorStage>>;
  now?: string;
}

export async function buildAllCustomerLifecycle(
  deps: LifecycleGatherDeps = {},
): Promise<CustomerLifecycle[]> {
  const now = deps.now ?? new Date().toISOString();
  const buildHealth = deps.buildHealth ?? ((o: { now: string }) => buildAllCustomerHealth(o));
  const loadPrevious = deps.loadPrevious ?? loadLatestLifecycleStages;

  const healths = await buildHealth({ now });
  if (healths.length === 0) return [];

  const prior = await loadPrevious(healths.map((h) => h.health.companyId));

  return healths.map((h) => {
    const p = prior.get(h.health.companyId);
    return computeCustomerLifecycle({
      companyId: h.health.companyId,
      now,
      platformReady: h.inputs.platformReady,
      healthScore: h.health.score,
      healthState: h.health.state,
      trajectory: h.inputs.trajectory,
      scoreDelta: h.inputs.scoreDelta,
      integrationCoverage: integrationCoverageOf(h),
      inactiveDays: h.health.risk.inactiveDays,
      usageActiveDays: h.inputs.usage.activeDays,
      activeUsers: h.inputs.usage.activeUsers,
      previousStage: p?.stage ?? null,
      previousStageSince: p?.stageSince ?? null,
    });
  });
}

// ── Persistence (daily snapshots, idempotent) ────────────────────────────────

export interface LifecycleSnapshotRow {
  company_id: string;
  taken_at: string;
  snapshot_date: string; // YYYY-MM-DD (UTC) — idempotency key
  lifecycle_stage: string;
  previous_stage: string | null;
  transition_changed: boolean;
  transition_direction: string;
  transition_reason: string;
  stage_since: string;
  trajectory: string;
  health_score: number;
  health_state: string;
  signals: unknown;
  snapshot_version: string;
}

/** Build one deterministic lifecycle snapshot row. Pure. */
export function buildLifecycleSnapshotRow(
  l: CustomerLifecycle,
  health: { score: number; state: string },
  takenAt: string,
): LifecycleSnapshotRow {
  return {
    company_id: l.companyId,
    taken_at: takenAt,
    snapshot_date: takenAt.slice(0, 10),
    lifecycle_stage: l.stage,
    previous_stage: l.transition.from,
    transition_changed: l.transition.changed,
    transition_direction: l.transition.direction,
    transition_reason: l.transition.reason,
    stage_since: l.stageSince,
    trajectory: l.transition.trajectory,
    health_score: health.score,
    health_state: health.state,
    signals: l.explanation,
    snapshot_version: LIFECYCLE_SNAPSHOT_VERSION,
  };
}

export interface LifecycleWriter {
  upsertDaily: (rows: LifecycleSnapshotRow[]) => Promise<number>;
}

const defaultWriter: LifecycleWriter = {
  upsertDaily: async (rows) => {
    if (rows.length === 0) return 0;
    const { data, error } = await supabase
      .from('customer_lifecycle_snapshots')
      .upsert(rows, { onConflict: 'company_id,snapshot_date', ignoreDuplicates: true })
      .select('snapshot_id');
    if (error) throw new Error(error.message);
    return data?.length ?? 0;
  },
};

export interface LifecycleSnapshotResult { total: number; inserted: number; skipped: number; taken_at: string; }

/**
 * Persist one lifecycle snapshot per company. Idempotent: a same-day rerun
 * inserts 0. Health score/state are carried on the row for fast reads.
 */
export async function generateLifecycleSnapshots(
  lifecycles: CustomerLifecycle[],
  health: Map<string, { score: number; state: string }>,
  takenAt: string,
  deps: { writer?: LifecycleWriter } = {},
): Promise<LifecycleSnapshotResult> {
  const writer = deps.writer ?? defaultWriter;
  const rows = lifecycles.map((l) =>
    buildLifecycleSnapshotRow(l, health.get(l.companyId) ?? { score: 0, state: 'UNKNOWN' }, takenAt),
  );
  const inserted = await writer.upsertDaily(rows);
  return { total: rows.length, inserted, skipped: rows.length - inserted, taken_at: takenAt };
}

// ── Read authority — lifecycle history comes ONLY from here ───────────────────

const COLS =
  'company_id, taken_at, snapshot_date, lifecycle_stage, previous_stage, transition_changed, transition_direction, transition_reason, stage_since, trajectory, health_score, health_state, signals';

/** Load the latest persisted stage per company (for transition detection). Fail-safe. */
export async function loadLatestLifecycleStages(
  companyIds: string[],
  deps?: { supabase?: SupabaseClient },
): Promise<Map<string, PriorStage>> {
  const map = new Map<string, PriorStage>();
  if (companyIds.length === 0) return map;
  try {
    const db = deps?.supabase ?? supabase;
    const { data, error } = await db
      .from('customer_lifecycle_snapshots')
      .select('company_id, lifecycle_stage, stage_since, taken_at')
      .in('company_id', companyIds)
      .order('taken_at', { ascending: false });
    if (error || !data) return map;
    for (const r of data as unknown as Array<Record<string, unknown>>) {
      const id = String(r.company_id);
      if (map.has(id)) continue; // first (latest) wins
      map.set(id, { stage: r.lifecycle_stage as LifecycleStage, stageSince: (r.stage_since as string) ?? null });
    }
    return map;
  } catch {
    return map;
  }
}

/** Latest lifecycle snapshot for a company (or null). Fail-safe. */
export async function getLatestCustomerLifecycle(
  companyId: string,
  deps?: { supabase?: SupabaseClient },
): Promise<LifecycleSnapshotRow | null> {
  try {
    const db = deps?.supabase ?? supabase;
    const { data, error } = await db
      .from('customer_lifecycle_snapshots')
      .select(COLS)
      .eq('company_id', companyId)
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as LifecycleSnapshotRow;
  } catch {
    return null;
  }
}

/** Full daily lifecycle history for a company (ascending). Fail-safe → []. */
export async function getCustomerLifecycleHistory(
  companyId: string,
  deps?: { supabase?: SupabaseClient },
): Promise<LifecycleSnapshotRow[]> {
  try {
    const db = deps?.supabase ?? supabase;
    const { data, error } = await db
      .from('customer_lifecycle_snapshots')
      .select(COLS)
      .eq('company_id', companyId)
      .order('taken_at', { ascending: true })
      .limit(3650);
    if (error || !data) return [];
    return data as unknown as LifecycleSnapshotRow[];
  } catch {
    return [];
  }
}
