/**
 * Phase 6H-1 — Weekly Assignment Engine tests.
 *
 * Pure planning function: deterministic, frequency/duration-preserving,
 * platform-safe (derives eligibility from the 6G-1 authority), balanced
 * rotation, intelligence reorders only. No publishing/scheduler/generation.
 */

import { buildWeeklyAssignments, type WeeklyAssignmentResult } from '@/lib/shared/bolt/weeklyAssignmentEngine';
import { getSupportedPlatformsForFormat } from '@/lib/shared/bolt/contentPlatformAssignment';

function flat(r: WeeklyAssignmentResult) {
  return r.weekAssignments.flatMap((w) => w.assignments.map((a) => ({ week: w.week, ...a })));
}
function totalForFormatInWeek(r: WeeklyAssignmentResult, week: number, format: string): number {
  return r.weekAssignments
    .find((w) => w.week === week)!
    .assignments.filter((a) => a.format === format)
    .reduce((s, a) => s + a.count, 0);
}

const SELECTED = ['linkedin', 'instagram', 'facebook', 'youtube', 'x', 'pinterest'];

describe('6H-1 — frequency & duration preservation', () => {
  test('every week receives exactly the requested per-format frequency', () => {
    const r = buildWeeklyAssignments({
      durationWeeks: 12,
      selectedPlatforms: SELECTED,
      formatFrequency: { carousel: 2, video: 1, post: 3 },
    });
    expect(r.weekAssignments).toHaveLength(12); // duration preserved
    for (let w = 1; w <= 12; w++) {
      expect(totalForFormatInWeek(r, w, 'carousel')).toBe(2);
      expect(totalForFormatInWeek(r, w, 'video')).toBe(1);
      expect(totalForFormatInWeek(r, w, 'post')).toBe(3);
    }
  });

  test('no empty weeks; 12-week campaign distributes across all weeks', () => {
    const r = buildWeeklyAssignments({ durationWeeks: 12, selectedPlatforms: SELECTED, formatFrequency: { post: 2 } });
    expect(r.weekAssignments.every((w) => w.assignments.length > 0)).toBe(true);
  });
});

describe('6H-1 — eligibility / platform safety (impossible invalid pairs)', () => {
  test('every assignment is a capability-valid (format, platform) pair ⊆ selected', () => {
    const r = buildWeeklyAssignments({
      durationWeeks: 6,
      selectedPlatforms: SELECTED,
      formatFrequency: { carousel: 2, video: 2, tweet: 1, article: 1 },
    });
    for (const a of flat(r)) {
      expect(SELECTED).toContain(a.platform); // membership preserved
      expect(getSupportedPlatformsForFormat(a.format)).toContain(a.platform); // capability-valid
    }
  });

  test('carousel never reaches youtube', () => {
    const r = buildWeeklyAssignments({ durationWeeks: 8, selectedPlatforms: SELECTED, formatFrequency: { carousel: 3 } });
    expect(flat(r).some((a) => a.format === 'carousel' && a.platform === 'youtube')).toBe(false);
  });

  test('tweet never reaches linkedin (X-exclusive)', () => {
    const r = buildWeeklyAssignments({ durationWeeks: 8, selectedPlatforms: SELECTED, formatFrequency: { tweet: 2 } });
    expect(flat(r).every((a) => a.format !== 'tweet' || a.platform === 'x')).toBe(true);
  });

  test('video reaches only supported platforms (incl. youtube/linkedin, never pinterest)', () => {
    const r = buildWeeklyAssignments({ durationWeeks: 8, selectedPlatforms: SELECTED, formatFrequency: { video: 4 } });
    const platforms = new Set(flat(r).filter((a) => a.format === 'video').map((a) => a.platform));
    expect(platforms.has('pinterest')).toBe(false); // pinterest can't do video
    for (const p of platforms) expect(getSupportedPlatformsForFormat('video')).toContain(p);
  });
});

describe('6H-1 — fail closed', () => {
  test('format with no eligible platform is dropped, not misrouted (counted)', () => {
    // carousel with only youtube selected → no eligible platform → prevented.
    const r = buildWeeklyAssignments({ durationWeeks: 4, selectedPlatforms: ['youtube'], formatFrequency: { carousel: 2 } });
    expect(flat(r).some((a) => a.format === 'carousel')).toBe(false);
    expect(r.diagnostics.invalid_assignments_prevented).toBe(2 * 4);
  });

  test('audio (podcast) has no destination → prevented (consistent with 6G-1B)', () => {
    const r = buildWeeklyAssignments({ durationWeeks: 4, selectedPlatforms: SELECTED, formatFrequency: { podcast: 1 } });
    expect(flat(r).some((a) => a.format === 'podcast')).toBe(false);
    expect(r.diagnostics.invalid_assignments_prevented).toBeGreaterThan(0);
  });
});

describe('6H-1 — balanced rotation (no single-platform domination)', () => {
  test('video 1/week over 3 eligible spreads across weeks (Task 7 example)', () => {
    // Restrict selection so video-eligible = [linkedin, facebook, youtube] in that order.
    const r = buildWeeklyAssignments({ durationWeeks: 4, selectedPlatforms: ['linkedin', 'facebook', 'youtube'], formatFrequency: { video: 1 } });
    const seq = r.weekAssignments.map((w) => w.assignments.find((a) => a.format === 'video')!.platform);
    expect(seq).toEqual(['linkedin', 'facebook', 'youtube', 'linkedin']); // weighted rotation
    expect(new Set(seq).size).toBe(3); // all eligible used → no domination
  });

  test('multi-instance format spreads across eligible platforms within/over weeks', () => {
    const r = buildWeeklyAssignments({ durationWeeks: 2, selectedPlatforms: ['linkedin', 'facebook', 'instagram', 'pinterest'], formatFrequency: { carousel: 2 } });
    const used = new Set(flat(r).map((a) => a.platform));
    expect(used.size).toBeGreaterThanOrEqual(3); // not all on one platform
  });
});

describe('6H-1 — intelligence reorders only (never expands eligibility)', () => {
  test('platform intelligence (advisory) reorders within eligible, same membership', () => {
    const base = buildWeeklyAssignments({ durationWeeks: 4, selectedPlatforms: ['linkedin', 'facebook', 'youtube'], formatFrequency: { video: 1 } });
    const ranked = buildWeeklyAssignments({
      durationWeeks: 4,
      selectedPlatforms: ['linkedin', 'facebook', 'youtube'],
      formatFrequency: { video: 1 },
      platformPriorities: [{ platform: 'youtube', score: 9 }],
      platformPriorityMode: 'advisory',
    });
    const baseSet = new Set(flat(base).map((a) => a.platform));
    const rankedSet = new Set(flat(ranked).map((a) => a.platform));
    expect([...rankedSet].sort()).toEqual([...baseSet].sort()); // membership identical
    expect(flat(ranked)[0].platform).toBe('youtube'); // youtube promoted to week 1
  });

  test('format intelligence never changes frequency or membership', () => {
    const ranked = buildWeeklyAssignments({
      durationWeeks: 3,
      selectedPlatforms: SELECTED,
      formatFrequency: { post: 2, carousel: 1 },
      formatPriorities: [{ format: 'carousel', score: 9 }],
      formatPriorityMode: 'advisory',
    });
    for (let w = 1; w <= 3; w++) {
      expect(totalForFormatInWeek(ranked, w, 'post')).toBe(2); // frequency preserved
      expect(totalForFormatInWeek(ranked, w, 'carousel')).toBe(1);
    }
  });
});

describe('6H-1 — attachment-required media', () => {
  test('video family assigned with attachmentRequired + video asset type', () => {
    const r = buildWeeklyAssignments({ durationWeeks: 4, selectedPlatforms: SELECTED, formatFrequency: { video: 1, product_demo: 1 } });
    const media = flat(r).filter((a) => a.attachmentRequired);
    expect(media.length).toBeGreaterThan(0);
    for (const a of media) expect(a.requiredAssetType).toBe('video');
  });
});

describe('6H-1 — edge / determinism', () => {
  test('same input → same output (deterministic)', () => {
    const args = { durationWeeks: 5, selectedPlatforms: SELECTED, formatFrequency: { post: 2, video: 1 } };
    expect(buildWeeklyAssignments(args)).toEqual(buildWeeklyAssignments(args));
  });
  test('empty inputs degrade safely', () => {
    expect(buildWeeklyAssignments({ durationWeeks: 0, selectedPlatforms: SELECTED, formatFrequency: { post: 1 } }).weekAssignments).toEqual([]);
    expect(buildWeeklyAssignments({ durationWeeks: 4, selectedPlatforms: [], formatFrequency: { post: 1 } }).weekAssignments).toEqual([]);
  });
});
