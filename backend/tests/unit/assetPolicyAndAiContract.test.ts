jest.mock('../../../lib/media/imageService', () => ({ searchImages: jest.fn(async () => []) }));

import type { ContentBlock, ImageBlock } from '../../../lib/blog/blockTypes';
import { searchImages } from '../../../lib/media/imageService';
import { realizeGeneratedDocument, realizeEmptyImageSlots } from '../../../lib/content/realizeGeneratedDocument';
import { getRuntimeProviderChain } from '../../../lib/content/assetRealizationProviders';
import { inventoryAssetBlocks, validateLayoutParity, type RealizationContext } from '../../../lib/content/assetRealization';
import { aiGenerateViaRenderInline } from '../../../lib/content/clientAssetProviders';

const mockSearch = searchImages as jest.Mock;
const ctx = (t = 'blog'): RealizationContext => ({ contentType: t, documentTitle: `Demo ${t}`, brandStyle: 'modern' });
const stock = (full: string) => ({ id: full, thumb: full, full, alt: `alt ${full}`, author: 'Jo', attribution: 'a', source: 'unsplash' });

function doc(salt: string): ContentBlock[] {
  return [
    { id: `${salt}-hero`, type: 'image', url: '', alt: 'Hero', hint: 'hero' } as ContentBlock,
    { id: `${salt}-h`, type: 'heading', level: 2, text: 'S', anchor: 's' } as ContentBlock,
    { id: `${salt}-img2`, type: 'image', url: '', alt: 'Inline', hint: 'inline' } as ContentBlock,
    { id: `${salt}-info`, type: 'creator_asset', creatorType: 'infographic', title: 'I' } as ContentBlock,
  ];
}

const POLICY_KEY = 'LONGFORM_EMPTY_IMAGE_POLICY';
let savedPolicy: string | undefined;
let savedAi: string | undefined;
beforeEach(() => {
  mockSearch.mockReset(); mockSearch.mockResolvedValue([]);
  savedPolicy = process.env[POLICY_KEY]; savedAi = process.env.NEXT_PUBLIC_ASSET_AI_IMAGES;
});
afterEach(() => {
  if (savedPolicy === undefined) delete process.env[POLICY_KEY]; else process.env[POLICY_KEY] = savedPolicy;
  if (savedAi === undefined) delete process.env.NEXT_PUBLIC_ASSET_AI_IMAGES; else process.env.NEXT_PUBLIC_ASSET_AI_IMAGES = savedAi;
});

describe('CREATOR-040 STEP 2 — empty-image policy at the seam', () => {
  it("'placeholder' fills every empty image at the seam", () => {
    process.env[POLICY_KEY] = 'placeholder';
    const { content_blocks, diagnostics } = realizeGeneratedDocument({ content_blocks: doc('p') }, [], ctx());
    expect(diagnostics.policy).toBe('placeholder');
    expect(diagnostics.emptyAfter).toBe(0);
    expect((content_blocks.find((b) => b.id === 'p-hero') as ImageBlock).url).toMatch(/picsum\.photos/);
  });

  it("default is 'stock' — images are LEFT EMPTY at the seam (no random placeholders), layout preserved", () => {
    delete process.env[POLICY_KEY];
    const source = doc('s');
    const { content_blocks, diagnostics } = realizeGeneratedDocument({ content_blocks: source }, [], ctx());
    expect(diagnostics.policy).toBe('stock');
    expect((content_blocks.find((b) => b.id === 's-hero') as ImageBlock).url).toBe('');
    expect(diagnostics.emptyAfter).toBeGreaterThan(0);
    expect(validateLayoutParity(source, content_blocks)).toMatchObject({ ok: true, missing: [], duplicated: [] });
  });

  it("'empty' preserves empty image blocks + slot + layout; never deletes or alters", () => {
    process.env[POLICY_KEY] = 'empty';
    const source = doc('e');
    const { content_blocks } = realizeGeneratedDocument({ content_blocks: source }, [], ctx());
    expect(content_blocks.filter((b) => b.type === 'image').length).toBe(2); // both image slots preserved
    expect((content_blocks.find((b) => b.id === 'e-hero') as ImageBlock).url).toBe('');
    expect(validateLayoutParity(source, content_blocks).ok).toBe(true);
  });

  it('invalid policy value falls back to stock', () => {
    process.env[POLICY_KEY] = 'nonsense';
    expect(realizeGeneratedDocument({ content_blocks: doc('x') }, [], ctx()).diagnostics.policy).toBe('stock');
  });
});

describe('CREATOR-040 STEP 2 — editor stock-upgrade (realizeEmptyImageSlots)', () => {
  it('fills empty IMAGE slots via stock→placeholder, de-duped, leaving non-image + layout untouched', async () => {
    mockSearch.mockResolvedValue([stock('https://s/A.jpg'), stock('https://s/B.jpg')]);
    const source = doc('u');
    const { blocks, slots } = await realizeEmptyImageSlots(source, getRuntimeProviderChain({ nowMs: () => 1 }), ctx());
    expect(slots.length).toBe(2);                              // only the 2 image slots
    expect(slots.every((s) => s.assetType === 'image')).toBe(true);
    expect(slots.map((s) => s.url)).toEqual(['https://s/A.jpg', 'https://s/B.jpg']); // ranked + de-duped
    expect((blocks.find((b) => b.id === 'u-info'))).toEqual(source.find((b) => b.id === 'u-info')); // creator_asset untouched
    expect(validateLayoutParity(source, blocks)).toMatchObject({ ok: true, missing: [], duplicated: [] });
  });

  it('placeholder only when stock fails (never empty)', async () => {
    mockSearch.mockResolvedValue([]);                          // stock returns nothing
    const { blocks } = await realizeEmptyImageSlots(doc('f'), getRuntimeProviderChain({ nowMs: () => 1 }), ctx());
    expect((blocks.find((b) => b.id === 'f-hero') as ImageBlock).url).toMatch(/picsum\.photos/);
    expect(inventoryAssetBlocks(blocks).filter((r) => r.assetType === 'image').every((r) => !r.isEmpty)).toBe(true);
  });
});

describe('CREATOR-040 STEP 1 — AI adapter matches the render-inline contract', () => {
  it('posts asset_kind:image + writer_asset_type:supporting_image and maps the hosted URL', async () => {
    process.env.NEXT_PUBLIC_ASSET_AI_IMAGES = '1';
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ rendered: { url: 'https://r/ai.png', metadata: { model: 'gpt-image-1' } } }) }));
    (global as unknown as { fetch: unknown }).fetch = fetchMock;

    const slot = { slotId: 'sc-1', blockId: 'b1', assetType: 'image' as const, purpose: 'hero' as const, prompt: 'A hero about AI marketing', aspectRatio: '16:9', layout: { indexPath: [0], aspectRatio: '16:9' }, history: [], status: 'empty' as const, source: 'generated' as const };
    const result = await aiGenerateViaRenderInline('A hero about AI marketing', slot, ctx());

    expect(result).toMatchObject({ url: 'https://r/ai.png', provider: 'ai' });
    expect(result!.generation).toMatchObject({ providerId: 'ai', model: 'gpt-image-1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/command-center/creator-content/render-inline', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.asset_payload.asset_kind).toBe('image');
    expect(body.asset_payload.media_bundle.metadata.writer_asset_type).toBe('supporting_image');
    expect(body.asset_payload.media_bundle.metadata.ai_image_prompt).toBe('A hero about AI marketing');
    expect(body.asset_payload.aspect_ratio).toBe('16:9');
  });

  it('returns null when the AI flag is off (graceful fall-through)', async () => {
    delete process.env.NEXT_PUBLIC_ASSET_AI_IMAGES;
    const slot = { slotId: 's', blockId: 'b', assetType: 'image' as const, purpose: 'hero' as const, prompt: 'x', aspectRatio: '16:9', layout: { indexPath: [0], aspectRatio: '16:9' }, history: [], status: 'empty' as const, source: 'generated' as const };
    expect(await aiGenerateViaRenderInline('x', slot, ctx())).toBeNull();
  });
});
