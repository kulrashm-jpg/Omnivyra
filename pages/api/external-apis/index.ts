import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  getPlatformConfigs,
  validatePlatformConfig,
} from '../../../backend/services/externalApiService';

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
  if (req.method === 'GET') {
    try {
      const apis = await getPlatformConfigs();
      return res.status(200).json({ apis });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to load external APIs' });
    }
  }

  if (req.method === 'POST') {
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

    const resolvedPlatformType = platform_type || 'social';
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
    if (auth_type && auth_type !== 'none') {
      if (!api_key_name || !process.env[api_key_name]) {
        return res.status(400).json({ error: 'API key not found in environment variables' });
      }
    }

    const { data, error } = await supabase
      .from('external_api_sources')
      .insert({
        name,
        base_url,
        purpose,
        category: category || null,
        is_active: is_active ?? true,
        auth_type: auth_type || 'none',
        api_key_name: api_key_name || null,
        platform_type: resolvedPlatformType,
        supported_content_types: supported_content_types || [],
        promotion_modes: promotion_modes || [],
        required_metadata: required_metadata || {},
        posting_constraints: posting_constraints || {},
        requires_admin: requires_admin ?? true,
        created_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to create external API' });
    }
    return res.status(201).json({ api: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
