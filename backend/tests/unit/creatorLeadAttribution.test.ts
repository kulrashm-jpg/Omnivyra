/**
 * Creator → Lead Attribution Extension — validation.
 *
 * Proves the three creator identifiers (asset / variant / strategy) survive
 * the pure transform chain of the EXISTING attribution spine:
 *
 *   link minting (trackingLinkService)
 *      → URL omn_* params
 *      → extractAttributionPayload  (server ingest)
 *      → buildTouchSnapshot         (visitor-session + touchpoint JSON)
 *
 * and that none of this overloads the UTM fields or perturbs the legacy
 * (no-creator-id) path. supabase is mocked as a purity proof — these code
 * paths must not touch the DB; if they did, the Proxy spy below would throw.
 */

const fromSpy = jest.fn(() => { throw new Error('DB access in pure attribution path'); });
jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: new Proxy({}, { get: () => fromSpy }),
}));

// trackingLinkService resolves the base URL from the company profile.
//
// WS-2 M1A (2): this mock previously targeted `companyProfileService`, but the
// profile read has since moved behind the canonical profile adapter, so the
// mock stopped intercepting and the real adapter reached the supabase Proxy
// above — surfacing as four "DB access in pure attribution path" failures that
// were an out-of-date test double, not a regression in the attribution chain.
// Mocking the seam the service actually imports restores the purity proof.
jest.mock('@/backend/services/context/canonicalProfileAdapter', () => ({
  __esModule: true,
  getCanonicalProfile: jest.fn(async () => ({ website_url: 'https://acme.example.com' })),
}));

import { generateTrackingLink } from '../../services/trackingLinkService';
import { extractAttributionPayload, buildTouchSnapshot } from '../../services/leadAttributionService';

const baseLinkInput = {
  companyId: 'company-1',
  campaignId: 'campaign-uuid-123',
  platform: 'linkedin',
  contentType: 'post',
  weekNumber: 2,
  dayNumber: 3,
};

describe('Phase 2 — link minting', () => {
  it('appends omn_* params and echoes them, without touching utm fields', async () => {
    const result = await generateTrackingLink({
      ...baseLinkInput,
      assetId: 'asset-9',
      variantId: 'variant-B',
      strategyId: 'strategy-aggressive',
    });
    const url = new URL(result.url);

    // Creator ids minted under their own namespace.
    expect(url.searchParams.get('omn_asset_id')).toBe('asset-9');
    expect(url.searchParams.get('omn_variant_id')).toBe('variant-B');
    expect(url.searchParams.get('omn_strategy_id')).toBe('strategy-aggressive');
    expect(result.omn_params).toEqual({
      omn_asset_id: 'asset-9',
      omn_variant_id: 'variant-B',
      omn_strategy_id: 'strategy-aggressive',
    });

    // UTM fields are NOT overloaded — utm_content keeps its exact legacy shape.
    expect(url.searchParams.get('utm_campaign')).toBe('campaign-uuid-123');
    expect(url.searchParams.get('utm_source')).toBe('linkedin');
    expect(url.searchParams.get('utm_content')).toBe('post_w2_d3');
  });

  it('mints an identical legacy link when no creator ids are supplied (regression safety)', async () => {
    const result = await generateTrackingLink(baseLinkInput);
    const url = new URL(result.url);
    expect(url.searchParams.get('omn_asset_id')).toBeNull();
    expect(url.searchParams.get('omn_variant_id')).toBeNull();
    expect(url.searchParams.get('omn_strategy_id')).toBeNull();
    expect(result.omn_params).toEqual({});
    // Existing campaign attribution unchanged.
    expect(url.searchParams.get('utm_campaign')).toBe('campaign-uuid-123');
    expect(url.searchParams.get('utm_content')).toBe('post_w2_d3');
  });

  it('treats blank creator ids as absent', async () => {
    const result = await generateTrackingLink({ ...baseLinkInput, assetId: '', variantId: '   ', strategyId: null });
    expect(result.omn_params).toEqual({});
    expect(new URL(result.url).searchParams.has('omn_asset_id')).toBe(false);
  });
});

describe('Phase 3/4 — server ingest extracts and snapshots creator ids', () => {
  it('extracts omn_* params from the top-level body', () => {
    const payload = extractAttributionPayload({
      utm_campaign: 'campaign-uuid-123',
      omn_asset_id: 'asset-9',
      omn_variant_id: 'variant-B',
      omn_strategy_id: 'strategy-aggressive',
    });
    expect(payload.asset_id).toBe('asset-9');
    expect(payload.variant_id).toBe('variant-B');
    expect(payload.creator_strategy_id).toBe('strategy-aggressive');
  });

  it('extracts omn_* params nested under body.attribution (capture page shape)', () => {
    const payload = extractAttributionPayload({
      attribution: {
        utm_campaign: 'campaign-uuid-123',
        omn_asset_id: 'asset-9',
        omn_variant_id: 'variant-B',
        omn_strategy_id: 'strategy-aggressive',
      },
    });
    expect(payload.asset_id).toBe('asset-9');
    expect(payload.variant_id).toBe('variant-B');
    expect(payload.creator_strategy_id).toBe('strategy-aggressive');
  });

  it('also accepts canonical column names', () => {
    const payload = extractAttributionPayload({
      asset_id: 'asset-9',
      variant_id: 'variant-B',
      creator_strategy_id: 'strategy-aggressive',
    });
    expect(payload.asset_id).toBe('asset-9');
    expect(payload.variant_id).toBe('variant-B');
    expect(payload.creator_strategy_id).toBe('strategy-aggressive');
  });

  it('leaves creator ids null on legacy traffic (backward compatible)', () => {
    const payload = extractAttributionPayload({ utm_campaign: 'campaign-uuid-123' });
    expect(payload.asset_id).toBeNull();
    expect(payload.variant_id).toBeNull();
    expect(payload.creator_strategy_id).toBeNull();
  });

  it('carries creator ids into the touch snapshot (visitor-session + touchpoint JSON)', () => {
    const payload = extractAttributionPayload({
      omn_asset_id: 'asset-9',
      omn_variant_id: 'variant-B',
      omn_strategy_id: 'strategy-aggressive',
    });
    const snapshot = buildTouchSnapshot(payload);
    expect(snapshot.asset_id).toBe('asset-9');
    expect(snapshot.variant_id).toBe('variant-B');
    expect(snapshot.creator_strategy_id).toBe('strategy-aggressive');
  });

  it('end-to-end: minted link → extract → snapshot preserves all three', async () => {
    const minted = await generateTrackingLink({
      ...baseLinkInput,
      assetId: 'asset-9',
      variantId: 'variant-B',
      strategyId: 'strategy-aggressive',
    });
    // Simulate a visitor landing with the minted URL's query string.
    const params = Object.fromEntries(new URL(minted.url).searchParams.entries());
    const payload = extractAttributionPayload(params);
    const snapshot = buildTouchSnapshot(payload);

    expect(payload.asset_id).toBe('asset-9');
    expect(payload.variant_id).toBe('variant-B');
    expect(payload.creator_strategy_id).toBe('strategy-aggressive');
    expect(snapshot.creator_strategy_id).toBe('strategy-aggressive');
    // Campaign attribution still intact alongside the creator ids.
    expect(payload.utm_campaign).toBe('campaign-uuid-123');
  });
});
