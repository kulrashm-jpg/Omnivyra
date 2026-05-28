/**
 * Campaign-scoped visual memory (Phase 5).
 *
 * Process-local in-memory cache of campaign visual DNA keyed by
 * campaign id. Separate from `creatorVisualBrandMemory` (which is
 * brand-level / cross-campaign) because campaigns can intentionally
 * diverge from baseline brand preferences — e.g., a brand might run
 * a "documentary founder story" campaign that uses a different
 * realism profile than its default brand lane.
 *
 * NOT model training. NOT persistence. Pure preference reuse for
 * cross-asset coherence within the lifetime of a campaign.
 *
 * Process-local with TTL ceiling. Restart-safe; cache re-warms from
 * the next generations within the campaign.
 */

import type { CampaignVisualDNA } from './campaignCoherenceEngine';

const CAMPAIGN_DNA_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const CACHE_MAX_ENTRIES = 1000;

type CacheEntry = {
  dna: CampaignVisualDNA;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

function key(campaignId: string): string {
  return campaignId.trim().toLowerCase();
}

function pruneIfFull(): void {
  if (cache.size <= CACHE_MAX_ENTRIES) return;
  // Drop oldest insertion entry — Map iteration is insertion order.
  const firstKey = cache.keys().next().value;
  if (firstKey) cache.delete(firstKey);
}

export function getCampaignVisualDNA(campaignId: string | null | undefined): CampaignVisualDNA | null {
  if (!campaignId) return null;
  const entry = cache.get(key(campaignId));
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key(campaignId));
    return null;
  }
  return entry.dna;
}

/**
 * Establish or refresh a campaign's visual DNA. The DNA is established
 * on first call for a campaign id and PRESERVED on subsequent calls —
 * `assetCount` increments to track campaign breadth, but the DNA's
 * visual rules stay stable for cross-asset coherence.
 *
 * To intentionally rotate a campaign's DNA, callers should `clearCampaignVisualDNA(campaignId)`
 * before storing the new shape.
 */
export function storeCampaignVisualDNA(input: {
  campaignId: string;
  dna: CampaignVisualDNA;
}): CampaignVisualDNA {
  const k = key(input.campaignId);
  const existing = cache.get(k);
  const dna: CampaignVisualDNA = existing
    ? { ...existing.dna, assetCount: existing.dna.assetCount + 1, lastUpdatedAt: new Date().toISOString() }
    : { ...input.dna, assetCount: 1, lastUpdatedAt: new Date().toISOString() };
  cache.set(k, { dna, expiresAt: Date.now() + CAMPAIGN_DNA_TTL_MS });
  pruneIfFull();
  return dna;
}

export function clearCampaignVisualDNA(campaignId: string): void {
  cache.delete(key(campaignId));
}

export function clearAllCampaignVisualMemory(): void {
  cache.clear();
}

export function campaignVisualMemoryStats(): { size: number; maxEntries: number; ttlMs: number } {
  return { size: cache.size, maxEntries: CACHE_MAX_ENTRIES, ttlMs: CAMPAIGN_DNA_TTL_MS };
}
