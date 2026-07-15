import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 7 — Investigation workspace endpoint.
 *
 *   GET    ?companyId=...
 *   GET    ?companyId=...&workspaceId=...&items=1
 *   POST   { companyId, title, description }                    — create workspace
 *   POST   { companyId, workspaceId, kind: 'item', ... }        — add item
 *   PATCH  { companyId, workspaceId, status }                   — update status
 *   DELETE ?companyId=...&workspaceItemId=...                   — remove item
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  addWorkspaceItem,
  createWorkspace,
  listWorkspaceItems,
  listWorkspaces,
  removeWorkspaceItem,
  updateWorkspaceStatus,
} from '../../../backend/services/investigationWorkspaceService';
import {
  INVESTIGATION_ITEM_KINDS,
  INVESTIGATION_STATUSES,
  type InvestigationItemKind,
  type InvestigationStatus,
} from '../../../backend/types/investigationWorkspace';
import { publishRealtime } from '../../../backend/services/realtimePublisherService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  if (req.method === 'PATCH') return handlePatch(req, res);
  if (req.method === 'DELETE') return handleDelete(req, res);
  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    if (req.query.workspaceId && (req.query.items === '1' || req.query.items === 'true')) {
      const items = await listWorkspaceItems(companyId, String(req.query.workspaceId));
      return res.status(200).json({ items, total: items.length });
    }
    const items = await listWorkspaces(companyId);
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[investigations GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load investigations' });
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
    if (body.kind === 'item') {
      const itemKind = body.itemKind as InvestigationItemKind;
      if (!INVESTIGATION_ITEM_KINDS.includes(itemKind)) return res.status(400).json({ error: 'invalid itemKind' });
      const result = await addWorkspaceItem({
        organizationId: companyId,
        workspaceId: String(body.workspaceId ?? ''),
        itemKind,
        itemRef: String(body.itemRef ?? ''),
        body: typeof body.body === 'string' ? body.body : null,
        pinned: Boolean(body.pinned),
        addedBy: ctx.userId,
      });
      void publishRealtime({
        organizationId: companyId,
        topic: 'workflow',
        eventName: 'investigation.updated',
        payload: { workspace_id: result.workspace_id, item_kind: itemKind, item_ref: result.item_ref },
      });
      return res.status(200).json({ ok: true, item: result });
    }
    const result = await createWorkspace({
      organizationId: companyId,
      title: String(body.title ?? ''),
      description: typeof body.description === 'string' ? body.description : null,
      createdBy: ctx.userId,
    });
    void publishRealtime({
      organizationId: companyId,
      topic: 'workflow',
      eventName: 'investigation.created',
      payload: { workspace_id: result.id, title: result.title },
    });
    return res.status(200).json({ ok: true, workspace: result });
  } catch (err: any) {
    console.error('[investigations POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Workspace write failed' });
  }
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const workspaceId = String(body.workspaceId ?? '');
  const status = body.status as InvestigationStatus;
  if (!companyId || !workspaceId || !INVESTIGATION_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'companyId, workspaceId, valid status required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const result = await updateWorkspaceStatus({ organizationId: companyId, workspaceId, status });
    return res.status(200).json({ ok: true, workspace: result });
  } catch (err: any) {
    console.error('[investigations PATCH] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Workspace status update failed' });
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  const companyId = String(req.query.companyId ?? '');
  const workspaceItemId = String(req.query.workspaceItemId ?? '');
  if (!companyId || !workspaceItemId) return res.status(400).json({ error: 'companyId and workspaceItemId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const removed = await removeWorkspaceItem({ organizationId: companyId, workspaceItemId });
    return res.status(200).json({ ok: true, removed });
  } catch (err: any) {
    console.error('[investigations DELETE] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Workspace item removal failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/investigations' });
