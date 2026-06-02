/**
 * Creator-asset variant link binding.
 *
 * Proves the creator asset's own variant is bound into the tracking link at
 * mint time (variantId + strategyId passed to generateTrackingLink), the URL is
 * appended additively to the existing CTA (copy preserved), and every failure
 * mode returns the output untouched (best-effort — never blocks generation).
 * generateTrackingLink is mocked; the chain variant → omn_variant_id is proven
 * by the existing trackingLinkService tests.
 */

const mockGenerate = jest.fn();
jest.mock('../../services/trackingLinkService', () => ({
  __esModule: true,
  generateTrackingLink: (...args: any[]) => mockGenerate(...args),
}));

import { appendVariantTrackingCta } from '../../services/creator/creatorVariantLinkBinding';

const URL = 'https://acme.example.com/?utm_campaign=c1&omn_variant_id=v2_punchy&omn_strategy_id=authority_play';
const applied = { strategy_id: 'authority_play', variant_id: 'v2_punchy', variant_family: 'v2' };
const scope = { companyId: 'co-1', campaignId: 'c1' };
const baseOutput = () => ({
  asset_type: 'image',
  packaging: { caption: 'A great hook.', meta_description: 'meta', cta: 'Take the next step.' },
}) as any;

beforeEach(() => {
  mockGenerate.mockReset();
  mockGenerate.mockResolvedValue({ url: URL, utm_params: {}, omn_params: {} });
});

describe('appendVariantTrackingCta', () => {
  it('binds the asset variant + strategy into the link and appends to the CTA (copy preserved)', async () => {
    const out = await appendVariantTrackingCta(baseOutput(), scope, applied, 'linkedin', 'image');

    // generateTrackingLink received the asset's OWN variant/strategy directly.
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'co-1',
        campaignId: 'c1',
        platform: 'linkedin',
        contentType: 'image',
        variantId: 'v2_punchy',
        strategyId: 'authority_play',
      }),
    );
    // URL appended; existing CTA text preserved; caption untouched.
    expect(out.packaging.cta).toBe(`Take the next step. ${URL}`);
    expect(out.packaging.caption).toBe('A great hook.');
    expect(out.packaging.meta_description).toBe('meta');
  });

  it('sets the CTA to the URL when there is no existing CTA copy', async () => {
    const output = { asset_type: 'image', packaging: { caption: 'x' } } as any;
    const out = await appendVariantTrackingCta(output, scope, applied, 'x', 'image');
    expect(out.packaging.cta).toBe(URL);
  });

  it('is idempotent — never double-appends on regeneration', async () => {
    const output = { asset_type: 'image', packaging: { cta: `Step. ${URL}` } } as any;
    const out = await appendVariantTrackingCta(output, scope, applied, 'x', 'image');
    expect(out.packaging.cta).toBe(`Step. ${URL}`);
  });

  it('no variant applied → output returned unchanged (legacy parity, no mint)', async () => {
    const output = baseOutput();
    const out = await appendVariantTrackingCta(output, scope, null, 'linkedin', 'image');
    expect(out).toBe(output);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('best-effort: link minting failure returns output untouched (never blocks generation)', async () => {
    mockGenerate.mockRejectedValue(new Error('Company website_url is required to generate tracking link'));
    const output = baseOutput();
    const out = await appendVariantTrackingCta(output, scope, applied, 'linkedin', 'image');
    expect(out.packaging.cta).toBe('Take the next step.'); // unchanged
  });
});
