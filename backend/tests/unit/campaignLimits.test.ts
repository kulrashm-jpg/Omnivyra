/**
 * CAMPAIGN-IMPL-001 — business-rule enforcement.
 *
 * Locks the canonical campaign limits enforced authoritatively in
 * validateCampaignLimits (server) and clampCampaignFormatFrequency (planner
 * defence-in-depth):
 *   Writer campaign : ≤2 writer types, each ≤3/week.
 *   Creator campaign: ≤2 creator types, each ≤3/week.
 *   Intelligent Mix : ≤2 writer + ≤2 creator types; ≤5 writer and ≤5 creator/week.
 */
import {
  validateCampaignLimits,
  clampCampaignFormatFrequency,
  CAMPAIGN_LIMITS,
} from '../../../lib/shared/bolt/formatGovernance';

const codes = (r: ReturnType<typeof validateCampaignLimits>) => r.violations.map((v) => v.code).sort();

describe('validateCampaignLimits — writer campaign (text mode)', () => {
  it('rejects more than 2 writer types', () => {
    const r = validateCampaignLimits(
      { text_formats: ['post', 'article', 'poll'], format_frequency: { post: 3, article: 3, poll: 3 } },
      'text',
    );
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('WRITER_TYPE_COUNT');
  });

  it('rejects a per-type frequency above 3', () => {
    const r = validateCampaignLimits(
      { text_formats: ['post', 'article'], format_frequency: { post: 5, article: 3 } },
      'text',
    );
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('PER_TYPE_FREQUENCY');
  });

  it('accepts 2 writer types at 3/week each (no ≤5 lane-total in writer-only)', () => {
    const r = validateCampaignLimits(
      { text_formats: ['post', 'article'], format_frequency: { post: 3, article: 3 } },
      'text',
    );
    expect(r.ok).toBe(true);
    expect(r.writerTotal).toBe(6); // 6 is allowed for writer-only (only mix caps at 5)
  });
});

describe('validateCampaignLimits — creator campaign', () => {
  it('rejects more than 2 creator types', () => {
    const r = validateCampaignLimits(
      { content_formats: ['carousel', 'infographic', 'image'], format_frequency: { carousel: 2, infographic: 2, image: 2 } },
      'creator',
    );
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('CREATOR_TYPE_COUNT');
  });
});

describe('validateCampaignLimits — Intelligent Mix (combined)', () => {
  it('rejects writer total > 5 (2 writer types × 3 = 6)', () => {
    const r = validateCampaignLimits(
      {
        campaign_mode: 'combined',
        content_formats: ['post', 'article', 'carousel'],
        format_frequency: { post: 3, article: 3, carousel: 2 },
      },
      'combined',
    );
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('WRITER_TOTAL_FREQUENCY');
    expect(r.writerTotal).toBe(6);
  });

  it('rejects creator total > 5', () => {
    const r = validateCampaignLimits(
      {
        campaign_mode: 'combined',
        content_formats: ['post', 'carousel', 'infographic'],
        format_frequency: { post: 2, carousel: 3, infographic: 3 },
      },
      'combined',
    );
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('CREATOR_TOTAL_FREQUENCY');
  });

  it('accepts a valid mix: writer 3+2=5, creator 3+2=5, 2 types per lane', () => {
    const r = validateCampaignLimits(
      {
        campaign_mode: 'combined',
        content_formats: ['post', 'article', 'carousel', 'infographic'],
        format_frequency: { post: 3, article: 2, carousel: 3, infographic: 2 },
      },
      'combined',
    );
    expect(r.violations).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.writerTypes.sort()).toEqual(['article', 'post']);
    expect(r.creatorTypes.sort()).toEqual(['carousel', 'infographic']);
    expect(r.writerTotal).toBe(5);
    expect(r.creatorTotal).toBe(5);
  });
});

describe('clampCampaignFormatFrequency — planner defence-in-depth', () => {
  it('drops types beyond 2 per lane', () => {
    const out = clampCampaignFormatFrequency({ post: 1, article: 1, poll: 1 });
    expect(Object.keys(out!).length).toBe(2);
  });

  it('clamps per-type frequency to 3', () => {
    const out = clampCampaignFormatFrequency({ post: 7 }, 'text');
    expect(out!.post).toBe(CAMPAIGN_LIMITS.MAX_FREQUENCY_PER_TYPE);
    expect(out!.post).toBe(3);
  });

  it('trims a mix lane to ≤5 total (both lanes present)', () => {
    const out = clampCampaignFormatFrequency({ post: 3, article: 3, carousel: 3, infographic: 3 });
    const writer = (out!.post ?? 0) + (out!.article ?? 0);
    const creator = (out!.carousel ?? 0) + (out!.infographic ?? 0);
    expect(writer).toBeLessThanOrEqual(5);
    expect(creator).toBeLessThanOrEqual(5);
  });

  it('does NOT trim a writer-only lane to 5 (no mix → 3+3=6 stays)', () => {
    const out = clampCampaignFormatFrequency({ post: 3, article: 3 });
    expect((out!.post ?? 0) + (out!.article ?? 0)).toBe(6);
  });

  it('returns null for a null/invalid frequency map', () => {
    expect(clampCampaignFormatFrequency(null)).toBeNull();
    expect(clampCampaignFormatFrequency(undefined)).toBeNull();
  });
});
