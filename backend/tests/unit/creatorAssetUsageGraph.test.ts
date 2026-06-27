/**
 * @jest-environment jsdom
 */
import {
  attachUsage, detachUsage, replaceUsage, moveUsage, duplicateUsage,
  listConsumers, listAssetsForConsumer, clearUsageGraph, writerDraftConsumer,
  type AssetConsumer,
} from '../../../lib/content/creatorAssetUsageGraph';
import type { CreatorAssetRef } from '../../../lib/content/creatorAssetResolver';

const ref = (assetId: string, version = 1): CreatorAssetRef => ({ assetId, version, selectedVariant: null });
const draftA: AssetConsumer = { type: 'writer-draft', id: 'post:draftA' };
const campaign1: AssetConsumer = { type: 'campaign', id: 'camp1' };
const ids = (refs: CreatorAssetRef[]) => refs.map((r) => r.assetId).sort();
const keys = (cs: AssetConsumer[]) => cs.map((c) => `${c.type}:${c.id}`).sort();

beforeEach(() => { window.localStorage.clear(); clearUsageGraph(); });

describe('Creator Asset Usage Graph — canonical relationship layer', () => {
  it('attach: both-way lookup (where used / what contained); dedupes per consumer', async () => {
    await attachUsage(ref('a1'), draftA, { now: '2026-06-26T00:00:00.000Z' });
    await attachUsage(ref('a2'), draftA, { now: '2026-06-26T00:00:01.000Z' });
    await attachUsage(ref('a1'), campaign1, { now: '2026-06-26T00:00:02.000Z' });
    // re-attach a1 to draftA (new version) → updates, not duplicates
    await attachUsage(ref('a1', 2), draftA, { now: '2026-06-26T00:00:03.000Z' });

    expect(ids(await listAssetsForConsumer(draftA))).toEqual(['a1', 'a2']);
    expect((await listAssetsForConsumer(draftA)).find((r) => r.assetId === 'a1')!.version).toBe(2);
    expect(keys(await listConsumers('a1'))).toEqual(['campaign:camp1', 'writer-draft:post:draftA']);
  });

  it('detach removes only the targeted edge', async () => {
    await attachUsage(ref('a1'), draftA); await attachUsage(ref('a1'), campaign1);
    await detachUsage('a1', draftA);
    expect(keys(await listConsumers('a1'))).toEqual(['campaign:camp1']);
  });

  it('replace swaps an asset within a consumer (preserving role)', async () => {
    await attachUsage(ref('a1'), draftA, { role: 'hero' });
    await replaceUsage(draftA, 'a1', ref('a9'));
    expect(ids(await listAssetsForConsumer(draftA))).toEqual(['a9']);
    expect((await listConsumers('a1')).length).toBe(0);
    const edges = await (await import('../../../lib/content/creatorAssetUsageGraph')).listUsageEdges();
    expect(edges.find((e) => e.assetId === 'a9')!.role).toBe('hero'); // role carried over
  });

  it('move reassigns usage from one consumer to another', async () => {
    await attachUsage(ref('a1'), draftA);
    await moveUsage('a1', draftA, campaign1);
    expect((await listAssetsForConsumer(draftA)).length).toBe(0);
    expect(ids(await listAssetsForConsumer(campaign1))).toEqual(['a1']);
  });

  it('duplicate copies relationships onto a new asset id', async () => {
    await attachUsage(ref('a1'), draftA); await attachUsage(ref('a1'), campaign1);
    await duplicateUsage('a1', 'a1_copy');
    expect(keys(await listConsumers('a1_copy'))).toEqual(['campaign:camp1', 'writer-draft:post:draftA']);
    // original untouched
    expect(keys(await listConsumers('a1'))).toEqual(['campaign:camp1', 'writer-draft:post:draftA']);
  });

  it('writerDraftConsumer builds a stable consumer id', () => {
    expect(writerDraftConsumer('post', 'post:draft')).toEqual({ type: 'writer-draft', id: 'post:post:draft' });
  });
});
