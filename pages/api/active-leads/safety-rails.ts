/**
 * Phase 11 — Operational safety rails endpoint.
 *
 *   GET    ?companyId=...                       — list rails
 *   GET    ?companyId=...&events=1&railId=...   — event history
 *
 *   POST   { companyId, action:'report',  railKind, observedValue }
 *   POST   { companyId, action:'override', railKind, rationale }
 *   POST   { companyId, action:'ack',     railKind }
 *   POST   { companyId, action:'freeze',  railKind, rationale }
 *   POST   { companyId, action:'rearm',   railKind }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on POST.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  acknowledgeRail,
  freezeRail,
  listSafetyRailEvents,
  listSafetyRails,
  overrideRail,
  reArmRail,
  reportRailObservation,
} from '../../../backend/services/operationalSafetyRailsService';
import {
  SAFETY_RAIL_KINDS,
  type SafetyRailKind,
} from '../../../backend/types/operationalSafetyRail';

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
    if (req.query.events) {
      const items = await listSafetyRailEvents(companyId, {
        railId: typeof req.query.railId === 'string' ? req.query.railId : undefined,
      });
      return res.status(200).json({ items, total: items.length });
    }
    const items = await listSafetyRails(companyId);
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[safety-rails GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load safety rails' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !['report', 'override', 'ack', 'freeze', 'rearm'].includes(action)) {
    return res.status(400).json({ error: 'companyId and valid action required' });
  }
  const railKind = SAFETY_RAIL_KINDS.includes(body.railKind as SafetyRailKind) ? (body.railKind as SafetyRailKind) : null;
  if (!railKind) return res.status(400).json({ error: 'valid railKind required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    if (action === 'report') {
      const rail = await reportRailObservation({ organizationId: companyId, railKind, observedValue: Number(body.observedValue ?? 0), actorUserId: ctx.userId });
      return res.status(200).json({ ok: true, rail });
    }
    if (action === 'override') {
      const rail = await overrideRail({ organizationId: companyId, railKind, actorUserId: ctx.userId, rationale: String(body.rationale ?? 'operator override') });
      return res.status(200).json({ ok: true, rail });
    }
    if (action === 'ack') {
      const rail = await acknowledgeRail({ organizationId: companyId, railKind, actorUserId: ctx.userId });
      return res.status(200).json({ ok: true, rail });
    }
    if (action === 'freeze') {
      const rail = await freezeRail({ organizationId: companyId, railKind, actorUserId: ctx.userId, rationale: String(body.rationale ?? 'operator freeze') });
      return res.status(200).json({ ok: true, rail });
    }
    const rail = await reArmRail({ organizationId: companyId, railKind, actorUserId: ctx.userId });
    return res.status(200).json({ ok: true, rail });
  } catch (err: any) {
    console.error('[safety-rails POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'safety_rail_action_failed' });
  }
}
