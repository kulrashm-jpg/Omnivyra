import { supabase } from './supabaseClient';

export async function upsertPlatformRule(input: any): Promise<any> {
  try {
    // Check-then-insert/update — avoids dependency on unique constraint for seeding
    const { data: existing } = await supabase
      .from('platform_rules')
      .select('id')
      .eq('platform', input.platform)
      .eq('content_type', input.content_type)
      .maybeSingle();

    if (existing?.id) {
      const { data, error } = await supabase
        .from('platform_rules')
        .update({ ...input, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select('*')
        .maybeSingle();
      if (error) {
        console.warn('[platformPromotionStore] upsertPlatformRule update failed:', error.message, { platform: input?.platform });
        return null;
      }
      return data;
    } else {
      const { data, error } = await supabase
        .from('platform_rules')
        .insert(input)
        .select('*')
        .maybeSingle();
      if (error) {
        console.warn('[platformPromotionStore] upsertPlatformRule insert failed:', error.message, { platform: input?.platform });
        return null;
      }
      return data;
    }
  } catch (err: any) {
    console.warn('[platformPromotionStore] upsertPlatformRule exception:', err?.message, { platform: input?.platform });
    return null;
  }
}

export async function listPlatformRules(): Promise<any[]> {
  const { data, error } = await supabase.from('platform_rules').select('*');
  if (error || !data) return [];
  return data;
}

export async function getPlatformRule(platform: string, contentType: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('platform_rules')
    .select('*')
    .eq('platform', platform)
    .eq('content_type', contentType)
    .single();
  if (error) return null;
  return data;
}

export async function savePromotionMetadata(input: any): Promise<any> {
  const { data, error } = await supabase
    .from('promotion_metadata')
    .insert(input)
    .select('*')
    .single();
  if (error) {
    throw new Error(`Failed to save promotion metadata: ${error.message}`);
  }
  return data;
}

export async function savePlatformVariant(input: any): Promise<any> {
  const { data, error } = await supabase
    .from('platform_content_variants')
    .insert(input)
    .select('*')
    .single();
  if (error) {
    throw new Error(`Failed to save platform content variant: ${error.message}`);
  }
  return data;
}

export async function saveComplianceReport(input: any): Promise<any> {
  const { data, error } = await supabase
    .from('platform_compliance_reports')
    .insert(input)
    .select('*')
    .single();
  if (error) {
    throw new Error(`Failed to save compliance report: ${error.message}`);
  }
  return data;
}

export async function getPromotionMetadata(assetId: string, platform: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('promotion_metadata')
    .select('*')
    .eq('content_asset_id', assetId)
    .eq('platform', platform)
    .single();
  if (error) return null;
  return data;
}

export async function getPlatformVariant(assetId: string, platform: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('platform_content_variants')
    .select('*')
    .eq('content_asset_id', assetId)
    .eq('platform', platform)
    .single();
  if (error) return null;
  return data;
}

export async function getComplianceReport(assetId: string, platform: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('platform_compliance_reports')
    .select('*')
    .eq('content_asset_id', assetId)
    .eq('platform', platform)
    .single();
  if (error) return null;
  return data;
}

/**
 * OPT-010 A6 (additive): batched variants of the three point getters above —
 * ONE `.in()` query per table instead of one query per (asset, platform).
 * Result maps are keyed `${content_asset_id}:${platform}`. Pairs with more
 * than one row map to NOTHING, preserving the `.single()` error→null
 * semantics of the per-row getters exactly.
 */
async function batchByAssetPlatform(table: string, assetIds: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  if (assetIds.length === 0) return out;
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .in('content_asset_id', assetIds);
  if (error || !Array.isArray(data)) return out;
  const counts = new Map<string, number>();
  for (const row of data as Array<{ content_asset_id?: string; platform?: string }>) {
    const key = `${row.content_asset_id}:${row.platform}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if ((counts.get(key) ?? 0) === 1) {
      out.set(key, row);
    } else {
      out.delete(key); // duplicate ⇒ .single() would have errored ⇒ null
    }
  }
  return out;
}

export async function getPromotionMetadataForAssets(assetIds: string[]): Promise<Map<string, any>> {
  return batchByAssetPlatform('promotion_metadata', assetIds);
}

export async function getPlatformVariantsForAssets(assetIds: string[]): Promise<Map<string, any>> {
  return batchByAssetPlatform('platform_content_variants', assetIds);
}

export async function getComplianceReportsForAssets(assetIds: string[]): Promise<Map<string, any>> {
  return batchByAssetPlatform('platform_compliance_reports', assetIds);
}
