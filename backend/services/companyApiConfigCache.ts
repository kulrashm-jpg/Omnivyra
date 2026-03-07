/**
 * In-memory cache for company API config.
 * TTL = 5 minutes. Key: company_api_config:{companyId}
 * Invalidate when configuration changes (company-config PUT, access API bulk/single).
 */

import { supabase } from '../db/supabaseClient';

const CACHE_PREFIX = 'company_api_config:';
const TTL_MS = 5 * 60 * 1000;

type CacheEntry<T> = { value: T; expiresAt: number };

export type CompanyConfigRow = {
  api_source_id: string;
  company_id: string;
  enabled: boolean;
  include_filters: Record<string, unknown> | null;
  exclude_filters: Record<string, unknown> | null;
};

const cache = new Map<string, CacheEntry<CompanyConfigRow[]>>();

function key(companyId: string): string {
  return `${CACHE_PREFIX}${companyId}`;
}

function isExpired(entry: CacheEntry<CompanyConfigRow[]>): boolean {
  return Date.now() >= entry.expiresAt;
}

function getCachedRows(companyId: string): CompanyConfigRow[] | null {
  const k = key(companyId);
  const entry = cache.get(k);
  if (!entry || isExpired(entry)) {
    cache.delete(k);
    return null;
  }
  return entry.value;
}

function setCachedRows(companyId: string, value: CompanyConfigRow[]): void {
  cache.set(key(companyId), { value, expiresAt: Date.now() + TTL_MS });
}

export function invalidateCompanyConfigCache(companyId: string): void {
  cache.delete(key(companyId));
}

/**
 * Invalidate cache for every company that has a config for this API source.
 * Call when an API source is removed, disabled, or updated.
 */
export async function invalidateCompanyConfigCacheForApiSource(apiSourceId: string): Promise<void> {
  const { data } = await supabase
    .from('company_api_configs')
    .select('company_id')
    .eq('api_source_id', apiSourceId);
  const companyIds = [...new Set((data ?? []).map((r) => r.company_id).filter(Boolean))];
  companyIds.forEach((companyId) => invalidateCompanyConfigCache(companyId));
}

/**
 * Load company_api_configs rows for a company (cached, TTL 5 min).
 * Pass skipCache: true to force a fresh read (e.g. right after saving selection).
 */
export async function getCompanyConfigRows(
  companyId: string,
  options?: { skipCache?: boolean }
): Promise<CompanyConfigRow[]> {
  if (!options?.skipCache) {
    const cached = getCachedRows(companyId);
    if (cached) return cached;
  } else {
    cache.delete(key(companyId));
  }

  const { data, error } = await supabase
    .from('company_api_configs')
    .select('api_source_id, company_id, enabled, include_filters, exclude_filters')
    .eq('company_id', companyId);

  if (error) {
    console.warn('Failed to load company API configs', { companyId, message: error.message });
    return [];
  }

  const rows = (data || []).map((row) => ({
    api_source_id: row.api_source_id,
    company_id: row.company_id,
    enabled: row.enabled === true,
    include_filters: (row.include_filters as Record<string, unknown>) || null,
    exclude_filters: (row.exclude_filters as Record<string, unknown>) || null,
  }));

  setCachedRows(companyId, rows);
  return rows;
}
