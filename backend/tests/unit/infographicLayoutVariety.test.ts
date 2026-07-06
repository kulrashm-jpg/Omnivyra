import { pickVariedInfographicLayout } from '../../services/creatorAssetRenderer';

describe('infographic layout variety — different format per topic', () => {
  it('matches the layout to the content when the topic implies one', () => {
    expect(pickVariedInfographicLayout('LinkedIn vs Facebook for B2B')).toBe('comparison');
    expect(pickVariedInfographicLayout('How to launch a campaign: step by step')).toBe('process');
    expect(pickVariedInfographicLayout('The roadmap of our brand evolution over time')).toBe('timeline');
    expect(pickVariedInfographicLayout('Brand awareness by the numbers: 40% growth')).toBe('stats');
    expect(pickVariedInfographicLayout('The 5 tiers of marketing maturity')).toBe('hierarchy');
  });

  it('is deterministic — the same topic always renders the same layout', () => {
    const t = 'Deepening understanding of brand awareness';
    expect(pickVariedInfographicLayout(t)).toBe(pickVariedInfographicLayout(t));
  });

  it('varies across different generic topics (not all "framework")', () => {
    const topics = [
      'Deepening understanding of brand awareness',
      'Brand awareness — common pitfalls to avoid',
      'Brand awareness — a real-world example',
      'Building a memorable brand identity',
      'Why consistency drives recall',
      'The psychology of brand trust',
    ];
    const layouts = new Set(topics.map(pickVariedInfographicLayout));
    // A generic set should spread across MULTIPLE layouts, not collapse to one.
    expect(layouts.size).toBeGreaterThan(1);
  });

  it('only ever returns a real engine', () => {
    const valid = new Set(['stats', 'comparison', 'process', 'framework', 'hierarchy', 'timeline']);
    for (let i = 0; i < 50; i += 1) {
      expect(valid.has(pickVariedInfographicLayout(`random topic number ${i} about growth strategy`))).toBe(true);
    }
  });
});
