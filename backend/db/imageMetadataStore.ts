/**
 * Image Metadata Store — persists image search results to the DB
 * so the same images are not re-fetched from provider APIs across
 * different users/sessions.
 *
 * Two-table design:
 *  - image_metadata: one row per unique image (provider_id PK)
 *  - image_search_cache: maps a query fingerprint → ordered list of provider_ids
 *
 * Both tables are written via the service-role Supabase client (bypasses RLS).
 * All DB errors are caught and logged — the image service must never fail
 * because the DB store is unavailable.
 */

import { supabase } from '@/backend/db/supabaseClient';
import type { NormalizedImage, ImageSearchResult } from '@/backend/services/imageService';

// Cache TTL stored in DB (24 hours) — queries older than this are re-fetched
const DB_CACHE_TTL_HOURS = 24;

// ─── Query key ────────────────────────────────────────────────────────────────

function buildQueryKey(normalizedQuery: string, perPage: number, page: number, orientation: string): string {
  return `${normalizedQuery.toLowerCase().trim()}::${perPage}::${page}::${orientation}`;
}

// ─── DB lookup ────────────────────────────────────────────────────────────────

/**
 * Attempt to retrieve a cached search result from the DB.
 * Returns null on miss, error, or expired entry.
 */
export async function lookupImageSearchCache(
  query: string,
  perPage = 12,
  page = 1,
  orientation = 'landscape'
): Promise<ImageSearchResult | null> {
  try {
    const key = buildQueryKey(query, perPage, page, orientation);

    const { data: cacheRow, error: cacheErr } = await supabase
      .from('image_search_cache')
      .select('provider_ids, resolved_query, original_query, sources, expires_at')
      .eq('query_key', key)
      .single();

    if (cacheErr || !cacheRow) return null;
    if (new Date(cacheRow.expires_at) < new Date()) return null; // expired

    const providerIds: string[] = cacheRow.provider_ids ?? [];
    if (providerIds.length === 0) return null;

    const { data: imageRows, error: imgErr } = await supabase
      .from('image_metadata')
      .select('*')
      .in('provider_id', providerIds);

    if (imgErr || !imageRows || imageRows.length === 0) return null;

    // Restore original order from provider_ids list
    const byId: Record<string, NormalizedImage> = {};
    for (const row of imageRows) {
      byId[row.provider_id] = {
        id: row.provider_id,
        thumb: row.thumb_url,
        full: row.full_url,
        alt: row.alt_text ?? '',
        width: row.width ?? 0,
        height: row.height ?? 0,
        author: row.author ?? 'Unknown',
        author_url: row.author_url ?? undefined,
        source_url: row.source_url ?? undefined,
        source: row.source as NormalizedImage['source'],
        attribution: row.attribution,
        color: row.color ?? undefined,
      };
    }

    const images = providerIds
      .map((pid) => byId[pid])
      .filter(Boolean) as NormalizedImage[];

    if (images.length === 0) return null;

    // Update last_used_at on matched rows (fire-and-forget)
    supabase
      .from('image_metadata')
      .update({ last_used_at: new Date().toISOString() })
      .in('provider_id', providerIds)
      .then(() => {/* noop */});

    return {
      images,
      query: cacheRow.resolved_query,
      originalQuery: cacheRow.original_query ?? query,
      source: cacheRow.sources ?? '',
      fromCache: true,
    };
  } catch (err) {
    console.warn('[IMAGE_STORE] lookupImageSearchCache error:', err);
    return null;
  }
}

// ─── DB write ─────────────────────────────────────────────────────────────────

/**
 * Persist image search results to the DB.
 * Called fire-and-forget from the API route — must never throw.
 */
export async function recordImageSearch(
  originalQuery: string,
  resolvedQuery: string,
  images: NormalizedImage[],
  perPage = 12,
  page = 1,
  orientation = 'landscape'
): Promise<void> {
  try {
    // Upsert each image into image_metadata
    const now = new Date().toISOString();
    const rows = images.map((img) => ({
      provider_id:    img.id,
      source:         img.source,
      thumb_url:      img.thumb,
      full_url:       img.full,
      alt_text:       img.alt,
      width:          img.width,
      height:         img.height,
      author:         img.author,
      author_url:     img.author_url ?? null,
      source_url:     img.source_url ?? null,
      attribution:    img.attribution,
      color:          img.color ?? null,
      last_used_at:   now,
    }));

    const { error: upsertErr } = await supabase
      .from('image_metadata')
      .upsert(rows, {
        onConflict: 'provider_id',
        ignoreDuplicates: false,
      });

    if (upsertErr) {
      console.warn('[IMAGE_STORE] upsert error:', upsertErr.message);
      return;
    }

    // Append new query string to search_queries array for each image
    // (only if not already present — uses array_append pattern)
    const providerIds = images.map((img) => img.id);
    await supabase.rpc('image_metadata_append_query', {
      p_provider_ids: providerIds,
      p_query: resolvedQuery,
    }).then(() => {/* fire-and-forget */});

    // Upsert the search cache entry
    const key = buildQueryKey(resolvedQuery, perPage, page, orientation);
    const expiresAt = new Date(Date.now() + DB_CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const sources = [...new Set(images.map((img) => img.source))].join(', ');

    const { error: cacheErr } = await supabase
      .from('image_search_cache')
      .upsert({
        query_key:      key,
        original_query: originalQuery,
        resolved_query: resolvedQuery,
        provider_ids:   providerIds,
        sources,
        expires_at:     expiresAt,
      }, { onConflict: 'query_key' });

    if (cacheErr) {
      console.warn('[IMAGE_STORE] search cache upsert error:', cacheErr.message);
    }
  } catch (err) {
    console.warn('[IMAGE_STORE] recordImageSearch error:', err);
  }
}
