/**
 * Phase 12 — Governance convergence endpoint.
 *
 *   GET  ?companyId=...&scopeKind=...
 *   POST { companyId, scopeKind, metadata? }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on POST.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  generateConvergenceScore,
  listConvergenceScores,
} from '../../../backend/services/governanceConvergenceService';
import {
  GOVERNANCE_CONVERGENCE_SCOPES,
  type GovernanceConvergenceScope,
} from '../../../backend/types/governanceConvergence';

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
    const items = await listConvergenceScores(companyId, {
      scopeKind: typeof req.query.scopeKind === 'string' && GOVERNANCE_CONVERGENCE_SCOPES.includes(req.query.scopeKind as GovernanceConvergenceScope) ? (req.query.scopeKind as GovernanceConvergenceScope) : undefined,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[governance-convergence GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load governance convergence' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const scopeKind = GOVERNANCE_CONVERGENCE_SCOPES.includes(body.scopeKind as GovernanceConvergenceScope) ? (body.scopeKind as GovernanceConvergenceScope) : null;
  if (!companyId || !scopeKind) return res.status(400).json({ error: 'companyId and valid scopeKind required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const score = await generateConvergenceScore({
      organizationId: companyId,
      scopeKind,
      generatedBy: ctx.userId,
      metadata: (body.metadata as Record<string, unknown>) ?? {},
    });
    return res.status(200).json({ ok: true, score });
  } catch (err: any) {
    console.error('[governance-convergence POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'gov_convergence_failed' });
  }
}
