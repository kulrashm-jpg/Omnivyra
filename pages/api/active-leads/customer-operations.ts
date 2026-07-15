import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 12 — Customer operations endpoint.
 *
 *   GET  ?companyId=...&scoreKind=...
 *   POST { companyId, scoreKind, metadata? }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on POST.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  generateCustomerOpsScore,
  listCustomerOpsScores,
} from '../../../backend/services/customerOperationsService';
import {
  CUSTOMER_OPS_SCORE_KINDS,
  type CustomerOpsScoreKind,
} from '../../../backend/types/customerOperations';

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
    const items = await listCustomerOpsScores(companyId, {
      scoreKind: typeof req.query.scoreKind === 'string' && CUSTOMER_OPS_SCORE_KINDS.includes(req.query.scoreKind as CustomerOpsScoreKind) ? (req.query.scoreKind as CustomerOpsScoreKind) : undefined,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[customer-operations GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load customer ops scores' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const scoreKind = CUSTOMER_OPS_SCORE_KINDS.includes(body.scoreKind as CustomerOpsScoreKind) ? (body.scoreKind as CustomerOpsScoreKind) : null;
  if (!companyId || !scoreKind) return res.status(400).json({ error: 'companyId and valid scoreKind required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const score = await generateCustomerOpsScore({
      organizationId: companyId,
      scoreKind,
      generatedBy: ctx.userId,
      metadata: (body.metadata as Record<string, unknown>) ?? {},
    });
    return res.status(200).json({ ok: true, score });
  } catch (err: any) {
    console.error('[customer-operations POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'customer_ops_failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/customer-operations' });
