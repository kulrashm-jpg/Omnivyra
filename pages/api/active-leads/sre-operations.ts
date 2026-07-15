import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 12 — SRE operations endpoint.
 *
 *   GET  ?companyId=...&snapshotKind=...
 *   POST { companyId, snapshotKind, metadata? }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on POST.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  generateSreSnapshot,
  listSreSnapshots,
} from '../../../backend/services/sreOperationsService';
import {
  SRE_SNAPSHOT_KINDS,
  type SreSnapshotKind,
} from '../../../backend/types/sreOperations';

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
    const items = await listSreSnapshots(companyId, {
      snapshotKind: typeof req.query.snapshotKind === 'string' && SRE_SNAPSHOT_KINDS.includes(req.query.snapshotKind as SreSnapshotKind) ? (req.query.snapshotKind as SreSnapshotKind) : undefined,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[sre-operations GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load SRE snapshots' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const snapshotKind = SRE_SNAPSHOT_KINDS.includes(body.snapshotKind as SreSnapshotKind) ? (body.snapshotKind as SreSnapshotKind) : null;
  if (!companyId || !snapshotKind) return res.status(400).json({ error: 'companyId and valid snapshotKind required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const snapshot = await generateSreSnapshot({
      organizationId: companyId,
      snapshotKind,
      generatedBy: ctx.userId,
      metadata: (body.metadata as Record<string, unknown>) ?? {},
    });
    return res.status(200).json({ ok: true, snapshot });
  } catch (err: any) {
    console.error('[sre-operations POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'sre_snapshot_failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/sre-operations' });
