import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import * as aud from '../../../backend/services/audience/audienceService';
import * as ops from '../../../backend/services/operations/operationalCoreService';

/**
 * /api/lead-intelligence/audiences — THE canonical Audience API (LC-301 / W3).
 * One read model, one mutation model, one permission model (enforceCompanyAccess).
 * Audience-level operational mutations reuse /api/lead-intelligence/operations with
 * entity_type='audience'; member bulk-actions here reuse the same operational core.
 *
 * GET  ?company_id&list=1                              → audiences
 * GET  ?company_id&audience_id=..                      → audience + members + intelligence + operational overlay
 * GET  ?company_id&audience_id=..&explain=<entityId>   → membership explainability
 * POST { action: create|update|delete|preview|evaluate|explain|intelligence|bulk_members, ... }
 */
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const companyId = String((req.method === 'GET' ? req.query.company_id : req.body?.company_id) || '').trim();
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const actorId = user.userId;

  try {
    if (req.method === 'GET') {
      const audienceId = str(req.query.audience_id);
      if (str(req.query.list) || !audienceId) return res.status(200).json({ audiences: await aud.listAudiences(companyId) });
      const explain = str(req.query.explain);
      if (explain) return res.status(200).json((await aud.explainMembership(companyId, audienceId, explain)) ?? { error: 'not_a_member' });
      const [audience, members, intelligence, overlay] = await Promise.all([
        aud.getAudience(companyId, audienceId),
        aud.listMembers(companyId, audienceId),
        aud.getAudienceIntelligence(companyId, audienceId).catch(() => null),
        ops.getOperationalOverlay({ companyId, entityType: 'audience', entityId: audienceId }),
      ]);
      if (!audience) return res.status(404).json({ error: 'not_found' });
      return res.status(200).json({ audience, members, intelligence, operational: overlay });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      switch (str(b.action)) {
        case 'create':       return res.status(201).json(await aud.createAudience(companyId, actorId, { name: String(b.name), description: str(b.description), kind: b.kind, rules: b.rules, metadata: b.metadata }));
        case 'update':       { await aud.updateAudience(companyId, String(b.audience_id), { name: str(b.name), description: str(b.description), kind: b.kind, rules: b.rules, metadata: b.metadata }); return res.status(200).json({ ok: true }); }
        case 'delete':       { await aud.deleteAudience(companyId, String(b.audience_id)); return res.status(200).json({ ok: true }); }
        case 'preview':      return res.status(200).json(await aud.previewAudience(companyId, b.rules, Number(b.limit) || 50));
        case 'evaluate':     return res.status(200).json(await aud.evaluateAudience(companyId, String(b.audience_id)));
        case 'explain':      return res.status(200).json((await aud.explainMembership(companyId, String(b.audience_id), String(b.entity_id))) ?? { error: 'not_a_member' });
        case 'intelligence': return res.status(200).json(await aud.getAudienceIntelligence(companyId, String(b.audience_id)));
        case 'bulk_members': return res.status(200).json(await bulkOnMembers(companyId, actorId, String(b.audience_id), b));
        default: return res.status(400).json({ error: 'unknown_action' });
      }
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err instanceof aud.AudienceError) return res.status(err.httpStatus).json({ error: err.code });
    if (err instanceof ops.OperationalError) return res.status(err.httpStatus).json({ error: err.code });
    return res.status(500).json({ error: err instanceof Error ? err.message : 'audience_operation_failed' });
  }
}

/** Bulk operational action over an audience's active members — reuses the W2 operational core. */
async function bulkOnMembers(companyId: string, actorId: string, audienceId: string, b: any) {
  const members = await aud.listMembers(companyId, audienceId, 5000);
  const refs = members.map((m) => ({ companyId, entityType: 'canonical_lead' as const, entityId: String((m as any).entity_id) }));
  const actor = { userId: actorId };
  switch (str(b.op)) {
    case 'assign':      return ops.bulkAssign(refs, actor, String(b.assignee_id));
    case 'set_status':  return ops.bulkSetStatus(refs, actor, String(b.status), str(b.reason));
    case 'create_task': return ops.bulkCreateTask(refs, actor, { taskType: b.task_type, title: String(b.title), priority: b.priority, origin: b.origin });
    default: throw new ops.OperationalError('unknown_bulk_op', 400);
  }
}

export default __createApiRoute(handler, { route: '/api/lead-intelligence/audiences' });
