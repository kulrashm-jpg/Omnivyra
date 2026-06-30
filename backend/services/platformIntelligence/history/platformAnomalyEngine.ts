/**
 * Platform anomaly engine (Phase 37). Deterministic threshold detection over persisted
 * snapshots (latest vs previous + the series). No AI, no learned thresholds. Returns an empty
 * list when there is insufficient history (Unknown ≠ anomaly).
 */
import type { HistoricalSnapshot } from './platformSnapshotTypes';

export type AnomalyKind =
  | 'sudden_drop' | 'sudden_improvement' | 'confidence_collapse' | 'module_regression'
  | 'recommendation_explosion' | 'business_impact_spike' | 'freshness_anomaly';

export interface Anomaly {
  kind: AnomalyKind;
  pluginId: string;
  detail: string;
  delta?: number;
  at: string;
}

const SCORE_DROP = 15;          // points
const SCORE_JUMP = 20;          // points
const CONFIDENCE_COLLAPSE = 0.3; // fractional drop
const REC_EXPLOSION = 2;         // ≥2x previous recommendation count (and ≥4 absolute)

/** Detect anomalies for one plugin's history (rows oldest → newest). */
export function detectAnomalies(rows: HistoricalSnapshot[]): Anomaly[] {
  if (rows.length < 2) return []; // insufficient history — not an anomaly
  const prev = rows[rows.length - 2]!;
  const cur = rows[rows.length - 1]!;
  const out: Anomaly[] = [];
  const at = cur.takenAt;

  const scoreDelta = cur.overallScore - prev.overallScore;
  if (scoreDelta <= -SCORE_DROP) out.push({ kind: 'sudden_drop', pluginId: cur.pluginId, detail: `Score fell ${Math.abs(Math.round(scoreDelta))} pts`, delta: Math.round(scoreDelta), at });
  if (scoreDelta >= SCORE_JUMP) out.push({ kind: 'sudden_improvement', pluginId: cur.pluginId, detail: `Score rose ${Math.round(scoreDelta)} pts`, delta: Math.round(scoreDelta), at });

  if (prev.confidence > 0 && cur.confidence <= prev.confidence - CONFIDENCE_COLLAPSE) {
    out.push({ kind: 'confidence_collapse', pluginId: cur.pluginId, detail: `Confidence fell from ${Math.round(prev.confidence * 100)}% to ${Math.round(cur.confidence * 100)}%`, at });
  }

  // Module regression: a module that was scored and dropped ≥ SCORE_DROP.
  for (const m of cur.moduleSummaries) {
    const pm = prev.moduleSummaries.find((x) => x.key === m.key);
    if (pm && typeof pm.score === 'number' && typeof m.score === 'number' && m.score <= pm.score - SCORE_DROP) {
      out.push({ kind: 'module_regression', pluginId: cur.pluginId, detail: `Module ${m.key} fell ${pm.score - m.score} pts`, delta: m.score - pm.score, at });
    }
  }

  const prevRecs = prev.recommendationIds.length; const curRecs = cur.recommendationIds.length;
  if (curRecs >= 4 && prevRecs > 0 && curRecs >= prevRecs * REC_EXPLOSION) {
    out.push({ kind: 'recommendation_explosion', pluginId: cur.pluginId, detail: `Recommendations rose ${prevRecs} → ${curRecs}`, delta: curRecs - prevRecs, at });
  }

  const prevImpact = prev.businessImpact.topDimensions.length; const curImpact = cur.businessImpact.topDimensions.length;
  if (curImpact > prevImpact) out.push({ kind: 'business_impact_spike', pluginId: cur.pluginId, detail: `Business-impact dimensions widened ${prevImpact} → ${curImpact}`, at });

  if (!prev.freshness.stale && cur.freshness.stale) out.push({ kind: 'freshness_anomaly', pluginId: cur.pluginId, detail: 'Intelligence became stale', at });

  return out;
}

/** Detect anomalies across every plugin in a company timeline (grouped by pluginId). */
export function detectTimelineAnomalies(timeline: HistoricalSnapshot[]): Anomaly[] {
  const byPlugin = new Map<string, HistoricalSnapshot[]>();
  for (const r of timeline) { const a = byPlugin.get(r.pluginId) ?? []; a.push(r); byPlugin.set(r.pluginId, a); }
  return [...byPlugin.values()].flatMap((rows) => detectAnomalies(rows.slice().sort((a, b) => a.takenAt.localeCompare(b.takenAt))));
}
