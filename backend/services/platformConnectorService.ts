/**
 * Platform Connector Service
 *
 * Manages organization-level platform connections (platform_connectors table).
 * Used by publishing, engagement, and ingestion when the new connector system is preferred.
 * Existing community_ai_platform_tokens and social_accounts remain functional.
 */

import { supabase } from '../db/supabaseClient';
import { validatePlatformKey } from './platformRegistryService';

export type PlatformConnectorConfig = {
  id?: string;
  organization_id: string;
  platform_key: string;
  account_id?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: string | null;
  active?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

/**
 * Get an active connector for an organization and platform.
 */
export async function getConnector(
  organizationId: string,
  platformKey: string
): Promise<PlatformConnectorConfig | null> {
  const normalized = (platformKey || '').toString().trim().toLowerCase();
  const alias = normalized === 'x' ? 'twitter' : normalized;
  if (!organizationId || !alias) return null;

  try {
    const { data, error } = await supabase
      .from('platform_connectors')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('platform_key', alias)
      .eq('active', true)
      .maybeSingle();

    if (error) {
      console.warn('[platformConnector] getConnector error:', error.message);
      return null;
    }
    return data as PlatformConnectorConfig | null;
  } catch (e) {
    console.warn('[platformConnector] getConnector exception:', (e as Error)?.message);
    return null;
  }
}

/**
 * Store a new connector. Validates platform_key against registry.
 */
export async function storeConnector(config: PlatformConnectorConfig): Promise<PlatformConnectorConfig | null> {
  const valid = await validatePlatformKey(config.platform_key);
  if (!valid) {
    throw new Error(`Unsupported platform_key: ${config.platform_key}`);
  }

  const payload = {
    organization_id: config.organization_id,
    platform_key: (config.platform_key || '').toString().trim().toLowerCase().replace(/^x$/, 'twitter'),
    account_id: config.account_id ?? null,
    access_token: config.access_token ?? null,
    refresh_token: config.refresh_token ?? null,
    expires_at: config.expires_at ?? null,
    active: config.active !== false,
    updated_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from('platform_connectors')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error(`Connector for platform ${config.platform_key} already exists for this organization`);
      }
      throw new Error(error.message);
    }
    return data as PlatformConnectorConfig;
  } catch (e) {
    if ((e as Error)?.message?.startsWith('Unsupported') || (e as Error)?.message?.includes('already exists')) {
      throw e;
    }
    console.error('[platformConnector] storeConnector:', (e as Error)?.message);
    throw new Error('Failed to store connector');
  }
}

/**
 * Update an existing connector.
 */
export async function updateConnector(config: PlatformConnectorConfig): Promise<PlatformConnectorConfig | null> {
  if (!config.id) {
    throw new Error('Connector id required for update');
  }
  const valid = config.platform_key ? await validatePlatformKey(config.platform_key) : true;
  if (!valid) {
    throw new Error(`Unsupported platform_key: ${config.platform_key}`);
  }

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (config.account_id !== undefined) payload.account_id = config.account_id;
  if (config.access_token !== undefined) payload.access_token = config.access_token;
  if (config.refresh_token !== undefined) payload.refresh_token = config.refresh_token;
  if (config.expires_at !== undefined) payload.expires_at = config.expires_at;
  if (config.active !== undefined) payload.active = config.active;

  try {
    const { data, error } = await supabase
      .from('platform_connectors')
      .update(payload)
      .eq('id', config.id)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as PlatformConnectorConfig;
  } catch (e) {
    console.error('[platformConnector] updateConnector:', (e as Error)?.message);
    throw new Error('Failed to update connector');
  }
}
