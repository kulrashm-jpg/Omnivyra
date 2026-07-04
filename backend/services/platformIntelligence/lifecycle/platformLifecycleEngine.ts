/**
 * Platform lifecycle engine (Phase 40). Synthesises "what changed / why / what next" per plugin
 * from persisted history only. Reuses the change engine, root-cause engine and the registry.
 * No plugin execution, no new recommendations (responses reference the plugin's own latest ids).
 */
import { getPlugins } from '../registry';
import type { HistoricalSnapshot } from '../history/platformSnapshotTypes';
import { detectChangesForHistory, type Change } from './platformChangeEngine';
import { analyzeRootCause, type RootCause } from './platformRootCauseEngine';

export type Urgency = 'immediate' | 'soon' | 'monitor' | 'none';

export interface LifecycleRecord {
  pluginId: string;
  whatChanged: string[];
  why: string;
  impact: string[];
  priority: number; // higher = more urgent
  urgency: Urgency;
  recommendedResponse: string[];
  businessOwner: string;
  expectedOutcome: string;
  recoveryEstimate: string;
  riskEstimate: string;
  dependencies: string[];
}

export interface LifecycleReport {
  records: LifecycleRecord[]; // priority desc
  rootCause: RootCause;
  changes: Change[];
}

const OWNER_BY_DOMAIN: Record<string, string> = {
  website: 'Marketing / Web', lead: 'Demand Generation', growth: 'Growth', readiness: 'Activation',
  marketing_growth: 'Marketing', commercial: 'Revenue', customer: 'Customer Success',
  revenue_operations: 'RevOps', product_usage: 'Product', partner_channel: 'Partnerships',
  predictive: 'Strategy', unified: 'Executive', decision: 'Executive',
};

export function groupTimelineByPlugin(timeline: HistoricalSnapshot[]): Map<string, HistoricalSnapshot[]> {
  const m = new Map<string, HistoricalSnapshot[]>();
  for (const r of timeline) { const a = m.get(r.pluginId) ?? []; a.push(r); m.set(r.pluginId, a); }
  for (const [, a] of m) a.sort((x, y) => x.takenAt.localeCompare(y.takenAt));
  return m;
}

const ownerFor = (pluginId: string) => OWNER_BY_DOMAIN[getPlugins().find((p) => p.id === pluginId)?.domain ?? ''] ?? 'Operations';

export function buildLifecycle(timeline: HistoricalSnapshot[]): LifecycleReport {
  const byPlugin = groupTimelineByPlugin(timeline);
  const allChanges: Change[] = [];
  const dimsByPlugin: Record<string, string[]> = {};
  const records: LifecycleRecord[] = [];

  for (const [pluginId, rows] of byPlugin) {
    const latest = rows[rows.length - 1]!;
    dimsByPlugin[pluginId] = latest.businessImpact.topDimensions;
    const changes = detectChangesForHistory(rows);
    if (changes.length === 0) continue;
    allChanges.push(...changes);

    const negatives = changes.filter((c) => c.negative);
    const worstDrop = Math.min(0, ...changes.filter((c) => typeof c.delta === 'number').map((c) => c.delta!));
    const priority = negatives.reduce((s, c) => s + (typeof c.delta === 'number' ? Math.abs(c.delta) : 12), 0);
    const urgency: Urgency = priority === 0 ? (changes.length ? 'monitor' : 'none') : priority >= 25 ? 'immediate' : priority >= 10 ? 'soon' : 'monitor';

    records.push({
      pluginId,
      whatChanged: changes.map((c) => c.detail),
      why: negatives.length ? `${negatives[0]!.detail} (primary negative change)` : 'Improving — positive movement only',
      impact: latest.businessImpact.topDimensions,
      priority,
      urgency,
      recommendedResponse: latest.recommendationIds, // reuse plugin's own recommendations
      businessOwner: ownerFor(pluginId),
      expectedOutcome: negatives.length ? 'Address primary cause to restore prior score' : 'Sustain current trajectory',
      recoveryEstimate: worstDrop <= -20 ? '2–3 snapshot cycles' : worstDrop < 0 ? '1–2 snapshot cycles' : 'n/a',
      riskEstimate: worstDrop <= -20 ? 'high' : worstDrop <= -8 ? 'medium' : 'low',
      dependencies: getPlugins().find((p) => p.id === pluginId)?.dependencies ?? [],
    });
  }

  records.sort((a, b) => b.priority - a.priority);
  return { records, rootCause: analyzeRootCause(allChanges, dimsByPlugin), changes: allChanges };
}
