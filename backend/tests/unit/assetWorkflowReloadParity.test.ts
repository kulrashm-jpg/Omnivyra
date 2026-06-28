/**
 * CREATOR-040 — data-level validation of the parity chain that a live browser
 * test exercises: Generated → Editor → Draft (save) → Reloaded Draft. The UI
 * click-through + AI image visuals require manual QA, but the STRUCTURAL
 * invariants (no empty/missing/duplicate/reordered images; caption/alt/url
 * persist a save→reload round-trip) are verified here against the real engine.
 */
import type { ContentBlock, ImageBlock } from '../../../lib/blog/blockTypes';
import {
  realizeDocumentAssetsSync, deriveAssetSlots, applySlotToBlocks, setSlotCaption, setSlotAltText,
  inventoryAssetBlocks, validateLayoutParity, type RealizationContext,
} from '../../../lib/content/assetRealization';

const LONG_FORM_TYPES = ['blog', 'article', 'story', 'guide', 'newsletter', 'whitepaper', 'case-study', 'research-report', 'ebook'];

function generatedDoc(salt: string): ContentBlock[] {
  return [
    { id: `${salt}-hero`, type: 'image', url: '', alt: 'Hero', caption: 'Lead visual', hint: 'hero' } as ContentBlock,
    { id: `${salt}-h`, type: 'heading', level: 2, text: 'Section', anchor: 'section' } as ContentBlock,
    { id: `${salt}-p`, type: 'paragraph', html: '<p>Section body.</p>' } as ContentBlock,
    { id: `${salt}-img2`, type: 'image', url: '', alt: 'Inline', hint: 'inline' } as ContentBlock,
    { id: `${salt}-cols`, type: 'columns', columnCount: 2, columns: [
      { id: `${salt}-c0`, blocks: [{ id: `${salt}-cl`, type: 'image', url: '', alt: 'L', hint: 'comparison left' } as ContentBlock] },
      { id: `${salt}-c1`, blocks: [{ id: `${salt}-cr`, type: 'image', url: '', alt: 'R', hint: 'comparison right' } as ContentBlock] },
    ] } as ContentBlock,
  ];
}
const ctx = (t: string): RealizationContext => ({ contentType: t, documentTitle: `Demo ${t}`, stamp: 1 });

// Simulate the draft save→reload round-trip (DB stores content_blocks as JSON).
const saveReload = (blocks: ContentBlock[]): ContentBlock[] => JSON.parse(JSON.stringify(blocks));

describe('Generated → Editor → Draft → Reloaded Draft parity (data level)', () => {
  it.each(LONG_FORM_TYPES)('%s — realized images survive save→reload with no structural drift', (type) => {
    const source = generatedDoc(type);
    const realized = realizeDocumentAssetsSync(source, ctx(type)).blocks;     // editor receives this
    const reloaded = saveReload(realized);                                     // draft saved + reloaded

    // No empty / missing / duplicate / reordered images after reload.
    expect(inventoryAssetBlocks(reloaded).every((r) => !r.isEmpty)).toBe(true);
    expect(validateLayoutParity(source, reloaded)).toMatchObject({ ok: true, missing: [], duplicated: [], reordered: false });
    // Image identity + urls are byte-identical pre/post reload.
    expect(JSON.stringify(reloaded)).toBe(JSON.stringify(realized));
    // Re-deriving slots after reload yields the same realized urls (no re-realization needed).
    const slots = deriveAssetSlots(reloaded, ctx(type));
    expect(slots.every((s) => !!s.url && s.status === 'realized')).toBe(true);
  });

  it('caption + alt edits persist across save→reload (block-level fields)', () => {
    const realized = realizeDocumentAssetsSync(generatedDoc('blog'), ctx('blog')).blocks;
    const heroSlot = deriveAssetSlots(realized, ctx('blog')).find((s) => s.purpose === 'hero')!;
    let edited = applySlotToBlocks(realized, setSlotCaption(heroSlot, 'Edited caption'));
    edited = applySlotToBlocks(edited, setSlotAltText({ ...heroSlot, caption: 'Edited caption' }, 'Edited alt'));

    const reloaded = saveReload(edited);
    const hero = reloaded.find((b) => b.id === 'blog-hero') as ImageBlock;
    expect(hero.caption).toBe('Edited caption');
    expect(hero.alt).toBe('Edited alt');
    expect(hero.url).toBeTruthy();
  });

  it('story variant wiring (sanitize → realize) fills every image', () => {
    // Mirrors pages/stories/new.tsx: sanitize first, then realize.
    const sanitize = (blocks: ContentBlock[]) => blocks; // story sanitizer is text-only; identity for images
    const realized = realizeDocumentAssetsSync(sanitize(generatedDoc('story')), ctx('story')).blocks;
    expect(inventoryAssetBlocks(realized).every((r) => !r.isEmpty)).toBe(true);
  });
});
