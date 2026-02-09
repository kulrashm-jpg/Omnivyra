import { supabase } from '../db/supabaseClient';

type TokenInput = {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
};

const normalizePlatform = (platform: string) => platform.toString().trim().toLowerCase();

export const saveToken = async (
  tenant_id: string,
  organization_id: string,
  platform: string,
  tokenData: TokenInput
) => {
  const normalized = normalizePlatform(platform);
  const payload = {
    tenant_id,
    organization_id,
    platform: normalized,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token ?? null,
    expires_at: tokenData.expires_at ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data: existing, error: lookupError } = await supabase
    .from('community_ai_platform_tokens')
    .select('id')
    .eq('tenant_id', tenant_id)
    .eq('organization_id', organization_id)
    .eq('platform', normalized)
    .limit(1);

  if (lookupError) {
    throw new Error(`Failed to lookup token: ${lookupError.message}`);
  }

  if (existing && existing.length > 0) {
    const { data, error } = await supabase
      .from('community_ai_platform_tokens')
      .update(payload)
      .eq('id', existing[0].id)
      .eq('tenant_id', tenant_id)
      .eq('organization_id', organization_id)
      .select('*')
      .limit(1);
    if (error) {
      throw new Error(`Failed to update token: ${error.message}`);
    }
    return data?.[0] || null;
  }

  const { data, error } = await supabase
    .from('community_ai_platform_tokens')
    .insert({ ...payload, created_at: new Date().toISOString() })
    .select('*')
    .limit(1);
  if (error) {
    throw new Error(`Failed to save token: ${error.message}`);
  }
  return data?.[0] || null;
};

export const getToken = async (tenant_id: string, organization_id: string, platform: string) => {
  const normalized = normalizePlatform(platform);
  const { data, error } = await supabase
    .from('community_ai_platform_tokens')
    .select('*')
    .eq('tenant_id', tenant_id)
    .eq('organization_id', organization_id)
    .eq('platform', normalized)
    .single();
  if (error) {
    throw new Error(`Failed to load token: ${error.message}`);
  }
  return data || null;
};

export const revokeToken = async (
  tenant_id: string,
  organization_id: string,
  platform: string
) => {
  const normalized = normalizePlatform(platform);
  const { data, error } = await supabase
    .from('community_ai_platform_tokens')
    .update({
      access_token: null,
      refresh_token: null,
      expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenant_id)
    .eq('organization_id', organization_id)
    .eq('platform', normalized)
    .select('*')
    .limit(1);
  if (error) {
    throw new Error(`Failed to revoke token: ${error.message}`);
  }
  return data?.[0] || null;
};
