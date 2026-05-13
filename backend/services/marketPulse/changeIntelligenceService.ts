/**
 * Market Pulse — Change Intelligence Service.
 *
 * Phase 1B: produces the "what changed since last run" delta. Reuses the
 * existing `market_pulse_memory` rows (canonical_event_key + last_change_status
 * + times_seen) and the prior-run row in `market_pulse_runs` — no new tables.
 *
 * Output is persisted on `market_pulse_runs.change_summary` (JSONB) and
 * surfaced by `getMarketPulseRun` so the UI can render the diff strip.
 *
 * Computed AFTER the new findings have been inserted (so memory rows reflect
 * the current run state) by reading:
 *   - current run's `market_pulse_findings`
 *   - prior run's `market_pulse_findings` (if one exists for the same company)
 *   - `market_pulse_memory` for resolved/escalated detection
 */

import { ownedDbTable } from '../../db/writeOwner';

export interface ChangeSummary {
  prior_run_id: string | null;
  prior_run_at: string | null;
  /** Counts. */
  new_count: number;
  updated_count: number;
  unchanged_count: number;
  resolved_count: number;
  /** Tier movements vs prior run (matched by canonical_event_key). */
  escalated_count: number;
  downgraded_count: number;
  /** Categories appearing in current run that did NOT appear in prior run. */
  emerging_categories: string[];
  /** Categories present in prior run but absent from current. */
  disappearing_categories: string[];
  /** Capped sample of escalated findings for UI surfacing. */
  escalated_samples: Array<{
    finding_id: string;
    title: string;
    from_tier: string | null;
    to_tier: string | null;
  }>;
}

interface FindingRow {
  id: string;
  title: string;
  category: string;
  canonical_event_key: string;
  priority_tier: string | null;
  change_status: string | null;
}

const TIER_ORDER: Record<string, number> = { P0: 3, P1: 2, P2: 1 };

function tierRank(t: string | null | undefined): number {
  if (!t) return 0;
  return TIER_ORDER[t] ?? 0;
}

/**
 * Locate the most recent COMPLETED run that precedes the current run for
 * this company. Returns null if this is the company's first ever run.
 */
async function findPriorRun(
  companyId: string,
  currentRunId: string,
  currentRunCreatedAt: string,
): Promise<{ id: string; created_at: string } | null> {
  const { data } = await ownedDbTable('market_pulse_runs')
    .select('id, created_at, status')
    .eq('company_id', companyId)
    .neq('id', currentRunId)
    .lt('created_at', currentRunCreatedAt)
    .in('status', ['completed', 'completed_with_warnings'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id as string, created_at: data.created_at as string };
}

async function loadFindingsForRun(runId: string): Promise<FindingRow[]> {
  const { data } = await ownedDbTable('market_pulse_findings')
    .select('id, title, category, canonical_event_key, priority_tier, change_status')
    .eq('run_id', runId);
  return Array.isArray(data) ? (data as FindingRow[]) : [];
}

/**
 * Compute the change summary for a freshly-synced run. Safe to call even
 * when there is no prior run — returns counts based on the current run only
 * with priors set to 0 / empty.
 */
export async function computeChangeSummary(
  companyId: string,
  runId: string,
  runCreatedAt: string,
): Promise<ChangeSummary> {
  const currentFindings = await loadFindingsForRun(runId);
  const prior = await findPriorRun(companyId, runId, runCreatedAt);

  // Counts derivable from current run alone.
  let new_count = 0;
  let updated_count = 0;
  let unchanged_count = 0;
  let resolved_count = 0;
  for (const f of currentFindings) {
    if (f.change_status === 'new') new_count++;
    else if (f.change_status === 'updated') updated_count++;
    else if (f.change_status === 'unchanged') unchanged_count++;
    else if (f.change_status === 'resolved') resolved_count++;
  }

  if (!prior) {
    // First run for this company — no diff to compute.
    return {
      prior_run_id: null,
      prior_run_at: null,
      new_count,
      updated_count,
      unchanged_count,
      resolved_count,
      escalated_count: 0,
      downgraded_count: 0,
      emerging_categories: Array.from(new Set(currentFindings.map((f) => f.category))),
      disappearing_categories: [],
      escalated_samples: [],
    };
  }

  const priorFindings = await loadFindingsForRun(prior.id);

  // Match prior↔current by canonical_event_key. Tier movement detection runs
  // against this match.
  const priorByKey = new Map<string, FindingRow>();
  for (const f of priorFindings) {
    if (f.canonical_event_key) priorByKey.set(f.canonical_event_key, f);
  }

  let escalated_count = 0;
  let downgraded_count = 0;
  const escalated_samples: ChangeSummary['escalated_samples'] = [];

  for (const cur of currentFindings) {
    if (!cur.canonical_event_key) continue;
    const prev = priorByKey.get(cur.canonical_event_key);
    if (!prev) continue;
    const curRank = tierRank(cur.priority_tier);
    const prevRank = tierRank(prev.priority_tier);
    if (curRank > prevRank) {
      escalated_count++;
      if (escalated_samples.length < 5) {
        escalated_samples.push({
          finding_id: cur.id,
          title: cur.title,
          from_tier: prev.priority_tier,
          to_tier: cur.priority_tier,
        });
      }
    } else if (curRank < prevRank) {
      downgraded_count++;
    }
  }

  // Category emergence/disappearance.
  const currentCats = new Set(currentFindings.map((f) => f.category));
  const priorCats = new Set(priorFindings.map((f) => f.category));
  const emerging_categories = Array.from(currentCats).filter((c) => !priorCats.has(c));
  const disappearing_categories = Array.from(priorCats).filter((c) => !currentCats.has(c));

  return {
    prior_run_id: prior.id,
    prior_run_at: prior.created_at,
    new_count,
    updated_count,
    unchanged_count,
    resolved_count,
    escalated_count,
    downgraded_count,
    emerging_categories,
    disappearing_categories,
    escalated_samples,
  };
}
