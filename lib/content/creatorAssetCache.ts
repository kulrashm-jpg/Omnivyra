/**
 * Creator Asset Resolver cache — transparent, in-memory, hidden from consumers.
 *
 * A read-through cache of `CreatorAsset` records by id (covering all versions).
 * The resolver populates it on read; library writes invalidate it. The backend
 * stays authoritative — a cache miss always re-reads the backend. Only the
 * resolver (reads) and the library (invalidation) import this module; no consumer
 * touches it.
 */

import type { CreatorAsset } from './creatorAssetLibrary';

const cache = new Map<string, CreatorAsset>();

export function getCachedAsset(assetId: string): CreatorAsset | null {
  return cache.get(assetId) ?? null;
}
export function setCachedAsset(asset: CreatorAsset): void {
  cache.set(asset.id, asset);
}
/** Invalidate one asset's cached record (called automatically by library writes). */
export function invalidateAssetCache(assetId: string): void {
  cache.delete(assetId);
}
export function clearAssetCache(): void {
  cache.clear();
}
