/**
 * Platform insight engine (Phase 40). Evidence-backed narrative insights derived ONLY from the
 * persisted score series + trend engine. Never invents: every insight cites the exact first/last
 * values, delta and point count. Emits nothing when the trend does not support a statement.
 */
import { getPlugins } from '../registry';
import type { HistoricalSnapshot } from '../history/platformSnapshotTypes';
import { computeTrend } from '../history/platformTrendEngine';
import { groupTimelineByPlugin } from './platformLifecycleEngine';

export interface Insight {
  pluginId: string;
  kind: 'improved' | 'declined' | 'recovered' | 'plateaued';
  text: string;
  evidence: { first: number; last: number; delta: number; points: number };
  confidence: number;
}

const labelFor = (pluginId: string) => getPlugins().find((p) => p.id === pluginId)?.displayName ?? pluginId;

/** Insights for one plugin's score history. Returns at most one insight (the dominant signal). */
export function insightsForHistory(rows: HistoricalSnapshot[]): Insight[] {
  if (rows.length < 2) return []; // insufficient evidence — say nothing
  const series = rows.map((r) => r.overallScore);
  const t = computeTrend(series);
  if (t.first == null || t.last == null || t.delta == null) return [];
  const label = labelFor(rows[0]!.pluginId);
  const evidence = { first: t.first, last: t.last, delta: t.delta, points: t.points };
  const confidence = Math.min(0.9, 0.5 + 0.1 * t.points);
  const base = { pluginId: rows[0]!.pluginId, evidence, confidence };

  if (t.recovery) return [{ ...base, kind: 'recovered', text: `${label} recovered: score returned to ${t.last} after dipping during the window (${t.points} snapshots).` }];
  if (t.improvement) return [{ ...base, kind: 'improved', text: `${label} health improved because score rose ${t.first}→${t.last} (+${t.delta}) over ${t.points} snapshots.` }];
  if (t.regression) return [{ ...base, kind: 'declined', text: `${label} health dropped because score fell ${t.first}→${t.last} (${t.delta}) over ${t.points} snapshots.` }];
  if (t.plateau) return [{ ...base, kind: 'plateaued', text: `${label} plateaued around ${t.last} across the last ${Math.min(3, t.points)} snapshots.` }];
  return [];
}

/** Insights across a company timeline. */
export function generateInsights(timeline: HistoricalSnapshot[]): Insight[] {
  const out: Insight[] = [];
  for (const [, rows] of groupTimelineByPlugin(timeline)) out.push(...insightsForHistory(rows));
  return out;
}
