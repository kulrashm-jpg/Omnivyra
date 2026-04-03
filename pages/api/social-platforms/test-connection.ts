
/**
 * POST /api/social-platforms/test-connection
 *
 * Tests platform API connection with provided credentials.
 * Loads adapter by platform_key, calls adapter.testConnection(), returns success/failure.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getPlatformAdapter } from '../../../backend/services/platformAdapters';
import { validatePlatformKey } from '../../../backend/services/platformRegistryService';

type TestConnectionBody = {
  platform_key: string;
  credentials?: {
    access_token?: string;
    refresh_token?: string | null;
    expires_at?: string | null;
  };
  api_key_env_name?: string;
  organization_id?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as TestConnectionBody;
    const platformKey = (body.platform_key ?? '').toString().trim();
    const credentials = body.credentials ?? {};
    const apiKeyEnvName = (body.api_key_env_name ?? '').toString().trim();
    const organizationId = body.organization_id ?? user?.defaultCompanyId;

    if (!platformKey) {
      return res.status(400).json({ success: false, error: 'platform_key required' });
    }

    let accessToken = credentials.access_token;
    if (!accessToken && apiKeyEnvName) {
      accessToken = process.env[apiKeyEnvName] ?? null;
    }
    if (!accessToken) {
      return res.status(400).json({
        success: false,
        error: 'credentials.access_token or api_key_env_name required',
      });
    }

    const valid = await validatePlatformKey(platformKey);
    if (!valid) {
      return res.status(400).json({ success: false, error: `Unsupported platform: ${platformKey}` });
    }

    const adapter = getPlatformAdapter(platformKey);
    if (!adapter) {
      return res.status(400).json({
        success: false,
        error: `No adapter available for platform: ${platformKey}`,
      });
    }

    if (organizationId) {
      const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
      if (!access) return;
    }

    const result = await adapter.testConnection({
      access_token: accessToken,
      refresh_token: credentials.refresh_token ?? null,
      expires_at: credentials.expires_at ?? null,
    });

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: result.message ?? 'Connection test passed',
      });
    }
    return res.status(400).json({
      success: false,
      error: result.error ?? 'Connection test failed',
    });
  } catch (err: any) {
    console.error('[social-platforms/test-connection]', err?.message);
    return res.status(500).json({
      success: false,
      error: err?.message ?? 'Failed to test connection',
    });
  }
}
