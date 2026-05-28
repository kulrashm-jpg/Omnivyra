/**
 * Phase 11 — Revision governance diagnostics aggregator.
 *
 * In-memory per-process registry accumulating revision-pass samples and
 * emitting trend-aware diagnostics.
 */

import type {
  ApprovalReadinessResult,
  CollaborativeConflictResult,
  DiagnosticTrend,
  EditRiskType,
  EditorialDiffAnalysis,
  HumanAIDriftResult,
  RevisionGovernanceDiagnostics,
} from './longFormRecommendationTypes';

const EDIT_RISK_TYPES: EditRiskType[] = [
  'strategic_narrative_drift', 'factual_degradation', 'terminology_removal',
  'citation_removal', 'operational_simplification', 'icp_erosion',
  'capability_suppression', 'tone_mutation', 'unsupported_addition',
];

interface RevisionSample {
  timestamp: string;
  companyId: string;
  diffAnalyses: EditorialDiffAnalysis[];
  drift: HumanAIDriftResult;
  approval: ApprovalReadinessResult;
  conflicts: CollaborativeConflictResult;
  rolledBack: boolean;
  integrityScoreBefore: number;
  integrityScoreAfter: number;
}

export interface RevisionGovernanceDiagnosticsRegistry {
  record(sample: RevisionSample): void;
  build(companyId?: string, windowSize?: number): RevisionGovernanceDiagnostics;
  clear(companyId?: string): void;
  size(companyId?: string): number;
}

function emptyEditRiskDist(): Record<EditRiskType, number> {
  const d = {} as Record<EditRiskType, number>;
  for (const t of EDIT_RISK_TYPES) d[t] = 0;
  return d;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function trendDirection(first: number, last: number, threshold = 4): DiagnosticTrend {
  if (Math.abs(last - first) < threshold) return 'stable';
  return last > first ? 'improving' : 'degrading';
}

export function createRevisionGovernanceDiagnosticsRegistry(options?: {
  maxSamplesPerCompany?: number;
}): RevisionGovernanceDiagnosticsRegistry {
  const capacity = Math.max(20, options?.maxSamplesPerCompany ?? 200);
  const buckets = new Map<string, RevisionSample[]>();

  function bucket(companyId: string): RevisionSample[] {
    let b = buckets.get(companyId);
    if (!b) { b = []; buckets.set(companyId, b); }
    return b;
  }

  function allSamples(companyId?: string): RevisionSample[] {
    if (companyId) return [...(buckets.get(companyId) ?? [])];
    const out: RevisionSample[] = [];
    buckets.forEach((b) => out.push(...b));
    return out;
  }

  return {
    record(sample) {
      const b = bucket(sample.companyId);
      b.push(sample);
      while (b.length > capacity) b.shift();
    },
    build(companyId, windowSize = 50) {
      const samples = allSamples(companyId).slice(-windowSize);
      const sampleSize = samples.length;
      if (sampleSize === 0) {
        return {
          revisionRiskTrend: 'unknown',
          approvalBottleneckCount: 0,
          driftFrequencyHumanPercent: 0,
          driftFrequencyAiPercent: 0,
          rollbackFrequencyPercent: 0,
          reviewerConflictTrend: 'unknown',
          editRiskDistribution: emptyEditRiskDist(),
          integrityDegradationAfterEditsPercent: 0,
          sampleSize: 0,
        };
      }

      const editRiskDistribution = emptyEditRiskDist();
      let approvalBottleneck = 0;
      let rolledBack = 0;
      let degraded = 0;
      let humanDriftHits = 0;
      let aiDriftHits = 0;

      for (const s of samples) {
        for (const diff of s.diffAnalyses) {
          for (const risk of diff.detectedRisks) editRiskDistribution[risk.type] += 1;
        }
        if (s.approval.approvalState === 'blocked' || s.approval.approvalBlockers.some((b) => b.severity === 'critical')) approvalBottleneck += 1;
        if (s.rolledBack) rolledBack += 1;
        if (s.integrityScoreAfter < s.integrityScoreBefore - 5) degraded += 1;
        if (s.drift.humanDriftIndicators.length > 0) humanDriftHits += 1;
        if (s.drift.aiDriftIndicators.length > 0) aiDriftHits += 1;
      }

      const mid = Math.max(1, Math.floor(samples.length / 2));
      const riskFirst = average(samples.slice(0, mid).flatMap((s) => s.diffAnalyses.map((d) => d.editRiskScore)));
      const riskLast = average(samples.slice(mid).flatMap((s) => s.diffAnalyses.map((d) => d.editRiskScore)));
      const conflictFirst = average(samples.slice(0, mid).map((s) => s.conflicts.conflicts.length));
      const conflictLast = average(samples.slice(mid).map((s) => s.conflicts.conflicts.length));

      return {
        // Rising risk is bad — flip direction so improving=lower risk.
        revisionRiskTrend: trendDirection(riskLast, riskFirst),
        approvalBottleneckCount: approvalBottleneck,
        driftFrequencyHumanPercent: Math.round((humanDriftHits / sampleSize) * 100),
        driftFrequencyAiPercent: Math.round((aiDriftHits / sampleSize) * 100),
        rollbackFrequencyPercent: Math.round((rolledBack / sampleSize) * 100),
        // Rising conflict is bad — flip direction.
        reviewerConflictTrend: trendDirection(conflictLast, conflictFirst),
        editRiskDistribution,
        integrityDegradationAfterEditsPercent: Math.round((degraded / sampleSize) * 100),
        sampleSize,
      };
    },
    clear(companyId) {
      if (!companyId) { buckets.clear(); return; }
      buckets.delete(companyId);
    },
    size(companyId) {
      if (companyId) return buckets.get(companyId)?.length ?? 0;
      let total = 0;
      buckets.forEach((b) => { total += b.length; });
      return total;
    },
  };
}

let _defaultRegistry: RevisionGovernanceDiagnosticsRegistry | null = null;

export function getDefaultRevisionGovernanceDiagnosticsRegistry(): RevisionGovernanceDiagnosticsRegistry {
  if (!_defaultRegistry) _defaultRegistry = createRevisionGovernanceDiagnosticsRegistry();
  return _defaultRegistry;
}

export function setDefaultRevisionGovernanceDiagnosticsRegistry(reg: RevisionGovernanceDiagnosticsRegistry): void {
  _defaultRegistry = reg;
}

export type { RevisionSample };
