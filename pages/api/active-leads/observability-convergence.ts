/**
 * Phase 12 — Observability convergence endpoint.
 *
 *   GET  ?companyId=...&projectionKind=...
 *   POST { companyId, projectionKind, windowStart?, windowEnd?, metadata? }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on POST.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  generateObservabilityProjection,
  listObservabilityProjections,
} from '../../../backend/services/observabilityConvergenceService';
import {
  OBSERVABILITY_PROJECTION_KINDS,
  type ObservabilityProjectionKind,
} from '../../../backend/types/observabilityConvergence';

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
    const items = await listObservabilityProjections(companyId, {
      projectionKind: typeof req.query.projectionKind === 'string' && OBSERVABILITY_PROJECTION_KINDS.includes(req.query.projectionKind as ObservabilityProjectionKind) ? (req.query.projectionKind as ObservabilityProjectionKind) : undefined,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[observability-convergence GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load observability projections' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const projectionKind = OBSERVABILITY_PROJECTION_KINDS.includes(body.projectionKind as ObservabilityProjectionKind) ? (body.projectionKind as ObservabilityProjectionKind) : null;
  if (!companyId || !projectionKind) return res.status(400).json({ error: 'companyId and valid projectionKind required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const projection = await generateObservabilityProjection({
      organizationId: companyId,
      projectionKind,
      windowStart: typeof body.windowStart === 'string' ? body.windowStart : undefined,
      windowEnd: typeof body.windowEnd === 'string' ? body.windowEnd : undefined,
      generatedBy: ctx.userId,
      metadata: (body.metadata as Record<string, unknown>) ?? {},
    });
    return res.status(200).json({ ok: true, projection });
  } catch (err: any) {
    console.error('[observability-convergence POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'observability_convergence_failed' });
  }
}
