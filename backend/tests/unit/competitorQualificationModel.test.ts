/**
 * COMPETITOR-TAXONOMY-P1/P2 — validation of the multi-signal qualification model.
 *
 * Demonstrates the four mandated validation outcomes:
 *   1. Unknown (unseen) industries qualify correctly.
 *   2. Existing supported industries retain accuracy.
 *   3. No increase in false positives (vs the live taxonomy gate).
 *   4. Explainability preserved.
 * Plus: taxonomy demoted to a bounded prior, and the shadow flag defaults OFF (byte-identical).
 */

import {
  evaluateMultiSignalQualification,
  aggregateQualification,
  MULTISIGNAL_WEIGHT_PROFILE,
} from '../../services/competitor/qualification/competitorQualificationModel';
import { extractQualificationSignals } from '../../services/competitor/qualification/competitorSignalExtraction';
import {
  runCalibration,
  CALIBRATION_CASES,
} from '../../services/competitor/qualification/competitorQualificationCalibration';
import {
  competitorMultiSignalShadowEnabled,
  buildShadowComparison,
} from '../../services/competitor/qualification/competitorQualificationShadow';
import { classifyCategoryCoverage } from '../../services/competitorTaxonomy';

describe('COMPETITOR-TAXONOMY-P2 — taxonomy coverage detection', () => {
  it('flags known industries as in coverage and unseen industries as out of coverage', () => {
    expect(classifyCategoryCoverage('mental_wellness_ai', 'anxiety and stress support')).toBe('in_coverage');
    expect(classifyCategoryCoverage(null, 'AI content marketing and SEO copywriting')).toBe('in_coverage');
    // Unseen industries the taxonomy has no vocabulary for:
    expect(classifyCategoryCoverage(null, 'freight logistics visibility and shipment tracking')).toBe('out_of_coverage');
    expect(classifyCategoryCoverage(null, 'contract lifecycle management for legal teams')).toBe('out_of_coverage');
    expect(classifyCategoryCoverage(null, 'precision agriculture crop yield analytics')).toBe('out_of_coverage');
  });
});

describe('COMPETITOR-TAXONOMY — calibration across seen + unseen industries', () => {
  const result = runCalibration();

  it('(1) unknown/unseen industries qualify correctly: perfect recall + precision on unseen set', () => {
    expect(result.multiSignalUnseen.recall).toBe(1); // every true unseen competitor qualified
    expect(result.multiSignalUnseen.falsePositive).toBe(0); // no unseen non-competitor qualified
  });

  it('(2) existing supported industries retain accuracy', () => {
    expect(result.multiSignalSeen.recall).toBe(1);
    expect(result.multiSignalSeen.falsePositive).toBe(0);
  });

  it('(3) no increase in false positives vs the live taxonomy gate', () => {
    // Multi-signal never produces MORE false positives than the taxonomy gate.
    expect(result.multiSignal.falsePositive).toBeLessThanOrEqual(result.taxonomyBaseline.falsePositive);
    // And it strictly reduces them: the taxonomy gate leaks a functional-affinity false
    // positive (e.g. an AI companion for a wellness product) that the multi-signal model rejects.
    expect(result.taxonomyBaseline.falsePositive).toBeGreaterThan(0);
    expect(result.multiSignal.falsePositive).toBe(0);
  });

  it('the taxonomy gate suppresses ALL unseen-industry competitors; multi-signal recovers them', () => {
    // Live P0 abstention returns `unknown` for unseen industries; affinity(unknown, …) is
    // never same/functional, so the gate suppresses every genuine unseen-industry competitor.
    expect(result.taxonomyBaselineUnseen.recall).toBe(0);
    expect(result.taxonomyBaselineUnseen.falseNegative).toBeGreaterThan(0);
    // The multi-signal model qualifies them on evidence.
    expect(result.multiSignalUnseen.recall).toBe(1);
  });

  it('overall multi-signal accuracy is perfect on the representative set and beats the taxonomy gate', () => {
    expect(result.multiSignal.accuracy).toBe(1);
    expect(result.multiSignal.accuracy).toBeGreaterThan(result.taxonomyBaseline.accuracy);
  });
});

describe('COMPETITOR-TAXONOMY-P2 — taxonomy is a bounded prior, not the decision-maker', () => {
  it('taxonomy abstains (effective weight 0) for out-of-coverage companies', () => {
    const logistics = CALIBRATION_CASES.find((c) => c.id === 'logistics-true')!;
    const q = evaluateMultiSignalQualification(logistics.candidate, logistics.context);
    expect(q.taxonomyCoverage).toBe('out_of_coverage');
    expect(q.effectiveWeights.taxonomyPrior).toBe(0);
    expect(q.decision).toBe('qualified'); // decided on evidence alone
  });

  it('taxonomy cannot by itself qualify a low-evidence candidate (bounded contribution)', () => {
    // A same-category candidate with essentially no shared evidence must NOT reach qualified
    // on the taxonomy prior alone.
    const context = {
      marketFocus: 'mental wellness AI platform',
      primaryService: 'AI mental wellness chatbot for anxiety and stress',
      targetCustomer: 'individuals seeking emotional wellbeing',
      idealCustomerProfile: null,
      brandPositioning: null,
      geography: null,
      teamSize: null,
      foundedYear: null,
      revenueRange: null,
      businessModel: 'B2C subscription',
      entityArchetype: null,
    };
    const q = evaluateMultiSignalQualification(
      { name: 'ZZZ Unrelated', domain: 'zzz.example', source: 'serp_live', category: 'mental_wellness_ai' },
      context,
    );
    expect(q.affinity).toBe('same');
    expect(q.decision).not.toBe('qualified');
  });
});

describe('COMPETITOR-TAXONOMY — (4) explainability preserved', () => {
  it('every signal carries a value, coverage and human-readable explanation', () => {
    const c = CALIBRATION_CASES.find((x) => x.id === 'wellness-true')!;
    const extracted = extractQualificationSignals(c.candidate, c.context);
    const keys = Object.keys(extracted.signals);
    expect(keys).toHaveLength(7);
    for (const key of keys) {
      const s = extracted.signals[key as keyof typeof extracted.signals];
      expect(s.value).toBeGreaterThanOrEqual(0);
      expect(s.value).toBeLessThanOrEqual(1);
      expect(typeof s.explanation).toBe('string');
      expect(s.explanation.length).toBeGreaterThan(0);
    }
  });

  it('the aggregate explanation names the decision, score, taxonomy coverage and top drivers', () => {
    const c = CALIBRATION_CASES.find((x) => x.id === 'logistics-true')!;
    const q = evaluateMultiSignalQualification(c.candidate, c.context);
    expect(q.explanation).toMatch(/qualified|borderline|unqualified/);
    expect(q.explanation).toMatch(/score \d+/);
    expect(q.explanation).toMatch(/taxonomy/);
    expect(q.weightProfile).toBe(MULTISIGNAL_WEIGHT_PROFILE.id);
  });
});

describe('COMPETITOR-TAXONOMY — determinism', () => {
  it('is deterministic across repeated evaluation', () => {
    const c = CALIBRATION_CASES.find((x) => x.id === 'marketing-true')!;
    const a = evaluateMultiSignalQualification(c.candidate, c.context);
    const b = evaluateMultiSignalQualification(c.candidate, c.context);
    expect(a).toEqual(b);
  });

  it('aggregate is stable when signals are re-extracted', () => {
    const c = CALIBRATION_CASES.find((x) => x.id === 'agritech-true')!;
    const first = aggregateQualification(extractQualificationSignals(c.candidate, c.context));
    const second = aggregateQualification(extractQualificationSignals(c.candidate, c.context));
    expect(first.score).toBe(second.score);
  });
});

describe('COMPETITOR-TAXONOMY-P2 — shadow flag defaults OFF (byte-identical live path)', () => {
  const original = process.env.COMPETITOR_MULTISIGNAL_SHADOW;
  afterEach(() => {
    if (original === undefined) delete process.env.COMPETITOR_MULTISIGNAL_SHADOW;
    else process.env.COMPETITOR_MULTISIGNAL_SHADOW = original;
  });

  it('is disabled unless explicitly enabled', () => {
    delete process.env.COMPETITOR_MULTISIGNAL_SHADOW;
    expect(competitorMultiSignalShadowEnabled()).toBe(false);
    process.env.COMPETITOR_MULTISIGNAL_SHADOW = '0';
    expect(competitorMultiSignalShadowEnabled()).toBe(false);
    process.env.COMPETITOR_MULTISIGNAL_SHADOW = 'false';
    expect(competitorMultiSignalShadowEnabled()).toBe(false);
    process.env.COMPETITOR_MULTISIGNAL_SHADOW = '1';
    expect(competitorMultiSignalShadowEnabled()).toBe(true);
    process.env.COMPETITOR_MULTISIGNAL_SHADOW = 'true';
    expect(competitorMultiSignalShadowEnabled()).toBe(true);
  });

  it('buildShadowComparison classifies live-vs-shadow agreement deterministically', () => {
    const c = CALIBRATION_CASES.find((x) => x.id === 'logistics-true')!;
    const report = buildShadowComparison({
      consideredCandidates: [c.candidate],
      liveKept: [], // simulate live having dropped this unseen-industry true competitor
      context: c.context,
    });
    expect(report.total).toBe(1);
    expect(report.shadowAdds).toBe(1); // shadow would surface what live dropped
    expect(report.outOfCoverage).toBe(1);
  });
});
