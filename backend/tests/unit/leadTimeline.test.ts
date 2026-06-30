import { buildTimeline, mergeTimelines, type TimelineEvent } from '../../../lib/leadIntelligence';

const ev = (over: Partial<TimelineEvent>): TimelineEvent => ({
  origin: 'o', source: 'website', entityId: null, eventType: 't', occurredAt: null, metadata: {}, ...over,
});

describe('Canonical timeline', () => {
  it('orders newest-first and preserves provenance', () => {
    const t = buildTimeline([
      ev({ source: 'community', entityId: 'o1', occurredAt: '2026-01-02T00:00:00Z', metadata: { a: 1 } }),
      ev({ source: 'website', entityId: 'l1', occurredAt: '2026-01-03T00:00:00Z' }),
      ev({ source: 'engagement', entityId: 's1', occurredAt: '2026-01-01T00:00:00Z' }),
    ]);
    expect(t.map((e) => e.entityId)).toEqual(['l1', 'o1', 's1']);
    expect(t[1].source).toBe('community');
    expect(t[1].metadata.a).toBe(1); // provenance + metadata retained
  });

  it('unknown timestamps sort last; equal timestamps stable', () => {
    const t = buildTimeline([
      ev({ entityId: 'x', occurredAt: null }),
      ev({ entityId: 'a', occurredAt: '2026-01-01T00:00:00Z' }),
      ev({ entityId: 'b', occurredAt: '2026-01-01T00:00:00Z' }),
    ]);
    expect(t.map((e) => e.entityId)).toEqual(['a', 'b', 'x']);
  });

  it('mergeTimelines combines per-source lists', () => {
    const web = [ev({ source: 'website', entityId: 'w', occurredAt: '2026-01-02T00:00:00Z' })];
    const com = [ev({ source: 'community', entityId: 'c', occurredAt: '2026-01-03T00:00:00Z' })];
    expect(mergeTimelines(web, com).map((e) => e.entityId)).toEqual(['c', 'w']);
  });

  it('handles a large dataset correctly (10k events)', () => {
    const big: TimelineEvent[] = Array.from({ length: 10000 }, (_, i) =>
      ev({ entityId: String(i), occurredAt: new Date(1700000000000 + i * 1000).toISOString() }));
    const t = buildTimeline(big);
    expect(t).toHaveLength(10000);
    expect(t[0].entityId).toBe('9999'); // newest first
    expect(t[9999].entityId).toBe('0');
  });
});
