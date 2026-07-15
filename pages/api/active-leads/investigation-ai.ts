import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 10 — AI-assisted investigation endpoint.
 *
 *   GET    ?companyId=...&summaryId=...
 *   GET    ?companyId=...&investigationKind=...&subjectRef=...
 *
 *   POST   { companyId, investigationKind, subjectRef, queryHint?, contextWindow?, metadata? }
 *
 * Auth: enforceCompanyAccess. Read-only for analysts; generation requires
 * authenticated session (no extra capability — investigations are
 * bounded + auditable).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  generateInvestigationSummary,
  getInvestigationSummary,
  listInvestigationSummaries,
} from '../../../backend/services/aiInvestigationService';
import {
  INVESTIGATION_AI_KINDS,
  type InvestigationAiKind,
} from '../../../backend/types/investigationAi';

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
    if (req.query.summaryId) {
      const summary = await getInvestigationSummary(companyId, String(req.query.summaryId));
      if (!summary) return res.status(404).json({ error: 'summary_not_found' });
      return res.status(200).json({ summary });
    }
    const kind = typeof req.query.investigationKind === 'string' && INVESTIGATION_AI_KINDS.includes(req.query.investigationKind as InvestigationAiKind) ? (req.query.investigationKind as InvestigationAiKind) : undefined;
    const items = await listInvestigationSummaries(companyId, {
      investigationKind: kind,
      subjectRef: typeof req.query.subjectRef === 'string' ? req.query.subjectRef : undefined,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[investigation-ai GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load investigation summaries' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const investigationKind = INVESTIGATION_AI_KINDS.includes(body.investigationKind as InvestigationAiKind) ? (body.investigationKind as InvestigationAiKind) : null;
  if (!companyId || !investigationKind) return res.status(400).json({ error: 'companyId and valid investigationKind required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    const summary = await generateInvestigationSummary({
      organizationId: companyId,
      investigationKind,
      subjectRef: String(body.subjectRef ?? ''),
      queryHint: typeof body.queryHint === 'string' ? body.queryHint : undefined,
      contextWindow: typeof body.contextWindow === 'number' ? body.contextWindow : undefined,
      requestedBy: ctx.userId,
      metadata: (body.metadata as Record<string, unknown>) ?? {},
    });
    return res.status(200).json({ ok: true, summary });
  } catch (err: any) {
    console.error('[investigation-ai POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'investigation_failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/investigation-ai' });
