import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 5 — Cross-source identity resolution endpoint.
 *
 *   GET    /api/active-leads/identity-resolution?companyId=...&status=candidate&minConfidence=0.5
 *     List identity link candidates / confirmations.
 *
 *   POST   /api/active-leads/identity-resolution
 *     Body: { companyId, linkId, action: 'confirm'|'reject'|'reopen' }
 *     Reversible. Rejected links can be reopened.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  confirmIdentityLink,
  listIdentityLinks,
  rejectIdentityLink,
  reopenIdentityLink,
} from '../../../backend/services/crossSourceIdentityService';
import type { IdentityLinkStatus } from '../../../backend/types/authorIdentity';

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
  const status = typeof req.query.status === 'string' ? (req.query.status as IdentityLinkStatus) : undefined;
  const minConfidence = typeof req.query.minConfidence === 'string' ? Number(req.query.minConfidence) : undefined;
  try {
    const items = await listIdentityLinks(companyId, { status, minConfidence });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[identity GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load identity links' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as { companyId?: string; linkId?: string; action?: string };
  const companyId = body.companyId || '';
  const linkId = body.linkId || '';
  const action = body.action || '';
  if (!companyId || !linkId) return res.status(400).json({ error: 'companyId and linkId required' });
  if (!['confirm', 'reject', 'reopen'].includes(action)) {
    return res.status(400).json({ error: 'action must be confirm|reject|reopen' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    let updated;
    if (action === 'confirm') updated = await confirmIdentityLink(companyId, linkId, ctx.userId);
    else if (action === 'reject') updated = await rejectIdentityLink(companyId, linkId, ctx.userId);
    else updated = await reopenIdentityLink(companyId, linkId);
    return res.status(200).json({ ok: true, link: updated });
  } catch (err: any) {
    console.error('[identity POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Identity link update failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/identity-resolution' });
