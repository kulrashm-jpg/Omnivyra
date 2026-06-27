import {
  resolveAttachmentGovernance,
} from '../../../backend/services/creator/intelligence/canonical/creatorAssetRegistry';
import { validateAttachmentPayload } from '../../../lib/content/writerCreatorAttachmentContracts';

describe('Canonical attachment governance contract', () => {
  it('default governance is permissive (preserves universal behavior)', () => {
    const g = resolveAttachmentGovernance('supporting_image');
    expect(g.supportedAttachmentModes).toEqual(['embedded_copy', 'supporting_visual']);
    expect(g.requiresTransformForEmbeddedCopy).toBe(false);
    expect(g.allowsSupportingVisual).toBe(true);
    expect(g.allowedSourceTextTransforms).toBe('all');
    expect(g.duplicateTextPolicy).toBe('forbid_raw_duplication');
  });

  it('carousel governance overrides requiresTransformForEmbeddedCopy (the former hardcoded rule)', () => {
    expect(resolveAttachmentGovernance('carousel').requiresTransformForEmbeddedCopy).toBe(true);
    expect(resolveAttachmentGovernance('infographic').requiresTransformForEmbeddedCopy).toBe(false);
    expect(resolveAttachmentGovernance('banner').requiresTransformForEmbeddedCopy).toBe(false);
  });

  it('the transform-required rule is now governance-driven, not asset-named', () => {
    // carousel (requiresTransform) + embedded_copy + no transform → rejected
    const bad = validateAttachmentPayload({ sourceType: 'thread', assetType: 'carousel', attachmentMode: 'embedded_copy', copyPolicy: { sourceTextTransform: 'none' } } as any);
    expect(bad.errors).toContain('thread carousel requires transform policy');
    // same asset WITH a transform → that rule does not fire
    const ok = validateAttachmentPayload({ sourceType: 'thread', assetType: 'carousel', attachmentMode: 'embedded_copy', copyPolicy: { sourceTextTransform: 'summarize', allowHeadline: true } } as any);
    expect(ok.errors).not.toContain('thread carousel requires transform policy');
    // an asset WITHOUT the requirement never triggers it
    const img = validateAttachmentPayload({ sourceType: 'post', assetType: 'supporting_image', attachmentMode: 'embedded_copy', copyPolicy: { sourceTextTransform: 'none', allowHeadline: true } } as any);
    expect(img.errors).not.toContain('thread carousel requires transform policy');
  });

  it('validator source contains no asset-type governance conditionals', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(process.cwd(), 'lib/content/writerCreatorAttachmentContracts.ts'), 'utf8');
    const body = src.slice(src.indexOf('export function validateAttachmentPayload'));
    const fnBody = body.slice(0, body.indexOf('\n}\n'));
    expect(fnBody).not.toMatch(/assetType === '(carousel|image|infographic|banner|brand_card)'/);
  });
});
