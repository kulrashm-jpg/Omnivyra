/**
 * Wave 4 — unit tests for the deterministic Quality Engine.
 */
import { evaluate, type QualityEngineInput } from '../../services/content/qualityEngine';
import { QUALITY_DIMENSIONS } from '../../../lib/content/quality/types';

const STRONG: QualityEngineInput = {
  contentType: 'social_post',
  platform: 'instagram',
  objective: 'help marketing teams automate content scheduling to save time',
  brandContext: 'Omnivyra automation platform for marketing teams',
  originalityScore: 0.9,
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

const WEAK: QualityEngineInput = {
  contentType: 'social_post',
  platform: 'instagram',
  objective: 'help marketing teams automate content scheduling to save time',
  text: 'stuff stuff stuff.  very very just basically the the thing thing.',
};

describe('qualityEngine.evaluate', () => {
  it('always returns all 12 dimensions', () => {
    const card = evaluate(STRONG);
    const keys = Object.keys(card.dimensions).sort();
    expect(keys).toEqual([...QUALITY_DIMENSIONS].sort());
    expect(keys).toHaveLength(12);
  });

  it('every dimension score is in 0..100 with a valid label', () => {
    for (const input of [STRONG, WEAK]) {
      const card = evaluate(input);
      for (const d of QUALITY_DIMENSIONS) {
        const ds = card.dimensions[d];
        expect(ds.score).toBeGreaterThanOrEqual(0);
        expect(ds.score).toBeLessThanOrEqual(100);
        expect(Number.isInteger(ds.score)).toBe(true);
        expect(['poor', 'fair', 'good', 'excellent']).toContain(ds.label);
        expect(Array.isArray(ds.signals)).toBe(true);
      }
    }
  });

  it('overall is an integer in 0..100', () => {
    for (const input of [STRONG, WEAK]) {
      const card = evaluate(input);
      expect(card.overall).toBeGreaterThanOrEqual(0);
      expect(card.overall).toBeLessThanOrEqual(100);
      expect(Number.isInteger(card.overall)).toBe(true);
    }
  });

  it('is deterministic (same input → identical scorecard)', () => {
    expect(evaluate(STRONG)).toEqual(evaluate(STRONG));
    expect(evaluate(WEAK)).toEqual(evaluate(WEAK));
  });

  it('scores strong content higher than weak content', () => {
    expect(evaluate(STRONG).overall).toBeGreaterThan(evaluate(WEAK).overall);
  });

  it('empty text is safe and yields a valid low scorecard', () => {
    const card = evaluate({ contentType: 'social_post', text: '' });
    expect(Object.keys(card.dimensions)).toHaveLength(12);
    expect(card.overall).toBeGreaterThanOrEqual(0);
    expect(card.overall).toBeLessThanOrEqual(100);
    expect(card.overall).toBeLessThan(50);
  });

  it('never throws on malformed input', () => {
    // @ts-expect-error — deliberately malformed
    expect(() => evaluate({})).not.toThrow();
    // @ts-expect-error — deliberately malformed
    expect(() => evaluate({ text: 123, contentType: null })).not.toThrow();
    expect(() => evaluate(undefined as unknown as QualityEngineInput)).not.toThrow();
  });

  it('maps the upstream originality score into the originality dimension', () => {
    const card = evaluate({ ...STRONG, originalityScore: 0.4 });
    expect(card.dimensions.originality.score).toBe(40);
  });

  it('passes evaluatedAt through untouched and never fabricates one', () => {
    const withTs = evaluate({ ...STRONG, evaluatedAt: '2026-07-18T00:00:00.000Z' });
    expect(withTs.evaluatedAt).toBe('2026-07-18T00:00:00.000Z');
    const withoutTs = evaluate(STRONG);
    expect(withoutTs.evaluatedAt).toBeUndefined();
  });

  it('flags objective alignment when content matches the objective', () => {
    const card = evaluate(STRONG);
    expect(card.dimensions.objectiveAlignment.score).toBeGreaterThan(50);
  });
});
