/**
 * Phase 12 — Support snapshots endpoint.
 *
 *   GET  ?companyId=...&snapshotId=...
 *   GET  ?companyId=...&snapshotKind=...   — lightweight list
 *   POST { companyId, snapshotKind, scopeDescription?, linkedIncidentId?, linkedReplayId?, metadata? }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on POST.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  generateSupportSnapshot,
  getSupportSnapshot,
  listSupportSnapshots,
} from '../../../backend/services/supportSnapshotService';
import {
  SUPPORT_SNAPSHOT_KINDS,
  type SupportSnapshotKind,
} from '../../../backend/types/supportSnapshot';

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
    if (req.query.snapshotId) {
      const snapshot = await getSupportSnapshot(companyId, String(req.query.snapshotId));
      if (!snapshot) return res.status(404).json({ error: 'snapshot_not_found' });
      return res.status(200).json({ snapshot });
    }
    const items = await listSupportSnapshots(companyId, {
      snapshotKind: typeof req.query.snapshotKind === 'string' && SUPPORT_SNAPSHOT_KINDS.includes(req.query.snapshotKind as SupportSnapshotKind) ? (req.query.snapshotKind as SupportSnapshotKind) : undefined,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[support-snapshots GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load support snapshots' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const snapshotKind = SUPPORT_SNAPSHOT_KINDS.includes(body.snapshotKind as SupportSnapshotKind) ? (body.snapshotKind as SupportSnapshotKind) : null;
  if (!companyId || !snapshotKind) return res.status(400).json({ error: 'companyId and valid snapshotKind required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const snapshot = await generateSupportSnapshot({
      organizationId: companyId,
      snapshotKind,
      scopeDescription: typeof body.scopeDescription === 'string' ? body.scopeDescription : null,
      linkedIncidentId: typeof body.linkedIncidentId === 'string' ? body.linkedIncidentId : null,
      linkedReplayId: typeof body.linkedReplayId === 'string' ? body.linkedReplayId : null,
      generatedBy: ctx.userId,
      metadata: (body.metadata as Record<string, unknown>) ?? {},
    });
    return res.status(200).json({ ok: true, snapshot });
  } catch (err: any) {
    console.error('[support-snapshots POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'support_snapshot_failed' });
  }
}
