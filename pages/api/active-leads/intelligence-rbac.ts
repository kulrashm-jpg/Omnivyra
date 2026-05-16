/**
 * Phase 8 — Enterprise intelligence RBAC endpoint.
 *
 *   GET   ?companyId=...                 — list roles
 *   GET   ?companyId=...&userId=...      — user's assignments
 *   POST  { companyId, action: 'seed'|'upsert_role'|'assign'|'revoke', ... }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  assignIntelligenceRole,
  listAssignmentsForUser,
  listIntelligenceRoles,
  revokeIntelligenceRoleAssignment,
  seedIntelligenceRoles,
  upsertIntelligenceRole,
} from '../../../backend/services/intelligenceRbacService';
import {
  INTELLIGENCE_CAPABILITIES,
  type IntelligenceCapability,
} from '../../../backend/types/intelligenceRbac';

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
    if (req.query.userId) {
      const items = await listAssignmentsForUser(companyId, String(req.query.userId));
      return res.status(200).json({ assignments: items });
    }
    const items = await listIntelligenceRoles(companyId);
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[intelligence-rbac GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load RBAC' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !['seed', 'upsert_role', 'assign', 'revoke'].includes(action)) {
    return res.status(400).json({ error: 'companyId, action ∈ seed|upsert_role|assign|revoke required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    if (action === 'seed') {
      const seeded = await seedIntelligenceRoles({ organizationId: companyId, createdBy: ctx.userId });
      return res.status(200).json({ ok: true, roles: seeded });
    }
    if (action === 'upsert_role') {
      const caps = Array.isArray(body.capabilities)
        ? (body.capabilities as string[]).filter((c): c is IntelligenceCapability => INTELLIGENCE_CAPABILITIES.includes(c as IntelligenceCapability))
        : [];
      const result = await upsertIntelligenceRole({
        organizationId: companyId,
        roleKey: String(body.roleKey ?? ''),
        displayName: String(body.displayName ?? ''),
        capabilities: caps,
        ssoExternalId: typeof body.ssoExternalId === 'string' ? body.ssoExternalId : null,
        createdBy: ctx.userId,
      });
      return res.status(200).json({ ok: true, role: result });
    }
    if (action === 'assign') {
      const result = await assignIntelligenceRole({
        organizationId: companyId,
        userId: String(body.userId ?? ''),
        roleId: String(body.roleId ?? ''),
        assignedBy: ctx.userId,
        expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
      });
      return res.status(200).json({ ok: true, assignment: result });
    }
    const result = await revokeIntelligenceRoleAssignment({
      organizationId: companyId,
      assignmentId: String(body.assignmentId ?? ''),
    });
    return res.status(200).json({ ok: true, assignment: result });
  } catch (err: any) {
    console.error('[intelligence-rbac POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'RBAC action failed' });
  }
}
