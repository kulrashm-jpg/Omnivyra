import { buildThrottledSlotPlatforms, MAX_SHARE_PLATFORMS } from '../../services/deterministicWeeklySkeleton';

const totalPosts = (slots: string[][]) => slots.reduce((n, s) => n + s.length, 0);

describe('throttled-total cross-platform sharing (frequency = total posts, ≤2 platforms/piece)', () => {
  it('3 posts over 3 platforms → exactly 3 posts (NOT 9), each piece ≤2 platforms', () => {
    const slots = buildThrottledSlotPlatforms(3, ['linkedin', 'facebook', 'instagram']);
    expect(totalPosts(slots)).toBe(3);              // total honored — the core fix (was 9)
    slots.forEach((s) => expect(s.length).toBeLessThanOrEqual(MAX_SHARE_PLATFORMS));
    // every selected platform is used exactly once (even distribution)
    const flat = slots.flat().sort();
    expect(flat).toEqual(['facebook', 'instagram', 'linkedin']);
  });

  it('3 posts over 2 platforms → 3 posts, one piece re-shared to both', () => {
    const slots = buildThrottledSlotPlatforms(3, ['linkedin', 'facebook']);
    expect(totalPosts(slots)).toBe(3);
    expect(slots.some((s) => s.length === 2)).toBe(true); // a re-shared piece exists
    slots.forEach((s) => expect(s.length).toBeLessThanOrEqual(2));
  });

  it('never puts a single piece on more than 2 platforms even with 4 platforms', () => {
    const slots = buildThrottledSlotPlatforms(4, ['linkedin', 'facebook', 'instagram', 'x']);
    expect(totalPosts(slots)).toBe(4);
    slots.forEach((s) => expect(s.length).toBeLessThanOrEqual(2));
  });

  it('distributes evenly — 6 posts over 3 platforms → 2 each', () => {
    const slots = buildThrottledSlotPlatforms(6, ['linkedin', 'facebook', 'instagram']);
    expect(totalPosts(slots)).toBe(6);
    const perPlatform: Record<string, number> = {};
    slots.flat().forEach((p) => { perPlatform[p] = (perPlatform[p] ?? 0) + 1; });
    expect(perPlatform).toEqual({ linkedin: 2, facebook: 2, instagram: 2 });
  });

  it('single platform → all posts solo (no phantom sharing)', () => {
    const slots = buildThrottledSlotPlatforms(3, ['linkedin']);
    expect(slots).toEqual([['linkedin'], ['linkedin'], ['linkedin']]);
  });

  it('zero / empty inputs are safe', () => {
    expect(buildThrottledSlotPlatforms(0, ['linkedin'])).toEqual([]);
    expect(buildThrottledSlotPlatforms(3, [])).toEqual([]);
  });
});
