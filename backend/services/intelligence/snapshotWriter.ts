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
import { buildComparabilityIdentity } from './comparabilityIdentity';

export type ScanProfile = ReportSnapshotRecord['scan_profile'];

/**
 * Statuses that already record an absence, so a still-absent action must not
 * append another row on the next run.
 *
 * `no_longer_surfaced` is the one this code writes. `resolved` is here because
 * historical rows carry it: treating it as terminal is what keeps a legacy row
 * from being re-described by today's rules, which would be a retrospective
 * reclassification of data whose provenance is unknown.
 */
const ABSENCE_ALREADY_RECORDED: ReadonlySet<RecommendationHistoryRecord['status']> = new Set<
  RecommendationHistoryRecord['status']
>(['no_longer_surfaced', 'resolved']);

export type PersistSnapshotInput = {
  companyId: string;
  report: CanonicalReport;
  scanProfile: ScanProfile;
  engineVersion: string;
  providerOutcomes: ProviderHistoryRecord[];
  /**
   * The site this run actually measured (`buildCanonicalReport`'s
   * `options.domain`). REQUIRED rather than optional: a snapshot recorded
   * without it can never become a comparison baseline, and silently omitting
   * it is exactly how a domain change becomes a published trend. Pass `null`
   * only when the domain genuinely could not be resolved — the snapshot is
   * still recorded (elapsed time is irrecoverable, so history is never thrown
   * away) but it is reported as non-comparable instead of quietly compared.
   */
  domain: string | null;
};

export type PersistSnapshotResult = {
  observedAt: string;
  written: boolean;
  reason?: string;
  /**
   * BASELINE #1. `true` means the row carries a complete comparability
   * identity and is therefore eligible to be the baseline a later run is
   * measured against — i.e. the comparable-history clock has started.
   * `false` means the row is durable history but can never anchor a delta.
   */
  comparable: boolean;
  comparabilityReason: string | null;
};

export async function persistCanonicalSnapshot(input: PersistSnapshotInput): Promise<PersistSnapshotResult> {
  // Resolved BEFORE anything is written, so the row is stamped with the
  // subject it measured at the moment it measured it. Reconstructing this
  // later is impossible: `company_id` outlives a domain change, which is the
  // whole problem the identity exists to solve.
  const identity = buildComparabilityIdentity({
    companyId: input.companyId,
    domain: input.domain,
    scanProfile: input.scanProfile,
    engineVersion: input.engineVersion,
  });
  const comparabilityReason = identity
    ? null
    : 'Snapshot recorded without a complete comparability identity (company, measured domain, scan profile and engine version must all be known), so it cannot serve as a comparison baseline.';

  const store = getHistoricalStore();
  const operational = await store.isOperational();
  if (!operational) {
    return {
      observedAt: new Date().toISOString(),
      written: false,
      reason: 'history-store-not-operational',
      comparable: false,
      comparabilityReason: 'History store is not operational — nothing was recorded.',
    };
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
      // Stamped only when the identity is complete. Writing a partial or
      // guessed host would be worse than writing nothing: a reader cannot tell
      // a guess from an observation, and the guess would compare equal.
      ...(identity ? { subject_domain: identity.subject_domain } : {}),
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
  // ─── ABSENCE IS NOT RESOLUTION ─────────────────────────────────────────────
  //
  // THE DEFECT. This block wrote `status: 'resolved'` for any prior action
  // missing from the current run. Set membership was the entire basis, so the
  // report recorded that the customer had COMPLETED work whenever an action id
  // stopped appearing. Action ids are built from title text (`<source>:<title>`)
  // and those titles interpolate the measured domain, the discovered competitor
  // name, a query and a keyword -- so the usual causes of disappearance are an
  // identifier change, a surface that was not measured, or a narrower scan
  // profile. None of them is an achievement.
  //
  // There is no completion evidence to consult. The only per-action signal in
  // the system is `recommendation_dismissal`, which is suppression; the
  // collaboration status table that does carry a `completed` value has no
  // production writer, no uniqueness or ordering contract, no tenant identity
  // reachable from here, and is loaded one phase AFTER this write. So `resolved`
  // is no longer emitted at all -- it remains in the union only for historical
  // rows, whose provenance is unknown and which are never rewritten.
  //
  // WHAT IS RECORDED. `no_longer_surfaced`: this identifier stopped appearing,
  // and nothing beyond that.
  //
  // FORWARD-ONLY. A prior row is never read-modified-written; a new row is
  // appended. `ABSENCE_ALREADY_RECORDED` is what stops a permanently-absent
  // action appending an identical row on every later run. Legacy `resolved` is
  // terminal for the same reason, which is also what leaves historical rows
  // untouched.
  for (const [actionId, prior] of priorByActionId.entries()) {
    if (!currentActionIds.has(actionId) && !ABSENCE_ALREADY_RECORDED.has(prior.status)) {
      recommendations.push({
        id: randomUUID(),
        company_id: input.companyId,
        observed_at: observedAt,
        action_id: actionId,
        title: prior.title,
        pillar: prior.pillar,
        severity: prior.severity,
        leverage_score: prior.leverage_score,
        status: 'no_longer_surfaced',
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

  return {
    observedAt,
    written: true,
    comparable: identity != null,
    comparabilityReason,
  };
}
