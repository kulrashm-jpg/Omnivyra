/**
 * Platform change engine (Phase 40). Deterministic diff between two persisted HistoricalSnapshots
 * for one plugin. NO plugin execution — compares stored canonical outputs only. Every change is
 * evidence-backed (carries the actual delta + the timestamp it was observed).
 */
import type { HistoricalSnapshot } from '../history/platformSnapshotTypes';

export type ChangeKind =
  | 'score_increase' | 'score_decrease' | 'confidence_increase' | 'confidence_decrease'
  | 'module_activation' | 'module_degradation' | 'recommendation_added' | 'recommendation_removed'
  | 'business_impact_increase' | 'business_impact_decrease' | 'freshness_change'
  | 'new_issue' | 'resolved_issue';

export interface Change {
  kind: ChangeKind;
  pluginId: string;
  detail: string;
  delta?: number;
  at: string; // observation time (cur.takenAt)
  negative: boolean;
}

const HEALTH_RANK: Record<string, number> = { disconnected: 0, critical: 0, warning: 1, degraded: 1, healthy: 2, ready: 2 };
const rank = (h: string) => HEALTH_RANK[h] ?? 1;
const isAvail = (score: number | null) => score != null;

const NEGATIVE: Set<ChangeKind> = new Set(['score_decrease', 'confidence_decrease', 'module_degradation', 'business_impact_decrease', 'new_issue', 'recommendation_added', 'freshness_change']);

/** Diff two consecutive snapshots (prev → cur) of the same plugin. */
export function detectChanges(prev: HistoricalSnapshot, cur: HistoricalSnapshot): Change[] {
  const out: Change[] = [];
  const at = cur.takenAt; const pid = cur.pluginId;
  const push = (kind: ChangeKind, detail: string, delta?: number) => out.push({ kind, pluginId: pid, detail, delta, at, negative: NEGATIVE.has(kind) });

  const sd = Math.round(cur.overallScore - prev.overallScore);
  if (sd > 2) push('score_increase', `Score rose ${prev.overallScore}→${cur.overallScore}`, sd);
  if (sd < -2) push('score_decrease', `Score fell ${prev.overallScore}→${cur.overallScore}`, sd);

  const cd = Math.round((cur.confidence - prev.confidence) * 100) / 100;
  if (cd >= 0.1) push('confidence_increase', `Confidence rose ${Math.round(prev.confidence * 100)}%→${Math.round(cur.confidence * 100)}%`, cd);
  if (cd <= -0.1) push('confidence_decrease', `Confidence fell ${Math.round(prev.confidence * 100)}%→${Math.round(cur.confidence * 100)}%`, cd);

  for (const m of cur.moduleSummaries) {
    const pm = prev.moduleSummaries.find((x) => x.key === m.key);
    if (!pm) continue;
    if (!isAvail(pm.score) && isAvail(m.score)) push('module_activation', `Module ${m.key} activated`);
    if (typeof pm.score === 'number' && typeof m.score === 'number' && m.score <= pm.score - 10) push('module_degradation', `Module ${m.key} fell ${pm.score}→${m.score}`, m.score - pm.score);
  }

  const prevR = new Set(prev.recommendationIds); const curR = new Set(cur.recommendationIds);
  for (const r of curR) if (!prevR.has(r)) push('recommendation_added', `Recommendation '${r}' added`);
  for (const r of prevR) if (!curR.has(r)) push('recommendation_removed', `Recommendation '${r}' resolved`);

  const bd = cur.businessImpact.topDimensions.length - prev.businessImpact.topDimensions.length;
  if (bd > 0) push('business_impact_increase', `Impact widened to ${cur.businessImpact.topDimensions.length} dimensions`, bd);
  if (bd < 0) push('business_impact_decrease', `Impact narrowed to ${cur.businessImpact.topDimensions.length} dimensions`, bd);

  if (prev.freshness.stale !== cur.freshness.stale) push('freshness_change', cur.freshness.stale ? 'Intelligence became stale' : 'Intelligence refreshed');

  const hr = rank(cur.health) - rank(prev.health);
  if (hr < 0) push('new_issue', `Health worsened ${prev.health}→${cur.health}`);
  if (hr > 0) push('resolved_issue', `Health recovered ${prev.health}→${cur.health}`);

  return out;
}

/** Diff the latest consecutive pair in a plugin's history (oldest → newest). */
export function detectChangesForHistory(rows: HistoricalSnapshot[]): Change[] {
  if (rows.length < 2) return [];
  return detectChanges(rows[rows.length - 2]!, rows[rows.length - 1]!);
}
