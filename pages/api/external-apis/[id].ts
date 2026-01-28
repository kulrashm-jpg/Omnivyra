import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { validatePlatformConfig } from '../../../backend/services/externalApiService';

const ensureSuperAdmin = async (req: NextApiRequest, res: NextApiResponse): Promise<boolean> => {
  const userId = 'current-user-id';
  const { data: isSuperAdmin, error } = await supabase.rpc('is_super_admin', {
    check_user_id: userId,
  });
  if (error || !isSuperAdmin) {
    res.status(403).json({
      error: 'Access denied. Only super admins can manage external APIs.',
      code: 'INSUFFICIENT_PRIVILEGES',
    });
    return false;
  }
  return true;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'API ID is required' });
  }

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('external_api_sources')
      .select('*')
      .eq('id', id)
      .single();
    if (error) {
      return res.status(500).json({ error: 'Failed to load external API' });
    }
    const { data: healthData } = await supabase
      .from('external_api_health')
      .select('*')
      .eq('api_source_id', id)
      .single();
    return res.status(200).json({ api: { ...data, health: healthData || null } });
  }

  if (req.method === 'PUT') {
    const isAdmin = await ensureSuperAdmin(req, res);
    if (!isAdmin) return;

    const {
      name,
      base_url,
      purpose,
      category,
      is_active,
      auth_type,
      api_key_name,
      platform_type,
      supported_content_types,
      promotion_modes,
      required_metadata,
      posting_constraints,
      requires_admin,
    } = req.body || {};

    let resolvedPlatformType = platform_type;
    if (!resolvedPlatformType) {
      const { data: existing } = await supabase
        .from('external_api_sources')
        .select('*')
        .eq('id', id)
        .single();
      resolvedPlatformType = existing?.platform_type || 'social';
    }

    const validation = validatePlatformConfig({
      name,
      base_url,
      platform_type: resolvedPlatformType,
      supported_content_types,
      promotion_modes,
      required_metadata,
      posting_constraints,
    });
    if (!validation.ok) {
      return res.status(400).json({ error: validation.message || 'Invalid platform config' });
    }

    let resolvedAuthType = auth_type;
    let resolvedApiKeyName = api_key_name;
    if (!resolvedAuthType || !resolvedApiKeyName) {
      const { data: existing } = await supabase
        .from('external_api_sources')
        .select('*')
        .eq('id', id)
        .single();
      resolvedAuthType = resolvedAuthType ?? existing?.auth_type ?? 'none';
      resolvedApiKeyName = resolvedApiKeyName ?? existing?.api_key_name ?? null;
    }

    if (resolvedAuthType !== 'none') {
      if (!resolvedApiKeyName || !process.env[resolvedApiKeyName]) {
        return res.status(400).json({ error: 'API key not found in environment variables' });
      }
    }

    const { data, error } = await supabase
      .from('external_api_sources')
      .update({
        name,
        base_url,
        purpose,
        category,
        is_active,
        auth_type: resolvedAuthType,
        api_key_name: resolvedApiKeyName,
        platform_type: resolvedPlatformType || 'social',
        supported_content_types: supported_content_types || [],
        promotion_modes: promotion_modes || [],
        required_metadata: required_metadata || {},
        posting_constraints: posting_constraints || {},
        requires_admin: requires_admin ?? true,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to update external API' });
    }
    return res.status(200).json({ api: data });
  }

  if (req.method === 'DELETE') {
    const isAdmin = await ensureSuperAdmin(req, res);
    if (!isAdmin) return;

    const { error } = await supabase.from('external_api_sources').delete().eq('id', id);
    if (error) {
      return res.status(500).json({ error: 'Failed to delete external API' });
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
