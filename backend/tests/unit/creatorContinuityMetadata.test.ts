/**
 * Tests for the global "Use Existing Asset" continuity surface.
 *
 * Pinned contract:
 *   1. `buildCreatorContinuityBlock` produces a typed marker with the
 *      canonical `creator_continuity` `type` field and the metadata
 *      under `data`, stamped with the current schema version.
 *   2. `extractCreatorContinuity` round-trips the metadata when the
 *      block is present at index 0.
 *   3. Strips the marker block from the returned `blocks[]` so
 *      downstream renderers never see it.
 *   4. Legacy fallback: blocks without the marker (or with a different
 *      first-block type) return `metadata: null` and `blocks` unchanged.
 *   5. Defensive: malformed `data` payloads do not throw — they return
 *      `metadata: null` (legacy fallback) or skip silently.
 *   6. Per-creator-type fields survive the round-trip:
 *      image / banner / infographic / carousel / pdf / slider.
 */

import {
  buildCreatorContinuityBlock,
  extractCreatorContinuity,
  synthesizeLegacyCreatorMetadata,
  CREATOR_CONTINUITY_BLOCK_TYPE,
  CREATOR_CONTINUITY_SCHEMA_VERSION,
  type CreatorContinuityMetadata,
} from '../../services/blockTemplateService';

const sampleImageMetadata: CreatorContinuityMetadata = {
  asset_type: 'image',
  attachment_mode: 'embedded_copy',
  overlay_text: {
    hook:           'Stop the scroll',
    headline:       'Resonance > Reach',
    keyInsight:     'Resonance compounds; reach decays.',
    cta:            'Audit your week',
    supportingText: 'For B2B founders shipping weekly.',
  },
  subtype:         'quote-image',
  brand_mode:      'brand-aware',
  brand_presence:  'balanced',
  platform:        'linkedin',
  files:           ['url1', 'url2'],
  preview_kind:    'social_creative',
  platformContext: 'linkedin',
  renderIdentityHash: 'abc123',
  renderer_metadata: { provider_model: 'gpt-image-1' },
};

describe('buildCreatorContinuityBlock', () => {
  it('emits a typed marker block with the metadata under data', () => {
    const block = buildCreatorContinuityBlock(sampleImageMetadata) as unknown as { type: string; data: Record<string, unknown> };
    expect(block.type).toBe(CREATOR_CONTINUITY_BLOCK_TYPE);
    expect(block.data.asset_type).toBe('image');
    expect(block.data.attachment_mode).toBe('embedded_copy');
  });

  it('stamps the current schema_version', () => {
    const block = buildCreatorContinuityBlock(sampleImageMetadata) as unknown as { data: Record<string, unknown> };
    expect(block.data.schema_version).toBe(CREATOR_CONTINUITY_SCHEMA_VERSION);
  });

  it('does not mutate the caller input', () => {
    const input = { ...sampleImageMetadata };
    const before = JSON.stringify(input);
    buildCreatorContinuityBlock(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('extractCreatorContinuity — extraction + round-trip', () => {
  it('round-trips the full bundle when the marker block is at index 0', () => {
    const marker = buildCreatorContinuityBlock(sampleImageMetadata);
    const fakeContent = { type: 'paragraph', data: { text: 'hello' } } as unknown;
    const blocks = [marker, fakeContent];

    const out = extractCreatorContinuity(blocks);
    expect(out.metadata).toMatchObject(sampleImageMetadata);
    expect(out.blocks).toEqual([fakeContent]);
  });

  it('strips ONLY the marker block — other blocks pass through unchanged', () => {
    const marker = buildCreatorContinuityBlock({ asset_type: 'image' });
    const blocks = [marker, { type: 'a' }, { type: 'b' }, { type: 'c' }] as unknown[];
    const out = extractCreatorContinuity(blocks);
    expect(out.blocks).toEqual([{ type: 'a' }, { type: 'b' }, { type: 'c' }]);
  });
});

describe('extractCreatorContinuity — legacy / defensive', () => {
  it('returns null metadata + full blocks when the marker block is absent', () => {
    const blocks = [{ type: 'paragraph', data: {} }, { type: 'image', data: {} }] as unknown[];
    const out = extractCreatorContinuity(blocks);
    expect(out.metadata).toBeNull();
    expect(out.blocks).toEqual(blocks);
  });

  it('returns null metadata when the first block has a different type', () => {
    const blocks = [{ type: 'paragraph', data: { foo: 'bar' } }] as unknown[];
    const out = extractCreatorContinuity(blocks);
    expect(out.metadata).toBeNull();
    expect(out.blocks).toEqual(blocks);
  });

  it('returns null metadata when content_blocks is missing entirely', () => {
    const out = extractCreatorContinuity(undefined);
    expect(out.metadata).toBeNull();
    expect(out.blocks).toEqual([]);
  });

  it('returns null metadata when content_blocks is not an array', () => {
    const out = extractCreatorContinuity({ not: 'an array' });
    expect(out.metadata).toBeNull();
    expect(out.blocks).toEqual([]);
  });

  it('returns null metadata when the marker block has no data payload', () => {
    const blocks = [{ type: CREATOR_CONTINUITY_BLOCK_TYPE }] as unknown[];
    const out = extractCreatorContinuity(blocks);
    expect(out.metadata).toBeNull();
    expect(out.blocks).toEqual([]);
  });

  it('returns null metadata when the marker block has a non-object data payload', () => {
    const blocks = [{ type: CREATOR_CONTINUITY_BLOCK_TYPE, data: 'not-an-object' }] as unknown[];
    const out = extractCreatorContinuity(blocks);
    expect(out.metadata).toBeNull();
  });
});

describe('extractCreatorContinuity — schema-version safety (final polish)', () => {
  it('strips fields with values outside the documented enum (attachment mode)', () => {
    const block = {
      type: CREATOR_CONTINUITY_BLOCK_TYPE,
      data: { asset_type: 'image', attachment_mode: 'invented_mode', schema_version: 1 },
    } as unknown;
    const out = extractCreatorContinuity([block]);
    expect(out.metadata?.asset_type).toBe('image');
    // Unknown attachment mode value was dropped during sanitize.
    expect(out.metadata?.attachment_mode).toBeUndefined();
  });

  it('strips brand_mode outside the canonical 2-value set', () => {
    const block = {
      type: CREATOR_CONTINUITY_BLOCK_TYPE,
      data: { asset_type: 'image', brand_mode: 'mystery', schema_version: 1 },
    } as unknown;
    const out = extractCreatorContinuity([block]);
    expect(out.metadata?.brand_mode).toBeUndefined();
  });

  it('strips brand_presence outside minimal/balanced/strong', () => {
    const block = {
      type: CREATOR_CONTINUITY_BLOCK_TYPE,
      data: { asset_type: 'image', brand_presence: 'extra-strong', schema_version: 1 },
    } as unknown;
    const out = extractCreatorContinuity([block]);
    expect(out.metadata?.brand_presence).toBeUndefined();
  });

  it('treats schema_version=1 as the current shape (passes through)', () => {
    const block = buildCreatorContinuityBlock({ asset_type: 'image', attachment_mode: 'supporting_visual' });
    const out = extractCreatorContinuity([block]);
    expect(out.metadata?.attachment_mode).toBe('supporting_visual');
    expect(out.metadata?.schema_version).toBe(CREATOR_CONTINUITY_SCHEMA_VERSION);
  });

  it('treats missing schema_version as v1 (back-compat)', () => {
    const block = {
      type: CREATOR_CONTINUITY_BLOCK_TYPE,
      data: { asset_type: 'image', attachment_mode: 'embedded_copy' },
    } as unknown;
    const out = extractCreatorContinuity([block]);
    expect(out.metadata?.attachment_mode).toBe('embedded_copy');
  });

  it('returns null metadata for unknown future schema_version + still strips the marker block', () => {
    const fakeFutureBlock = {
      type: CREATOR_CONTINUITY_BLOCK_TYPE,
      data: { asset_type: 'image', attachment_mode: 'supporting_visual', schema_version: 99 },
    } as unknown;
    const otherBlock = { type: 'paragraph', data: { text: 'hello' } } as unknown;
    const out = extractCreatorContinuity([fakeFutureBlock, otherBlock]);
    expect(out.metadata).toBeNull();
    // Marker block was stripped — downstream renderers don't see it.
    expect(out.blocks).toEqual([otherBlock]);
  });

  it('does not throw when schema_version is non-numeric junk', () => {
    const block = {
      type: CREATOR_CONTINUITY_BLOCK_TYPE,
      data: { asset_type: 'image', schema_version: 'not_a_number' },
    } as unknown;
    expect(() => extractCreatorContinuity([block])).not.toThrow();
  });
});

describe('synthesizeLegacyCreatorMetadata — legacy backfill', () => {
  it('returns null for non-Creator templates (no creator-asset tag)', () => {
    const out = synthesizeLegacyCreatorMetadata({
      description: 'A blog template',
      tags:        ['blog', 'newsletter'],
      format_type: 'blog',
      name:        'My Template',
    });
    expect(out).toBeNull();
  });

  it('synthesizes asset_type from the source: tag when present', () => {
    const out = synthesizeLegacyCreatorMetadata({
      description: null,
      tags:        ['creator-asset', 'source:image'],
      format_type: 'image',
      name:        'Topic Asset',
    });
    expect(out?.asset_type).toBe('image');
    expect(out?.synthesized_from_legacy).toBe(true);
  });

  it('falls back to format_type when the source: tag is absent', () => {
    const out = synthesizeLegacyCreatorMetadata({
      description: null,
      tags:        ['creator-asset'],
      format_type: 'banner',
      name:        'Topic Asset',
    });
    expect(out?.asset_type).toBe('banner');
  });

  it('parses renderer metadata back out of legacy description prose', () => {
    const legacyDescription = 'Creator asset from Image. Stored for future reuse.\n\nRenderer metadata: {"rendererVersion":"v1","platformContext":"linkedin","renderIdentityHash":"abc123"}';
    const out = synthesizeLegacyCreatorMetadata({
      description: legacyDescription,
      tags:        ['creator-asset', 'source:image'],
      format_type: 'image',
      name:        'Topic Asset',
    });
    expect(out?.platformContext).toBe('linkedin');
    expect(out?.platform).toBe('linkedin');
    expect(out?.renderer_metadata).toMatchObject({ rendererVersion: 'v1' });
  });

  it('fails safely when description prose looks like JSON but isn\'t parseable', () => {
    expect(() => synthesizeLegacyCreatorMetadata({
      description: 'Renderer metadata: { not-valid-json',
      tags:        ['creator-asset', 'source:image'],
      format_type: 'image',
      name:        'X',
    })).not.toThrow();
  });

  it('always stamps schema_version + synthesized_from_legacy flags', () => {
    const out = synthesizeLegacyCreatorMetadata({
      description: null,
      tags:        ['creator-asset'],
      format_type: 'image',
      name:        'X',
    });
    expect(out?.schema_version).toBe(CREATOR_CONTINUITY_SCHEMA_VERSION);
    expect(out?.synthesized_from_legacy).toBe(true);
  });
});

describe('extractCreatorContinuity — per-creator-type round-trip', () => {
  it.each([
    ['image',       { asset_type: 'image', attachment_mode: 'supporting_visual' as const, platform: 'linkedin' }],
    ['banner',      { asset_type: 'banner', subtype: 'promo-banner', platform: 'linkedin' }],
    ['infographic', { asset_type: 'infographic', overlay_text: { headline: 'X' } }],
    ['carousel',    { asset_type: 'carousel', files: ['a', 'b', 'c'], platform: 'instagram' }],
    ['pdf',         { asset_type: 'pdf', files: ['page1', 'page2'], preview_kind: 'pdf_document' }],
    ['slider',      { asset_type: 'slider', files: ['s1', 's2', 's3'], platform: 'x' }],
  ])('round-trips %s metadata', (_label, input) => {
    const marker = buildCreatorContinuityBlock(input as CreatorContinuityMetadata);
    const out = extractCreatorContinuity([marker]);
    expect(out.metadata).toMatchObject(input);
  });

  it('preserves brand-mode + brand-presence for brand-aware assets', () => {
    const marker = buildCreatorContinuityBlock({
      asset_type: 'image',
      brand_mode: 'brand-aware',
      brand_presence: 'strong',
    });
    const out = extractCreatorContinuity([marker]);
    expect(out.metadata?.brand_mode).toBe('brand-aware');
    expect(out.metadata?.brand_presence).toBe('strong');
  });

  it('preserves files array (PDF / carousel / slider continuity)', () => {
    const marker = buildCreatorContinuityBlock({
      asset_type: 'pdf',
      files: ['pdf-page-1.png', 'pdf-page-2.png', 'pdf-page-3.png'],
      preview_kind: 'pdf_document',
    });
    const out = extractCreatorContinuity([marker]);
    expect(out.metadata?.files).toEqual(['pdf-page-1.png', 'pdf-page-2.png', 'pdf-page-3.png']);
  });

  it('preserves nested overlay_text + renderer_metadata exactly', () => {
    const marker = buildCreatorContinuityBlock(sampleImageMetadata);
    const out = extractCreatorContinuity([marker]);
    expect(out.metadata?.overlay_text).toMatchObject(sampleImageMetadata.overlay_text as object);
    expect(out.metadata?.renderer_metadata).toMatchObject(sampleImageMetadata.renderer_metadata as object);
  });
});
