/**
 * customerEvolutionService.ts
 *
 * READ-ONLY Customer Evolution Engine. Computes movement/trend (Improving / Stable /
 * Declining / UNKNOWN) by comparing readiness SNAPSHOTS over time. Pure delta math;
 * no writes, no delivery, no AI.
 *
 * IMPORTANT: the readiness model is currently computed live and NOT persisted, so no
 * readiness history exists yet. With < 2 snapshots the engine returns UNKNOWN — it
 * never guesses. It is built to produce correct deltas the moment snapshots are
 * persisted (see PHASE12G report "Known limitations").
 */

import { supabase } from '../db/supabaseClient';
import type { ReadinessArea, ReadinessState, ReadinessBucket, TenantStatus, CompanyReadiness } from './customerReadinessService';
import type { PriorityTier } from './customerOpportunityPriorityService';

export type Trajectory = 'IMPROVING' | 'STABLE' | 'DECLINING' | 'UNKNOWN';

/** The historical record a future `customer_readiness_snapshots` table would store. */
export interface ReadinessSnapshot {
  company_id: string;
  taken_at: string; // ISO
  overall_readiness_score: number;
  readiness_bucket: ReadinessBucket;
  tenant_status: TenantStatus;
  opportunity_count: number;
  priority_tier: PriorityTier;
  areas: Record<ReadinessArea, ReadinessState>;
}

export interface AreaMovement {
  area: ReadinessArea;
  from: ReadinessState;
  to: ReadinessState;
  direction: 'IMPROVED' | 'REGRESSED' | 'UNCHANGED';
}

export interface CompanyEvolution {
  company_id: string;
  company_name?: string;
  trajectory: Trajectory;
  current_trajectory: Trajectory;
  snapshots_available: number;
  score_delta: number | null;
  readiness_movement: string | null;   // e.g. "AT_RISK → PARTIAL"
  status_movement: string | null;      // e.g. "ACTIVE → DORMANT"
  priority_movement: string | null;
  opportunity_delta: number | null;
  biggest_improvement: AreaMovement | null;
  biggest_regression: AreaMovement | null;
  evidence: string[];
}

const AREAS: ReadinessArea[] = [
  'COMPANY_PROFILE', 'WEBSITE', 'GOOGLE_ANALYTICS', 'GOOGLE_SEARCH_CONSOLE',
  'SOCIAL_INTEGRATIONS', 'COMMUNITY', 'TEAM_MEMBERS', 'BILLING',
];
const STATE_RANK: Record<ReadinessState, number> = { NOT_READY: 0, UNKNOWN: 1, READY: 2 };
const BUCKET_RANK: Record<ReadinessBucket, number> = { AT_RISK: 0, PARTIAL: 1, READY: 2 };
const SCORE_STABLE_BAND = 3; // |Δscore| within this, and no bucket move → STABLE

const UNKNOWN_EVOLUTION = (company_id: string, snapshots_available: number, company_name?: string): CompanyEvolution => ({
  company_id, company_name, trajectory: 'UNKNOWN', current_trajectory: 'UNKNOWN', snapshots_available,
  score_delta: null, readiness_movement: null, status_movement: null, priority_movement: null,
  opportunity_delta: null, biggest_improvement: null, biggest_regression: null,
  evidence: snapshots_available < 2 ? ['Insufficient history (need ≥ 2 snapshots).'] : [],
});

/** Compute evolution from a company's snapshots (any order). Pure + deterministic. */
export function computeCompanyEvolution(snapshots: ReadinessSnapshot[], company_name?: string): CompanyEvolution {
  if (snapshots.length === 0) return UNKNOWN_EVOLUTION('', 0, company_name);
  const ordered = [...snapshots].sort((a, b) => Date.parse(a.taken_at) - Date.parse(b.taken_at));
  const company_id = ordered[0].company_id;
  if (ordered.length < 2) return UNKNOWN_EVOLUTION(company_id, ordered.length, company_name);

  const prev = ordered[ordered.length - 2];
  const curr = ordered[ordered.length - 1];

  const score_delta = curr.overall_readiness_score - prev.overall_readiness_score;
  const bucketMove = BUCKET_RANK[curr.readiness_bucket] - BUCKET_RANK[prev.readiness_bucket];

  // Per-area movements.
  const movements: AreaMovement[] = AREAS.map((area) => {
    const from = prev.areas[area]; const to = curr.areas[area];
    const d = STATE_RANK[to] - STATE_RANK[from];
    return { area, from, to, direction: d > 0 ? 'IMPROVED' : d < 0 ? 'REGRESSED' : 'UNCHANGED' };
  });
  const improvements = movements.filter((m) => m.direction === 'IMPROVED');
  const regressions = movements.filter((m) => m.direction === 'REGRESSED');
  // Deterministic "biggest" = first by AREAS order among the strongest state jump.
  const strongest = (ms: AreaMovement[]) =>
    ms.length === 0 ? null : [...ms].sort((a, b) =>
      Math.abs(STATE_RANK[b.to] - STATE_RANK[b.from]) - Math.abs(STATE_RANK[a.to] - STATE_RANK[a.from])
      || AREAS.indexOf(a.area) - AREAS.indexOf(b.area))[0];

  let trajectory: Trajectory;
  if (score_delta > SCORE_STABLE_BAND || bucketMove > 0 || (improvements.length > regressions.length)) trajectory = 'IMPROVING';
  else if (score_delta < -SCORE_STABLE_BAND || bucketMove < 0 || (regressions.length > improvements.length)) trajectory = 'DECLINING';
  else trajectory = 'STABLE';

  const evidence: string[] = [];
  evidence.push(`readiness ${prev.overall_readiness_score}→${curr.overall_readiness_score} (${score_delta >= 0 ? '+' : ''}${score_delta})`);
  if (prev.readiness_bucket !== curr.readiness_bucket) evidence.push(`bucket ${prev.readiness_bucket} → ${curr.readiness_bucket}`);
  if (prev.tenant_status !== curr.tenant_status) evidence.push(`status ${prev.tenant_status} → ${curr.tenant_status}`);
  for (const m of [...improvements, ...regressions]) evidence.push(`${m.area} ${m.from} → ${m.to}`);

  return {
    company_id, company_name, trajectory, current_trajectory: trajectory,
    snapshots_available: ordered.length,
    score_delta,
    readiness_movement: prev.readiness_bucket !== curr.readiness_bucket ? `${prev.readiness_bucket} → ${curr.readiness_bucket}` : null,
    status_movement: prev.tenant_status !== curr.tenant_status ? `${prev.tenant_status} → ${curr.tenant_status}` : null,
    priority_movement: prev.priority_tier !== curr.priority_tier ? `${prev.priority_tier} → ${curr.priority_tier}` : null,
    opportunity_delta: curr.opportunity_count - prev.opportunity_count,
    biggest_improvement: strongest(improvements),
    biggest_regression: strongest(regressions),
    evidence,
  };
}

// ── Portfolio (Phase 5) ──────────────────────────────────────────────────────
export interface PortfolioEvolution {
  total_tenants: number;
  trajectory_distribution: Record<Trajectory, number>;
  most_improved: CompanyEvolution[];
  most_declined: CompanyEvolution[];
  most_improved_areas: Array<{ area: ReadinessArea; count: number }>;
  most_common_regressions: Array<{ area: ReadinessArea; count: number }>;
}

export function generatePortfolioEvolution(evolutions: CompanyEvolution[]): PortfolioEvolution {
  const trajectory_distribution: Record<Trajectory, number> = { IMPROVING: 0, STABLE: 0, DECLINING: 0, UNKNOWN: 0 };
  const improvedAreas = new Map<ReadinessArea, number>();
  const regressedAreas = new Map<ReadinessArea, number>();
  for (const e of evolutions) {
    trajectory_distribution[e.trajectory] += 1;
    if (e.biggest_improvement) improvedAreas.set(e.biggest_improvement.area, (improvedAreas.get(e.biggest_improvement.area) ?? 0) + 1);
    if (e.biggest_regression) regressedAreas.set(e.biggest_regression.area, (regressedAreas.get(e.biggest_regression.area) ?? 0) + 1);
  }
  const withDelta = evolutions.filter((e) => e.score_delta !== null);
  const most_improved = [...withDelta].filter((e) => (e.score_delta ?? 0) > 0).sort((a, b) => (b.score_delta ?? 0) - (a.score_delta ?? 0)).slice(0, 10);
  const most_declined = [...withDelta].filter((e) => (e.score_delta ?? 0) < 0).sort((a, b) => (a.score_delta ?? 0) - (b.score_delta ?? 0)).slice(0, 10);
  const rank = (m: Map<ReadinessArea, number>) => Array.from(m.entries()).map(([area, count]) => ({ area, count })).sort((a, b) => b.count - a.count);

  return {
    total_tenants: evolutions.length,
    trajectory_distribution,
    most_improved, most_declined,
    most_improved_areas: rank(improvedAreas),
    most_common_regressions: rank(regressedAreas),
  };
}

// ── Read-only history loader ─────────────────────────────────────────────────
/**
 * Load persisted readiness snapshots per company. The `customer_readiness_snapshots`
 * table does NOT exist yet, so this defensively returns an empty map → every company
 * resolves to UNKNOWN (no guessing). Ready to light up when snapshotting is added.
 */
export async function loadReadinessHistory(companyIds: string[]): Promise<Map<string, ReadinessSnapshot[]>> {
  const map = new Map<string, ReadinessSnapshot[]>();
  if (companyIds.length === 0) return map;
  try {
    const { data, error } = await supabase
      .from('customer_readiness_snapshots')
      .select('company_id, taken_at, overall_readiness_score, readiness_bucket, tenant_status, opportunity_count, priority_tier, company_profile_ready, website_ready, ga_ready, gsc_ready, social_ready, community_ready, team_ready, billing_ready')
      .in('company_id', companyIds);
    if (error || !data) return map; // table absent / unreadable → no history
    for (const r of data as unknown as Array<Record<string, unknown>>) {
      // Map the per-column area states into the engine's `areas` shape (no delta-logic change).
      const snap: ReadinessSnapshot = {
        company_id: String(r.company_id),
        taken_at: String(r.taken_at),
        overall_readiness_score: Number(r.overall_readiness_score),
        readiness_bucket: r.readiness_bucket as ReadinessBucket,
        tenant_status: r.tenant_status as TenantStatus,
        opportunity_count: Number(r.opportunity_count),
        priority_tier: r.priority_tier as PriorityTier,
        areas: {
          COMPANY_PROFILE: r.company_profile_ready as ReadinessState,
          WEBSITE: r.website_ready as ReadinessState,
          GOOGLE_ANALYTICS: r.ga_ready as ReadinessState,
          GOOGLE_SEARCH_CONSOLE: r.gsc_ready as ReadinessState,
          SOCIAL_INTEGRATIONS: r.social_ready as ReadinessState,
          COMMUNITY: r.community_ready as ReadinessState,
          TEAM_MEMBERS: r.team_ready as ReadinessState,
          BILLING: r.billing_ready as ReadinessState,
        },
      };
      map.set(snap.company_id, [...(map.get(snap.company_id) ?? []), snap]);
    }
  } catch {
    /* no history available */
  }
  return map;
}

/** Snapshot the CURRENT readiness (for future persistence / as the latest point). */
export function snapshotFromCurrent(
  c: CompanyReadiness, takenAt: string, opportunity_count: number, priority_tier: PriorityTier,
): ReadinessSnapshot {
  return {
    company_id: c.company_id, taken_at: takenAt,
    overall_readiness_score: c.overall_readiness_score, readiness_bucket: c.readiness_bucket,
    tenant_status: c.tenant_status, opportunity_count, priority_tier,
    areas: {
      COMPANY_PROFILE: c.company_profile_ready, WEBSITE: c.website_ready,
      GOOGLE_ANALYTICS: c.ga_ready, GOOGLE_SEARCH_CONSOLE: c.gsc_ready,
      SOCIAL_INTEGRATIONS: c.social_ready, COMMUNITY: c.community_ready,
      TEAM_MEMBERS: c.team_ready, BILLING: c.billing_ready,
    },
  };
}
