/**
 * Creator Asset storage backend — the ONLY module that touches asset storage.
 *
 * The library (writes) and the resolver (reads) both go through this interface,
 * so the storage substrate can change (local → server / CDN / blob / database)
 * without any consumer changing. Today: a browser localStorage backend. Swap via
 * `setCreatorAssetBackend(...)`.
 */

import type { CreatorAsset } from './creatorAssetLibrary';

export interface CreatorAssetBackend {
  read(assetId: string): Promise<CreatorAsset | null>;
  readAll(): Promise<CreatorAsset[]>;
  write(asset: CreatorAsset): Promise<void>;
  /** Remove an asset record (used by identity convergence to drop a temp id after
   *  the canonical record has been written under the persisted id). */
  remove(assetId: string): Promise<void>;
}

const LIBRARY_KEY = 'creator_asset_library';
const MAX_ASSETS = 50;

function readMap(): Record<string, CreatorAsset> {
  if (typeof window === 'undefined') return {};
  try { const raw = window.localStorage.getItem(LIBRARY_KEY); return raw ? (JSON.parse(raw) as Record<string, CreatorAsset>) : {}; } catch { return {}; }
}
function writeMap(map: Record<string, CreatorAsset>): void {
  if (typeof window === 'undefined') return;
  try {
    const kept = Object.values(map).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, MAX_ASSETS);
    const capped: Record<string, CreatorAsset> = {};
    for (const a of kept) capped[a.id] = a;
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(capped));
  } catch { /* ignore quota */ }
}

/**
 * The default browser backend — the single localStorage access point. Sync
 * localStorage ops are wrapped in Promise.resolve(); behavior is identical.
 */
export const localCreatorAssetBackend: CreatorAssetBackend = {
  read(assetId) { return Promise.resolve(readMap()[assetId] ?? null); },
  readAll() { return Promise.resolve(Object.values(readMap())); },
  write(asset) { const m = readMap(); m[asset.id] = asset; writeMap(m); return Promise.resolve(); },
  remove(assetId) { const m = readMap(); if (m[assetId]) { delete m[assetId]; writeMap(m); } return Promise.resolve(); },
};

let active: CreatorAssetBackend = localCreatorAssetBackend;

/** Swap the storage substrate (future: server / CDN / blob / DB). Consumers unchanged. */
export function setCreatorAssetBackend(backend: CreatorAssetBackend): void { active = backend; }
/** The active backend. Used only by the library (writes) + the resolver (reads). */
export function creatorAssetBackend(): CreatorAssetBackend { return active; }
