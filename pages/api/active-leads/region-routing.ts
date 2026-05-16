/**
 * Phase 9 — Region routing endpoint.
 *
 *   GET    ?companyId=...
 *   POST   { companyId, primaryRegion?, failoverRegion?, partitionRouting?, failoverStrategy?, metadata? }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on POST.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  getRegionRouting,
  upsertRegionRouting,
} from '../../../backend/services/regionRoutingService';
import {
  REGION_FAILOVER_STRATEGIES,
  type RegionFailoverStrategy,
} from '../../../backend/types/regionRouting';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    const routing = await getRegionRouting(companyId);
    return res.status(200).json({ routing });
  } catch (err: any) {
    console.error('[region-routing GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load region routing' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const routing = await upsertRegionRouting({
      organizationId: companyId,
      primaryRegion: typeof body.primaryRegion === 'string' ? body.primaryRegion : undefined,
      failoverRegion: typeof body.failoverRegion !== 'undefined' ? (body.failoverRegion as string | null) : undefined,
      partitionRouting: (body.partitionRouting as Record<string, string>) ?? undefined,
      failoverStrategy: typeof body.failoverStrategy === 'string' && REGION_FAILOVER_STRATEGIES.includes(body.failoverStrategy as RegionFailoverStrategy) ? (body.failoverStrategy as RegionFailoverStrategy) : undefined,
      metadata: (body.metadata as Record<string, unknown>) ?? undefined,
      updatedBy: ctx.userId,
    });
    return res.status(200).json({ ok: true, routing });
  } catch (err: any) {
    console.error('[region-routing POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'region_routing_failed' });
  }
}
