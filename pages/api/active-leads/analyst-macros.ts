import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 10 — Analyst macros endpoint.
 *
 *   GET    ?companyId=...&executions=1&macroId=...
 *   GET    ?companyId=...                       — list macros
 *
 *   POST   { companyId, action:'upsert', id?, macroKind, name, description?, steps, shared?, enabled? }
 *   POST   { companyId, action:'execute', macroId, metadata? }
 *
 * Auth: enforceCompanyAccess. No extra capability — owner-scoped.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  executeAnalystMacro,
  listAnalystMacroExecutions,
  listAnalystMacros,
  upsertAnalystMacro,
} from '../../../backend/services/analystMacroService';
import {
  ANALYST_MACRO_KINDS,
  type AnalystMacroKind,
  type AnalystMacroStep,
} from '../../../backend/types/analystMacro';

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
    if (req.query.executions) {
      const items = await listAnalystMacroExecutions(companyId, {
        macroId: typeof req.query.macroId === 'string' ? req.query.macroId : undefined,
      });
      return res.status(200).json({ items, total: items.length });
    }
    const items = await listAnalystMacros(companyId, {
      macroKind: typeof req.query.macroKind === 'string' && ANALYST_MACRO_KINDS.includes(req.query.macroKind as AnalystMacroKind) ? (req.query.macroKind as AnalystMacroKind) : undefined,
      enabledOnly: req.query.enabledOnly ? true : false,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[analyst-macros GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load macros' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !['upsert', 'execute'].includes(action)) {
    return res.status(400).json({ error: 'companyId and action ∈ upsert|execute required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    if (action === 'upsert') {
      const macroKind = ANALYST_MACRO_KINDS.includes(body.macroKind as AnalystMacroKind) ? (body.macroKind as AnalystMacroKind) : null;
      if (!macroKind) return res.status(400).json({ error: 'valid macroKind required' });
      const macro = await upsertAnalystMacro({
        organizationId: companyId,
        id: typeof body.id === 'string' ? body.id : undefined,
        macroKind,
        name: String(body.name ?? ''),
        description: typeof body.description === 'string' ? body.description : null,
        steps: Array.isArray(body.steps) ? (body.steps as AnalystMacroStep[]) : [],
        ownerUserId: ctx.userId,
        shared: Boolean(body.shared),
        enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
        metadata: (body.metadata as Record<string, unknown>) ?? {},
      });
      return res.status(200).json({ ok: true, macro });
    }
    const exec = await executeAnalystMacro({
      organizationId: companyId,
      macroId: String(body.macroId ?? ''),
      executedBy: ctx.userId,
      metadata: (body.metadata as Record<string, unknown>) ?? {},
    });
    return res.status(200).json({ ok: true, execution: exec });
  } catch (err: any) {
    console.error('[analyst-macros POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'macro_action_failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/analyst-macros' });
