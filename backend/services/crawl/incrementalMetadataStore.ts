/**
 * incrementalMetadataStore.ts — deterministic incremental metadata refresh
 * (CKRE-002 §2).
 *
 * Persists ONLY the cheap, deterministic knowledge a crawl already produced
 * (logo, favicon, country/geography + the discovered_metadata bundle) WITHOUT
 * invoking AI. Used by the REFRESH_METADATA_ONLY policy path so a cosmetic
 * change refreshes affected metadata without the LLM chain.
 *
 * Reuses the EXISTING company_profiles columns + ONBOARD-001R provenance — no
 * new store, no duplicate extraction (the metadata is the crawl's output).
 * Respects user_locked_fields (never overwrites a user edit). Best-effort.
 */

import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';
import { buildDiscoveredProvenance } from '../companyProfile/enrichmentProvenance';
import type { DiscoveredWebsiteMetadata } from '../companyProfile/websiteMetadataExtractor';

export interface IncrementalMetadataResult {
  updated: boolean;
  fields: string[];
}

/**
 * Merge discovered metadata into the company profile (deterministic fields
 * only). Returns which fields were written. Never throws.
 */
export async function refreshDiscoveredMetadata(
  companyId: string,
  metadata: DiscoveredWebsiteMetadata | null,
  now: string = new Date().toISOString(),
): Promise<IncrementalMetadataResult> {
  if (!companyId || !metadata) return { updated: false, fields: [] };
  try {
    const { data } = await supabase
      .from('company_profiles')
      .select('report_settings, user_locked_fields, logo_url, favicon_url, geography')
      .eq('company_id', companyId)
      .maybeSingle();
    if (!data) return { updated: false, fields: [] };

    const row = data as {
      report_settings?: Record<string, unknown>;
      user_locked_fields?: unknown;
    };
    const locked = new Set<string>(Array.isArray(row.user_locked_fields) ? (row.user_locked_fields as string[]) : []);

    const update: Record<string, unknown> = { updated_at: now };
    const fields: string[] = [];
    const setIfUnlocked = (col: string, value: string | null | undefined) => {
      if (value && !locked.has(col)) { update[col] = value; fields.push(col); }
    };
    setIfUnlocked('logo_url', metadata.logoUrl);
    setIfUnlocked('favicon_url', metadata.faviconUrl);
    setIfUnlocked('geography', metadata.country);

    // Merge the discovered_metadata bundle + provenance (reuses ONBOARD-001R).
    const rs = row.report_settings ?? {};
    update.report_settings = {
      ...rs,
      discovered_metadata: {
        source: 'system_discovered',
        discovered_at: now,
        refreshed_via: 'incremental_metadata_refresh',
        provenance: buildDiscoveredProvenance(metadata, now),
        title: metadata.title,
        description: metadata.description,
        site_name: metadata.siteName,
        language: metadata.language,
        country: metadata.country,
        brand_color: metadata.brandColor,
        seo_keywords: metadata.keywords,
        open_graph: metadata.openGraph,
        logo_url: metadata.logoUrl,
        favicon_url: metadata.faviconUrl,
      },
    };
    fields.push('discovered_metadata');

    const { error } = await supabase
      .from('company_profiles')
      .update(update)
      .eq('company_id', companyId);
    if (error) {
      logger.warn('incremental_metadata_refresh_failed', { companyId, message: error.message });
      return { updated: false, fields: [] };
    }
    return { updated: true, fields };
  } catch (err) {
    logger.warn('incremental_metadata_refresh_threw', {
      companyId,
      message: err instanceof Error ? err.message : String(err),
    });
    return { updated: false, fields: [] };
  }
}

/** Touch last_refined_at so a verified-unchanged site resets its staleness gate. Never throws. */
export async function touchProfileRefreshedAt(companyId: string, now: string = new Date().toISOString()): Promise<void> {
  if (!companyId) return;
  try {
    await supabase.from('company_profiles').update({ last_refined_at: now }).eq('company_id', companyId);
  } catch { /* fail-safe */ }
}
