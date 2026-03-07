/**
 * In-memory cache for Growth Intelligence results.
 * Optional, fail-safe. No DB writes. TTL: 60 seconds.
 */

import type { GrowthSummary } from '../types';

type CacheEntry = {
  data: GrowthSummary;
  timestamp: number;
};

const growthCache = new Map<string, CacheEntry>();

const CACHE_TTL = 60 * 1000; // 60 seconds

function getCacheKey(companyId: string, campaignId?: string): string {
  return campaignId ? `growth:${companyId}:${campaignId}` : `growth:${companyId}`;
}

export function getCachedGrowth(
  companyId: string,
  campaignId?: string
): GrowthSummary | null {
  try {
    const key = getCacheKey(companyId, campaignId);
    const entry = growthCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      growthCache.delete(key);
      return null;
    }
    if (process.env.NODE_ENV === 'development') {
      console.debug('Growth cache hit', key);
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function setCachedGrowth(
  companyId: string,
  data: GrowthSummary,
  campaignId?: string
): void {
  try {
    const key = getCacheKey(companyId, campaignId);
    growthCache.set(key, { data, timestamp: Date.now() });
  } catch {
    // fail-safe: ignore cache write errors
  }
}
