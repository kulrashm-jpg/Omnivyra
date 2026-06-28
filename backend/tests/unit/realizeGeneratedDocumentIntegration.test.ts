import type { ContentBlock, ImageBlock } from '../../../lib/blog/blockTypes';
import { realizeGeneratedDocument, realizeGeneratedBlocks } from '../../../lib/content/realizeGeneratedDocument';
import { buildImageAssetActions } from '../../../lib/content/assetSlotEditorActions';
import { getRuntimeProviderChain } from '../../../lib/content/assetRealizationProviders';
import { deriveAssetSlots, defaultProviderChain, inventoryAssetBlocks, type AssetSlot } from '../../../lib/content/assetRealization';

const LONG_FORM_TYPES = ['blog', 'article', 'story', 'guide', 'newsletter', 'whitepaper', 'case-study', 'research-report', 'ebook'];

// This suite validates the SEAM realization mechanism, exercised by the
// 'placeholder' policy. (Default 'stock' leaves seam images empty for the editor
// to fill — covered separately in assetPolicyAndAiContract.test.ts.)
let _savedPolicy: string | undefined;
beforeAll(() => { _savedPolicy = process.env.LONGFORM_EMPTY_IMAGE_POLICY; process.env.LONGFORM_EMPTY_IMAGE_POLICY = 'placeholder'; });
afterAll(() => { if (_savedPolicy === undefined) delete process.env.LONGFORM_EMPTY_IMAGE_POLICY; else process.env.LONGFORM_EMPTY_IMAGE_POLICY = _savedPolicy; });

/** A raw generated output (template skeleton with empty image/asset blocks). */
function generatedOutput(salt: string) {
  const content_blocks: ContentBlock[] = [
    { id: `${salt}-hero`, type: 'image', url: '', alt: 'Hero', caption: 'Opening visual', hint: 'hero image' } as ContentBlock,
    { id: `${salt}-h`, type: 'heading', level: 2, text: 'Section', anchor: 'section' } as ContentBlock,
    { id: `${salt}-p`, type: 'paragraph', html: '<p>Body text that is reasonably long for context.</p>' } as ContentBlock,
    { id: `${salt}-inline`, type: 'image', url: '', alt: 'Inline', hint: 'supporting image' } as ContentBlock,
    { id: `${salt}-info`, type: 'creator_asset', creatorType: 'infographic', title: 'Stats', caption: 'Numbers' } as ContentBlock,
  ];
  return { title: `Demo ${salt}`, content_blocks };
}
const DEFAULT_TEMPLATE: ContentBlock[] = [{ id: 'tpl-p', type: 'paragraph', html: '<p>Default.</p>' } as ContentBlock];

describe('CREATOR-038 — live integration: realize before the editor opens', () => {
  it('STEP 2 — generated output arrives already realized (no empty image blocks)', () => {
    const { content_blocks, slots, diagnostics } = realizeGeneratedDocument(generatedOutput('blog'), DEFAULT_TEMPLATE, { contentType: 'blog', documentTitle: 'Demo', stamp: 1 });
    expect(slots.length).toBe(3);
    expect(slots.every((s) => s.status === 'realized' && !!s.url)).toBe(true);
    expect(inventoryAssetBlocks(content_blocks).every((r) => !r.isEmpty)).toBe(true);
    expect(diagnostics.emptyAfter).toBe(0);
    expect(diagnostics.layoutParityOk).toBe(true);
    expect(diagnostics.missingAssets).toEqual([]);
    expect(diagnostics.realizedCount).toBe(3);
  });

  it.each(LONG_FORM_TYPES)('STEP 8 — %s: every image is realized before the editor receives blocks', (type) => {
    const blocks = realizeGeneratedBlocks(generatedOutput(type), DEFAULT_TEMPLATE, { contentType: type, documentTitle: `Demo ${type}`, stamp: 1 });
    const imgs = inventoryAssetBlocks(blocks);
    expect(imgs.length).toBe(3);
    expect(imgs.every((r) => !r.isEmpty)).toBe(true);
  });

  it('falls back to the default template when generation produced nothing — still realized', () => {
    const { content_blocks } = realizeGeneratedDocument({ content_blocks: [] }, [
      { id: 'd-img', type: 'image', url: '', alt: 'Default hero', hint: 'hero' } as ContentBlock,
    ], { contentType: 'blog', stamp: 1 });
    expect((content_blocks.find((b) => b.id === 'd-img') as ImageBlock).url).toBeTruthy();
  });

  it('STEP 6/7 — image actions are functional and isolate to ONE slot/block', async () => {
    const blocks = realizeGeneratedBlocks(generatedOutput('guide'), DEFAULT_TEMPLATE, { contentType: 'guide', stamp: 1 });
    const heroBlock = blocks.find((b) => b.id === 'guide-hero') as ImageBlock;
    const slot = deriveAssetSlots(blocks, { contentType: 'guide' }).find((s) => s.blockId === 'guide-hero')!;

    const calls: Array<{ b: ImageBlock; s: AssetSlot }> = [];
    const actions = buildImageAssetActions({
      block: heroBlock,
      slot,
      providers: defaultProviderChain(),                 // placeholder-only → deterministic
      ctx: { contentType: 'guide' },
      apply: (b, s) => calls.push({ b, s }),
      pickUpload: async () => ({ url: 'https://cdn/up.png', altText: 'Up' }),
      pickUrl: () => 'https://ext/import.png',
      openMediaLibrary: () => { /* opens stock popover */ },
      stamp: () => 7,
    });

    // All advertised actions are wired (no dead buttons for the capabilities we provide).
    expect(Object.keys(actions).sort()).toEqual(['onGenerateAI', 'onImportUrl', 'onMediaLibrary', 'onRemove', 'onReplace', 'onUpload'].sort());

    await actions.onGenerateAI!();          // regenerate → new placeholder (attempt bumped)
    expect(calls.at(-1)!.b.url).toMatch(/picsum\.photos/);
    expect(calls.at(-1)!.b.url).not.toBe(heroBlock.url);
    expect(calls.at(-1)!.s.history.at(-1)!.reason).toBe('regenerate');

    await actions.onUpload!();
    expect(calls.at(-1)!.b.url).toBe('https://cdn/up.png');
    expect(calls.at(-1)!.s.provider).toBe('upload');

    await actions.onImportUrl!();
    expect(calls.at(-1)!.b.url).toBe('https://ext/import.png');

    actions.onRemove!();
    expect(calls.at(-1)!.b.url).toBe('');
    expect(calls.at(-1)!.s.status).toBe('empty');

    // Every produced block keeps the same id (one block, never reordered/duplicated).
    expect(calls.every((c) => c.b.id === 'guide-hero')).toBe(true);
  });

  it('STEP 5 — runtime provider chain ends in placeholder and respects config', () => {
    expect(getRuntimeProviderChain().at(-1)!.id).toBe('placeholder');
    expect(getRuntimeProviderChain().some((p) => p.id === 'stock')).toBe(true);
    expect(getRuntimeProviderChain({ disableStock: true }).some((p) => p.id === 'stock')).toBe(false);
    expect(getRuntimeProviderChain({ aiGenerate: async () => ({ url: 'x', provider: 'ai' }) })[0].id).toBe('ai');
  });

  it('media-library action is omitted when no opener is wired (no dead button)', () => {
    const blocks = realizeGeneratedBlocks(generatedOutput('blog'), DEFAULT_TEMPLATE, { contentType: 'blog', stamp: 1 });
    const block = blocks.find((b) => b.id === 'blog-hero') as ImageBlock;
    const actions = buildImageAssetActions({
      block, slot: deriveAssetSlots(blocks, { contentType: 'blog' })[0],
      providers: defaultProviderChain(), ctx: { contentType: 'blog' }, apply: () => {},
    });
    expect(actions.onMediaLibrary).toBeUndefined();
    expect(actions.onUpload).toBeUndefined();
    expect(actions.onGenerateAI).toBeDefined();   // engine-only actions always present
  });
});
