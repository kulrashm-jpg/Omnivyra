/**
 * Phase 10 — Compliance evidence endpoint.
 *
 *   GET    ?companyId=...&exportId=...
 *   GET    ?companyId=...                            — list (lightweight)
 *
 *   POST   { companyId, evidenceKind, certificationTarget?, windowStart?, windowEnd?, metadata? }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on POST.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  generateComplianceExport,
  getComplianceExport,
  listComplianceExports,
} from '../../../backend/services/complianceEvidenceService';
import {
  COMPLIANCE_EVIDENCE_KINDS,
  COMPLIANCE_TARGETS,
  type ComplianceEvidenceKind,
  type ComplianceTarget,
} from '../../../backend/types/complianceEvidence';

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
    if (req.query.exportId) {
      const exported = await getComplianceExport(companyId, String(req.query.exportId));
      if (!exported) return res.status(404).json({ error: 'export_not_found' });
      return res.status(200).json({ export: exported });
    }
    const items = await listComplianceExports(companyId, {
      evidenceKind: typeof req.query.evidenceKind === 'string' && COMPLIANCE_EVIDENCE_KINDS.includes(req.query.evidenceKind as ComplianceEvidenceKind) ? (req.query.evidenceKind as ComplianceEvidenceKind) : undefined,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[compliance-evidence GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load compliance exports' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const evidenceKind = COMPLIANCE_EVIDENCE_KINDS.includes(body.evidenceKind as ComplianceEvidenceKind) ? (body.evidenceKind as ComplianceEvidenceKind) : null;
  if (!companyId || !evidenceKind) return res.status(400).json({ error: 'companyId and valid evidenceKind required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const target: ComplianceTarget = typeof body.certificationTarget === 'string' && COMPLIANCE_TARGETS.includes(body.certificationTarget as ComplianceTarget) ? (body.certificationTarget as ComplianceTarget) : 'soc2';
    const exported = await generateComplianceExport({
      organizationId: companyId,
      evidenceKind,
      certificationTarget: target,
      windowStart: typeof body.windowStart === 'string' ? body.windowStart : undefined,
      windowEnd: typeof body.windowEnd === 'string' ? body.windowEnd : undefined,
      generatedBy: ctx.userId,
      metadata: (body.metadata as Record<string, unknown>) ?? {},
    });
    return res.status(200).json({ ok: true, export: exported });
  } catch (err: any) {
    console.error('[compliance-evidence POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'compliance_export_failed' });
  }
}
