import { supabase } from './supabaseClient';

export async function upsertPlatformRule(input: any): Promise<any> {
  const { data, error } = await supabase
    .from('platform_rules')
    .upsert(input, { onConflict: 'platform,content_type' })
    .select('*')
    .single();
  if (error) {
    throw new Error(`Failed to upsert platform rule: ${error.message}`);
  }
  return data;
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
