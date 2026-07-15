import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 6 — Source health endpoint.
 *
 *   GET  ?companyId=...                     — latest per-source health
 *   GET  ?companyId=...&listeningSourceId=  — single source latest
 *   POST { companyId, listeningSourceId }   — compute + record a new state
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  getLatestSourceHealth,
  listLatestSourceHealth,
  recordSourceHealth,
} from '../../../backend/services/sourceHealthService';
import { publishRealtime } from '../../../backend/services/realtimePublisherService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    if (req.query.listeningSourceId) {
      const item = await getLatestSourceHealth(companyId, String(req.query.listeningSourceId));
      return res.status(200).json({ item });
    }
    const items = await listLatestSourceHealth(companyId);
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[source-health GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load source health' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as { companyId?: string; listeningSourceId?: string };
  const companyId = body.companyId || '';
  const listeningSourceId = body.listeningSourceId || '';
  if (!companyId || !listeningSourceId) {
    return res.status(400).json({ error: 'companyId and listeningSourceId required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const record = await recordSourceHealth({
      organizationId: companyId,
      listeningSourceId,
    });
    if (record) {
      void publishRealtime({
        organizationId: companyId,
        topic: 'source_health',
        eventName: 'source.health_changed',
        payload: {
          listening_source_id: listeningSourceId,
          health_state: record.health_state,
          computed_at: record.computed_at,
        },
      });
    }
    return res.status(200).json({ ok: true, record });
  } catch (err: any) {
    console.error('[source-health POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Compute failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/source-health' });
