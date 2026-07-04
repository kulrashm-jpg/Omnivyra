import { deriveDecisionConfidence, decisionConfidenceExplainability } from '../../services/evidencePlatform';

describe('Decision Confidence Adapter (BETA-ENGINE-002)', () => {
  it('is deterministic', () => {
    const ev = { maturity: 'MEASURED' as const, sampleSize: 40, dataPresent: true };
    expect(deriveDecisionConfidence(ev)).toEqual(deriveDecisionConfidence(ev));
  });

  it('rises with sample size (more evidence → higher confidence)', () => {
    const small = deriveDecisionConfidence({ maturity: 'MEASURED', sampleSize: 2, dataPresent: true });
    const large = deriveDecisionConfidence({ maturity: 'MEASURED', sampleSize: 40, dataPresent: true });
    expect(large.confidenceScore).toBeGreaterThan(small.confidenceScore);
    expect(small.reasonCodes).toContain('SMALL_SAMPLE');
  });

  it('measured evidence outranks inferred evidence at equal sample', () => {
    const measured = deriveDecisionConfidence({ maturity: 'MEASURED', sampleSize: 40, dataPresent: true });
    const inferred = deriveDecisionConfidence({ maturity: 'INFERRED', sampleSize: 40, dataPresent: true });
    expect(measured.confidenceScore).toBeGreaterThan(inferred.confidenceScore);
    // this is the executive-behaviour win: inferred authority is correctly less trusted than measured analytics
  });

  it('low completeness (many null values) lowers confidence', () => {
    const complete = deriveDecisionConfidence({ maturity: 'INFERRED', sampleSize: 40, completeness: 1, dataPresent: true });
    const sparse = deriveDecisionConfidence({ maturity: 'INFERRED', sampleSize: 40, completeness: 0.1, dataPresent: true });
    expect(complete.confidenceScore).toBeGreaterThan(sparse.confidenceScore);
  });

  it('exposes a full explainability block (no opaque confidence)', () => {
    const readout = deriveDecisionConfidence({ maturity: 'INFERRED', sampleSize: 30, completeness: 0.4, dataPresent: true });
    const explain = decisionConfidenceExplainability(readout);
    expect(typeof explain.score).toBe('number');
    expect(explain.band).toBeDefined();
    expect(explain.maturity).toBe('INFERRED');
    expect(Array.isArray(explain.reason_codes)).toBe(true);
    expect(explain.factors.length).toBeGreaterThan(0);
    // breakdown must reconstruct the score
    const summed = Math.round(explain.factors.reduce((s, f) => s + f.value * f.weight, 0) * 100) / 100;
    expect(explain.score).toBe(summed);
  });
});
