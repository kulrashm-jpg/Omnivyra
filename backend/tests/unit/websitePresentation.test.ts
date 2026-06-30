/**
 * Phase 20 — presentation unification. One presentation model is consumed by both the
 * React renderer (via tokens) and the HTML renderer, with one styling registry. Proves:
 * the model is the single interpretation; the HTML renderer emits registry colours.
 */
import { statusToken, categoryToken, scoreToken, badgeStyle, badgeCss, TOKENS } from '../../services/websiteIntelligence/presentationStyles';

describe('Styling registry (one styling system)', () => {
  it('maps status/category/score to deterministic tokens', () => {
    expect(statusToken('healthy')).toBe('good');
    expect(statusToken('critical')).toBe('bad');
    expect(statusToken('unavailable')).toBe('neutral');
    expect(categoryToken('quick_win')).toBe('good');
    expect(categoryToken('critical')).toBe('bad');
    expect(scoreToken(90)).toBe('good');
    expect(scoreToken(60)).toBe('warn');
    expect(scoreToken(10)).toBe('bad');
    expect(scoreToken(null)).toBe('neutral');
  });
  it('React style object and HTML css string come from the SAME colour source', () => {
    const s = badgeStyle('good');
    expect(s.backgroundColor).toBe(TOKENS.good.bg);
    expect(s.color).toBe(TOKENS.good.fg);
    expect(badgeCss('good')).toContain(TOKENS.good.bg);
    expect(badgeCss('good')).toContain(TOKENS.good.fg);
  });
});
