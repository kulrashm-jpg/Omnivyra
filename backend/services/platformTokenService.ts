/**
 * Platform Token Service
 *
 * Primary: community_ai_platform_tokens (tenant/org scoped, for Community AI actions).
 * Fallback: social_accounts (user-level OAuth from Connect Accounts) — extends the same
 * credentials to Engagement module and Community AI so one connection works for both.
 *
 * G3.3: Tokens stored encrypted at rest (AES-256-GCM via credentialEncryption).
 */

import { supabase } from '../db/supabaseClient';
import { getToken as getTokenFromStore } from '../auth/tokenStore';
import { encryptCredential, decryptCredential } from '../auth/credentialEncryption';

type TokenInput = {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  /** G2.4: User who connected; allows owner to disconnect own. */
  connected_by_user_id?: string | null;
};

const normalizePlatform = (platform: string) => platform.toString().trim().toLowerCase();

function encryptToken(plain: string): string {
  if (!plain || !plain.trim()) return '';
  return encryptCredential(plain);
}

function decryptTokenOrLegacy(encrypted: string | null): string | null {
  if (!encrypted || !encrypted.trim()) return null;
  try {
    const parts = encrypted.split(':');
    if (parts.length === 3 && /^[0-9a-fA-F]+$/.test(parts[0]) && /^[0-9a-fA-F]+$/.test(parts[1])) {
      return decryptCredential(encrypted);
    }
    return encrypted; // legacy plaintext
  } catch {
    return encrypted; // legacy plaintext on decrypt failure
  }
}

export const saveToken = async (
  tenant_id: string,
  organization_id: string,
  platform: string,
  tokenData: TokenInput
) => {
  const normalized = normalizePlatform(platform);
  const payload: Record<string, unknown> = {
    tenant_id,
    organization_id,
    platform: normalized,
    access_token: encryptToken(tokenData.access_token),
    refresh_token: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null,
    expires_at: tokenData.expires_at ?? null,
    updated_at: new Date().toISOString(),
  };
  if (tokenData.connected_by_user_id != null) {
    payload.connected_by_user_id = tokenData.connected_by_user_id;
  }

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

const PLATFORM_ALIASES: Record<string, string[]> = {
  x: ['x', 'twitter'],
  twitter: ['twitter', 'x'],
};

async function resolveTokenFromSocialAccounts(
  organization_id: string,
  platform: string
): Promise<{ access_token: string; refresh_token?: string; expires_at?: string } | null> {
  const platformsToMatch = PLATFORM_ALIASES[platform] ?? [platform];
  const { data: roleRows } = await supabase
    .from('user_company_roles')
    .select('user_id')
    .eq('company_id', organization_id)
    .eq('status', 'active');
  const userIds = (roleRows ?? []).map((r: { user_id: string }) => r.user_id).filter(Boolean);
  if (userIds.length === 0) return null;

  // G2.3: Filter by company_id when available for tenant isolation
  const { data: saRows } = await supabase
    .from('social_accounts')
    .select('id, platform')
    .in('user_id', userIds)
    .eq('is_active', true)
    .in('platform', platformsToMatch)
    .or(`company_id.eq.${organization_id},company_id.is.null`)
    .order('updated_at', { ascending: false })
    .limit(1);
  const account = (saRows ?? [])[0] as { id: string } | undefined;
  if (!account?.id) return null;

  const tokenObj = await getTokenFromStore(account.id);
  if (!tokenObj?.access_token) return null;
  return {
    access_token: tokenObj.access_token,
    refresh_token: tokenObj.refresh_token,
    expires_at: tokenObj.expires_at,
  };
}

export const getToken = async (tenant_id: string, organization_id: string, platform: string) => {
  const normalized = normalizePlatform(platform);

  // 1. Try community_ai_platform_tokens first
  const { data: catRow, error } = await supabase
    .from('community_ai_platform_tokens')
    .select('*')
    .eq('tenant_id', tenant_id)
    .eq('organization_id', organization_id)
    .eq('platform', normalized)
    .maybeSingle();

  if (catRow?.access_token) {
    const accessToken = decryptTokenOrLegacy(catRow.access_token);
    const refreshToken = catRow.refresh_token ? decryptTokenOrLegacy(catRow.refresh_token) : null;
    if (!accessToken) return null;
    return {
      ...catRow,
      access_token: accessToken,
      refresh_token: refreshToken ?? null,
    };
  }

  // 2. Fallback: social_accounts (users in org with connected accounts)
  const fallback = await resolveTokenFromSocialAccounts(organization_id, normalized);
  if (fallback) {
    return {
      access_token: fallback.access_token,
      refresh_token: fallback.refresh_token ?? null,
      expires_at: fallback.expires_at ?? null,
      tenant_id,
      organization_id,
      platform: normalized,
    };
  }

  if (error) {
    throw new Error(`Failed to load token: ${error.message}`);
  }
  return null;
};

/**
 * Get platforms that have tokens for an org (community_ai_platform_tokens OR social_accounts fallback).
 * Used by connectors status API to show connected platforms.
 */
export async function getPlatformsWithTokensForOrg(organization_id: string): Promise<string[]> {
  const platforms = new Set<string>();

  // 1. From community_ai_platform_tokens (any tenant)
  const { data: catRows } = await supabase
    .from('community_ai_platform_tokens')
    .select('platform')
    .eq('organization_id', organization_id)
    .not('access_token', 'is', null);
  for (const r of catRows ?? []) {
    if (r.platform) platforms.add(normalizePlatform(r.platform));
  }

  // 2. From social_accounts (users in org with active accounts)
  const { data: roleRows } = await supabase
    .from('user_company_roles')
    .select('user_id')
    .eq('company_id', organization_id)
    .eq('status', 'active');
  const userIds = (roleRows ?? []).map((r: { user_id: string }) => r.user_id).filter(Boolean);
  if (userIds.length > 0) {
    // G2.1: Filter by company_id for tenant isolation; include legacy (null) for backward compat
    const { data: saRows } = await supabase
      .from('social_accounts')
      .select('platform')
      .in('user_id', userIds)
      .eq('is_active', true)
      .or(`company_id.eq.${organization_id},company_id.is.null`)
      .not('access_token', 'is', null);
    for (const r of saRows ?? []) {
      if (r.platform) platforms.add(normalizePlatform(r.platform));
    }
  }

  return Array.from(platforms).sort();
}

/**
 * G2.4: Get connected_by_user_id for a connector (owner-based disconnect).
 */
export async function getConnectorConnectedByUserId(
  tenant_id: string,
  organization_id: string,
  platform: string
): Promise<string | null> {
  const normalized = normalizePlatform(platform);
  const { data, error } = await supabase
    .from('community_ai_platform_tokens')
    .select('connected_by_user_id')
    .eq('tenant_id', tenant_id)
    .eq('organization_id', organization_id)
    .eq('platform', normalized)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { connected_by_user_id?: string | null }).connected_by_user_id ?? null;
}

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
