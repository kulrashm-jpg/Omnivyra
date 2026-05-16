/**
 * Phase 11 — Production certification endpoint.
 *
 *   GET    ?companyId=...&certificationKind=...
 *
 *   POST   { companyId, certificationKind, metadata? }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on POST.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  generateCertification,
  listCertifications,
} from '../../../backend/services/productionCertificationService';
import {
  PRODUCTION_CERTIFICATION_KINDS,
  type ProductionCertificationKind,
} from '../../../backend/types/productionCertification';

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
    const items = await listCertifications(companyId, {
      certificationKind: typeof req.query.certificationKind === 'string' && PRODUCTION_CERTIFICATION_KINDS.includes(req.query.certificationKind as ProductionCertificationKind) ? (req.query.certificationKind as ProductionCertificationKind) : undefined,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[production-certification GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load certifications' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const certificationKind = PRODUCTION_CERTIFICATION_KINDS.includes(body.certificationKind as ProductionCertificationKind) ? (body.certificationKind as ProductionCertificationKind) : null;
  if (!companyId || !certificationKind) return res.status(400).json({ error: 'companyId and valid certificationKind required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const report = await generateCertification({
      organizationId: companyId,
      certificationKind,
      generatedBy: ctx.userId,
      metadata: (body.metadata as Record<string, unknown>) ?? {},
    });
    return res.status(200).json({ ok: true, report });
  } catch (err: any) {
    console.error('[production-certification POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'certification_failed' });
  }
}
