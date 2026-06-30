/**
 * Durable SnapshotStore (Phase 39). Implements the Phase-37 SnapshotStore interface EXACTLY
 * over `platform_intelligence_snapshots`. Swapped in only via setSnapshotStore() — no
 * interface change, no repository redesign. Fail-open: if the table is absent or a read/write
 * errors, it degrades to a no-op / empty list so nothing breaks before the migration is applied.
 */
import { ownedDbTable } from '../../../db/writeOwner';
import type { SnapshotStore } from './platformSnapshotRepository';
import type { HistoricalSnapshot } from './platformSnapshotTypes';

const TABLE = 'platform_intelligence_snapshots';

const toRow = (s: HistoricalSnapshot) => ({
  company_id: s.companyId, plugin_id: s.pluginId, taken_at: s.takenAt,
  overall_score: s.overallScore, health: s.health, confidence: s.confidence,
  freshness: s.freshness, maturity: s.maturity, business_impact: s.businessImpact,
  recommendation_ids: s.recommendationIds, module_summaries: s.moduleSummaries, metadata: s.metadata ?? {},
});

const fromRow = (r: any): HistoricalSnapshot => ({
  companyId: r.company_id, takenAt: r.taken_at, pluginId: r.plugin_id,
  overallScore: Number(r.overall_score ?? 0), health: r.health, confidence: Number(r.confidence ?? 0),
  freshness: r.freshness ?? { lastEvaluatedAt: null, stale: true }, maturity: r.maturity == null ? null : Number(r.maturity),
  businessImpact: r.business_impact ?? { topDimensions: [], summary: '' },
  recommendationIds: r.recommendation_ids ?? [], moduleSummaries: r.module_summaries ?? [], metadata: r.metadata ?? {},
});

export class SupabaseSnapshotStore implements SnapshotStore {
  async save(rows: HistoricalSnapshot[]): Promise<void> {
    if (!rows.length) return;
    try { await ownedDbTable(TABLE).insert(rows.map(toRow)); } catch { /* fail-open until migration applied */ }
  }

  async list(companyId: string, pluginId?: string): Promise<HistoricalSnapshot[]> {
    try {
      let q = ownedDbTable(TABLE).select('*').eq('company_id', companyId);
      if (pluginId) q = q.eq('plugin_id', pluginId);
      const { data, error } = await q.order('taken_at', { ascending: true }).limit(5000);
      if (error || !data) return [];
      return (data as any[]).map(fromRow);
    } catch {
      return [];
    }
  }
}
