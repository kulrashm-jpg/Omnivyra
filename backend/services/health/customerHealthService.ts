/**
 * customerHealthService.ts — the ONE canonical Customer Health authority (CSA-003).
 *
 * Gathers inputs from the EXISTING authorities (readiness, evolution, CSA-001
 * usage, integration coverage via readiness areas, company-scoped Platform
 * Ready), runs the pure health model, and persists/read the daily health
 * time-series. It NEVER recomputes readiness and introduces NO second health
 * model — the math lives in lib/health/customerHealth.ts. Every future Customer
 * Success capability reads company health through this service.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../../db/supabaseClient';
import {
  getCustomerReadiness,
  type CompanyReadiness,
} from '../customerReadinessService';
import {
  loadReadinessHistory,
  computeCompanyEvolution,
  type ReadinessSnapshot,
} from '../customerEvolutionService';
import { getUsageSummary } from '../usage/usageAuthorityService';
import {
  computeCustomerHealth,
  type CustomerHealth,
  type HealthInputs,
  type HealthUsageInput,
  type HealthArea,
  type ReadinessAreaState,
} from '../../../lib/health/customerHealth';

export const HEALTH_SNAPSHOT_VERSION = 'health-snapshot-v1';

/** Company-scoped Platform Ready = every mandatory area complete (readiness READY). */
function companyPlatformReady(c: CompanyReadiness): boolean {
  return c.readiness_bucket === 'READY';
}

/** Map the existing readiness row's area states into the health model's areas. */
function areasFrom(c: CompanyReadiness): Record<HealthArea, ReadinessAreaState> {
  return {
    COMPANY_PROFILE: c.company_profile_ready,
    WEBSITE: c.website_ready,
    GOOGLE_ANALYTICS: c.ga_ready,
    GOOGLE_SEARCH_CONSOLE: c.gsc_ready,
    SOCIAL_INTEGRATIONS: c.social_ready,
  };
}

/** Assemble the pure model's inputs from the existing authorities. Pure mapping. */
export function gatherHealthInputs(
  c: CompanyReadiness,
  evolution: { trajectory: HealthInputs['trajectory']; score_delta: number | null },
  usage: HealthUsageInput,
  now: string,
): HealthInputs {
  return {
    companyId: c.company_id,
    now,
    platformReady: companyPlatformReady(c),
    readinessScore: c.overall_readiness_score,
    readinessBucket: c.readiness_bucket,
    tenantStatus: c.tenant_status,
    lastActivityAt: c.last_activity_at,
    areas: areasFrom(c),
    trajectory: evolution.trajectory,
    scoreDelta: evolution.score_delta,
    usage,
  };
}

const EMPTY_USAGE: HealthUsageInput = { totalEvents: 0, activeUsers: 0, activeDays: 0, capabilitiesUsed: [] };

/** Default per-company usage loader over the CSA-001 authority (last 30 days). Fail-safe. */
async function defaultLoadUsage(companyId: string, from: string, to: string): Promise<HealthUsageInput> {
  try {
    const s = await getUsageSummary(companyId, { from, to, granularity: 'daily' });
    return {
      totalEvents: s.totalEvents,
      activeUsers: s.activeUsers,
      activeDays: s.series.length,
      capabilitiesUsed: Object.keys(s.byCapability),
    };
  } catch {
    return EMPTY_USAGE;
  }
}

export interface HealthResult {
  inputs: HealthInputs;
  health: CustomerHealth;
}

export interface HealthGatherDeps {
  getReadiness?: () => Promise<{ tenants: CompanyReadiness[] }>;
  loadHistory?: (ids: string[]) => Promise<Map<string, ReadinessSnapshot[]>>;
  loadUsage?: (companyId: string, from: string, to: string) => Promise<HealthUsageInput>;
  now?: string;
}

/**
 * Compute canonical health for every company. Deterministic given its inputs;
 * consumes only existing authorities. No writes.
 */
export async function buildAllCustomerHealth(deps: HealthGatherDeps = {}): Promise<HealthResult[]> {
  const now = deps.now ?? new Date().toISOString();
  const from = new Date(Date.parse(now) - 30 * 86_400_000).toISOString();
  const getReadiness = deps.getReadiness ?? (() => getCustomerReadiness({}));
  const loadHistory = deps.loadHistory ?? loadReadinessHistory;
  const loadUsage = deps.loadUsage ?? defaultLoadUsage;

  const { tenants } = await getReadiness();
  if (tenants.length === 0) return [];

  const history = await loadHistory(tenants.map((t) => t.company_id));

  const results: HealthResult[] = [];
  for (const c of tenants) {
    const snaps = history.get(c.company_id) ?? [];
    const evo = computeCompanyEvolution(snaps, c.company_name);
    const usage = await loadUsage(c.company_id, from, now);
    const inputs = gatherHealthInputs(
      c,
      { trajectory: evo.trajectory, score_delta: evo.score_delta },
      usage,
      now,
    );
    results.push({ inputs, health: computeCustomerHealth(inputs) });
  }
  return results;
}

// ── Persistence (daily snapshots, idempotent) ────────────────────────────────

export interface HealthSnapshotRow {
  company_id: string;
  taken_at: string;
  snapshot_date: string; // YYYY-MM-DD (UTC) — idempotency key
  health_score: number;
  health_state: string;
  risk_level: string;
  readiness_score: number;
  trajectory: string;
  inactive_days: number | null;
  contributors: unknown;
  risk_reasons: unknown;
  snapshot_version: string;
}

/** Build one deterministic health snapshot row. Pure. */
export function buildHealthSnapshotRow(r: HealthResult, takenAt: string): HealthSnapshotRow {
  return {
    company_id: r.health.companyId,
    taken_at: takenAt,
    snapshot_date: takenAt.slice(0, 10),
    health_score: r.health.score,
    health_state: r.health.state,
    risk_level: r.health.risk.level,
    readiness_score: r.inputs.readinessScore,
    trajectory: r.inputs.trajectory,
    inactive_days: r.health.risk.inactiveDays,
    contributors: r.health.contributors,
    risk_reasons: r.health.risk.reasons,
    snapshot_version: HEALTH_SNAPSHOT_VERSION,
  };
}

export interface HealthWriter {
  /** Returns rows actually inserted (per-day duplicates skipped). */
  upsertDaily: (rows: HealthSnapshotRow[]) => Promise<number>;
}

const defaultWriter: HealthWriter = {
  upsertDaily: async (rows) => {
    if (rows.length === 0) return 0;
    const { data, error } = await supabase
      .from('customer_health_snapshots')
      .upsert(rows, { onConflict: 'company_id,snapshot_date', ignoreDuplicates: true })
      .select('snapshot_id');
    if (error) throw new Error(error.message);
    return data?.length ?? 0;
  },
};

export interface HealthSnapshotResult { total: number; inserted: number; skipped: number; taken_at: string; }

/** Persist one health snapshot per company. Idempotent: a same-day rerun inserts 0. */
export async function generateHealthSnapshots(
  results: HealthResult[],
  takenAt: string,
  deps: { writer?: HealthWriter } = {},
): Promise<HealthSnapshotResult> {
  const writer = deps.writer ?? defaultWriter;
  const rows = results.map((r) => buildHealthSnapshotRow(r, takenAt));
  const inserted = await writer.upsertDaily(rows);
  return { total: rows.length, inserted, skipped: rows.length - inserted, taken_at: takenAt };
}

// ── Read authority (§1/§7) — historical health comes ONLY from here ───────────

const HISTORY_COLS =
  'company_id, taken_at, snapshot_date, health_score, health_state, risk_level, readiness_score, trajectory, inactive_days, contributors, risk_reasons';

/** Latest health snapshot for a company (or null). Fail-safe. */
export async function getLatestCustomerHealth(
  companyId: string,
  deps?: { supabase?: SupabaseClient },
): Promise<HealthSnapshotRow | null> {
  try {
    const db = deps?.supabase ?? supabase;
    const { data, error } = await db
      .from('customer_health_snapshots')
      .select(HISTORY_COLS)
      .eq('company_id', companyId)
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as HealthSnapshotRow;
  } catch {
    return null;
  }
}

/** Full daily health history for a company (ascending). Fail-safe → []. */
export async function getCustomerHealthHistory(
  companyId: string,
  deps?: { supabase?: SupabaseClient },
): Promise<HealthSnapshotRow[]> {
  try {
    const db = deps?.supabase ?? supabase;
    const { data, error } = await db
      .from('customer_health_snapshots')
      .select(HISTORY_COLS)
      .eq('company_id', companyId)
      .order('taken_at', { ascending: true })
      .limit(3650);
    if (error || !data) return [];
    return data as unknown as HealthSnapshotRow[];
  } catch {
    return [];
  }
}
