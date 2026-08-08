/**
 * Variant Attribution Completion — plan persistence + end-to-end survival.
 *
 * Proves that when a variant is actually selected, it is stamped durably onto
 * every day of platform_execution_plans.plan_json (a JSONB column — no schema
 * change), and that it then survives the full chain:
 *
 *   variant selected → execution plan day → link mint → visitor capture
 *   → lead attribution snapshot.
 *
 * Also proves legacy parity: with no variant selected, days carry no variant
 * keys at all. supabase + getProfile are mocked — the build is pure and must
 * not touch the DB.
 */

const fromSpy = jest.fn(() => { throw new Error('DB access in pure plan build'); });
jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: new Proxy({}, { get: () => fromSpy }),
}));
jest.mock('../../services/companyProfileService', () => ({
  __esModule: true,
  getProfile: jest.fn(async () => ({ website_url: 'https://acme.example.com' })),
  // platformIntelligenceService imports the CompanyProfile type only; provide a
  // no-op so the module loads.
}));
/**
 * G2R — `generateTrackingLink` (trackingLinkService.ts:44) reads the profile through
 * `context/canonicalProfileAdapter` (Wave 2F, 107c21d1). The profile read itself is not new — it
 * predates the migration (760a3d24) — only the module it comes from changed, so the mock above
 * stopped intercepting and the call fell through to the real adapter, hitting `ownedDbTable` and
 * tripping this suite's "DB access in pure plan build" guard.
 *
 * Bridged to this suite's own `getProfile` mock so the guard measures what it was written to
 * measure: that the PLAN BUILD performs no DB access of its own.
 */
jest.mock('../../services/context/canonicalProfileAdapter', () => ({
  getCanonicalProfile: jest.fn(async (companyId: string) => {
    const { getProfile } = jest.requireMock('../../services/companyProfileService') as {
      getProfile: (id: string) => Promise<unknown>;
    };
    return getProfile(companyId);
  }),
}));

import { buildPlatformExecutionPlan } from '../../services/platformIntelligenceService';
import { generateTrackingLink } from '../../services/trackingLinkService';
import { extractAttributionPayload, buildTouchSnapshot } from '../../services/leadAttributionService';

const profile: any = {
  company_id: 'comp-1',
  content_themes_list: ['growth'],
  target_audience_list: ['founders'],
  goals_list: ['engagement'],
  social_profiles: [
    { platform: 'LinkedIn', url: 'x' },
    { platform: 'Instagram', url: 'x' },
    { platform: 'X', url: 'x' },
  ],
};
const weekPlan: any = {
  week_number: 1,
  theme: 'Growth Systems',
  platforms: ['LinkedIn', 'Instagram', 'X'],
  content_types: { linkedin: ['text'], instagram: ['text'], x: ['text'] },
};

describe('buildPlatformExecutionPlan — variant persistence', () => {
  it('stamps an explicitly-selected variant onto every day', () => {
    const plan = buildPlatformExecutionPlan({
      companyProfile: profile,
      campaign: { objective: 'engagement' },
      weekPlan,
      trends: [],
      variantSelection: { variantId: 'v2_punchy', creatorStrategyId: 'authority_play' },
    });
    expect(plan.days).toHaveLength(7);
    expect(plan.days.every((d) => d.variantId === 'v2_punchy')).toBe(true);
    expect(plan.days.every((d) => d.creatorStrategyId === 'authority_play')).toBe(true);
  });

  it('resolves a variant carried on the week blueprint', () => {
    const plan = buildPlatformExecutionPlan({
      companyProfile: profile,
      campaign: { strategy_id: 'authority_play' },
      weekPlan: { ...weekPlan, variant_id: 'v3_data' },
      trends: [],
    });
    expect(plan.days.every((d) => d.variantId === 'v3_data')).toBe(true);
    expect(plan.days.every((d) => d.creatorStrategyId === 'authority_play')).toBe(true);
  });

  it('resolves a variant from campaign.applied_variant', () => {
    const plan = buildPlatformExecutionPlan({
      companyProfile: profile,
      campaign: { applied_variant: { variant_id: 'v1_baseline', strategy_id: 'authority_play' } },
      weekPlan,
      trends: [],
    });
    expect(plan.days.every((d) => d.variantId === 'v1_baseline')).toBe(true);
  });

  it('legacy parity: no variant selected → days carry no variant keys', () => {
    const plan = buildPlatformExecutionPlan({
      companyProfile: profile,
      campaign: { objective: 'engagement' },
      weekPlan,
      trends: [],
    });
    for (const d of plan.days) {
      expect('variantId' in d).toBe(false);
      expect('creatorStrategyId' in d).toBe(false);
    }
  });
});

describe('end-to-end — selected variant survives plan → link → lead snapshot', () => {
  it('preserves variant_id and creator_strategy_id all the way to the lead snapshot', async () => {
    // 1. Variant selected → durable execution plan.
    const plan = buildPlatformExecutionPlan({
      companyProfile: profile,
      campaign: { objective: 'engagement' },
      weekPlan,
      trends: [],
      variantSelection: { variantId: 'v2_punchy', creatorStrategyId: 'authority_play' },
    });
    const dayPlan = plan.days[0];

    // 2. generate-day reads dayPlan.variantId / dayPlan.creatorStrategyId.
    const variantId = (dayPlan as any).variant_id ?? dayPlan.variantId ?? null;
    const strategyId =
      (dayPlan as any).creator_strategy_id ?? dayPlan.creatorStrategyId ?? null;
    expect(variantId).toBe('v2_punchy');
    expect(strategyId).toBe('authority_play');

    // 3. Link mint carries the variant in the omn_ namespace.
    const minted = await generateTrackingLink({
      companyId: 'comp-1',
      campaignId: 'campaign-uuid-123',
      platform: dayPlan.platform,
      contentType: dayPlan.contentType,
      weekNumber: 1,
      dayNumber: 1,
      assetId: 'asset-77',
      variantId,
      strategyId,
    });
    expect(new URL(minted.url).searchParams.get('omn_variant_id')).toBe('v2_punchy');
    expect(new URL(minted.url).searchParams.get('omn_strategy_id')).toBe('authority_play');

    // 4. Visitor capture → 5. lead snapshot.
    const params = Object.fromEntries(new URL(minted.url).searchParams.entries());
    const payload = extractAttributionPayload(params);
    const snapshot = buildTouchSnapshot(payload);

    expect(payload.variant_id).toBe('v2_punchy');
    expect(payload.creator_strategy_id).toBe('authority_play');
    expect(payload.asset_id).toBe('asset-77');
    expect(snapshot.variant_id).toBe('v2_punchy');
    // Campaign attribution unchanged alongside the variant.
    expect(payload.utm_campaign).toBe('campaign-uuid-123');
  });
});
