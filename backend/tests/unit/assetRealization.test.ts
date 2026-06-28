import type { ContentBlock } from '../../../lib/blog/blockTypes';
import {
  inventoryAssetBlocks, deriveAssetSlots, realizeAssetSlot, realizeDocumentAssets,
  defaultProviderChain, placeholderProvider, makeAiProvider, applySlotToBlocks,
  regenerateSlot, applyUploadToSlot, applyLibraryAssetToSlot, applyUrlToSlot,
  setSlotCaption, setSlotAltText, removeSlotAsset, revertSlot,
  validateLayoutParity, reconcileTemplateLayout, serializeSlots, deserializeSlots,
  type AssetProvider, type RealizationContext,
} from '../../../lib/content/assetRealization';

/* Every long-form type the engine must serve identically (incl. report + ebook). */
const LONG_FORM_TYPES = ['blog', 'article', 'story', 'guide', 'newsletter', 'whitepaper', 'case-study', 'research-report', 'ebook'];

/** A representative template document with the full visual-asset vocabulary. */
function buildDoc(salt: string): ContentBlock[] {
  return [
    { id: `${salt}-hero`, type: 'image', url: '', alt: 'Hero image', caption: 'A bold opening visual', hint: 'hero cover image' } as ContentBlock,
    { id: `${salt}-h2a`, type: 'heading', level: 2, text: 'The Big Idea', anchor: 'the-big-idea' } as ContentBlock,
    { id: `${salt}-p1`, type: 'paragraph', html: '<p>This section explains the core concept in depth and at length.</p>' } as ContentBlock,
    { id: `${salt}-inline`, type: 'image', url: '', alt: 'Inline image', hint: 'an inline supporting photo' } as ContentBlock,
    { id: `${salt}-h2b`, type: 'heading', level: 2, text: 'Side by Side', anchor: 'side-by-side' } as ContentBlock,
    { id: `${salt}-cols`, type: 'columns', columnCount: 2, columns: [
      { id: `${salt}-c0`, blocks: [{ id: `${salt}-cmpL`, type: 'image', url: '', alt: 'Left option', hint: 'comparison left' } as ContentBlock] },
      { id: `${salt}-c1`, blocks: [{ id: `${salt}-cmpR`, type: 'image', url: '', alt: 'Right option', hint: 'comparison right' } as ContentBlock] },
    ] } as ContentBlock,
    { id: `${salt}-info`, type: 'creator_asset', creatorType: 'infographic', title: 'Stats infographic', caption: 'Key numbers' } as ContentBlock,
    { id: `${salt}-vid`, type: 'media', mediaType: 'youtube', url: '', title: 'Explainer video' } as ContentBlock,
    { id: `${salt}-sum`, type: 'summary', body: 'A short closing synthesis of the piece.' } as ContentBlock,
  ];
}

const ctx = (contentType: string): RealizationContext => ({ contentType, documentTitle: `Demo ${contentType}`, templateName: 'Magazine', stamp: 1000 });

describe('Universal Asset Realization Engine (CREATOR-037)', () => {
  it('STEP 1 — inventories every visual block with an inferred purpose, across nesting', () => {
    const inv = inventoryAssetBlocks(buildDoc('blog'));
    expect(inv.map((r) => r.assetType).sort()).toEqual(['creator_asset', 'image', 'image', 'image', 'image', 'media'].sort());
    const byId = Object.fromEntries(inv.map((r) => [r.blockId.replace('blog-', ''), r.purpose]));
    expect(byId.hero).toBe('hero');
    expect(byId.inline).toBe('inline');
    expect(byId.cmpL).toBe('comparison');   // inside 2-col layout with sibling image
    expect(byId.cmpR).toBe('comparison');
    expect(byId.info).toBe('infographic');
    expect(byId.vid).toBe('media');
    expect(inv.find((r) => r.blockId === 'blog-cmpL')!.indexPath).toEqual([5, 0, 0]); // path into columns
  });

  it.each(LONG_FORM_TYPES)('%s — realization fills EVERY slot (no empty box) and preserves layout', async (type) => {
    const doc = buildDoc(type);
    const providers = defaultProviderChain();             // placeholder-only worst case
    const { blocks, slots } = await realizeDocumentAssets(doc, providers, ctx(type));

    // Every derived slot is realized — zero empties.
    expect(slots.length).toBe(6);
    expect(slots.every((s) => s.status === 'realized' && !!s.url)).toBe(true);

    // Every visual block in the document now carries a URL — never a placeholder gap.
    const inv = inventoryAssetBlocks(blocks);
    expect(inv.every((r) => !r.isEmpty)).toBe(true);

    // Template → realized layout is structurally identical (STEP 9).
    const report = validateLayoutParity(doc, blocks);
    expect(report).toMatchObject({ ok: true, missing: [], duplicated: [], reordered: false, templateAssetCount: 6, realizedAssetCount: 6 });
  });

  it('STEP 3 — provider priority: AI wins when available, else falls through to placeholder', async () => {
    const ai: AssetProvider = makeAiProvider(async (prompt) => (prompt.includes('hero') ? { url: 'https://ai/hero.png', provider: 'ai' } : null));
    const doc = buildDoc('blog');
    const slots = deriveAssetSlots(doc, ctx('blog'));
    const heroSlot = slots.find((s) => s.purpose === 'hero')!;
    const inlineSlot = slots.find((s) => s.purpose === 'inline')!;

    const heroRealized = await realizeAssetSlot(heroSlot, defaultProviderChain({ ai }), ctx('blog'));
    const inlineRealized = await realizeAssetSlot(inlineSlot, defaultProviderChain({ ai }), ctx('blog'));
    expect(heroRealized.provider).toBe('ai');
    expect(heroRealized.url).toBe('https://ai/hero.png');
    expect(inlineRealized.provider).toBe('placeholder');  // AI declined → fell through
    expect(inlineRealized.url).toMatch(/picsum\.photos/);

    // The prompt was synthesized from page context (title + section + purpose).
    expect(heroSlot.prompt).toMatch(/Document: Demo blog/);
    expect(inlineSlot.prompt).toMatch(/Section: The Big Idea/);
  });

  it('STEP 6/7 — regenerate / upload / library / url touch ONLY their slot; everything else identical', async () => {
    const doc = buildDoc('guide');
    const { blocks, slots } = await realizeDocumentAssets(doc, defaultProviderChain(), ctx('guide'));
    const target = slots.find((s) => s.purpose === 'inline')!;
    const others = slots.filter((s) => s.slotId !== target.slotId).map((s) => ({ ...s }));

    // Regenerate one slot via a fresh AI url.
    const ai = makeAiProvider(async () => ({ url: 'https://ai/new-inline.png', provider: 'ai' as const }));
    const regenerated = await regenerateSlot(target, defaultProviderChain({ ai }), ctx('guide'));
    expect(regenerated.url).toBe('https://ai/new-inline.png');
    expect(regenerated.history.length).toBe(target.history.length + 1);
    expect(regenerated.history.at(-1)!.reason).toBe('regenerate');

    // Apply it back — only the inline block changes; all other blocks byte-identical.
    const after = applySlotToBlocks(blocks, regenerated);
    blocks.forEach((b, i) => { if (b.id !== target.blockId) expect(after[i]).toEqual(b); });
    expect((after.find((b) => b.id === target.blockId) as { url: string }).url).toBe('https://ai/new-inline.png');
    // Sibling slots are untouched data.
    others.forEach((o) => expect(slots.find((s) => s.slotId === o.slotId)).toEqual(o));

    // Upload / library / url each replace exactly one slot + append history.
    const up = applyUploadToSlot(target, { url: 'https://cdn/up.png', altText: 'Uploaded' }, 2000);
    expect(up.provider).toBe('upload'); expect(up.url).toBe('https://cdn/up.png'); expect(up.altText).toBe('Uploaded');
    const lib = applyLibraryAssetToSlot(target, { url: 'https://org/lib.png' }, 2001);
    expect(lib.provider).toBe('organization'); expect(lib.url).toBe('https://org/lib.png');
    const url = applyUrlToSlot(target, 'https://ext/u.png', 2002);
    expect(url.provider).toBe('url'); expect(url.history.at(-1)!.reason).toBe('url');
  });

  it('STEP 5/10 — caption, alt, remove, and undo (revert) operate per-slot and persist', async () => {
    const doc = buildDoc('newsletter');
    const { slots } = await realizeDocumentAssets(doc, defaultProviderChain(), ctx('newsletter'));
    let s = slots[0];
    s = setSlotCaption(s, 'New caption'); expect(s.caption).toBe('New caption');
    s = setSlotAltText(s, 'New alt'); expect(s.altText).toBe('New alt');

    const uploaded = applyUploadToSlot(s, { url: 'https://cdn/x.png' }, 1);
    const reverted = revertSlot(uploaded, 2);                 // undo the upload
    expect(reverted.url).toBe(s.url);                          // back to the realized url
    expect(reverted.history.at(-1)!.reason).toBe('revert');

    const removed = removeSlotAsset(s, 3);
    expect(removed.status).toBe('empty'); expect(removed.url).toBeUndefined();

    // Persistence: slots survive a JSON round-trip unchanged.
    const round = deserializeSlots(serializeSlots(slots));
    expect(round).toEqual(slots);
  });

  it('STEP 2/9 — validateLayoutParity catches missing, duplicated, and reordered assets', async () => {
    const doc = buildDoc('whitepaper');
    const { blocks } = await realizeDocumentAssets(doc, defaultProviderChain(), ctx('whitepaper'));
    expect(validateLayoutParity(doc, blocks).ok).toBe(true);

    const dropped = blocks.filter((b) => b.id !== 'whitepaper-inline');
    expect(validateLayoutParity(doc, dropped)).toMatchObject({ ok: false, missing: ['whitepaper-inline'] });

    const duped = [...blocks, blocks.find((b) => b.id === 'whitepaper-vid')!];
    expect(validateLayoutParity(doc, duped).duplicated).toContain('whitepaper-vid');

    const swapped = [...blocks];
    const i = swapped.findIndex((b) => b.id === 'whitepaper-hero');
    const j = swapped.findIndex((b) => b.id === 'whitepaper-inline');
    [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
    expect(validateLayoutParity(doc, swapped).reordered).toBe(true);
  });

  it('STEP 2 — reconcileTemplateLayout re-inserts a dropped asset block without duplication/reorder', () => {
    const tpl = buildDoc('ebook');
    const generated = tpl.filter((b) => b.id !== 'ebook-cols');   // generation dropped the comparison columns
    const { blocks, reinserted } = reconcileTemplateLayout(tpl, generated);
    expect(reinserted).toContain('ebook-cols');
    expect(blocks.some((b) => b.id === 'ebook-cols')).toBe(true);
    expect(blocks.filter((b) => b.id === 'ebook-cols').length).toBe(1); // no duplication
    // After reconcile, every template asset is present.
    expect(validateLayoutParity(tpl, blocks).missing).toEqual([]);
  });

  it('determinism — placeholder realization is stable across runs (no Date.now / random)', async () => {
    const a = await realizeDocumentAssets(buildDoc('story'), [placeholderProvider], ctx('story'));
    const b = await realizeDocumentAssets(buildDoc('story'), [placeholderProvider], ctx('story'));
    expect(a.slots.map((s) => s.url)).toEqual(b.slots.map((s) => s.url));
    expect(a.slots.every((s) => s.aspectRatio.includes(':'))).toBe(true);
  });

  it('captions + alt text survive realization (carried onto the realized slot/block)', async () => {
    const { blocks, slots } = await realizeDocumentAssets(buildDoc('case-study'), defaultProviderChain(), ctx('case-study'));
    const heroBlock = blocks.find((b) => b.id === 'case-study-hero') as { caption?: string; alt: string; url: string };
    expect(heroBlock.caption).toBe('A bold opening visual');
    expect(heroBlock.alt).toBe('Hero image');
    expect(heroBlock.url).toBeTruthy();
    expect(slots.find((s) => s.purpose === 'infographic')!.caption).toBe('Key numbers');
  });
});
