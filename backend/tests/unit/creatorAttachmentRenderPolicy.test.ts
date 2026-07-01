/**
 * BETA-015 RULE 9/10 — the canonical attachment render policy is the single source of truth
 * for POST + IMAGE (supporting_visual = clean photograph) vs TEXT INSIDE IMAGE (embedded_copy =
 * designed overlay). These tests fail if the legacy "enforced banner ⇒ embedded_copy" path
 * ever reappears ahead of attachment_mode.
 */
import { resolveCanonicalRenderPolicy } from '../../services/creatorAssetRenderer';

const base = { fileNamePrefix: 'image', assetPayload: {}, metadata: {} as Record<string, unknown> };

describe('BETA-015 — canonical attachment render policy', () => {
  it('attachment_mode wins: POST+IMAGE (supporting_visual) over an enforced banner', () => {
    expect(resolveCanonicalRenderPolicy({
      ...base, attachmentMode: 'supporting_visual', enforcedAssetType: 'banner',
      metadata: { attachment_mode: 'supporting_visual' },
    })).toBe('supporting_visual');
  });

  it('attachment_mode wins: TEXT INSIDE (embedded_copy) over an enforced supporting_image', () => {
    expect(resolveCanonicalRenderPolicy({
      ...base, attachmentMode: 'embedded_copy', enforcedAssetType: 'supporting_image',
    })).toBe('embedded_copy');
  });

  it('compatibility fallback (no explicit mode): supporting_image → supporting_visual', () => {
    expect(resolveCanonicalRenderPolicy({ ...base, enforcedAssetType: 'supporting_image' })).toBe('supporting_visual');
  });

  it('compatibility fallback (no explicit mode): banner → embedded_copy', () => {
    expect(resolveCanonicalRenderPolicy({ ...base, enforcedAssetType: 'banner' })).toBe('embedded_copy');
  });

  it('no enforced type → resolves from metadata.attachment_mode (image lane)', () => {
    expect(resolveCanonicalRenderPolicy({ ...base, metadata: { attachment_mode: 'supporting_visual' } })).toBe('supporting_visual');
    expect(resolveCanonicalRenderPolicy({ ...base, metadata: { attachment_mode: 'embedded_copy' } })).toBe('embedded_copy');
  });

  // The regression that BETA-013/014/015 exist to prevent.
  it('LEGACY GUARD — a banner asset MUST NOT force embedded_copy when POST+IMAGE is selected', () => {
    const policy = resolveCanonicalRenderPolicy({ ...base, attachmentMode: 'supporting_visual', enforcedAssetType: 'banner' });
    expect(policy).not.toBe('embedded_copy'); // fails if the legacy banner-first branch returns
    expect(policy).toBe('supporting_visual');
  });
});
