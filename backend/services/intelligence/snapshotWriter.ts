// Snapshot writer.
//
// Called after every canonical report build. Constructs the historical record
// bundle from the live canonical report and persists it via the active
// HistoricalStore. Replay-safe: same (company_id, observed_at) writes are
// idempotent at the DB level.

import { randomUUID } from 'crypto';
import type { CanonicalReport, PillarKey } from '../canonicalReport/canonicalReportTypes';
import type {
  EvidenceHistoryRecord,
  PillarHistoryRecord,
  ProviderHistoryRecord,
  RecommendationHistoryRecord,
  ReportSnapshotRecord,
  BenchmarkHistoryRecord,
} from './historicalPersistence';
import {
  classifyRecommendationStatus,
  getHistoricalStore,
} from './historicalPersistence';

export type ScanProfile = ReportSnapshotRecord['scan_profile'];

export type PersistSnapshotInput = {
  companyId: string;
  report: CanonicalReport;
  scanProfile: ScanProfile;
  engineVersion: string;
  providerOutcomes: ProviderHistoryRecord[];
};

export async function persistCanonicalSnapshot(input: PersistSnapshotInput): Promise<{
  observedAt: string;
  written: boolean;
  reason?: string;
}> {
  const store = getHistoricalStore();
  const operational = await store.isOperational();
  if (!operational) {
    return { observedAt: new Date().toISOString(), written: false, reason: 'history-store-not-operational' };
  }

  const observedAt = new Date().toISOString();
  const overall = input.report.authority_overview.overall_score;
  const aiSurface = input.report.ai_surface_presence.score;

  const providersUsed = input.providerOutcomes.filter((p) => p.outcome === 'measured').map((p) => p.provider_id);
  const providersUnavailable = input.providerOutcomes.filter((p) => p.outcome !== 'measured').map((p) => p.provider_id);

  const snapshot: ReportSnapshotRecord = {
    id: randomUUID(),
    company_id: input.companyId,
    observed_at: observedAt,
    authority_score: overall,
    ai_visibility_score: aiSurface,
    maturity: input.report.authority_overview.maturity,
    maturity_stage: input.report.maturity_stage.stage,
    scan_profile: input.scanProfile,
    source_metadata: {
      engine_version: input.engineVersion,
      providers_used: providersUsed,
      providers_unavailable: providersUnavailable,
    },
  };

  const pillars: PillarHistoryRecord[] = input.report.pillars.map((p) => ({
    id: randomUUID(),
    company_id: input.companyId,
    observed_at: observedAt,
    pillar: p.pillar,
    score: p.score,
    primary_signal: p.primary_signal,
  }));

  const providers: ProviderHistoryRecord[] = input.providerOutcomes.map((p) => ({
    ...p,
    id: randomUUID(),
    company_id: input.companyId,
    observed_at: observedAt,
  }));

  // Recommendation lifecycle: classify each current action against its prior row.
  const priorRecs = await store.loadRecommendationHistory({ company_id: input.companyId, limit: 200 });
  const priorByActionId = new Map<string, RecommendationHistoryRecord>();
  for (const rec of priorRecs) {
    if (!priorByActionId.has(rec.action_id)) priorByActionId.set(rec.action_id, rec);
  }
  const currentActionIds = new Set(input.report.action_playbook.actions.map((a) => a.id));
  const recommendations: RecommendationHistoryRecord[] = input.report.action_playbook.actions.map((action) => ({
    id: randomUUID(),
    company_id: input.companyId,
    observed_at: observedAt,
    action_id: action.id,
    title: action.title,
    pillar: action.pillar,
    severity: action.severity,
    leverage_score: action.leverage_score,
    status: classifyRecommendationStatus({
      current: { action_id: action.id, severity: action.severity },
      prior: priorByActionId.get(action.id) ?? null,
    }),
  }));
  // Mark resolved any prior actions that no longer surface.
  for (const [actionId, prior] of priorByActionId.entries()) {
    if (!currentActionIds.has(actionId) && prior.status !== 'resolved') {
      recommendations.push({
        id: randomUUID(),
        company_id: input.companyId,
        observed_at: observedAt,
        action_id: actionId,
        title: prior.title,
        pillar: prior.pillar,
        severity: prior.severity,
        leverage_score: prior.leverage_score,
        status: 'resolved',
      });
    }
  }

  const evidence: EvidenceHistoryRecord[] = [];
  evidence.push({
    id: randomUUID(),
    company_id: input.companyId,
    observed_at: observedAt,
    scope: { kind: 'overall' },
    evidence_count: input.report.evidence_trace.overall.count,
    evidence_sources: [...input.report.evidence_trace.overall.sources],
    signal_summary: input.report.evidence_trace.overall.observations
      .slice(0, 12)
      .map((o) => o.signal),
  });
  for (const [pillar, trace] of Object.entries(input.report.evidence_trace.by_pillar)) {
    if (!trace) continue;
    evidence.push({
      id: randomUUID(),
      company_id: input.companyId,
      observed_at: observedAt,
      scope: { kind: 'pillar', pillar: pillar as PillarKey },
      evidence_count: trace.count,
      evidence_sources: [...trace.sources],
      signal_summary: trace.observations.slice(0, 12).map((o) => o.signal),
    });
  }
  for (const [dimensionKey, trace] of Object.entries(input.report.evidence_trace.by_dimension)) {
    if (!trace) continue;
    evidence.push({
      id: randomUUID(),
      company_id: input.companyId,
      observed_at: observedAt,
      scope: { kind: 'dimension', dimension_key: dimensionKey },
      evidence_count: trace.count,
      evidence_sources: [...trace.sources],
      signal_summary: trace.observations.slice(0, 12).map((o) => o.signal),
    });
  }

  const benchmark: BenchmarkHistoryRecord | null = input.report.benchmark.overlay && input.report.benchmark.state === 'measured'
    ? {
        id: randomUUID(),
        company_id: input.companyId,
        observed_at: observedAt,
        vertical: input.report.benchmark.overlay.vertical,
        size_band: input.report.benchmark.overlay.size_band,
        peer_count: input.report.benchmark.overlay.peer_count ?? 0,
        percentile: input.report.benchmark.overlay.percentile,
        median_snapshot: input.report.benchmark.overlay.median,
      }
    : null;

  await store.writeSnapshot({
    snapshot,
    pillars,
    providers,
    benchmark,
    recommendations,
    evidence,
  });

  return { observedAt, written: true };
}
