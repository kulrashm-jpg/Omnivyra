import {
  canAttachTo,
  getAllowedAssetTypesForTarget,
  getPostAllowedAssetTypes,
  getThreadAllowedAssetTypes,
} from '../../../backend/services/creator/intelligence/canonical/creatorAssetRegistry';
import { validateAttachmentPayload } from '../../../lib/content/writerCreatorAttachmentContracts';

describe('Canonical attachment eligibility (one capability contract)', () => {
  it('canAttachTo reproduces the existing post/thread rules from the registry', () => {
    expect(canAttachTo('thread', 'carousel')).toBe(true);   // carousel eligible for thread
    expect(canAttachTo('post', 'carousel')).toBe(false);    // NOT for post
    expect(canAttachTo('post', 'supporting_image')).toBe(true);
    expect(canAttachTo('post', 'infographic')).toBe(true);
    expect(canAttachTo('post', 'brand_card')).toBe(true);
    expect(canAttachTo('thread', 'supporting_image')).toBe(true);
  });

  it('resolves canonical aliases (image → supporting_image canonical)', () => {
    expect(canAttachTo('post', 'image')).toBe(true);
  });

  it('selectors are derived from the same capability (generation == attachment availability)', () => {
    expect(getPostAllowedAssetTypes()).toEqual(getAllowedAssetTypesForTarget('post'));
    expect(getThreadAllowedAssetTypes()).toEqual(getAllowedAssetTypesForTarget('thread'));
    // every menu-eligible type is attachable, and vice-versa
    for (const t of getPostAllowedAssetTypes()) expect(canAttachTo('post', t)).toBe(true);
    for (const t of getThreadAllowedAssetTypes()) expect(canAttachTo('thread', t)).toBe(true);
  });

  it('extensible targets default to not-eligible until registry metadata adds them', () => {
    expect(canAttachTo('article', 'carousel')).toBe(false);
    expect(canAttachTo('newsletter', 'supporting_image')).toBe(false);
    expect(canAttachTo('guide', 'infographic')).toBe(false);
    expect(getAllowedAssetTypesForTarget('article')).toEqual([]);
  });

  it('unknown / empty asset types fail gracefully (no silent pass)', () => {
    expect(canAttachTo('post', 'totally_unknown')).toBe(false);
    expect(canAttachTo('post', '')).toBe(false);
    expect(canAttachTo('post', null)).toBe(false);
  });

  it('validateAttachmentPayload now rejects via the canonical helper (post+carousel still rejected)', () => {
    const res = validateAttachmentPayload({ sourceType: 'post', assetType: 'carousel', attachmentMode: 'embedded_copy' } as any);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/does not support carousel/);
    // existing supported combo still passes the eligibility gate
    const ok = validateAttachmentPayload({ sourceType: 'thread', assetType: 'carousel', attachmentMode: 'supporting_visual', copyPolicy: { sourceTextTransform: 'support_visual_only' } } as any);
    expect(ok.errors.join(' ')).not.toMatch(/does not support/);
  });
});
