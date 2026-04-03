
/**
 * Admin Intelligence API Presets API
 * Phase-2: Super Admin Governance
 * GET, POST, PUT, PATCH for external_api_sources where is_preset = true
 * Coexists with code-defined presets in externalApiPresets.ts
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { requireSuperAdmin } from '../../../../backend/middleware/requireSuperAdmin';
import {
  listApiPresets,
  createApiPreset,
  updateApiPreset,
  setApiPresetEnabled,
} from '../../../../backend/services/intelligenceGovernanceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireSuperAdmin(req, res))) return;

  try {
    switch (req.method) {
      case 'GET': {
        const presets = await listApiPresets();
        return res.status(200).json({ presets });
      }
      case 'POST': {
        const body = req.body as {
          name: string;
          base_url: string;
          purpose?: string;
          category?: string | null;
          is_active?: boolean;
          method?: string;
          auth_type?: string;
          api_key_env_name?: string | null;
          headers?: Record<string, string>;
          query_params?: Record<string, string | number>;
        };
        if (!body?.name?.trim() || !body?.base_url?.trim()) {
          return res.status(400).json({ error: 'name and base_url are required' });
        }
        const preset = await createApiPreset({
          name: body.name,
          base_url: body.base_url,
          purpose: body.purpose,
          category: body.category,
          is_active: body.is_active,
          method: body.method,
          auth_type: body.auth_type,
          api_key_env_name: body.api_key_env_name,
          headers: body.headers,
          query_params: body.query_params,
        });
        return res.status(201).json({ preset });
      }
      case 'PUT': {
        const { id, ...params } = req.body as {
          id: string;
          name?: string;
          base_url?: string;
          purpose?: string;
          category?: string | null;
          is_active?: boolean;
        };
        if (!id) return res.status(400).json({ error: 'id is required' });
        const preset = await updateApiPreset(id, params);
        return res.status(200).json({ preset });
      }
      case 'PATCH': {
        const { id, is_active } = req.body as { id: string; is_active: boolean };
        if (!id || typeof is_active !== 'boolean') {
          return res.status(400).json({ error: 'id and is_active (boolean) are required' });
        }
        const preset = await setApiPresetEnabled(id, is_active);
        return res.status(200).json({ preset });
      }
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    const message = (err as Error)?.message ?? 'Internal server error';
    return res.status(500).json({ error: message });
  }
}
