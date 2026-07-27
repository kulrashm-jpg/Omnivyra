import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import * as ops from '../../../backend/services/operations/operationalCoreService';
import type { OperationalEntityRef, OperationalEntityType } from '../../../backend/services/operations/operationalCoreService';

/**
 * /api/lead-intelligence/operations — THE single operational mutation + read layer for
 * the Lead Operations Console (LC-201 / W2). One auth model (enforceCompanyAccess), one
 * audit model (the service appends to the canonical timeline), one permission model.
 * No per-primitive endpoints — everything routes through the one `action` dispatcher.
 *
 * GET  ?company_id&entity_id[&entity_type]           → operational overlay (status/assignee/notes/tasks)
 * GET  ?company_id&assignee=<userId>                 → that user's active assignment queue
 * POST { action, ... }                               → mutation (see ACTIONS below)
 */
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

function refOf(companyId: string, entityId: string, entityType?: string): OperationalEntityRef {
  return { companyId, entityType: (entityType as OperationalEntityType) || 'canonical_lead', entityId };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const companyId = String((req.method === 'GET' ? req.query.company_id : req.body?.company_id) || '').trim();
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const actor = { userId: user.userId };

  try {
    if (req.method === 'GET') {
      const assignee = str(req.query.assignee);
      if (assignee) return res.status(200).json({ assignments: await ops.listAssignmentsForUser(companyId, assignee) });
      const entityId = str(req.query.entity_id);
      if (!entityId) return res.status(400).json({ error: 'entity_id or assignee required' });
      return res.status(200).json(await ops.getOperationalOverlay(refOf(companyId, entityId, str(req.query.entity_type))));
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const action = str(b.action);
      const ref = (id?: string) => refOf(companyId, id ?? str(b.entity_id) ?? '', str(b.entity_type));
      const entities = (): OperationalEntityRef[] => arr(b.entity_ids).map((id) => refOf(companyId, id, str(b.entity_type)));

      switch (action) {
        case 'set_status':   return res.status(200).json(await ops.setStatus(ref(), actor, String(b.status), str(b.reason)));
        case 'assign':       { await ops.assign(ref(), actor, String(b.assignee_id)); return res.status(200).json({ ok: true }); }
        case 'unassign':     { await ops.unassign(ref(), actor, str(b.reason)); return res.status(200).json({ ok: true }); }
        case 'add_note':     return res.status(201).json(await ops.addNote(ref(), actor, { body: String(b.body), bodyFormat: b.body_format, mentions: arr(b.mentions), pinned: !!b.pinned }));
        case 'pin_note':     { await ops.setNotePinned(companyId, String(b.note_id), actor, !!b.pinned); return res.status(200).json({ ok: true }); }
        case 'delete_note':  { await ops.deleteNote(companyId, String(b.note_id), actor); return res.status(200).json({ ok: true }); }
        case 'create_task':  return res.status(201).json(await ops.createTask(ref(), actor, { taskType: b.task_type, title: String(b.title), description: str(b.description), ownerId: b.owner_id ?? null, dueAt: b.due_at ?? null, priority: b.priority, origin: b.origin }));
        case 'update_task':  { await ops.updateTask(companyId, String(b.task_id), actor, { status: str(b.status), title: str(b.title), description: str(b.description), ownerId: b.owner_id, dueAt: b.due_at, priority: str(b.priority) }); return res.status(200).json({ ok: true }); }
        case 'bulk_set_status':  return res.status(200).json(await ops.bulkSetStatus(entities(), actor, String(b.status), str(b.reason)));
        case 'bulk_assign':      return res.status(200).json(await ops.bulkAssign(entities(), actor, String(b.assignee_id)));
        case 'bulk_archive':     return res.status(200).json(await ops.bulkArchive(entities(), actor, str(b.reason)));
        case 'bulk_create_task': return res.status(200).json(await ops.bulkCreateTask(entities(), actor, { taskType: b.task_type, title: String(b.title), description: str(b.description), priority: b.priority, origin: b.origin }));
        default: return res.status(400).json({ error: 'unknown_action' });
      }
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err instanceof ops.OperationalError) return res.status(err.httpStatus).json({ error: err.code });
    return res.status(500).json({ error: err instanceof Error ? err.message : 'operation_failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/lead-intelligence/operations' });
