/**
 * Creator Asset Usage Graph — the ONE canonical relationship layer.
 *
 * The library knows what an asset IS; this graph knows WHERE it is used. It owns
 * relationships only (asset ↔ consumer edges) — never payloads, metadata, or
 * storage of assets. Every relationship is queryable both ways:
 *   - "Where am I used?"            → listConsumers(assetId)
 *   - "Which assets do I contain?"  → listAssetsForConsumer(consumer)
 *
 * Consumers (writer-draft, campaign, calendar, automation, workflow,
 * published-post, …) are identified by `{ type, id }`. A new consumer type is
 * just a new string — no code change. The Attachment Session no longer infers
 * relationships; it calls `attachUsage()` and the graph owns the rest.
 */

import type { CreatorAssetRef } from './creatorAssetResolver';

export type AssetConsumerType =
  | 'writer-draft'
  | 'campaign'
  | 'calendar'
  | 'automation'
  | 'workflow'
  | 'published-post'
  | string;

export interface AssetConsumer { type: AssetConsumerType; id: string }

export interface AssetUsageEdge {
  assetId: string;
  version: number | null;
  selectedVariant: string | null;
  consumerType: AssetConsumerType;
  consumerId: string;
  role: string | null;
  /** Display order within a consumer — higher = more recent (newest-first). The
   *  graph owns ordering; consumers never sort by an external store. */
  order: number;
  createdAt: string;
}

const GRAPH_KEY = 'creator_asset_usage_graph';

function readEdges(): AssetUsageEdge[] {
  if (typeof window === 'undefined') return [];
  try { const raw = window.localStorage.getItem(GRAPH_KEY); return raw ? (JSON.parse(raw) as AssetUsageEdge[]) : []; } catch { return []; }
}
function writeEdges(edges: AssetUsageEdge[]): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(GRAPH_KEY, JSON.stringify(edges.slice(-500))); } catch { /* ignore quota */ }
}
const sameConsumer = (e: AssetUsageEdge, c: AssetConsumer): boolean => e.consumerType === c.type && e.consumerId === c.id;
const maxOrder = (edges: AssetUsageEdge[], c: AssetConsumer): number =>
  edges.filter((e) => sameConsumer(e, c)).reduce((m, e) => Math.max(m, e.order), 0);

/** Record (or update) that an asset is used by a consumer. Deduped per (asset,
 *  consumer). New edges append (newest-first); a re-attach keeps its position
 *  unless an explicit `order` is given (hydration re-asserts persisted order). */
export async function attachUsage(ref: CreatorAssetRef, consumer: AssetConsumer, opts?: { role?: string | null; now?: string; order?: number }): Promise<void> {
  const edges = readEdges();
  const now = opts?.now ?? new Date().toISOString();
  const existing = edges.find((e) => e.assetId === ref.assetId && sameConsumer(e, consumer));
  if (existing) {
    existing.version = ref.version;
    existing.selectedVariant = ref.selectedVariant ?? null;
    if (opts?.role !== undefined) existing.role = opts.role ?? null;
    if (opts?.order !== undefined) existing.order = opts.order;
  } else {
    edges.push({
      assetId: ref.assetId, version: ref.version, selectedVariant: ref.selectedVariant ?? null,
      consumerType: consumer.type, consumerId: consumer.id, role: opts?.role ?? null,
      order: opts?.order ?? maxOrder(edges, consumer) + 1, createdAt: now,
    });
  }
  writeEdges(edges);
}

/** Reorder a consumer's assets to the given display order (first = newest/top). */
export async function reorderUsage(consumer: AssetConsumer, assetIdsInDisplayOrder: string[]): Promise<void> {
  const edges = readEdges();
  const n = assetIdsInDisplayOrder.length;
  assetIdsInDisplayOrder.forEach((assetId, i) => {
    const e = edges.find((x) => x.assetId === assetId && sameConsumer(x, consumer));
    if (e) e.order = n - i; // first → highest order → top of newest-first list
  });
  writeEdges(edges);
}

/** Remove an asset↔consumer relationship. */
export async function detachUsage(assetId: string, consumer: AssetConsumer): Promise<void> {
  writeEdges(readEdges().filter((e) => !(e.assetId === assetId && sameConsumer(e, consumer))));
}

/** Swap one asset for another within a consumer (preserving the old edge's role). */
export async function replaceUsage(consumer: AssetConsumer, oldAssetId: string, newRef: CreatorAssetRef, opts?: { now?: string }): Promise<void> {
  const role = readEdges().find((e) => e.assetId === oldAssetId && sameConsumer(e, consumer))?.role ?? null;
  await detachUsage(oldAssetId, consumer);
  await attachUsage(newRef, consumer, { role, now: opts?.now });
}

/** Move an asset's usage from one consumer to another (preserving version/role). */
export async function moveUsage(assetId: string, from: AssetConsumer, to: AssetConsumer): Promise<void> {
  const edges = readEdges();
  for (const e of edges) {
    if (e.assetId === assetId && sameConsumer(e, from)) { e.consumerType = to.type; e.consumerId = to.id; }
  }
  writeEdges(edges);
}

/** Duplicate an asset's relationships onto a new asset id (the copy inherits usage). */
export async function duplicateUsage(sourceAssetId: string, newAssetId: string, opts?: { now?: string }): Promise<void> {
  const edges = readEdges();
  const now = opts?.now ?? new Date().toISOString();
  const copies = edges
    .filter((e) => e.assetId === sourceAssetId)
    .map((e) => ({ ...e, assetId: newAssetId, createdAt: now }));
  writeEdges([...edges, ...copies]);
}

/**
 * Identity migration — rewrite every edge of a temporary asset id to the canonical
 * persisted id. Consumers, roles, versions and order are preserved; if both ids
 * already share a consumer (idempotent re-converge), the edges are de-duplicated
 * keeping the higher order. After this, no consumer ever observes the temp id.
 */
export async function reassignAssetIdInGraph(oldAssetId: string, newAssetId: string): Promise<void> {
  if (!oldAssetId || !newAssetId || oldAssetId === newAssetId) return;
  const rewritten = readEdges().map((e) => (e.assetId === oldAssetId ? { ...e, assetId: newAssetId } : e));
  const byKey = new Map<string, AssetUsageEdge>();
  for (const e of rewritten) {
    const key = `${e.assetId}|${e.consumerType}|${e.consumerId}`;
    const prev = byKey.get(key);
    if (!prev || e.order > prev.order) byKey.set(key, e);
  }
  writeEdges([...byKey.values()]);
}

/** Where is this asset used? */
export async function listConsumers(assetId: string): Promise<AssetConsumer[]> {
  const seen = new Set<string>();
  const out: AssetConsumer[] = [];
  for (const e of readEdges()) {
    if (e.assetId !== assetId) continue;
    const key = `${e.consumerType}|${e.consumerId}`;
    if (!seen.has(key)) { seen.add(key); out.push({ type: e.consumerType, id: e.consumerId }); }
  }
  return out;
}

/** Which assets does this consumer contain? (references only, newest-first order) */
export async function listAssetsForConsumer(consumer: AssetConsumer): Promise<CreatorAssetRef[]> {
  return readEdges()
    .filter((e) => sameConsumer(e, consumer))
    .sort((a, b) => (b.order - a.order) || (a.createdAt < b.createdAt ? 1 : -1))
    .map((e) => ({ assetId: e.assetId, version: e.version ?? 1, selectedVariant: e.selectedVariant }));
}

/** All edges (diagnostics). */
export async function listUsageEdges(): Promise<AssetUsageEdge[]> { return readEdges(); }
export function clearUsageGraph(): void { if (typeof window !== 'undefined') { try { window.localStorage.removeItem(GRAPH_KEY); } catch { /* ignore */ } } }

/** Stable consumer id for a writer draft (used by the Attachment Session). */
export function writerDraftConsumer(sourceType: string, sourceId: string): AssetConsumer {
  return { type: 'writer-draft', id: `${sourceType}:${sourceId}` };
}
