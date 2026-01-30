import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { externalApiPresets } from '../../../backend/services/externalApiPresets';
import { ExternalApiSource } from '../../../backend/services/externalApiService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data, error } = await supabase
      .from('external_api_sources')
      .select('*')
      .eq('is_preset', true)
      .order('created_at', { ascending: true });

    if (error) {
      return res.status(500).json({ error: 'Failed to load presets' });
    }

    const dbPresets = (data || []).map((preset: ExternalApiSource) => ({
      id: preset.id,
      name: preset.name,
      description: preset.category || preset.purpose || 'Custom preset',
      base_url: preset.base_url,
      method: (preset.method || 'GET').toUpperCase() as 'GET' | 'POST',
      headers: (preset.headers || {}) as Record<string, string>,
      query_params: (preset.query_params || {}) as Record<string, string | number>,
      auth_type: preset.auth_type || 'none',
      api_key_env_name: preset.api_key_env_name || preset.api_key_name || null,
      example_response_type: 'json',
      is_preset: true,
    }));

    return res.status(200).json({ presets: [...externalApiPresets, ...dbPresets] });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load presets' });
  }
}
