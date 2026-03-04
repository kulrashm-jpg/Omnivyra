import type { NextApiRequest, NextApiResponse } from 'next';
import { requireManageConnectors } from './utils';
import { supabase } from '../../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : '';
  const organizationId = typeof req.query.organization_id === 'string' ? req.query.organization_id : '';

  if (!tenantId || !organizationId) {
    return res.status(400).json({ error: 'tenant_id and organization_id are required' });
  }

  const access = await requireManageConnectors(req, res, tenantId);
  if (!access) return;

  try {
    const { data: rows, error } = await supabase
      .from('community_ai_platform_tokens')
      .select('platform, expires_at, access_token')
      .eq('tenant_id', tenantId)
      .eq('organization_id', organizationId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const list = (rows || [])
      .filter((r: { access_token?: string | null }) => r.access_token != null && r.access_token !== '')
      .map((r: { platform: string; expires_at?: string | null }) => ({
        platform: r.platform,
        expires_at: r.expires_at ?? null,
        connected: true,
      }));

    return res.status(200).json(list);
  } catch (err: any) {
    console.error('[connectors/status]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}
