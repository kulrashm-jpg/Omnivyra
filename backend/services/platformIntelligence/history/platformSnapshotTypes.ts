/**
 * Historical Intelligence snapshot model (Phase 37). One snapshot = one company, one plugin,
 * one point in time. Persists ONLY canonical plugin outputs (never source data). Pure data
 * shape — no logic, no framework dependency beyond the composed PluginSnapshot it mirrors.
 */
export interface HistoricalModuleSummary { key: string; score: number | null; status: string }

export interface HistoricalSnapshot {
  companyId: string;
  takenAt: string; // ISO — the caller-provided point in time (deterministic, not Date.now inside logic)
  pluginId: string;
  overallScore: number;
  health: string;
  confidence: number;
  freshness: { lastEvaluatedAt: string | null; stale: boolean };
  maturity: number | null; // from the plugin's *maturity module (0..100), or null if it has none
  businessImpact: { topDimensions: string[]; summary: string };
  recommendationIds: string[];
  moduleSummaries: HistoricalModuleSummary[];
  metadata?: Record<string, unknown>;
}
