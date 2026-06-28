jest.mock('../../../lib/media/imageService', () => ({ searchImages: jest.fn(async () => []) }));

import type { ContentBlock } from '../../../lib/blog/blockTypes';
import { searchImages } from '../../../lib/media/imageService';
import {
  getRuntimeProviderChain, type ProviderDiagnosticEvent,
} from '../../../lib/content/assetRealizationProviders';
import {
  deriveAssetSlots, realizeAssetSlot, realizeDocumentAssets, regenerateSlot,
  inventoryAssetBlocks, validateLayoutParity, type RealizationContext, type RealizedAsset,
} from '../../../lib/content/assetRealization';

const mockSearch = searchImages as jest.Mock;
const LONG_FORM_TYPES = ['blog', 'article', 'story', 'guide', 'newsletter', 'whitepaper', 'case-study', 'research-report', 'ebook'];

function doc(salt: string): ContentBlock[] {
  return [
    { id: `${salt}-hero`, type: 'image', url: '', alt: 'Hero', caption: 'Lead', hint: 'hero image' } as ContentBlock,
    { id: `${salt}-h`, type: 'heading', level: 2, text: 'Section', anchor: 'section' } as ContentBlock,
    { id: `${salt}-p`, type: 'paragraph', html: '<p>Body context for the section.</p>' } as ContentBlock,
    { id: `${salt}-img2`, type: 'image', url: '', alt: 'Inline', hint: 'inline image' } as ContentBlock,
    { id: `${salt}-info`, type: 'creator_asset', creatorType: 'infographic', title: 'Stats', caption: 'Numbers' } as ContentBlock,
  ];
}
const ctx = (t: string): RealizationContext => ({ contentType: t, documentTitle: `Demo ${t}`, brandStyle: 'modern, tech', templateName: 'Magazine' });
const stockResult = (full: string) => ({ id: full, thumb: full, full, alt: `alt ${full}`, author: 'Jo', attribution: 'u', source: 'unsplash' });

beforeEach(() => { mockSearch.mockReset(); mockSearch.mockResolvedValue([]); });

describe('CREATOR-039 — production provider integration', () => {
  it('STEP 2 — AI provider is used first and stamps canonical metadata (providerId/model/at/org)', async () => {
    const aiGenerate = jest.fn(async (): Promise<RealizedAsset> => ({ url: 'https://ai/x.png', provider: 'ai', generation: { model: 'gpt-image-1' } }));
    const chain = getRuntimeProviderChain({ aiGenerate, organizationId: 'org-1', nowMs: () => 5000 });
    const slot = deriveAssetSlots(doc('blog'), ctx('blog'))[0];
    const realized = await realizeAssetSlot(slot, chain, ctx('blog'));
    expect(realized.provider).toBe('ai');
    expect(realized.url).toBe('https://ai/x.png');
    expect(realized.generation).toMatchObject({ providerId: 'ai', model: 'gpt-image-1', at: 5000, organizationId: 'org-1', version: 1 });
    expect(aiGenerate).toHaveBeenCalledTimes(1);   // one image per slot — never batch
  });

  it('STEP 3 — Organization Library resolves when AI declines; metadata records the asset version', async () => {
    const aiGenerate = jest.fn(async () => null);
    const organizationResolve = jest.fn(async (): Promise<RealizedAsset> => ({ url: 'https://org/a.png', provider: 'organization', generation: { assetId: 'a1', version: 3 } }));
    const chain = getRuntimeProviderChain({ aiGenerate, organizationResolve, organizationId: 'org-9', nowMs: () => 1 });
    const realized = await realizeAssetSlot(deriveAssetSlots(doc('guide'), ctx('guide'))[0], chain, ctx('guide'));
    expect(realized.provider).toBe('organization');
    expect(realized.generation).toMatchObject({ providerId: 'organization', assetId: 'a1', version: 3, organizationId: 'org-9' });
  });

  it('STEP 4 — Stock fallback: ranked, de-duplicated within a document, metadata recorded', async () => {
    mockSearch.mockResolvedValue([stockResult('https://s/A.jpg'), stockResult('https://s/B.jpg')]);
    const chain = getRuntimeProviderChain({ nowMs: () => 1 });            // AI/org absent → stock then placeholder
    const { blocks, slots } = await realizeDocumentAssets(doc('news'), chain, ctx('newsletter'));

    const imageSlots = slots.filter((s) => s.assetType === 'image');
    expect(imageSlots[0].url).toBe('https://s/A.jpg');
    expect(imageSlots[1].url).toBe('https://s/B.jpg');                    // de-duped — not A again
    expect(new Set(imageSlots.map((s) => s.url)).size).toBe(imageSlots.length); // no duplicate images
    expect(imageSlots[0].generation).toMatchObject({ providerId: 'stock', source: 'unsplash', deduped: true });
    expect(inventoryAssetBlocks(blocks).every((r) => !r.isEmpty)).toBe(true); // creator_asset → placeholder
  });

  it('STEP 5 — orchestration: each provider returns asset-or-null, never throws, always fills', async () => {
    const aiGenerate = jest.fn(async () => { throw new Error('ai exploded'); });           // throws
    const organizationResolve = jest.fn(async () => null);                                  // no match
    mockSearch.mockResolvedValue([]);                                                       // stock empty
    const events: ProviderDiagnosticEvent[] = [];
    const chain = getRuntimeProviderChain({ aiGenerate, organizationResolve, onDiagnostic: (e) => events.push(e), nowMs: () => 1 });

    const realized = await realizeAssetSlot(deriveAssetSlots(doc('wp'), ctx('whitepaper'))[0], chain, ctx('whitepaper'));
    expect(realized.status).toBe('realized');                 // never empty
    expect(realized.provider).toBe('placeholder');            // fell all the way through
    expect(events.map((e) => [e.providerId, e.reason])).toEqual([
      ['ai', 'error'], ['organization', 'no_match'], ['stock', 'no_match'], ['placeholder', 'resolved'],
    ]);
  });

  it('STEP 8 — diagnostics record provider latency + selection per slot', async () => {
    let clock = 0;
    const nowMs = () => (clock += 10);
    const events: ProviderDiagnosticEvent[] = [];
    mockSearch.mockResolvedValue([stockResult('https://s/A.jpg')]);
    const chain = getRuntimeProviderChain({ onDiagnostic: (e) => events.push(e), nowMs });
    await realizeAssetSlot(deriveAssetSlots(doc('blog'), ctx('blog'))[0], chain, ctx('blog'));
    const stockEvent = events.find((e) => e.providerId === 'stock')!;
    expect(stockEvent.ok).toBe(true);
    expect(stockEvent.latencyMs).toBeGreaterThan(0);
    expect(typeof stockEvent.slotId).toBe('string');
  });

  it('STEP 6 — one-slot regeneration via the production chain touches only that slot + appends history', async () => {
    mockSearch.mockResolvedValue([stockResult('https://s/A.jpg')]);
    const chain = getRuntimeProviderChain({ nowMs: () => 1 });
    const { slots } = await realizeDocumentAssets(doc('story'), chain, ctx('story'));
    const target = slots.find((s) => s.purpose === 'inline')!;
    mockSearch.mockResolvedValue([stockResult('https://s/NEW.jpg')]);
    const regen = await regenerateSlot(target, chain, ctx('story'));
    expect(regen.url).toBe('https://s/NEW.jpg');
    expect(regen.history.at(-1)!.reason).toBe('regenerate');
    expect(regen.blockId).toBe(target.blockId);              // same block — never a neighbor
  });

  it.each(LONG_FORM_TYPES)('STEP 10 — %s realizes fully through the production chain: no missing, no duplicate', async (type) => {
    mockSearch.mockResolvedValue([stockResult('https://s/A.jpg'), stockResult('https://s/B.jpg'), stockResult('https://s/C.jpg')]);
    const source = doc(type);
    const { blocks, slots } = await realizeDocumentAssets(source, getRuntimeProviderChain({ nowMs: () => 1 }), ctx(type));
    expect(slots.every((s) => s.status === 'realized' && !!s.url)).toBe(true);
    expect(inventoryAssetBlocks(blocks).every((r) => !r.isEmpty)).toBe(true);
    const imageUrls = slots.filter((s) => s.assetType === 'image').map((s) => s.url);
    expect(new Set(imageUrls).size).toBe(imageUrls.length);   // no duplicate images in a doc
    expect(validateLayoutParity(source, blocks)).toMatchObject({ ok: true, missing: [], duplicated: [] });
  });

  it('STEP 5 — chain order is AI → Organization → Stock → Placeholder', () => {
    const chain = getRuntimeProviderChain({ aiGenerate: async () => null, organizationResolve: async () => null });
    expect(chain.map((p) => p.id)).toEqual(['ai', 'organization', 'stock', 'placeholder']);
    expect(getRuntimeProviderChain().map((p) => p.id)).toEqual(['stock', 'placeholder']);
    expect(getRuntimeProviderChain({ disableStock: true }).map((p) => p.id)).toEqual(['placeholder']);
  });
});
