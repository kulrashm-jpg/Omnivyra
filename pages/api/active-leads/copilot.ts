/**
 * Phase 11 — Bounded AI copilot endpoint.
 *
 *   GET    ?companyId=...&responseId=...
 *   GET    ?companyId=...&copilotIntent=...&subjectRef=...
 *
 *   POST   { companyId, copilotIntent, subjectRef, prompt, queryHint?, contextWindow?, metadata? }
 *
 * Auth: enforceCompanyAccess. Read-only for analysts; generation
 * requires authenticated session (no extra capability — bounded +
 * auditable).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  generateCopilotResponse,
  getCopilotResponse,
  listCopilotResponses,
} from '../../../backend/services/copilotService';
import {
  COPILOT_INTENTS,
  type CopilotIntent,
} from '../../../backend/types/copilot';

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
    if (req.query.responseId) {
      const response = await getCopilotResponse(companyId, String(req.query.responseId));
      if (!response) return res.status(404).json({ error: 'response_not_found' });
      return res.status(200).json({ response });
    }
    const items = await listCopilotResponses(companyId, {
      copilotIntent: typeof req.query.copilotIntent === 'string' && COPILOT_INTENTS.includes(req.query.copilotIntent as CopilotIntent) ? (req.query.copilotIntent as CopilotIntent) : undefined,
      subjectRef: typeof req.query.subjectRef === 'string' ? req.query.subjectRef : undefined,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[copilot GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load copilot responses' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const intent = COPILOT_INTENTS.includes(body.copilotIntent as CopilotIntent) ? (body.copilotIntent as CopilotIntent) : null;
  if (!companyId || !intent) return res.status(400).json({ error: 'companyId and valid copilotIntent required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    const response = await generateCopilotResponse({
      organizationId: companyId,
      copilotIntent: intent,
      subjectRef: String(body.subjectRef ?? ''),
      prompt: String(body.prompt ?? ''),
      queryHint: typeof body.queryHint === 'string' ? body.queryHint : undefined,
      contextWindow: typeof body.contextWindow === 'number' ? body.contextWindow : undefined,
      requestedBy: ctx.userId,
      metadata: (body.metadata as Record<string, unknown>) ?? {},
    });
    return res.status(200).json({ ok: true, response });
  } catch (err: any) {
    console.error('[copilot POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'copilot_failed' });
  }
}
