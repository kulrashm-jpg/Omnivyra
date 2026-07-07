/**
 * Infographic layout fidelity (item 3b/3c). The layout ENGINE should follow the CONTENT, not
 * a template's hardcoded aesthetic or an arbitrary topic hash:
 *   - contentImpliedInfographicLayout: strong keyword → engine, else null (safe to override an
 *     aesthetic template's layout only on a real content signal).
 *   - pickVariedInfographicLayout: content engine first, deterministic rotation only when no cue.
 */
import { contentImpliedInfographicLayout, pickVariedInfographicLayout } from '../../services/creatorAssetRenderer';

describe('contentImpliedInfographicLayout — strong content→engine signal', () => {
  it('maps clear structural cues to the right engine', () => {
    expect(contentImpliedInfographicLayout('Manual routing vs automated routing')).toBe('comparison');
    expect(contentImpliedInfographicLayout('5 steps to onboard a new customer')).toBe('process');
    expect(contentImpliedInfographicLayout('Our 2026 product roadmap')).toBe('timeline');
    expect(contentImpliedInfographicLayout('The maturity model: tiers of adoption')).toBe('hierarchy');
    expect(contentImpliedInfographicLayout('Growth by the numbers: 92% faster')).toBe('stats');
  });

  it('returns null when there is no strong structural cue (template/hash decides)', () => {
    expect(contentImpliedInfographicLayout('Our company overview')).toBeNull();
    expect(contentImpliedInfographicLayout('')).toBeNull();
  });
});

describe('pickVariedInfographicLayout — content-first, deterministic fallback', () => {
  it('prefers the content-implied engine over the hash', () => {
    expect(pickVariedInfographicLayout('A timeline of our journey')).toBe('timeline');
    expect(pickVariedInfographicLayout('Pros and cons of each plan')).toBe('comparison');
  });

  it('falls back to a deterministic, valid engine for generic topics', () => {
    const valid = ['stats', 'framework', 'process', 'timeline', 'hierarchy', 'comparison'];
    const a = pickVariedInfographicLayout('Company overview');
    const b = pickVariedInfographicLayout('Company overview');
    expect(a).toBe(b); // deterministic (same topic → same engine)
    expect(valid).toContain(a);
    // Different generic topics can land on different engines (variety, not always 'framework').
    const topics = ['alpha brief', 'beta notes', 'gamma update', 'delta memo', 'epsilon recap'];
    const engines = new Set(topics.map(pickVariedInfographicLayout));
    expect(engines.size).toBeGreaterThan(1);
  });
});
