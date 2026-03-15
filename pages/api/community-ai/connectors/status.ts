import type { NextApiRequest, NextApiResponse } from 'next';
import { requireManageConnectors } from './utils';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getPlatformsWithTokensForOrg } from '../../../../backend/services/platformTokenService';
import { getCompanyConfiguredPlatformsForConnectors } from '../../../../backend/services/companyPlatformService';

/**
 * GET /api/community-ai/connectors/status
 * Returns connected platforms for the org and which platforms have OAuth configured.
 * Includes both community_ai_platform_tokens and social_accounts (same credentials for Engagement + Community AI).
 */
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

    const byPlatform = new Map<string, { platform: string; expires_at: string | null }>();
    for (const r of rows ?? []) {
      if (r.access_token && (r as { access_token?: string }).access_token !== '') {
        byPlatform.set((r.platform || '').toLowerCase(), {
          platform: r.platform,
          expires_at: r.expires_at ?? null,
        });
      }
    }

    // Include platforms from social_accounts (Connect Accounts flow)
    const socialPlatforms = await getPlatformsWithTokensForOrg(organizationId);
    for (const p of socialPlatforms) {
      if (!byPlatform.has(p)) {
        byPlatform.set(p, { platform: p, expires_at: null });
      }
    }

    const list = Array.from(byPlatform.values()).map((entry) => ({
      platform: entry.platform,
      expires_at: entry.expires_at,
      connected: true,
    }));

    const configured_platforms = await getCompanyConfiguredPlatformsForConnectors(organizationId);

    return res.status(200).json({ connections: list, configured_platforms });
  } catch (err: any) {
    console.error('[connectors/status]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}
