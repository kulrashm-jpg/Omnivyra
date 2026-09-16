import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireManageConnectors } from './utils';
import { getPlatformsWithTokensForOrg } from '../../../../backend/services/platformTokenService';
import { getCompanyConfiguredPlatformsForConnectors } from '../../../../backend/services/companyPlatformService';

/**
 * GET /api/community-ai/connectors/status
 *
 * Returns the platforms connected for an org. Tokens live exclusively in
 * social_accounts since the community_ai_platform_tokens consolidation —
 * getPlatformsWithTokensForOrg now reads from there. expires_at is reported
 * as null because the canonical expiry is on social_accounts.token_expires_at
 * and not surfaced through this status shape today.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : '';
  const organizationId = typeof req.query.organization_id === 'string' ? req.query.organization_id : '';

  if (!tenantId || !organizationId) {
    return res.status(400).json({ error: 'tenant_id and organization_id are required' });
  }

  // SEC-91A (STEP 3AH-91, A2) — the route authorized `tenant_id` but read
  // `organization_id`, so a connector manager of company A could pass
  // tenant_id=A&organization_id=B and read B's connected platforms and
  // configured-platform list. Community AI's convention (requireTenantScope in
  // ../utils) is that the two ids name the same tenant; enforce that, then read
  // ONLY the id that was authorized. The UI (pages/community-ai/connectors.tsx)
  // already sends the same value for both.
  if (tenantId !== organizationId) {
    return res.status(400).json({ error: 'tenant_id and organization_id must match' });
  }

  const access = await requireManageConnectors(req, res, tenantId);
  if (!access) return;
  const authorizedCompanyId = tenantId;

  try {
    const socialPlatforms = await getPlatformsWithTokensForOrg(authorizedCompanyId);
    const list = socialPlatforms.map((platform) => ({
      platform,
      expires_at: null as string | null,
      connected: true,
    }));

    const configured_platforms = await getCompanyConfiguredPlatformsForConnectors(authorizedCompanyId);

    return res.status(200).json({ connections: list, configured_platforms });
  } catch (err: any) {
    console.error('[connectors/status]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/community-ai/connectors/status' });
