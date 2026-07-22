/**
 * Wave 5 (item 6) — unit tests for the explainable prediction engine.
 *
 * Proves: determinism/reproducibility, non-opacity (every score carries ≥1
 * explanation factor), discrimination (strong vs weak predict differently), and
 * fail-safe behavior (bad input never throws, yields a neutral-but-explained
 * prediction).
 */

// The engine imports the service-role client at module load; stub it so the
// test never touches a real DB (predict/opportunity paths never call it).
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

import {
  predict,
  PREDICTION_MODEL_VERSION,
  type PredictInput,
  type LearningPattern,
} from '../../services/content/predictionEngine';

const STRONG: PredictInput = {
  companyId: 'company-1',
  contentType: 'social_post',
  platform: 'instagram',
  objective: 'help marketing teams automate content scheduling to save time',
  text: [
    'How much time does your marketing team lose to manual scheduling?',
    '',
    'We built an automation workflow that schedules content across every channel from one calendar. Teams reclaim hours each week and ship more campaigns.',
    '',
    'Marketing leaders who automate scheduling launch faster and miss fewer slots.',
    '',
    'Try it free and see your first week planned in minutes.',
    '',
    '#marketing #automation #contentstrategy',
  ].join('\n'),
};

const WEAK: PredictInput = {
  companyId: 'company-1',
  contentType: 'social_post',
  platform: 'instagram',
  objective: 'help marketing teams automate content scheduling to save time',
  text: 'stuff stuff stuff.  very very just basically the the thing thing.',
};

const SCORE_KEYS = ['engagementPotential', 'platformSuitability', 'objectiveLikelihood'] as const;

describe('predictionEngine.predict — reproducibility', () => {
  it('is deterministic: same input → identical scores AND explanation', async () => {
    const a = await predict(STRONG);
    const b = await predict(STRONG);
    expect(a).toEqual(b);
    // Byte-identical serialization (no randomness, fixed precision).
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('carries the deterministic model version', async () => {
    const p = await predict(STRONG);
    expect(p.modelVersion).toBe(PREDICTION_MODEL_VERSION);
  });
});

describe('predictionEngine.predict — never opaque', () => {
  it('every score is in 0..1', async () => {
    for (const input of [STRONG, WEAK]) {
      const p = await predict(input);
      for (const key of SCORE_KEYS) {
        expect(p[key]).toBeGreaterThanOrEqual(0);
        expect(p[key]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('every score carries at least one explanation factor', async () => {
    const p = await predict(STRONG);
    for (const key of SCORE_KEYS) {
      const factors = p.explanation.filter((f) => f.factor.startsWith(`${key}:`));
      expect(factors.length).toBeGreaterThanOrEqual(1);
      for (const f of factors) {
        expect(typeof f.evidence).toBe('string');
        expect(f.evidence.length).toBeGreaterThan(0);
        expect(Number.isFinite(f.contribution)).toBe(true);
      }
    }
  });

  it('the score equals the sum of its own explanation contributions (transparent)', async () => {
    const p = await predict(STRONG);
    for (const key of SCORE_KEYS) {
      const sum = p.explanation
        .filter((f) => f.factor.startsWith(`${key}:`))
        .reduce((s, f) => s + f.contribution, 0);
      // Rounding tolerance: contributions are each rounded to 4dp.
      expect(Math.abs(sum - p[key])).toBeLessThan(0.001);
    }
  });
});

describe('predictionEngine.predict — discrimination', () => {
  it('strong content predicts higher engagement than weak content', async () => {
    const strong = await predict(STRONG);
    const weak = await predict(WEAK);
    expect(strong.engagementPotential).toBeGreaterThan(weak.engagementPotential);
  });

  it('surfaces improvement opportunities for weak content, ranked by expected lift', async () => {
    const weak = await predict(WEAK);
    expect(weak.improvementOpportunities.length).toBeGreaterThan(0);
    for (let i = 1; i < weak.improvementOpportunities.length; i += 1) {
      expect(weak.improvementOpportunities[i - 1].expectedLift)
        .toBeGreaterThanOrEqual(weak.improvementOpportunities[i].expectedLift);
    }
  });

  it('a matching historical hook pattern lifts engagement vs no learning data', async () => {
    const intelligence: LearningPattern[] = [
      {
        dimension: 'hook',
        patternKey: 'how much time does your team lose',
        platform: null,
        pattern: { tokens: ['how', 'much', 'time', 'team', 'lose', 'scheduling'] },
        score: 0.95,
        sampleSize: 40,
      },
    ];
    const withLearning = await predict({ ...STRONG, intelligence });
    const withoutLearning = await predict(STRONG);
    expect(withLearning.engagementPotential).toBeGreaterThanOrEqual(withoutLearning.engagementPotential);
    // The learning factor's evidence must name the matched pattern (explainable).
    const factor = withLearning.explanation.find((f) => f.factor === 'engagementPotential:historicalHookMatch');
    expect(factor?.evidence).toMatch(/pattern/i);
  });
});

describe('predictionEngine.predict — fail-safe', () => {
  it('never throws on bad input and returns a valid, explained prediction', async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const badInputs: any[] = [
      undefined,
      null,
      {},
      { companyId: 'c', text: null },
      { companyId: 'c', text: 12345 },
      { companyId: 'c', text: 'ok', scorecard: {} }, // malformed scorecard → catch path
    ];
    /* eslint-enable @typescript-eslint/no-explicit-any */
    for (const bad of badInputs) {
      const p = await predict(bad);
      for (const key of SCORE_KEYS) {
        expect(p[key]).toBeGreaterThanOrEqual(0);
        expect(p[key]).toBeLessThanOrEqual(1);
        // Even the fail-safe floor is explainable.
        expect(p.explanation.some((f) => f.factor.startsWith(`${key}:`))).toBe(true);
      }
      expect(p.modelVersion).toBe(PREDICTION_MODEL_VERSION);
    }
  });

  it('a malformed scorecard yields the neutral 0.5 floor, still explained', async () => {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const p = await predict({ companyId: 'c', text: 'hello world', scorecard: {} as any });
    expect(p.engagementPotential).toBe(0.5);
    expect(p.platformSuitability).toBe(0.5);
    expect(p.objectiveLikelihood).toBe(0.5);
    expect(p.explanation.every((f) => f.evidence.length > 0)).toBe(true);
  });
});
