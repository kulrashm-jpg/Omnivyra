/**
 * @jest-environment jsdom
 */
import { registerGeneratedAsset } from '../../../lib/content/creatorAssetLibrary';
import { clearAssetCache } from '../../../lib/content/creatorAssetCache';
import {
  listAssets, searchAssets, filterAssets, getRecentAssets,
  getAssetsByType, getAssetsBySource, getAssetsByOrganization,
  getAssetsByCampaign, getAssetsByTags,
} from '../../../lib/content/creatorAssetCatalog';
import type { WriterAttachedAsset } from '../../../lib/content/writerCreatorAssetLaunch';

const mk = (id: string, o: any = {}): WriterAttachedAsset => ({
  id, creatorType: o.assetType ?? 'supporting_image', title: id, url: `${id}.png`,
  platformContext: o.platform ?? 'linkedin', createdAt: o.createdAt ?? '2026-06-26T00:00:00.000Z',
  metadata: { company_id: o.org ?? 'org1', campaign_id: o.campaign ?? null, origin: o.source ?? 'writer', template_id: o.template ?? 'tpl1', tags: o.tags ?? ['promo'], status: o.status ?? 'ready' },
});

beforeEach(() => { window.localStorage.clear(); clearAssetCache(); });

async function seed() {
  await registerGeneratedAsset(mk('a1', { assetType: 'carousel', source: 'writer', org: 'org1', campaign: 'c1', tags: ['promo', 'q3'], createdAt: '2026-06-26T00:00:01.000Z' }), { now: '2026-06-26T00:00:01.000Z' });
  await registerGeneratedAsset(mk('a2', { assetType: 'supporting_image', source: 'campaign-creator', org: 'org2', campaign: 'c2', tags: ['brand'], createdAt: '2026-06-26T00:00:02.000Z' }), { now: '2026-06-26T00:00:02.000Z' });
  await registerGeneratedAsset(mk('a3', { assetType: 'infographic', source: 'writer', org: 'org1', campaign: 'c1', tags: ['promo'], createdAt: '2026-06-26T00:00:03.000Z' }), { now: '2026-06-26T00:00:03.000Z' });
}
const ids = (refs: any[]) => refs.map((r) => r.assetId).sort();

describe('Creator Asset Catalog — canonical, metadata-driven discovery (refs only)', () => {
  it('returns references only (no payload), and lists all assets', async () => {
    await seed();
    const refs = await listAssets();
    expect(refs.length).toBe(3);
    for (const r of refs) {
      expect(typeof r.assetId).toBe('string');
      expect(typeof r.version).toBe('number');
      expect((r as Record<string, unknown>).url).toBeUndefined(); // no payload leaked
      expect((r as Record<string, unknown>).title).toBeUndefined();
    }
  });

  it('discovery by type / source / org / campaign', async () => {
    await seed();
    expect(ids(await getAssetsByType('carousel'))).toEqual(['a1']);
    expect(ids(await getAssetsBySource('writer'))).toEqual(['a1', 'a3']);
    expect(ids(await getAssetsByOrganization('org2'))).toEqual(['a2']);
    expect(ids(await getAssetsByCampaign('c1'))).toEqual(['a1', 'a3']);
  });

  it('tags (any vs all) and recent ordering', async () => {
    await seed();
    expect(ids(await getAssetsByTags(['q3']))).toEqual(['a1']);
    expect(ids(await getAssetsByTags(['promo']))).toEqual(['a1', 'a3']);
    expect(ids(await getAssetsByTags(['promo', 'q3'], { matchAll: true }))).toEqual(['a1']);
    expect(ids(await getAssetsByTags(['promo', 'q3']))).toEqual(['a1', 'a3']); // any-match
    const recent = await getRecentAssets(1);
    expect(recent[0].assetId).toBe('a3'); // newest createdAt
  });

  it('filterAssets composes metadata predicates; searchAssets is free-text over metadata', async () => {
    await seed();
    expect(ids(await filterAssets({ assetType: 'infographic', organizationId: 'org1' }))).toEqual(['a3']);
    expect(ids(await filterAssets({ creatorSource: 'writer', campaignId: 'c1', tags: ['promo'] }))).toEqual(['a1', 'a3']);
    expect(ids(await searchAssets('campaign-creator'))).toEqual(['a2']);
    expect(ids(await searchAssets('q3'))).toEqual(['a1']);
    expect((await searchAssets('')).length).toBe(3);
  });

  it('the catalog source module imports ONLY the resolver (no storage/backend/library access)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs'); const path = require('path');
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/content/creatorAssetCatalog.ts'), 'utf8');
    expect(src).not.toMatch(/creatorAssetBackend|creatorAssetLibrary|localStorage|sessionStorage/);
    expect(src).toMatch(/from '\.\/creatorAssetResolver'/);
  });
});
