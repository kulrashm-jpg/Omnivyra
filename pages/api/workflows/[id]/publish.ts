import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * PI-WORKFLOW-DEFINITION-032 — publish a Workflow Version.
 *
 *   POST /api/workflows/:id/publish   { company_id, versionId }
 *        -> { version, supersededVersionId }
 *
 * ─── PUBLICATION IS ITS OWN ACTION, DELIBERATELY ──────────────────────────
 * The ratified contract makes publication "explicit, authorized, deliberate" and
 * the exact point definition content freezes. A PATCH setting `status` would make
 * it look like an edit; an action route makes it look like what it is. This
 * mirrors `prospect-lists/:id/evaluate` and `prospect-campaigns/:id/select`, the
 * established shape for an operation rather than a mutation.
 *
 * ─── WHAT IT DOES, AND WHERE ──────────────────────────────────────────────
 * The store calls `publish_workflow_version`, which in ONE transaction locks the
 * workflow, validates it is active, validates the Version is a draft in this
 * tenant, validates the definition, supersedes the outgoing current Version and
 * publishes the incoming one. The order is forced by the partial unique index and
 * supersession is irreversible, so the two steps cannot be separate statements —
 * the store header explains why at length.
 *
 * `supersededVersionId` is `null` when the workflow had no current Version, which
 * is the ordinary first-publication case.
 *
 * ─── PUBLISHING IS NOT EXECUTING ──────────────────────────────────────────
 * This creates no Execution Instance, no Plan, no Task, sends nothing, and confers
 * no permission to contact anyone. `mayContact`, suppression, quota and approval
 * remain authoritative at dispatch time and are untouched.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../../shared/contracts/security';
import {
  publishWorkflowVersion, getWorkflowVersion, WorkflowError,
} from '../../../../backend/services/workflows/workflowStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const METHODS = ['POST'];

const statusFor = (code: string): number => {
  if (code === 'version_not_found') return 404;
  if (code === 'workflow_not_active' || code === 'not_draft' || code === 'already_published') return 409;
  return 400;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!METHODS.includes(req.method ?? '')) {
    res.setHeader('Allow', METHODS.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const workflowId = str(req.query.id);
  if (!workflowId || !UUID.test(workflowId)) {
    return res.status(400).json({ error: 'workflow id must be a uuid' });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = str(req.query.company_id) ?? str(body.company_id);
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  const versionId = str(body.versionId);
  if (!versionId || !UUID.test(versionId)) {
    return res.status(400).json({ error: 'versionId must be a uuid' });
  }

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const guard = await requireCapability(req, res, {
    capability: PROSPECT_ICP_MANAGE,
    organizationId: companyId,
    reason: 'publish an immutable version of a reusable outreach workflow definition',
  });
  if (guard.ok !== true) return;

  // The VERIFIED actor. Publication is always attributed, and a body-supplied
  // publisher is never consulted.
  const actorUserId = str((access as { userId?: unknown }).userId);
  if (!actorUserId) {
    return res.status(403).json({ error: 'an authenticated actor is required to publish' });
  }

  try {
    // The version must belong to the workflow in the path, not merely to the
    // tenant: publishing through another workflow's path would attribute the
    // publication to a process it does not belong to.
    const candidate = await getWorkflowVersion(companyId, versionId);
    if (!candidate || candidate.workflowId !== workflowId) {
      return res.status(404).json({ error: 'no such version in this workflow' });
    }

    const { version, supersededVersionId } = await publishWorkflowVersion({
      organizationId: companyId,                    // the VERIFIED tenant
      versionId,
      actorUserId,                                  // the VERIFIED actor
    });
    return res.status(200).json({ version, supersededVersionId });
  } catch (e) {
    if (e instanceof WorkflowError) {
      return res.status(statusFor(e.code)).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: 'publication failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/workflows/[id]/publish' });
