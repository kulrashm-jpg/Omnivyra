import { contentDedupKey } from '../../services/boltScheduleBlockProcessor';

describe('content dedup key — unique per (platform, week), shareable per (day, cross-platform)', () => {
  it('same platform + same content → same key (a duplicate is caught)', () => {
    expect(contentDedupKey('linkedin', 'Unlock your brand potential')).toBe(contentDedupKey('linkedin', 'Unlock your brand potential'));
  });

  it('same content on DIFFERENT platforms → different keys (cross-posting allowed)', () => {
    expect(contentDedupKey('linkedin', 'Same message')).not.toBe(contentDedupKey('facebook', 'Same message'));
  });

  it('normalizes case + whitespace so trivial formatting differences still collide', () => {
    expect(contentDedupKey('linkedin', '  Unlock   Your\nBrand  ')).toBe(contentDedupKey('linkedin', 'unlock your brand'));
  });

  it('different content on the same platform → different keys (kept)', () => {
    expect(contentDedupKey('linkedin', 'Post A')).not.toBe(contentDedupKey('linkedin', 'Post B'));
  });
});
