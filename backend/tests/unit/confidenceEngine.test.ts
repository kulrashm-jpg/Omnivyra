import {
  computeConfidence, CONFIDENCE_WEIGHTS, MATURITY_WEIGHT, SAMPLE_SATURATION,
} from '../../services/evidencePlatform/confidenceEngine';

describe('Canonical Confidence Engine', () => {
  it('is deterministic — identical factors yield identical output', () => {
    const f = { coverage: 0.6, sampleSize: 8, dataAgeHours: 24, maturity: 'MEASURED' as const, calculationStability: 1 };
    expect(computeConfidence(f)).toEqual(computeConfidence(f));
  });

  it('is explainable — the score equals the sum of factor contributions', () => {
    const r = computeConfidence({ coverage: 0.5, completeness: 0.8, maturity: 'MEASURED', sampleSize: 6, calculationStability: 1 });
    const summed = Math.round(r.breakdown.reduce((s, b) => s + b.value * b.weight, 0) * 100) / 100;
    expect(r.confidenceScore).toBe(summed);
    // weights renormalize over provided factors → sum of applied weights ≈ 1
    const wsum = Math.round(r.breakdown.reduce((s, b) => s + b.weight, 0) * 100) / 100;
    expect(wsum).toBeCloseTo(1, 1);
  });

  it('reflects only the factors provided (renormalization)', () => {
    // coverage-only → score should equal coverage (single factor gets weight 1)
    const r = computeConfidence({ coverage: 0.72 });
    expect(r.confidenceScore).toBe(0.72);
    expect(r.breakdown).toHaveLength(1);
    expect(r.breakdown[0].weight).toBe(1);
  });

  it('weights stronger maturity higher than weaker maturity', () => {
    const strong = computeConfidence({ coverage: 0.8, maturity: 'MEASURED' });
    const weak = computeConfidence({ coverage: 0.8, maturity: 'INFERRED' });
    expect(strong.confidenceScore).toBeGreaterThan(weak.confidenceScore);
    expect(MATURITY_WEIGHT.MEASURED).toBeGreaterThan(MATURITY_WEIGHT.INFERRED);
  });

  it('emits deterministic reason codes', () => {
    const r = computeConfidence({ coverage: 0.2, dataAgeHours: 14 * 24, sampleSize: 1, maturity: 'INFERRED', validation: false, missingMeasurements: 3 });
    expect(r.reasonCodes).toContain('LOW_COVERAGE');
    expect(r.reasonCodes).toContain('STALE_EVIDENCE');
    expect(r.reasonCodes).toContain('SMALL_SAMPLE');
    expect(r.reasonCodes).toContain('UNVALIDATED');
    expect(r.reasonCodes).toContain('LOW_MATURITY:INFERRED');
    expect(r.reasonCodes).toContain('MISSING_MEASUREMENTS:3');
    const strong = computeConfidence({ coverage: 0.9, maturity: 'MEASURED', sampleSize: 12, calculationStability: 1 });
    expect(strong.reasonCodes).toContain('HIGH_COVERAGE');
    expect(strong.reasonCodes).toContain('STRONG_EVIDENCE');
  });

  it('bands map deterministically and empty input is honest', () => {
    expect(computeConfidence({ coverage: 0.9, maturity: 'MEASURED', calculationStability: 1 }).confidenceBand).toBe('high');
    expect(computeConfidence({ coverage: 0.5 }).confidenceBand).toBe('medium');
    expect(computeConfidence({ coverage: 0.1 }).confidenceBand).toBe('low');
    const empty = computeConfidence({});
    expect(empty.confidenceScore).toBe(0);
    expect(empty.confidenceBand).toBe('none');
    expect(empty.reasonCodes).toContain('NO_EVIDENCE_FACTORS');
  });

  it('normalizes sample size against the documented saturation point', () => {
    const full = computeConfidence({ coverage: 1, sampleSize: SAMPLE_SATURATION });
    const half = computeConfidence({ coverage: 1, sampleSize: SAMPLE_SATURATION / 2 });
    const sFull = full.breakdown.find((b) => b.factor === 'sampleSize')!;
    const sHalf = half.breakdown.find((b) => b.factor === 'sampleSize')!;
    expect(sFull.value).toBe(1);
    expect(sHalf.value).toBe(0.5);
    expect(CONFIDENCE_WEIGHTS.coverage).toBeGreaterThan(CONFIDENCE_WEIGHTS.calculationStability);
  });
});
