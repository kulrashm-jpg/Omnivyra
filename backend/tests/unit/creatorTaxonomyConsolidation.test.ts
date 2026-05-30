/**
 * Creator Taxonomy Consolidation — regression coverage.
 *
 * Pins the load-bearing invariants for the consolidation from 5
 * user-facing creator types (Image / Banner / Carousel / Slider /
 * Infographic) down to 3 (Image / Carousel / Infographic).
 *
 * Banner is now an Image layout (wide-banner) and Slider is now a
 * Carousel layout (widescreen-presentation). These tests guard
 * against silent regressions in:
 *
 *   1. Routing helpers — `creatorRouteTypeForAsset` and
 *      `creatorLayoutForAsset` must map banner → image+wide-banner.
 *   2. API alias map — historical creator_assets rows tagged with
 *      `creator_type='banner'` or `'slider'` must still be queryable.
 *   3. Asset registry — runtime_asset_types must still alias
 *      banner→image and slider→carousel for historical reads.
 *   4. Writer attachment contracts — `WriterCreatorAssetType` must
 *      still include banner so historical attachment records load.
 *   5. Writer Add Asset menu — `*_VISIBLE` arrays exclude banner.
 *   6. Label resolver — `assetLabel('banner')` and `assetLabel('slider')`
 *      must still return non-empty strings for historical chip render.
 *
 * Any failure here means a downstream surface has accidentally
 * dropped the backward-compat alias and historical assets will
 * orphan.
 */

import {
  assetLabel,
  creatorContentAssetFamily,
  creatorLayoutForAsset,
  creatorRouteTypeForAsset,
  CREATOR_CONTENT_ASSET_TYPES,
  type WriterCreatorAssetType,
} from '../../../lib/content/writerCreatorAttachmentContracts';
import {
  POST_CREATOR_ASSET_TYPES,
  POST_CREATOR_ASSET_TYPES_VISIBLE,
  THREAD_CREATOR_ASSET_TYPES,
  THREAD_CREATOR_ASSET_TYPES_VISIBLE,
} from '../../../lib/content/writerCreatorAssetLaunch';

describe('Taxonomy consolidation — routing', () => {
  test('creatorRouteTypeForAsset maps banner → image', () => {
    expect(creatorRouteTypeForAsset('banner' as WriterCreatorAssetType)).toBe('image');
  });

  test('creatorRouteTypeForAsset maps supporting_image → image', () => {
    expect(creatorRouteTypeForAsset('supporting_image')).toBe('image');
  });

  test('creatorRouteTypeForAsset maps brand_card → image', () => {
    expect(creatorRouteTypeForAsset('brand_card')).toBe('image');
  });

  test('creatorRouteTypeForAsset preserves carousel', () => {
    expect(creatorRouteTypeForAsset('carousel')).toBe('carousel');
  });

  test('creatorRouteTypeForAsset preserves infographic', () => {
    expect(creatorRouteTypeForAsset('infographic')).toBe('infographic');
  });

  test('creatorLayoutForAsset returns wide-banner for banner', () => {
    expect(creatorLayoutForAsset('banner' as WriterCreatorAssetType)).toBe('wide-banner');
  });

  test('creatorLayoutForAsset returns null for non-aliased types', () => {
    expect(creatorLayoutForAsset('supporting_image')).toBeNull();
    expect(creatorLayoutForAsset('carousel')).toBeNull();
    expect(creatorLayoutForAsset('infographic')).toBeNull();
    expect(creatorLayoutForAsset('brand_card')).toBeNull();
  });
});

describe('Taxonomy consolidation — asset family normalization', () => {
  test('creatorContentAssetFamily still routes slider → carousel', () => {
    expect(creatorContentAssetFamily('slider')).toBe('carousel');
  });

  test('creatorContentAssetFamily still routes pdf → carousel', () => {
    expect(creatorContentAssetFamily('pdf')).toBe('carousel');
  });

  test('creatorContentAssetFamily routes banner → image (via default branch)', () => {
    expect(creatorContentAssetFamily('banner' as never)).toBe('image');
  });

  test('creatorContentAssetFamily preserves carousel', () => {
    expect(creatorContentAssetFamily('carousel')).toBe('carousel');
  });
});

describe('Taxonomy consolidation — historical label compatibility', () => {
  test('assetLabel still returns "Banner" for historical banner attachments', () => {
    expect(assetLabel('banner' as WriterCreatorAssetType)).toBe('Banner');
  });

  test('assetLabel returns expected labels for the 3 consolidated types', () => {
    expect(assetLabel('supporting_image')).toBe('Image');
    expect(assetLabel('carousel')).toBe('Carousel');
    expect(assetLabel('infographic')).toBe('Infographic');
  });

  test('assetLabel still returns "Brand Card" for the canonical writer subtype', () => {
    expect(assetLabel('brand_card')).toBe('Brand Card');
  });
});

describe('Taxonomy consolidation — historical type unions intact', () => {
  test('CREATOR_CONTENT_ASSET_TYPES still includes banner for historical reads', () => {
    expect(CREATOR_CONTENT_ASSET_TYPES).toContain('banner');
  });

  test('CREATOR_CONTENT_ASSET_TYPES still includes slider for historical reads', () => {
    expect(CREATOR_CONTENT_ASSET_TYPES).toContain('slider');
  });

  test('CREATOR_CONTENT_ASSET_TYPES still includes the 3 consolidated primary types', () => {
    expect(CREATOR_CONTENT_ASSET_TYPES).toContain('image');
    expect(CREATOR_CONTENT_ASSET_TYPES).toContain('carousel');
    expect(CREATOR_CONTENT_ASSET_TYPES).toContain('infographic');
  });
});

describe('Taxonomy consolidation — writer Add Asset menu', () => {
  test('POST_CREATOR_ASSET_TYPES_VISIBLE excludes banner', () => {
    expect(POST_CREATOR_ASSET_TYPES_VISIBLE).not.toContain('banner');
  });

  test('THREAD_CREATOR_ASSET_TYPES_VISIBLE excludes banner', () => {
    expect(THREAD_CREATOR_ASSET_TYPES_VISIBLE).not.toContain('banner');
  });

  test('underlying POST_CREATOR_ASSET_TYPES still includes banner for backward compat', () => {
    expect(POST_CREATOR_ASSET_TYPES).toContain('banner');
  });

  test('THREAD_CREATOR_ASSET_TYPES still has its writer-attachment subtypes', () => {
    // Thread's only writer-attachable subtype today is carousel.
    expect(THREAD_CREATOR_ASSET_TYPES).toContain('carousel');
  });

  test('POST_CREATOR_ASSET_TYPES_VISIBLE preserves the consolidated primary types', () => {
    // supporting_image is the writer-side identifier for Image.
    expect(POST_CREATOR_ASSET_TYPES_VISIBLE).toContain('supporting_image');
    expect(POST_CREATOR_ASSET_TYPES_VISIBLE).toContain('infographic');
  });

  test('VISIBLE arrays are strictly subsets of the underlying arrays', () => {
    for (const t of POST_CREATOR_ASSET_TYPES_VISIBLE) expect(POST_CREATOR_ASSET_TYPES).toContain(t);
    for (const t of THREAD_CREATOR_ASSET_TYPES_VISIBLE) expect(THREAD_CREATOR_ASSET_TYPES).toContain(t);
  });
});

describe('Taxonomy consolidation — API alias map preserved', () => {
  // Direct check of the alias map shape in pages/api/creator-assets/index.ts
  // by exercising the helper. We import the file lazily so jest doesn't
  // pull in the Next.js handler boilerplate.
  test('historical banner and slider creator_type queries still resolve', () => {
    // The alias map at pages/api/creator-assets/index.ts:14-26 must
    // contain both entries. Inline-import the module file source so we
    // assert the shape without running the handler.
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const file = fs.readFileSync(path.resolve(__dirname, '../../../pages/api/creator-assets/index.ts'), 'utf8');
    expect(file).toMatch(/banner:\s*\['banner'\]/);
    expect(file).toMatch(/slider:\s*\['slider'\]/);
    expect(file).toMatch(/supporting_image:\s*\['supporting_image',\s*'image'\]/);
  });
});

describe('Taxonomy consolidation — canonical registry preserves runtime aliases', () => {
  // Pulls in the registry to confirm runtime_asset_types still includes
  // banner and slider entries. This is what allows historical reads to
  // continue normalizing to canonical families.
  test('registry image entry still includes banner in runtime_asset_types', () => {
    const { CREATOR_ASSET_REGISTRY } =
      require('../../services/creator/intelligence/canonical/creatorAssetRegistry') as typeof import('../../services/creator/intelligence/canonical/creatorAssetRegistry');
    const imageEntry = CREATOR_ASSET_REGISTRY.image;
    expect(imageEntry.runtime_asset_types).toContain('banner');
  });

  test('registry carousel entry still includes slider + pdf in runtime_asset_types', () => {
    const { CREATOR_ASSET_REGISTRY } =
      require('../../services/creator/intelligence/canonical/creatorAssetRegistry') as typeof import('../../services/creator/intelligence/canonical/creatorAssetRegistry');
    const carouselEntry = CREATOR_ASSET_REGISTRY.carousel;
    expect(carouselEntry.runtime_asset_types).toContain('slider');
    expect(carouselEntry.runtime_asset_types).toContain('pdf');
  });
});
