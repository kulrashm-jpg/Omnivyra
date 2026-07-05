import { contentDedupKey } from '../../services/boltScheduleBlockProcessor';

describe('content dedup key — unique per (platform, content-type, week), shareable across platforms/types', () => {
  it('same platform + same type + same content → same key (a real duplicate is caught)', () => {
    expect(contentDedupKey('linkedin', 'carousel', 'Unlock your brand potential'))
      .toBe(contentDedupKey('linkedin', 'carousel', 'Unlock your brand potential'));
  });

  it('same content on DIFFERENT platforms → different keys (cross-posting allowed)', () => {
    expect(contentDedupKey('linkedin', 'carousel', 'Same message'))
      .not.toBe(contentDedupKey('facebook', 'carousel', 'Same message'));
  });

  it('REGRESSION: same caption on DIFFERENT content types → different keys (carousel and infographic both survive)', () => {
    // Carousel + infographic that both fall back to the master caption must NOT collide,
    // else one of the two deliverables the user selected is silently dropped.
    expect(contentDedupKey('linkedin', 'carousel', 'Deepening understanding of brand awareness'))
      .not.toBe(contentDedupKey('linkedin', 'infographic', 'Deepening understanding of brand awareness'));
  });

  it('normalizes case + whitespace so trivial formatting differences still collide', () => {
    expect(contentDedupKey('linkedin', 'post', '  Unlock   Your\nBrand  '))
      .toBe(contentDedupKey('linkedin', 'post', 'unlock your brand'));
  });

  it('different content on the same platform+type → different keys (kept)', () => {
    expect(contentDedupKey('linkedin', 'post', 'Post A'))
      .not.toBe(contentDedupKey('linkedin', 'post', 'Post B'));
  });
});
