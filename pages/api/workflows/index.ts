import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * PI-WORKFLOW-DEFINITION-032 — the Workflow collection.
 *
 *   GET  /api/workflows?company_id=<uuid>            -> { workflows }
 *   POST /api/workflows   { company_id, name, description? } -> { workflow }
 *
 * ─── AUTHORIZATION: THE NEAREST CORRECT-SHAPED GRANT, DOCUMENTED ──────────
 * `PROSPECT_ICP_MANAGE`. No workflow-specific capability exists and the registry
 * is frozen, so 032 did not invent one — it recorded a dedicated grant as an open
 * product decision instead.
 *
 * It is the nearest grant whose REASONING fits rather than merely whose name is
 * adjacent: its own definition explains it exists because it "authorises a
 * DEFINITION THAT GOVERNS EVERY PROSPECT" rather than an assertion about one
 * person, and a Workflow Definition is exactly that one level further out. It is
 * granted as narrowly as `PROSPECT_INGEST` — COMPANY_ADMIN and above.
 *
 * The alternatives were considered and rejected: `CAMPAIGN_EXECUTE` and
 * `CAMPAIGN_VIEW` gate `pages/api/campaigns/*`, a different (content) domain, and
 * 014 already recorded why; `AUTOMATION_EXECUTE` authorises EXECUTING automation,
 * and using it to gate AUTHORING would conflate the two in both directions.
 *
 * Stated plainly as a consequence: holders of `PROSPECT_ICP_MANAGE` can now also
 * author workflows. That is a real, if small, widening of what that grant reaches,
 * and it is the documented interim choice rather than a silent one.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../shared/contracts/security';
import {
  createWorkflow, listWorkflows, WorkflowError,
} from '../../../backend/services/workflows/workflowStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const METHODS = ['GET', 'POST'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!METHODS.includes(req.method ?? '')) {
    res.setHeader('Allow', METHODS.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = str(req.query.company_id) ?? str(body.company_id);
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const guard = await requireCapability(req, res, {
    capability: PROSPECT_ICP_MANAGE,
    organizationId: companyId,
    reason: 'author reusable outreach workflow definitions',
  });
  // `ok !== true`, not `!ok`: `{ ok:false, sent:true }` is truthy and the root
  // tsconfig sets `strict: false`, disabling narrowing on a negated boolean.
  if (guard.ok !== true) return;

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ workflows: await listWorkflows(companyId) });
    }

    const workflow = await createWorkflow({
      organizationId: companyId,                    // the VERIFIED tenant, never the body's
      name: String(body.name ?? ''),
      description: body.description === undefined ? null : String(body.description ?? ''),
      // The VERIFIED actor. A body-supplied creator is never consulted.
      actorUserId: str((access as { userId?: unknown }).userId),
    });
    return res.status(201).json({ workflow });
  } catch (e) {
    if (e instanceof WorkflowError) {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: 'workflow request failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/workflows' });
