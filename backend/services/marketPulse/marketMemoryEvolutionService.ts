/**
 * Market Pulse — Memory Evolution Service.
 *
 * Phase 2: extends the Phase 1 `market_pulse_memory` upsert with
 * longitudinal tracking. Same row, additional columns:
 *
 *   - tier_history          (JSONB)  : compact rolling list of {tier, at}
 *   - first_priority_tier   (TEXT)   : tier at first sighting
 *   - last_priority_tier    (TEXT)   : tier at most recent sighting
 *   - peak_priority_tier    (TEXT)   : highest tier ever reached
 *   - escalation_velocity   (NUMERIC): rate of tier escalation per week
 *   - recurrence_cadence_days (NUMERIC): mean days between sightings
 *   - category_persistence_runs (INTEGER): consecutive runs in same category
 *   - regional_spread_score (NUMERIC): unique regions / total sightings
 *   - trajectory            (TEXT)   : 'accelerating' | 'fading' | 'cyclic'
 *                                      | 'structural' | 'stable'
 *   - last_category         (TEXT)   : category from latest sighting
 *
 * Computes trajectory deterministically from the rolling tier_history +
 * region history. No LLM needed.
 *
 * Backward compat: legacy `times_seen + first_seen_at + last_seen_at +
 * latest_finding_hash + last_change_status + is_resolved` are unchanged.
 */

import { ownedDbTable } from '../../db/writeOwner';

const TIER_HISTORY_MAX_ENTRIES = 12;     // rolling cap so the JSONB stays small
const ACCELERATING_LOOKBACK_DAYS = 14;   // window for escalation_velocity
const STABLE_TRAJECTORY_RECURRENCE_THRESHOLD = 4;

const TIER_RANK: Record<string, number> = { P0: 3, P1: 2, P2: 1 };

type TierHistoryEntry = {
  /** Priority tier at this sighting. */
  t: 'P0' | 'P1' | 'P2';
  /** ISO timestamp. */
  at: string;
  /** Region snapshot (max 4). */
  r?: string[];
};

export interface MemoryEvolutionInput {
  companyId: string;
  canonicalEventKey: string;
  /** Current sighting's data. */
  current: {
    tier: 'P0' | 'P1' | 'P2';
    category: string;
    regions: string[];
    impactType: 'opportunity' | 'risk' | 'watch';
    seenAt: string;
  };
}

export interface MemoryEvolutionOutput {
  trajectory: 'accelerating' | 'fading' | 'cyclic' | 'structural' | 'stable';
  escalation_velocity: number;
  recurrence_cadence_days: number | null;
  regional_spread_score: number;
  category_persistence_runs: number;
  last_priority_tier: string;
  peak_priority_tier: string;
  first_priority_tier: string;
  tier_history: TierHistoryEntry[];
  /** Convenience: how many tiers above last sighting (positive = escalation, negative = downgrade, 0 = same). */
  delta_vs_last: number;
  /** Was this finding's tier higher than peak_priority_tier before this update? */
  is_new_peak: boolean;
}

function rank(tier: string | null | undefined): number {
  return tier ? TIER_RANK[tier] ?? 0 : 0;
}

function tierFromRank(r: number): 'P0' | 'P1' | 'P2' {
  if (r >= 3) return 'P0';
  if (r >= 2) return 'P1';
  return 'P2';
}

function meanDaysBetween(history: TierHistoryEntry[]): number | null {
  if (history.length < 2) return null;
  // Walk the timestamps once.
  const timestamps = history
    .map((h) => new Date(h.at).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (timestamps.length < 2) return null;
  let totalGapMs = 0;
  for (let i = 1; i < timestamps.length; i++) totalGapMs += timestamps[i] - timestamps[i - 1];
  const meanMs = totalGapMs / (timestamps.length - 1);
  return Math.round((meanMs / (24 * 60 * 60 * 1000)) * 10) / 10;
}

function escalationVelocity(history: TierHistoryEntry[]): number {
  if (history.length < 2) return 0;
  // Slope of tier rank over time, normalized to "tiers per week".
  const sorted = [...history].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const earliest = new Date(sorted[0].at).getTime();
  const latest = new Date(sorted[sorted.length - 1].at).getTime();
  const ageDays = Math.max(0.5, (latest - earliest) / (24 * 60 * 60 * 1000));
  if (ageDays > ACCELERATING_LOOKBACK_DAYS * 2) return 0; // too old to count as velocity
  const tierDelta = rank(sorted[sorted.length - 1].t) - rank(sorted[0].t);
  return Math.round((tierDelta / ageDays) * 7 * 100) / 100;
}

function regionalSpreadScore(history: TierHistoryEntry[], currentRegions: string[]): number {
  const allRegions = new Set<string>();
  for (const h of history) {
    for (const r of h.r ?? []) allRegions.add(r.toUpperCase().trim());
  }
  for (const r of currentRegions) allRegions.add(r.toUpperCase().trim());
  const sightings = history.length + 1;
  if (sightings === 0 || allRegions.size === 0) return 0;
  return Math.round((allRegions.size / sightings) * 100) / 100;
}

/**
 * Classify trajectory:
 *   accelerating — escalation_velocity > 0 AND last tier > first tier
 *   fading       — escalation_velocity < 0 OR last tier < first tier across recent history
 *   cyclic       — alternating tiers (≥3 changes in last 6 sightings)
 *   structural   — recurrence ≥ 4 sightings AND tier hovers at same rank ≥ 0.6 of history
 *   stable       — fallback (low recurrence, no movement)
 */
function classifyTrajectory(
  history: TierHistoryEntry[],
  current: MemoryEvolutionInput['current'],
): 'accelerating' | 'fading' | 'cyclic' | 'structural' | 'stable' {
  const fullHistory = [...history, { t: current.tier, at: current.seenAt }];
  if (fullHistory.length === 1) return 'stable';

  const sorted = [...fullHistory].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const firstRank = rank(sorted[0].t);
  const lastRank = rank(sorted[sorted.length - 1].t);
  const velocity = escalationVelocity(history.concat([{ t: current.tier, at: current.seenAt, r: current.regions }]));

  // Accelerating: tier escalating + recent activity
  if (lastRank > firstRank && velocity > 0.1) return 'accelerating';

  // Fading: tier dropping
  if (lastRank < firstRank && velocity < -0.1) return 'fading';

  // Cyclic: ≥3 tier changes in last 6 entries
  const window = sorted.slice(-6);
  let changes = 0;
  for (let i = 1; i < window.length; i++) {
    if (window[i].t !== window[i - 1].t) changes++;
  }
  if (changes >= 3) return 'cyclic';

  // Structural: persistent recurrence at same tier
  if (fullHistory.length >= STABLE_TRAJECTORY_RECURRENCE_THRESHOLD) {
    const sameTierShare = fullHistory.filter((h) => h.t === current.tier).length / fullHistory.length;
    if (sameTierShare >= 0.6) return 'structural';
  }

  return 'stable';
}

/**
 * Update the longitudinal columns for an existing memory row, OR seed them
 * for a brand-new memory row. Called immediately after the legacy
 * `upsertMemory(...)` in syncLegacyJobIntoRun has updated the base columns.
 *
 * Reads the row again to get fresh state (including the updates the legacy
 * upsert just made) and rewrites the longitudinal columns with the
 * computed trajectory + history.
 */
export async function evolveMemoryAfterFinding(
  input: MemoryEvolutionInput,
): Promise<MemoryEvolutionOutput> {
  const { companyId, canonicalEventKey, current } = input;

  const { data: existing } = await ownedDbTable('market_pulse_memory')
    .select('first_priority_tier, last_priority_tier, peak_priority_tier, tier_history, last_category, category_persistence_runs')
    .eq('company_id', companyId)
    .eq('canonical_event_key', canonicalEventKey)
    .maybeSingle();

  const priorHistory: TierHistoryEntry[] = Array.isArray(existing?.tier_history)
    ? (existing!.tier_history as TierHistoryEntry[]).filter((e) => e && e.t && e.at)
    : [];

  const last_priority_tier = current.tier;
  const first_priority_tier = (existing?.first_priority_tier as string | null) ?? current.tier;
  const peak_priority_tier_prior = (existing?.peak_priority_tier as string | null) ?? null;
  const peak_priority_tier = rank(current.tier) > rank(peak_priority_tier_prior)
    ? current.tier
    : (peak_priority_tier_prior ?? current.tier);
  const is_new_peak = rank(current.tier) > rank(peak_priority_tier_prior);

  // Build the new history entry (regions truncated to 4 for size discipline).
  const newEntry: TierHistoryEntry = {
    t: current.tier,
    at: current.seenAt,
    r: current.regions.slice(0, 4),
  };
  const tier_history = [...priorHistory, newEntry].slice(-TIER_HISTORY_MAX_ENTRIES);

  const escalation_velocity = escalationVelocity(tier_history);
  const recurrence_cadence_days = meanDaysBetween(tier_history);
  const regional_spread_score = regionalSpreadScore(priorHistory, current.regions);
  const trajectory = classifyTrajectory(priorHistory, current);

  // Category persistence: if the same category continues, increment; reset on
  // change. Useful for "this canonical event has stayed in regulatory_policy
  // for 5 consecutive runs".
  const priorCategoryRuns = Number(existing?.category_persistence_runs ?? 0) || 0;
  const priorCategory = (existing?.last_category as string | null) ?? null;
  const category_persistence_runs = priorCategory === current.category ? priorCategoryRuns + 1 : 1;

  const delta_vs_last = rank(current.tier) - rank((existing?.last_priority_tier as string | null) ?? null);

  await ownedDbTable('market_pulse_memory')
    .update({
      first_priority_tier,
      last_priority_tier,
      peak_priority_tier,
      tier_history,
      escalation_velocity,
      recurrence_cadence_days,
      regional_spread_score,
      trajectory,
      category_persistence_runs,
      last_category: current.category,
    })
    .eq('company_id', companyId)
    .eq('canonical_event_key', canonicalEventKey);

  return {
    trajectory,
    escalation_velocity,
    recurrence_cadence_days,
    regional_spread_score,
    category_persistence_runs,
    last_priority_tier,
    peak_priority_tier,
    first_priority_tier,
    tier_history,
    delta_vs_last,
    is_new_peak,
  };
}

/**
 * Helper: classify escalation_level from memory evolution output.
 * Persisted on `market_pulse_findings.escalation_level` so the alert
 * classifier can differentiate first-occurrence vs repeated etc.
 */
export function deriveEscalationLevel(
  evolution: MemoryEvolutionOutput,
  inRunRegionCount: number,
): 'first_occurrence' | 'repeated' | 'escalating_pattern' | 'market_wide_propagation' {
  if (evolution.tier_history.length <= 1) return 'first_occurrence';
  if (evolution.delta_vs_last > 0 || evolution.escalation_velocity > 0.2) return 'escalating_pattern';
  if (evolution.regional_spread_score >= 0.5 && inRunRegionCount >= 3) return 'market_wide_propagation';
  return 'repeated';
}

export { TIER_RANK as MARKET_PULSE_TIER_RANK };
