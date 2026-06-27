/**
 * @jest-environment jsdom
 */
import { registerGeneratedAsset } from '../../../lib/content/creatorAssetLibrary';
import { attachUsage, writerDraftConsumer, clearUsageGraph } from '../../../lib/content/creatorAssetUsageGraph';
import { clearAssetCache } from '../../../lib/content/creatorAssetCache';
import {
  attachmentRefsForConsumer,
  resolveSchedulingMediaUrls,
  resolveSchedulingPayloads,
  normalizeIncomingAssetRefs,
} from '../../../lib/content/writerSchedulingRefs';
import type { WriterAttachedAsset } from '../../../lib/content/writerCreatorAssetLaunch';

const mk = (id: string, url: string, files: string[] = []): WriterAttachedAsset => ({ id, creatorType: 'carousel', title: id, url, files, createdAt: 'x' });
beforeEach(() => { window.localStorage.clear(); clearUsageGraph(); clearAssetCache(); });

describe('Scheduling reference transport (resolve-at-send)', () => {
  it('attachmentRefsForConsumer returns graph refs; media is resolver-driven (deduped url + files)', async () => {
    const c = writerDraftConsumer('post', 'd1');
    const r1 = (await registerGeneratedAsset(mk('a1', 'a1.png', ['a1.png', 's1.png']))).ref;
    const r2 = (await registerGeneratedAsset(mk('a2', 'a2.png', ['s2.png']))).ref;
    await attachUsage(r1, c, { order: 1 });
    await attachUsage(r2, c, { order: 2 });

    const refs = await attachmentRefsForConsumer(c);
    expect(refs.map((r) => r.assetId)).toEqual(['a2', 'a1']); // newest-first
    // refs carry only assetId/version/selectedVariant — no payload
    for (const r of refs) expect((r as Record<string, unknown>).url).toBeUndefined();

    const media = await resolveSchedulingMediaUrls(refs);
    expect(media).toEqual(expect.arrayContaining(['a2.png', 's2.png', 'a1.png', 's1.png']));
    expect(new Set(media).size).toBe(media.length); // deduped

    const payloads = await resolveSchedulingPayloads(refs);
    expect(payloads.map((p) => p.id)).toEqual(['a2', 'a1']); // resolution happens here, not in the ref
  });

  it('normalizeIncomingAssetRefs prefers assetRefs; falls back to legacy payloads (back-compat)', () => {
    expect(normalizeIncomingAssetRefs({ assetRefs: [{ assetId: 'x', version: 2, selectedVariant: 'v' }] }))
      .toEqual([{ assetId: 'x', version: 2, selectedVariant: 'v' }]);
    // legacy creatorAttachments → converted once to refs
    expect(normalizeIncomingAssetRefs({ creatorAttachments: [{ id: 'y', url: 'y.png', creatorType: 'image' }] }))
      .toEqual([{ assetId: 'y', version: 1, selectedVariant: null }]);
    // legacy attachments key also supported
    expect(normalizeIncomingAssetRefs({ attachments: [{ id: 'z' }] }))
      .toEqual([{ assetId: 'z', version: 1, selectedVariant: null }]);
    expect(normalizeIncomingAssetRefs({})).toEqual([]);
  });
});
