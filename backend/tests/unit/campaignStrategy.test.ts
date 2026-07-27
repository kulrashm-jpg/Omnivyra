import { recommendStrategy, recommendChannelPlan, DEFAULT_STRATEGY_CONFIG, type AudienceSignal } from '../../../lib/campaign/campaignStrategy';

const sig = (o: Partial<AudienceSignal> = {}): AudienceSignal => ({
  members: 40, avgIntent: 0.75, intentBands: { high: 20, medium: 15, low: 5 }, bySource: { website: 30, community: 10 }, ...o,
});

describe('LC-401 campaign strategy engine', () => {
  it('recommends conversion for high-intent audiences, with evidence + confidence', () => {
    const s = recommendStrategy(sig());
    expect(s.objective.value).toBe('book_meetings');
    expect(s.objective.evidence.length).toBeGreaterThan(0);
    expect(s.objective.confidence).toBeGreaterThan(0);
    expect(s.objective.confidence).toBeLessThanOrEqual(1);
    expect(s.cadence.value.touches).toBe(4);
    expect(s.timing.value).toBe('now');
    expect(s.channelMix.value).toContain('email');
  });

  it('recommends education for low-intent audiences', () => {
    const s = recommendStrategy(sig({ avgIntent: 0.2, intentBands: { high: 0, medium: 5, low: 35 } }));
    expect(s.objective.value).toBe('educate_awareness');
    expect(s.timing.value).toBe('scheduled');
    expect(s.cadence.value.intervalDays).toBe(7);
  });

  it('nurtures medium-intent audiences', () => {
    const s = recommendStrategy(sig({ avgIntent: 0.5, intentBands: { high: 2, medium: 30, low: 8 } }));
    expect(s.objective.value).toBe('nurture_to_meeting');
  });

  it('maps channels from the audience source mix and availability', () => {
    const s = recommendStrategy(sig(), ['email', 'linkedin']); // in_app not available
    expect(s.channelMix.value).toEqual(expect.arrayContaining(['email', 'linkedin']));
    expect(s.channelMix.value).not.toContain('in_app');
  });

  it('produces an evidence-backed channel plan', () => {
    const p = recommendChannelPlan(sig());
    expect(p.bestChannel.value).toBeTruthy();
    expect(p.bestChannel.evidence.length).toBeGreaterThan(0);
    expect(Array.isArray(p.sequence.value)).toBe(true);
    expect(p.sendWindow.value).toBe('business_hours_next_day'); // high intent
  });

  it('is configurable (thresholds not hardcoded)', () => {
    const strict = { ...DEFAULT_STRATEGY_CONFIG, highIntent: 0.95 };
    const s = recommendStrategy(sig({ avgIntent: 0.75, intentBands: { high: 0, medium: 40, low: 0 } }), undefined, strict);
    expect(s.objective.value).toBe('nurture_to_meeting'); // 0.75 < 0.95 strict high threshold
  });
});
