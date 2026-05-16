/**
 * Phase 7 — Audit export endpoint.
 *
 *   GET  ?companyId=...                  — list exports
 *   GET  ?companyId=...&exportId=...     — single export (includes payload)
 *   POST { companyId, exportType, format, filterCriteria }   — request export
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  getAuditExport,
  listAuditExports,
  requestAuditExport,
} from '../../../backend/services/auditExportService';
import {
  AUDIT_EXPORT_FORMATS,
  AUDIT_EXPORT_TYPES,
  type AuditExportFormat,
  type AuditExportType,
} from '../../../backend/types/auditExport';
import { publishRealtime } from '../../../backend/services/realtimePublisherService';

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
      const item = await getAuditExport(companyId, String(req.query.exportId));
      if (!item) return res.status(404).json({ error: 'export_not_found' });
      return res.status(200).json({ item });
    }
    const items = await listAuditExports(companyId);
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[audit-export GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load exports' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const exportType = body.exportType as AuditExportType;
  const format = (body.format ?? 'json') as AuditExportFormat;
  if (!companyId || !AUDIT_EXPORT_TYPES.includes(exportType) || !AUDIT_EXPORT_FORMATS.includes(format)) {
    return res.status(400).json({ error: 'companyId, exportType, format required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const filter = (body.filterCriteria ?? {}) as { since?: string; until?: string };
    const result = await requestAuditExport({
      organizationId: companyId,
      exportType,
      format,
      filterCriteria: filter,
      requestedBy: ctx.userId,
    });
    void publishRealtime({
      organizationId: companyId,
      topic: 'governance' as never,
      eventName: 'export.generated',
      payload: { export_id: result.id, export_type: exportType, format, row_count: result.row_count },
    });
    return res.status(200).json({ ok: true, export: result });
  } catch (err: any) {
    console.error('[audit-export POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Export failed' });
  }
}
