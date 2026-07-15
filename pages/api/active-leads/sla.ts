import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 8 — SLA monitoring endpoint.
 *
 *   GET ?companyId=...                  — snapshot
 *   GET ?companyId=...&breaches=1       — recorded breaches
 *   POST { companyId, action: 'record_breach', verdict }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  computeSlaSnapshot,
  listSlaBreaches,
  recordSlaBreach,
} from '../../../backend/services/slaMonitoringService';
import { publishRealtime } from '../../../backend/services/realtimePublisherService';

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
    if (req.query.breaches === '1' || req.query.breaches === 'true') {
      const items = await listSlaBreaches(companyId);
      return res.status(200).json({ items, total: items.length });
    }
    const snapshot = await computeSlaSnapshot(companyId);
    return res.status(200).json(snapshot);
  } catch (err: any) {
    console.error('[sla GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load SLA' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  if (!companyId || body.action !== 'record_breach') {
    return res.status(400).json({ error: 'companyId and action=record_breach required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const verdict = body.verdict as Parameters<typeof recordSlaBreach>[0]['verdict'];
    const breach = await recordSlaBreach({ organizationId: companyId, verdict });
    if (breach) {
      void publishRealtime({
        organizationId: companyId,
        topic: 'sla',
        eventName: breach.severity === 'breach' ? 'sla.breach_detected' : 'sla.degraded',
        payload: { sla_kind: breach.sla_kind, severity: breach.severity, observed: breach.observed_value, threshold: breach.threshold_value },
      });
    }
    return res.status(200).json({ ok: true, breach });
  } catch (err: any) {
    console.error('[sla POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'SLA action failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/sla' });
