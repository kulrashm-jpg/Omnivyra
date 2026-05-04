import { createServiceRoleMigrationProxy } from './supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

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
