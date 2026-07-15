import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 11 — Resilience validation endpoint.
 *
 *   GET    ?companyId=...&validationKind=...
 *
 *   POST   { companyId, validationKind, windowStart?, windowEnd?, metadata? }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on POST.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  listResilienceValidations,
  runResilienceValidation,
} from '../../../backend/services/resilienceValidationService';
import {
  RESILIENCE_VALIDATION_KINDS,
  type ResilienceValidationKind,
} from '../../../backend/types/resilienceValidation';

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
    const items = await listResilienceValidations(companyId, {
      validationKind: typeof req.query.validationKind === 'string' && RESILIENCE_VALIDATION_KINDS.includes(req.query.validationKind as ResilienceValidationKind) ? (req.query.validationKind as ResilienceValidationKind) : undefined,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[resilience-validation GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load resilience validations' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const validationKind = RESILIENCE_VALIDATION_KINDS.includes(body.validationKind as ResilienceValidationKind) ? (body.validationKind as ResilienceValidationKind) : null;
  if (!companyId || !validationKind) return res.status(400).json({ error: 'companyId and valid validationKind required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const run = await runResilienceValidation({
      organizationId: companyId,
      validationKind,
      windowStart: typeof body.windowStart === 'string' ? body.windowStart : undefined,
      windowEnd: typeof body.windowEnd === 'string' ? body.windowEnd : undefined,
      initiatedBy: ctx.userId,
      metadata: (body.metadata as Record<string, unknown>) ?? {},
    });
    return res.status(200).json({ ok: true, run });
  } catch (err: any) {
    console.error('[resilience-validation POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'resilience_failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/resilience-validation' });
