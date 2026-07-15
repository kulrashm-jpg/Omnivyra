import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 12 — Platform stabilization endpoint.
 *
 *   GET    ?companyId=...                       — list windows
 *   GET    ?companyId=...&windowId=...&events=1 — event history
 *
 *   POST   { companyId, action:'create', windowName, freezeMode, freezeScope, scheduledStart, scheduledEnd, rationale?, boundedScope?, metadata? }
 *   POST   { companyId, action:'activate', windowId }
 *   POST   { companyId, action:'close', windowId, closeAs? }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on mutations.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  activateStabilizationWindow,
  closeStabilizationWindow,
  createStabilizationWindow,
  listStabilizationEvents,
  listStabilizationWindows,
} from '../../../backend/services/platformStabilizationService';
import {
  STABILIZATION_FREEZE_MODES,
  STABILIZATION_FREEZE_SCOPES,
  STABILIZATION_WINDOW_STATES,
  type StabilizationFreezeMode,
  type StabilizationFreezeScope,
  type StabilizationWindowState,
} from '../../../backend/types/platformStabilization';

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
    if (req.query.windowId && req.query.events) {
      const items = await listStabilizationEvents(companyId, String(req.query.windowId));
      return res.status(200).json({ items, total: items.length });
    }
    const items = await listStabilizationWindows(companyId, {
      state: typeof req.query.state === 'string' && STABILIZATION_WINDOW_STATES.includes(req.query.state as StabilizationWindowState) ? (req.query.state as StabilizationWindowState) : undefined,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[platform-stabilization GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load stabilization state' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !['create', 'activate', 'close'].includes(action)) {
    return res.status(400).json({ error: 'companyId and action ∈ create|activate|close required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    if (action === 'create') {
      const freezeMode = STABILIZATION_FREEZE_MODES.includes(body.freezeMode as StabilizationFreezeMode) ? (body.freezeMode as StabilizationFreezeMode) : null;
      const freezeScope = STABILIZATION_FREEZE_SCOPES.includes(body.freezeScope as StabilizationFreezeScope) ? (body.freezeScope as StabilizationFreezeScope) : null;
      if (!freezeMode || !freezeScope) return res.status(400).json({ error: 'valid freezeMode and freezeScope required' });
      const win = await createStabilizationWindow({
        organizationId: companyId,
        windowName: String(body.windowName ?? ''),
        freezeMode,
        freezeScope,
        scheduledStart: String(body.scheduledStart ?? ''),
        scheduledEnd: String(body.scheduledEnd ?? ''),
        rationale: typeof body.rationale === 'string' ? body.rationale : null,
        boundedScope: Array.isArray(body.boundedScope) ? (body.boundedScope as string[]) : [],
        actorUserId: ctx.userId,
        metadata: (body.metadata as Record<string, unknown>) ?? {},
      });
      return res.status(200).json({ ok: true, window: win });
    }
    if (action === 'activate') {
      const win = await activateStabilizationWindow({ organizationId: companyId, windowId: String(body.windowId ?? ''), actorUserId: ctx.userId });
      return res.status(200).json({ ok: true, window: win });
    }
    const closeAs = body.closeAs === 'cancelled' || body.closeAs === 'expired' ? (body.closeAs as 'cancelled' | 'expired') : 'closed';
    const win = await closeStabilizationWindow({ organizationId: companyId, windowId: String(body.windowId ?? ''), actorUserId: ctx.userId, closeAs });
    return res.status(200).json({ ok: true, window: win });
  } catch (err: any) {
    console.error('[platform-stabilization POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'stabilization_action_failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/platform-stabilization' });
