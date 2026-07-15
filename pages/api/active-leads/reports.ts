import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 9 — Executive reporting endpoint.
 *
 *   GET    ?companyId=...                   — list executions
 *   GET    ?companyId=...&definitions=1     — list definitions
 *   GET    ?companyId=...&executionId=...   — single execution
 *
 *   POST   { companyId, action:'upsert_definition', id?, reportKind, name, description?, filterPayload?, scheduleCron?, enabled?, metadata? }
 *   POST   { companyId, action:'generate', reportKind, reportDefinitionId?, filterPayload?, windowStart?, windowEnd? }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on mutations.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  generateReport,
  getReportExecution,
  listReportDefinitions,
  listReportExecutions,
  upsertReportDefinition,
} from '../../../backend/services/executiveReportingService';
import {
  REPORT_KINDS,
  type ReportKind,
} from '../../../backend/types/reportDefinition';

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
    if (req.query.executionId) {
      const execution = await getReportExecution(companyId, String(req.query.executionId));
      if (!execution) return res.status(404).json({ error: 'report_execution_not_found' });
      return res.status(200).json({ execution });
    }
    if (req.query.definitions) {
      const items = await listReportDefinitions(companyId, {
        reportKind: typeof req.query.reportKind === 'string' && REPORT_KINDS.includes(req.query.reportKind as ReportKind) ? (req.query.reportKind as ReportKind) : undefined,
      });
      return res.status(200).json({ items, total: items.length });
    }
    const items = await listReportExecutions(companyId, {
      reportKind: typeof req.query.reportKind === 'string' && REPORT_KINDS.includes(req.query.reportKind as ReportKind) ? (req.query.reportKind as ReportKind) : undefined,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[reports GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load reports' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !['upsert_definition', 'generate'].includes(action)) {
    return res.status(400).json({ error: 'companyId and action ∈ upsert_definition|generate required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  const reportKind = REPORT_KINDS.includes(body.reportKind as ReportKind) ? (body.reportKind as ReportKind) : null;
  if (!reportKind) return res.status(400).json({ error: 'valid reportKind required' });
  try {
    if (action === 'upsert_definition') {
      const definition = await upsertReportDefinition({
        organizationId: companyId,
        id: typeof body.id === 'string' ? body.id : undefined,
        reportKind,
        name: String(body.name ?? ''),
        description: typeof body.description === 'string' ? body.description : null,
        filterPayload: (body.filterPayload as Record<string, unknown>) ?? {},
        scheduleCron: typeof body.scheduleCron === 'string' ? body.scheduleCron : null,
        enabled: Boolean(body.enabled),
        ownerUserId: ctx.userId,
        metadata: (body.metadata as Record<string, unknown>) ?? {},
      });
      return res.status(200).json({ ok: true, definition });
    }
    const execution = await generateReport({
      organizationId: companyId,
      reportKind,
      reportDefinitionId: typeof body.reportDefinitionId === 'string' ? body.reportDefinitionId : null,
      filterPayload: (body.filterPayload as Record<string, unknown>) ?? {},
      windowStart: typeof body.windowStart === 'string' ? body.windowStart : undefined,
      windowEnd: typeof body.windowEnd === 'string' ? body.windowEnd : undefined,
      requestedBy: ctx.userId,
    });
    return res.status(200).json({ ok: true, execution });
  } catch (err: any) {
    console.error('[reports POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'report_failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/reports' });
