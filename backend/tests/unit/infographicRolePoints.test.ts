import { validateRoleResponse, promptSchemaFor } from '../../services/creator/infographicSemanticContract';

describe('Infographic role contract — topic-specific bullets via points', () => {
  it('schema now requests points for content roles', () => {
    expect(promptSchemaFor('framework', 2)).toContain('points');
    expect(promptSchemaFor('stats', 3)).toContain('points');
  });

  it('maps AI-supplied points → bullets (topic-specific preserved)', () => {
    const parsed = {
      headline: 'Engagement',
      cta: 'Learn more',
      pillars: [
        { pillarName: 'Consistency', pillarExplanation: 'Show up on a cadence.', points: ['Post 3x/week', 'Reuse top performers', 'Batch on Mondays'] },
        { pillarName: 'Trust', pillarExplanation: 'Earn it with proof.', points: ['Cite real numbers', 'Show customer logos'] },
      ],
    };
    const v = validateRoleResponse('framework', parsed, 2);
    expect(v.ok).toBe(true);
    expect(v.result?.sections[0].bullets).toEqual(['Post 3x/week', 'Reuse top performers', 'Batch on Mondays']);
    expect(v.result?.sections[1].bullets).toEqual(['Cite real numbers', 'Show customer logos']);
  });

  it('accepts a response that omits points (optional — composer backfills)', () => {
    const parsed = {
      headline: 'Engagement',
      cta: 'Learn more',
      pillars: [
        { pillarName: 'Consistency', pillarExplanation: 'Show up on a cadence.' },
        { pillarName: 'Trust', pillarExplanation: 'Earn it with proof.' },
      ],
    };
    const v = validateRoleResponse('framework', parsed, 2);
    expect(v.ok).toBe(true);
    expect(v.result?.sections[0].bullets).toEqual([]); // absent → empty, backfilled later
  });

  it('rejects malformed points (present but not string[])', () => {
    const parsed = {
      headline: 'X', cta: 'Y',
      pillars: [{ pillarName: 'A', pillarExplanation: 'B', points: 'not an array' }, { pillarName: 'C', pillarExplanation: 'D' }],
    };
    expect(validateRoleResponse('framework', parsed, 2).ok).toBe(false);
  });
});
