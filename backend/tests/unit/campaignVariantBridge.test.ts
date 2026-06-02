/**
 * Creator Variant Bridge — read-only resolution + experiment safety.
 *
 * supabase is mocked with a tiny chainable builder; each table returns a
 * canned { data, error }. Proves: single/best-variant campaigns resolve,
 * experiment campaigns are flagged ambiguous (never guessed), creator_assets
 * is the fallback source, platform filtering is honoured, and any DB error
 * degrades to `none` without throwing.
 */

const mockTableData: Record<string, { data: any; error: any }> = {};
jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: {
    from(table: string) {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        limit: () => Promise.resolve(mockTableData[table] ?? { data: [], error: null }),
      };
      return builder;
    },
  },
}));

import { resolveCampaignVariant } from '../../services/creator/campaignVariantBridge';

const sp = (platform: string, variant: any) => ({
  platform,
  creator_attachment_metadata: [{ applied_variant: variant }],
});

beforeEach(() => {
  delete mockTableData.scheduled_posts;
  delete mockTableData.creator_assets;
});

describe('resolveCampaignVariant — happy paths', () => {
  it('single-variant campaign → resolved from scheduled_posts', async () => {
    mockTableData.scheduled_posts = {
      data: [
        sp('linkedin', { strategy_id: 'authority_play', variant_id: 'v2_punchy', variant_family: 'v2' }),
        sp('linkedin', { strategy_id: 'authority_play', variant_id: 'v2_punchy', variant_family: 'v2' }),
      ],
      error: null,
    };
    const r = await resolveCampaignVariant('camp-1', 'linkedin');
    expect(r.status).toBe('resolved');
    expect(r.variant_id).toBe('v2_punchy');
    expect(r.strategy_id).toBe('authority_play');
    expect(r.variant_family).toBe('v2');
    expect(r.source).toBe('scheduled_posts');
  });

  it('best-variant campaign (one winning variant in flight) → resolved', async () => {
    mockTableData.scheduled_posts = {
      data: [sp('x', { strategy_id: 'data_led', variant_id: 'v1_baseline', variant_family: 'v1' })],
      error: null,
    };
    const r = await resolveCampaignVariant('camp-2', 'twitter'); // twitter→x normalization
    expect(r.status).toBe('resolved');
    expect(r.variant_id).toBe('v1_baseline');
  });

  it('extracts from nested renderManifest.media_bundle.metadata', async () => {
    mockTableData.scheduled_posts = {
      data: [{
        platform: 'linkedin',
        creator_attachment_metadata: [{
          renderManifest: { media_bundle: { metadata: { applied_variant: { strategy_id: 's', variant_id: 'v3_data', variant_family: 'v3' } } } },
        }],
      }],
      error: null,
    };
    const r = await resolveCampaignVariant('camp-3', 'linkedin');
    expect(r.status).toBe('resolved');
    expect(r.variant_id).toBe('v3_data');
  });
});

describe('resolveCampaignVariant — experiment safety', () => {
  it('multiple distinct variants for campaign+platform → ambiguous, never guessed', async () => {
    mockTableData.scheduled_posts = {
      data: [
        sp('linkedin', { strategy_id: 'authority_play', variant_id: 'v1_baseline', variant_family: 'v1' }),
        sp('linkedin', { strategy_id: 'authority_play', variant_id: 'v2_punchy', variant_family: 'v2' }),
      ],
      error: null,
    };
    const r = await resolveCampaignVariant('camp-exp', 'linkedin');
    expect(r.status).toBe('ambiguous');
    expect(r.variant_id).toBeNull();
    expect(r.strategy_id).toBeNull();
    expect(r.distinct_variant_ids?.sort()).toEqual(['v1_baseline', 'v2_punchy']);
  });

  it('same variant repeated is NOT ambiguous', async () => {
    mockTableData.scheduled_posts = {
      data: [
        sp('linkedin', { variant_id: 'v2_punchy' }),
        sp('linkedin', { variant_id: 'v2_punchy' }),
        sp('linkedin', { variant_id: 'v2_punchy' }),
      ],
      error: null,
    };
    const r = await resolveCampaignVariant('camp-4', 'linkedin');
    expect(r.status).toBe('resolved');
    expect(r.variant_id).toBe('v2_punchy');
  });
});

describe('resolveCampaignVariant — fallback + filtering + safety', () => {
  it('falls back to creator_assets when scheduled_posts has none', async () => {
    mockTableData.scheduled_posts = { data: [], error: null };
    mockTableData.creator_assets = {
      data: [{
        platform_context: 'linkedin',
        metadata: { campaign_id: 'camp-5', applied_variant: { strategy_id: 'authority_play', variant_id: 'v3_data', variant_family: 'v3' } },
      }],
      error: null,
    };
    const r = await resolveCampaignVariant('camp-5', 'linkedin');
    expect(r.status).toBe('resolved');
    expect(r.variant_id).toBe('v3_data');
    expect(r.source).toBe('creator_assets');
  });

  it('ignores rows for a different platform', async () => {
    mockTableData.scheduled_posts = {
      data: [
        sp('instagram', { variant_id: 'v9_other' }),
        sp('linkedin', { variant_id: 'v2_punchy' }),
      ],
      error: null,
    };
    const r = await resolveCampaignVariant('camp-6', 'linkedin');
    expect(r.status).toBe('resolved');
    expect(r.variant_id).toBe('v2_punchy');
  });

  it('no variant anywhere → none', async () => {
    mockTableData.scheduled_posts = { data: [], error: null };
    mockTableData.creator_assets = { data: [], error: null };
    const r = await resolveCampaignVariant('camp-7', 'linkedin');
    expect(r.status).toBe('none');
    expect(r.variant_id).toBeNull();
  });

  it('DB error degrades to none without throwing', async () => {
    mockTableData.scheduled_posts = { data: null, error: { message: 'boom' } };
    mockTableData.creator_assets = { data: null, error: { message: 'boom' } };
    const r = await resolveCampaignVariant('camp-8', 'linkedin');
    expect(r.status).toBe('none');
  });

  it('missing campaignId or platform → none', async () => {
    expect((await resolveCampaignVariant(null, 'linkedin')).status).toBe('none');
    expect((await resolveCampaignVariant('camp-9', null)).status).toBe('none');
  });
});

describe('mint fallback semantics (generate-day contract)', () => {
  // Mirrors generate-day.ts: only resolve via bridge when the plan carries no
  // variant; use it when resolved; skip (keep null) when ambiguous.
  async function mintVariant(planVariantId: string | null, campaignId: string, platform: string) {
    let variantId = planVariantId;
    if (!variantId) {
      const bridged = await resolveCampaignVariant(campaignId, platform);
      if (bridged.status === 'resolved') variantId = bridged.variant_id;
      // ambiguous / none → leave null (no fabrication)
    }
    return variantId;
  }

  it('uses the bridge only when the plan carries no variant', async () => {
    mockTableData.scheduled_posts = { data: [sp('linkedin', { variant_id: 'v2_punchy' })], error: null };
    // Plan already carries a variant → bridge NOT consulted (value preserved).
    expect(await mintVariant('v_from_plan', 'camp-a', 'linkedin')).toBe('v_from_plan');
    // Plan carries none → bridge fills it.
    expect(await mintVariant(null, 'camp-a', 'linkedin')).toBe('v2_punchy');
  });

  it('skips attribution (null) on experiment ambiguity', async () => {
    mockTableData.scheduled_posts = {
      data: [sp('linkedin', { variant_id: 'v1_baseline' }), sp('linkedin', { variant_id: 'v2_punchy' })],
      error: null,
    };
    expect(await mintVariant(null, 'camp-exp', 'linkedin')).toBeNull();
  });
});
