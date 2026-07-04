/**
 * Platform alert engine (Phase 40). Deterministic alert levels from the latest changes per
 * plugin. Suppresses duplicates (same kind+plugin) and resolved alerts (a negative alert is
 * dropped when the same plugin's latest step also resolved it). History only.
 */
import type { HistoricalSnapshot } from '../history/platformSnapshotTypes';
import { detectChangesForHistory, type Change, type ChangeKind } from './platformChangeEngine';
import { groupTimelineByPlugin } from './platformLifecycleEngine';

export type AlertLevel = 'critical' | 'high' | 'medium' | 'low' | 'informational';

export interface Alert {
  level: AlertLevel;
  kind: ChangeKind;
  pluginId: string;
  message: string;
  at: string;
}

const LEVEL_RANK: Record<AlertLevel, number> = { critical: 4, high: 3, medium: 2, low: 1, informational: 0 };

function levelFor(c: Change): AlertLevel {
  switch (c.kind) {
    case 'new_issue': return (typeof c.delta === 'number' ? c.delta : 0) <= -20 ? 'critical' : 'high';
    case 'score_decrease': return c.delta! <= -20 ? 'critical' : c.delta! <= -8 ? 'high' : 'medium';
    case 'confidence_decrease': return 'high';
    case 'module_degradation': return 'medium';
    case 'business_impact_decrease': return 'medium';
    case 'freshness_change': return c.detail.includes('stale') ? 'medium' : 'informational';
    case 'recommendation_added': return 'low';
    case 'resolved_issue': case 'score_increase': case 'confidence_increase': case 'module_activation': case 'recommendation_removed': case 'business_impact_increase': return 'informational';
    default: return 'low';
  }
}

/** Alerts for one plugin's history (latest transition). */
export function alertsForHistory(rows: HistoricalSnapshot[]): Alert[] {
  const changes = detectChangesForHistory(rows);
  // Resolved-suppression: if the latest step resolved the issue / improved health, drop negative alerts.
  const resolved = changes.some((c) => c.kind === 'resolved_issue');
  const raw = changes
    .filter((c) => !(resolved && c.negative))
    .map((c) => ({ level: levelFor(c), kind: c.kind, pluginId: c.pluginId, message: c.detail, at: c.at } as Alert));
  // Dedupe by kind+plugin, keep highest level.
  const byKey = new Map<string, Alert>();
  for (const a of raw) {
    const k = `${a.kind}|${a.pluginId}`;
    const ex = byKey.get(k);
    if (!ex || LEVEL_RANK[a.level] > LEVEL_RANK[ex.level]) byKey.set(k, a);
  }
  return [...byKey.values()];
}

/** Alerts across a company timeline, sorted critical → informational. */
export function generateAlerts(timeline: HistoricalSnapshot[]): Alert[] {
  const out: Alert[] = [];
  for (const [, rows] of groupTimelineByPlugin(timeline)) out.push(...alertsForHistory(rows));
  return out.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
}
