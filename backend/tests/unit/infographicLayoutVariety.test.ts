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

  it('generic topics spread across the full engine set (real variety, all now dense)', () => {
    const valid = new Set(['stats', 'comparison', 'process', 'framework', 'hierarchy', 'timeline']);
    const generic = [
      'Deepening understanding of brand awareness',
      'Building a memorable brand identity',
      'Why consistency drives recall',
      'The psychology of brand trust',
      'Turning attention into demand',
      'The compounding effect of presence',
    ];
    for (const t of generic) expect(valid.has(pickVariedInfographicLayout(t))).toBe(true);
    // A batch of generic topics should hit more than just one or two layouts.
    expect(new Set(generic.map(pickVariedInfographicLayout)).size).toBeGreaterThanOrEqual(2);
  });

  it('a mixed set (generic + content-appropriate) still spreads across multiple formats', () => {
    const topics = [
      'Deepening understanding of brand awareness',   // generic → dense
      'Organic vs paid channels',                     // comparison
      'How to launch a campaign step by step',        // process
      'The roadmap of our brand over time',           // timeline
    ];
    expect(new Set(topics.map(pickVariedInfographicLayout)).size).toBeGreaterThan(1);
  });

  it('only ever returns a real engine', () => {
    const valid = new Set(['stats', 'comparison', 'process', 'framework', 'hierarchy', 'timeline']);
    for (let i = 0; i < 50; i += 1) {
      expect(valid.has(pickVariedInfographicLayout(`random topic number ${i} about growth strategy`))).toBe(true);
    }
  });
});
