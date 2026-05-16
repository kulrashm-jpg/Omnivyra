/**
 * Unit tests — creatorIntelligenceEngine.resolveCreatorContext()
 *
 * Validates the Step-2 purity + normalization contract:
 *   - deterministic (same input → identical output)
 *   - no DB access (supabase mock asserted never called)
 *   - no scheduler dependency (no scheduler import in the engine graph
 *     it actually exercises; covered by "no throw + supabase untouched")
 *   - packaging completeness (5 keys, hashtags/keywords arrays)
 *   - hashtag/keyword generation produces content
 *   - continuity passthrough (input === output, never fetched)
 *   - brand-grounding passthrough (input === output, never fetched)
 *   - inputs are not mutated
 */

// Mock the DB client. The engine itself never touches it; this mock is
// the PROOF — if the engine (or anything it calls) hit the DB the
// assertion `supabase.from` was-never-called would fail.
const fromSpy = jest.fn(() => { throw new Error('DB access in pure engine'); });
jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: new Proxy({}, { get: () => fromSpy }),
}));

import { resolveCreatorContext } from '../../services/creator/intelligence/creatorIntelligenceEngine';

const BASE_INPUT = {
  topic: 'From Data to Decisions: Transform your marketing',
  objective: 'Build brand awareness for mid-market SaaS',
  contentType: 'carousel',
  platforms: ['LinkedIn', 'Instagram', 'facebook'],
  campaignTheme: 'Smarter marketing through data',
  creativeObjective: 'Position the product as the data-to-decision bridge',
  audienceIntent: 'evaluating, skeptical',
  coreMessage: 'Turn raw analytics into weekly decisions',
  tone: 'authoritative',
  cta: 'Book a walkthrough',
  distributionMode: 'unique' as const,
  brandGrounding: {
    company_name: 'Omnivyra',
    industry: 'marketing operations',
    default_audience: 'B2B marketing leaders',
  },
  continuityContext: {
    campaign_id: 'camp-123',
    week_index: 2,
    prior_week_summaries: [{ week_number: 1, summary: 'Awareness week landed well' }],
  },
};

describe('resolveCreatorContext', () => {
  afterEach(() => fromSpy.mockClear());

  it('does not access the database', () => {
    resolveCreatorContext(BASE_INPUT);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('is deterministic — identical input yields identical output', () => {
    const a = resolveCreatorContext(BASE_INPUT);
    const b = resolveCreatorContext(BASE_INPUT);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('produces a complete, constraint-shaped packaging object', () => {
    const ctx = resolveCreatorContext(BASE_INPUT);
    expect(ctx.packaging).toEqual(
      expect.objectContaining({
        caption: expect.any(String),
        meta_description: expect.any(String),
        cta: expect.any(String),
      }),
    );
    expect(Array.isArray(ctx.packaging.hashtags)).toBe(true);
    expect(Array.isArray(ctx.packaging.keywords)).toBe(true);
    expect(ctx.packaging.caption.length).toBeGreaterThan(0);
    expect(ctx.packaging.cta).toBe('Book a walkthrough');
  });

  it('generates non-empty hashtags and keywords', () => {
    const ctx = resolveCreatorContext(BASE_INPUT);
    expect(ctx.packaging.hashtags.length).toBeGreaterThan(0);
    expect(ctx.packaging.keywords.length).toBeGreaterThan(0);
    // metadata mirrors packaging keywords (constraint duplication)
    expect(ctx.metadata.keywords).toEqual(ctx.packaging.keywords);
  });

  it('passes continuity context through verbatim (never fetched)', () => {
    const ctx = resolveCreatorContext(BASE_INPUT);
    expect(ctx.continuity_context).toEqual(BASE_INPUT.continuityContext);
  });

  it('passes brand grounding through verbatim (never fetched)', () => {
    const ctx = resolveCreatorContext(BASE_INPUT);
    expect(ctx.brand_grounding).toEqual(BASE_INPUT.brandGrounding);
  });

  it('does not mutate the input object', () => {
    const snapshot = JSON.stringify(BASE_INPUT);
    resolveCreatorContext(BASE_INPUT);
    expect(JSON.stringify(BASE_INPUT)).toEqual(snapshot);
  });

  it('falls back safely on a minimal input (topic only)', () => {
    const ctx = resolveCreatorContext({ topic: 'AI analytics', contentType: 'image' });
    expect(ctx.campaign_theme).toBe('AI analytics');
    expect(ctx.audience_intent).toBe('general audience');
    expect(ctx.emotional_goal.tone).toBe('professional');
    expect(ctx.reuse_strategy.distribution.mode).toBe('shared'); // default
    expect(ctx.continuity_context).toEqual({});
    expect(ctx.brand_grounding).toEqual({});
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('normalizes platform keys into platform_strategy', () => {
    const ctx = resolveCreatorContext(BASE_INPUT);
    // 'LinkedIn' → 'linkedin', etc. (normalizePlatformKey)
    expect(Object.keys(ctx.platform_strategy).sort()).toEqual(
      ['facebook', 'instagram', 'linkedin'],
    );
  });
});
