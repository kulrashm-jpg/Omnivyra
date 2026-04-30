import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';

function readBody(req: NextApiRequest): Record<string, unknown> {
  return req.method === 'GET'
    ? (req.query as Record<string, unknown>)
    : ((req.body || {}) as Record<string, unknown>);
}

function clampWindowDays(value: unknown): number {
  const parsed = Number(value ?? 7);
  if (!Number.isFinite(parsed)) return 7;
  return Math.min(30, Math.max(1, Math.floor(parsed)));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const user = await resolveUserContext(req);
  const input = readBody(req);
  const organizationId = String(input.organization_id ?? input.organizationId ?? user.defaultCompanyId ?? '').trim();
  if (!organizationId) {
    return res.status(400).json({ success: false, error: 'organization_id required' });
  }

  const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
  if (!access) return;

  const windowDays = clampWindowDays(input.window_days ?? input.windowDays);
  const until = new Date();
  const since = new Date(until.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const platform = typeof input.platform === 'string' && input.platform.trim()
    ? input.platform.trim().toLowerCase()
    : null;

  return res.status(200).json({
    success: true,
    mode: 'sync_recent',
    sync_recent: {
      organization_id: organizationId,
      platform,
      window_days: windowDays,
      since: since.toISOString(),
      until: until.toISOString(),
      ingestion: 'extension_driven',
    },
  });
}
