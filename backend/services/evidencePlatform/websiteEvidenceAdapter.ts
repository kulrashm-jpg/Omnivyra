/**
 * Website Evidence Adapter  (BETA-ARCH-001, Phase 6 adoption helper)
 *
 * Deterministically maps a Website-Intelligence engine's EXISTING output (its `CheckResult[]` + the
 * already-computed aggregate score + freshness) into canonical `Evidence[]`. This is a pure READ over
 * values the engine already produced — it performs NO scoring and NO recalculation, so attaching its
 * output as optional metadata cannot change any engine score, report, or API.
 *
 * Timestamps come from the engine's freshness (no clock access) → deterministic.
 */
import type { CheckResult } from '../platformIntelligence/confidence';
import { createEvidence, type Evidence, type CanonicalFreshness } from './evidenceModel';
import { buildProvenance } from './provenance';
// BETA-ENGINE-001: the optional aggregate confidence is now evidence-derived via the canonical engine.
import { computeConfidence } from './confidenceEngine';

const isEvaluableCheck = (c: CheckResult): boolean =>
  c.status !== 'not_evaluable' && typeof c.score === 'number' && Number.isFinite(c.score);

export function buildWebsiteEngineEvidence(params: {
  engineId: string;
  version: string;
  sourceSystem: string;
  origin: string;
  collector?: string;
  checks: CheckResult[];
  aggregate: { key: string; label: string; score: number | null; confidence?: number | null };
  freshness?: CanonicalFreshness | null;
}): Evidence[] {
  const ts = params.freshness?.lastEvaluatedAt ?? null;
  const prov = (steps: { op: string; detail?: string }[] = []) =>
    buildProvenance({
      origin: params.origin,
      collector: params.collector ?? null,
      engine: params.engineId,
      version: params.version,
      timestamp: ts,
      calculationSteps: steps,
    });

  const checkEvidence: Evidence[] = (params.checks ?? []).map((c) => {
    if (isEvaluableCheck(c)) {
      const score = Math.round(c.score as number);
      return createEvidence({
        engineId: params.engineId,
        key: c.key,
        value: score,
        maturity: 'MEASURED',
        sourceSystem: params.sourceSystem,
        sourceType: 'first_party',
        measurementType: 'score',
        observationType: 'snapshot',
        normalizedValue: score,
        unit: 'score_0_100',
        observedAt: ts,
        collectedAt: ts,
        freshness: params.freshness ?? null,
        provenance: prov(),
        validationStatus: 'validated',
        metadata: { label: c.label, status: c.status, detail: c.detail ?? null },
      });
    }
    return createEvidence({
      engineId: params.engineId,
      key: c.key,
      value: null,
      maturity: 'NOT_EVALUABLE',
      sourceSystem: params.sourceSystem,
      sourceType: 'first_party',
      observationType: 'snapshot',
      unit: 'score_0_100',
      provenance: prov(),
      validationStatus: 'not_applicable',
      metadata: { label: c.label, status: c.status, detail: c.detail ?? null },
    });
  });

  const measuredCount = checkEvidence.filter((e) => e.maturity === 'MEASURED').length;
  const notEvaluableCount = checkEvidence.length - measuredCount;
  // BETA-ENGINE-001: evidence-derived canonical confidence for the OPTIONAL metadata only.
  // `params.aggregate.confidence` is the engine's own coverage (evaluable/total) and is NOT modified;
  // the canonical engine blends it with sample size, freshness, maturity and stability into an
  // explainable readout that no score or report consumes.
  const canonicalConfidence = computeConfidence({
    coverage: params.aggregate.confidence,
    sampleSize: measuredCount,
    dataAgeHours: params.freshness?.dataAgeHours ?? null,
    maturity: params.aggregate.score == null ? 'UNAVAILABLE' : 'CALCULATED',
    calculationStability: 1,
    validation: params.aggregate.score != null,
    missingMeasurements: notEvaluableCount,
    unavailableMeasurements: notEvaluableCount,
    evidenceCount: measuredCount,
  });
  const aggregateEvidence = createEvidence({
    engineId: params.engineId,
    key: params.aggregate.key,
    value: params.aggregate.score,
    maturity: params.aggregate.score == null ? 'UNAVAILABLE' : 'CALCULATED',
    sourceSystem: params.sourceSystem,
    sourceType: 'derived',
    measurementType: 'aggregate',
    observationType: 'snapshot',
    normalizedValue: params.aggregate.score,
    unit: 'score_0_100',
    observedAt: ts,
    collectedAt: ts,
    freshness: params.freshness ?? null,
    confidence: canonicalConfidence,
    provenance: prov([{ op: 'aggregate', detail: 'mean(evaluable checks)' }, { op: 'clamp', detail: '0..100' }]),
    evidenceCount: measuredCount,
    validationStatus: params.aggregate.score == null ? 'not_applicable' : 'validated',
    calculationPath: ['crawl_checks', 'evaluable_checks', 'mean', 'clamp'],
    dependencies: checkEvidence.filter((e) => e.maturity === 'MEASURED').map((e) => e.id),
  });

  return [aggregateEvidence, ...checkEvidence];
}
