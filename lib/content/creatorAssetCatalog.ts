/**
 * Creator Asset Catalog — the ONE canonical discovery API.
 *
 * Every consumer (Writer, Campaign Creator, Calendar, Automation, Workflow
 * Engine, AI Assistant, future modules) finds assets through here — they never
 * enumerate storage. Discovery is METADATA-DRIVEN: searching/filtering operate
 * only on `CreatorAssetMetadata`; payloads are never loaded merely to search.
 * Every operation returns `CreatorAssetRef[]` (references only) — consumers
 * resolve a chosen ref through the Creator Asset Resolver when they need data.
 *
 * The catalog uses ONLY the resolver (no storage / backend / library access).
 */

import {
  listCreatorAssetEntries,
  type CreatorAssetRef,
  type CreatorAssetMetadata,
  type CreatorAssetCatalogEntry,
} from './creatorAssetResolver';

const toRefs = (entries: CreatorAssetCatalogEntry[]): CreatorAssetRef[] => entries.map((e) => e.ref);
const entries = (): Promise<CreatorAssetCatalogEntry[]> => listCreatorAssetEntries();
const lc = (v: unknown): string => String(v ?? '').toLowerCase();

export async function listAssets(): Promise<CreatorAssetRef[]> {
  return toRefs(await entries());
}

export async function getRecentAssets(limit = 20): Promise<CreatorAssetRef[]> {
  const sorted = (await entries()).sort((a, b) => (a.metadata.createdAt < b.metadata.createdAt ? 1 : -1));
  return toRefs(limit > 0 ? sorted.slice(0, limit) : sorted);
}

export async function getAssetsByType(assetType: string): Promise<CreatorAssetRef[]> {
  return toRefs((await entries()).filter((e) => e.metadata.assetType === assetType));
}

export async function getAssetsBySource(creatorSource: string): Promise<CreatorAssetRef[]> {
  return toRefs((await entries()).filter((e) => e.metadata.creatorSource === creatorSource));
}

export async function getAssetsByOrganization(organizationId: string): Promise<CreatorAssetRef[]> {
  return toRefs((await entries()).filter((e) => e.metadata.organizationId === organizationId));
}

export async function getAssetsByCampaign(campaignId: string): Promise<CreatorAssetRef[]> {
  return toRefs((await entries()).filter((e) => e.metadata.campaignId === campaignId));
}

export async function getAssetsByTags(tags: string[], opts?: { matchAll?: boolean }): Promise<CreatorAssetRef[]> {
  const wanted = tags.map(lc).filter(Boolean);
  if (wanted.length === 0) return [];
  return toRefs((await entries()).filter((e) => {
    const have = e.metadata.tags.map(lc);
    return opts?.matchAll ? wanted.every((t) => have.includes(t)) : wanted.some((t) => have.includes(t));
  }));
}

export interface CreatorAssetFilter {
  assetType?: string;
  creatorSource?: string;
  organizationId?: string;
  campaignId?: string;
  templateId?: string;
  status?: string;
  platform?: string;
  tags?: string[];
}

function matchesFilter(m: CreatorAssetMetadata, f: CreatorAssetFilter): boolean {
  if (f.assetType !== undefined && m.assetType !== f.assetType) return false;
  if (f.creatorSource !== undefined && m.creatorSource !== f.creatorSource) return false;
  if (f.organizationId !== undefined && m.organizationId !== f.organizationId) return false;
  if (f.campaignId !== undefined && m.campaignId !== f.campaignId) return false;
  if (f.templateId !== undefined && m.templateId !== f.templateId) return false;
  if (f.status !== undefined && m.status !== f.status) return false;
  if (f.platform !== undefined && m.platform !== f.platform) return false;
  if (f.tags && f.tags.length > 0) {
    const have = m.tags.map(lc);
    if (!f.tags.map(lc).every((t) => have.includes(t))) return false;
  }
  return true;
}

export async function filterAssets(filter: CreatorAssetFilter): Promise<CreatorAssetRef[]> {
  return toRefs((await entries()).filter((e) => matchesFilter(e.metadata, filter)));
}

/** Free-text search across metadata fields (never payloads). */
export async function searchAssets(query: string): Promise<CreatorAssetRef[]> {
  const q = lc(query).trim();
  const all = await entries();
  if (!q) return toRefs(all);
  return toRefs(all.filter((e) => {
    const m = e.metadata;
    const haystack = [m.assetType, m.creatorSource, m.templateId, m.campaignId, m.organizationId, m.platform, m.status, m.createdBy, ...m.tags];
    return haystack.some((v) => v && lc(v).includes(q));
  }));
}
