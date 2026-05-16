import { __test } from '../../services/creatorAssetRenderer';

describe('Writer Creator renderer dispatch', () => {
  it('dispatches banner and infographic to distinct renderer kinds', () => {
    expect(__test.resolveWriterRendererKind({
      assetKind: 'image',
      metadata: { writer_asset_type: 'banner' },
    })).toBe('banner');
    expect(__test.resolveWriterRendererKind({
      assetKind: 'image',
      metadata: { writer_asset_type: 'infographic' },
    })).toBe('infographic');
  });

  it('keeps supporting image and brand card independent', () => {
    expect(__test.resolveWriterRendererKind({
      assetKind: 'image',
      metadata: { writer_asset_type: 'supporting_image' },
    })).toBe('supporting_image');
    expect(__test.resolveWriterRendererKind({
      assetKind: 'image',
      metadata: { writer_asset_type: 'brand_card' },
    })).toBe('brand_card');
  });

  it('routes carousel intent to carousel renderer kind', () => {
    expect(__test.resolveWriterRendererKind({
      assetKind: 'carousel',
      metadata: { writer_asset_type: 'carousel' },
    })).toBe('carousel');
  });

  it('keeps PDF and slider as distinct six-route renderer identities', () => {
    expect(__test.resolveWriterRendererKind({
      assetKind: 'carousel',
      metadata: { creator_content_asset_type: 'pdf' },
    })).toBe('pdf');
    expect(__test.resolveWriterRendererKind({
      assetKind: 'carousel',
      metadata: { creator_content_asset_type: 'slider' },
    })).toBe('slider');
  });

  it('routes infographic away from generic image overlay renderer', () => {
    expect(__test.resolveWriterRendererKind({
      assetKind: 'image',
      metadata: { creator_content_asset_type: 'infographic' },
    })).toBe('infographic');
  });
});
