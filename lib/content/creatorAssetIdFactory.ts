/**
 * Creator Asset ID Factory — the ONE place allowed to mint Creator Asset IDs.
 *
 * No other module may construct asset IDs with `Date.now()`, template strings,
 * random strings, or manual concatenation. Minting paths (generation, save-as,
 * writeback, duplicate) delegate here; the Library's fallback also calls here, so
 * the factory is the single source of asset identity. A source-scan test enforces
 * that no asset IDs are minted outside this module.
 *
 * IDs are opaque keys — never parsed. The format may change without affecting
 * behavior; only uniqueness + stability within a generation matter.
 */

let counter = 0;

function uniqueToken(): string {
  counter = (counter + 1) >>> 0;
  // Date.now()/Math.random() are permitted ONLY here (browser context).
  const time = typeof Date !== 'undefined' && typeof Date.now === 'function' ? Date.now().toString(36) : '0';
  const rand = Math.floor(Math.random() * 0xffffff).toString(36);
  return `${time}${counter.toString(36)}${rand}`;
}

function normalizeKind(kind?: string): string {
  const k = String(kind ?? 'asset').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return k || 'asset';
}

/** Mint a brand-new canonical asset ID. */
export function generateCreatorAssetId(opts?: { kind?: string }): string {
  return `casset_${normalizeKind(opts?.kind)}_${uniqueToken()}`;
}

/**
 * Whether an id is a TEMPORARY pre-persistence id minted by this factory (vs. a
 * canonical persisted id from the server, e.g. `creator_assets.id`). Convergence
 * uses this to know which ids must be replaced once persistence returns a
 * canonical id. The `casset_` prefix is the factory's exclusive marker.
 */
export function isTemporaryCreatorAssetId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('casset_');
}

/** Mint a new ID for a duplicate of an existing asset. */
export function duplicateCreatorAssetId(sourceAssetId: string): string {
  const base = String(sourceAssetId ?? '').trim() || 'casset';
  return `${base}_copy_${uniqueToken()}`;
}

/**
 * The ID to use for a NEW VERSION of an existing asset. Versions reuse the same
 * stable asset ID (versioning is internal to the asset), so this returns the
 * source ID unchanged — provided for explicit, canonical call sites.
 */
export function versionedCreatorAssetId(sourceAssetId: string): string {
  return String(sourceAssetId ?? '');
}
