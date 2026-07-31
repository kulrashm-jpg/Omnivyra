/**
 * COMPETITOR-TAXONOMY-P2-CALIBRATION-001 — regression lock for the calibration audit.
 *
 * Pins the evidence behind the V2 weight profile: the deterministic optimizer reproduces V2,
 * V2 preserves perfect classification on the 44-case cross-industry set while improving
 * decision margins over V1, and every signal is stable under ±10%/±20% perturbation. This is
 * a shadow-model calibration only — no promotion, no deployment.
 */

import { CALIBRATION_CASES } from '../../services/competitor/qualification/competitorQualificationCalibration';
import { EXTENDED_CALIBRATION_CASES } from '../../services/competitor/qualification/competitorCalibrationDataset';
import {
  MULTISIGNAL_WEIGHT_PROFILE,
  MULTISIGNAL_WEIGHT_PROFILE_V1,
  MULTISIGNAL_WEIGHT_PROFILE_V2,
} from '../../services/competitor/qualification/competitorQualificationModel';
import {
  evaluateProfile,
  signalDiscrimination,
  sensitivitySweep,
  deriveOptimizedProfile,
  decomposeContributions,
  SIGNAL_KEYS,
} from '../../services/competitor/qualification/competitorCalibrationAnalysis';

const ALL = [...CALIBRATION_CASES, ...EXTENDED_CALIBRATION_CASES];

describe('calibration dataset', () => {
  it('spans seen + unseen industries with balanced labels', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(40);
    const pos = ALL.filter((c) => c.expectedCompetitor).length;
    const neg = ALL.length - pos;
    expect(pos).toBeGreaterThanOrEqual(18);
    expect(neg).toBeGreaterThanOrEqual(18);
    expect(ALL.some((c) => c.coverage === 'unseen')).toBe(true);
    expect(ALL.some((c) => c.coverage === 'seen')).toBe(true);
  });
});

describe('deterministic optimizer reproduces the active V2 profile', () => {
  it('derives exactly the shipped V2 weights (no hand-tuning)', () => {
    const derived = deriveOptimizedProfile(ALL);
    expect(derived.weights).toEqual(MULTISIGNAL_WEIGHT_PROFILE_V2.weights);
  });

  it('the active profile is V2 and its weights sum to 1.0', () => {
    expect(MULTISIGNAL_WEIGHT_PROFILE.id).toBe('multisignal-v2');
    const sum = SIGNAL_KEYS.reduce((s, k) => s + MULTISIGNAL_WEIGHT_PROFILE.weights[k], 0);
    expect(Number(sum.toFixed(2))).toBe(1);
  });

  it('keeps taxonomy a bounded prior (≤ 0.10 and not the largest weight)', () => {
    const w = MULTISIGNAL_WEIGHT_PROFILE.weights;
    expect(w.taxonomyPrior).toBeLessThanOrEqual(0.1);
    const maxEvidence = Math.max(
      w.semanticSimilarity, w.productOverlap, w.icpOverlap, w.marketOverlap, w.businessModelSimilarity, w.serpEvidence,
    );
    expect(w.taxonomyPrior).toBeLessThanOrEqual(maxEvidence);
  });
});

describe('signal contribution audit', () => {
  const disc = signalDiscrimination(ALL, MULTISIGNAL_WEIGHT_PROFILE_V1);
  const byKey = Object.fromEntries(disc.map((d) => [d.key, d]));

  it('serpEvidence is non-discriminative when provenance is held constant (the over-weight finding)', () => {
    expect(byKey.serpEvidence.valueDelta).toBe(0);
    // V2 reduces its weight vs V1 accordingly, but floors it (not deleted).
    expect(MULTISIGNAL_WEIGHT_PROFILE_V2.weights.serpEvidence).toBeLessThan(
      MULTISIGNAL_WEIGHT_PROFILE_V1.weights.serpEvidence,
    );
    expect(MULTISIGNAL_WEIGHT_PROFILE_V2.weights.serpEvidence).toBeGreaterThan(0);
  });

  it('marketOverlap is the most weight-efficient discriminator and is up-weighted in V2', () => {
    const efficiencies = disc.filter((d) => d.key !== 'serpEvidence' && d.key !== 'taxonomyPrior');
    const top = efficiencies.reduce((a, b) => (a.efficiency >= b.efficiency ? a : b));
    expect(top.key).toBe('marketOverlap');
    expect(MULTISIGNAL_WEIGHT_PROFILE_V2.weights.marketOverlap).toBeGreaterThan(
      MULTISIGNAL_WEIGHT_PROFILE_V1.weights.marketOverlap,
    );
  });

  it('every evidence signal separates competitors from non-competitors (positive Δ)', () => {
    for (const d of disc.filter((x) => x.key !== 'serpEvidence' && x.key !== 'taxonomyPrior')) {
      expect(d.valueDelta).toBeGreaterThan(0);
    }
  });

  it('decomposition attributes the full score across signals with a dominant set', () => {
    const d = decomposeContributions(ALL.find((c) => c.id === 'x-devtools-true')!);
    const totalContribution = d.contributions.reduce((s, c) => s + c.contribution, 0);
    expect(Math.round(totalContribution)).toBe(d.score);
    expect(d.dominantSignals.length).toBeGreaterThan(0);
  });
});

describe('V2 validation vs V1', () => {
  const v1 = evaluateProfile(ALL, MULTISIGNAL_WEIGHT_PROFILE_V1);
  const v2 = evaluateProfile(ALL, MULTISIGNAL_WEIGHT_PROFILE_V2);

  it('V2 preserves perfect classification (precision/recall/F1 = 1.0, 0 FP, 0 FN)', () => {
    expect(v2.precision).toBe(1);
    expect(v2.recall).toBe(1);
    expect(v2.f1).toBe(1);
    expect(v2.falsePositive).toBe(0);
    expect(v2.falseNegative).toBe(0);
  });

  it('V2 does not regress — and widens — the decision separation gap vs V1', () => {
    expect(v2.separationGap).toBeGreaterThanOrEqual(v1.separationGap);
    expect(v2.separationGap).toBeGreaterThan(0);
    expect(v2.minPositiveMargin).toBeGreaterThanOrEqual(v1.minPositiveMargin);
    expect(v2.negativeHeadroom).toBeGreaterThanOrEqual(v1.negativeHeadroom);
  });
});

describe('sensitivity — no unstable signals', () => {
  it('no weight perturbation of ±10%/±20% flips any decision under the active profile', () => {
    const { stability } = sensitivitySweep(ALL, MULTISIGNAL_WEIGHT_PROFILE);
    for (const s of stability) {
      expect(s.totalFlips).toBe(0);
      expect(s.stable).toBe(true);
    }
  });

  it('the active profile stays perfectly accurate at every perturbation point', () => {
    const { points } = sensitivitySweep(ALL, MULTISIGNAL_WEIGHT_PROFILE);
    for (const p of points) expect(p.accuracy).toBe(1);
  });
});
