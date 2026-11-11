import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * PI-WORKFLOW-DEFINITION-032 — one Workflow.
 *
 *   GET   /api/workflows/:id?company_id=<uuid>
 *         -> { workflow, currentVersion }
 *   PATCH /api/workflows/:id   { name?, description?, status? }
 *         -> { workflow }
 *
 * ─── `currentVersion` IS RESOLVED BY STATUS ───────────────────────────────
 * The GET returns the workflow's current published Version, or `null`. It comes
 * from `getCurrentWorkflowVersion`, which filters `status = 'published'` — never
 * the highest ordinal. `null` is a legitimate answer: a workflow with only drafts,
 * or one whose published Version was archived without replacement, genuinely has
 * no current Version.
 *
 * ─── PATCH EDITS METADATA AND STATUS, NEVER CONTENT ───────────────────────
 * A Workflow holds no authoring content, so there is nothing here to edit but its
 * name, description and lifecycle. `status` accepts `active | archived`; archiving
 * prevents new Version authoring and new invocation while leaving every existing
 * Version and Execution Instance valid.
 *
 * There is no DELETE: archiving preserves the record, exactly as
 * `prospect-campaigns/:id` and `prospect-lists/:id` already do.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../shared/contracts/security';
import {
  getWorkflow, getCurrentWorkflowVersion, updateWorkflowMetadata, setWorkflowStatus,
  WorkflowError, WORKFLOW_STATUSES, type WorkflowStatus,
} from '../../../backend/services/workflows/workflowStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const METHODS = ['GET', 'PATCH'];

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

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const guard = await requireCapability(req, res, {
    capability: PROSPECT_ICP_MANAGE,
    organizationId: companyId,
    reason: 'read or edit a reusable outreach workflow definition',
  });
  if (guard.ok !== true) return;

  try {
    if (req.method === 'GET') {
      const workflow = await getWorkflow(companyId, workflowId);
      if (!workflow) return res.status(404).json({ error: 'no such workflow' });
      // Resolved by the status predicate; null is a real answer.
      const currentVersion = await getCurrentWorkflowVersion(companyId, workflowId);
      return res.status(200).json({ workflow, currentVersion });
    }

    const status = str(body.status);
    if (status !== null) {
      if (!WORKFLOW_STATUSES.includes(status as WorkflowStatus)) {
        return res.status(400).json({
          error: `status must be one of ${WORKFLOW_STATUSES.join(' | ')}`,
        });
      }
      const changed = await setWorkflowStatus(companyId, workflowId, status as WorkflowStatus);
      if (!changed) return res.status(404).json({ error: 'no such workflow' });
      return res.status(200).json({ workflow: changed });
    }

    const updated = await updateWorkflowMetadata({
      organizationId: companyId,                    // the VERIFIED tenant
      workflowId,
      ...(body.name === undefined ? {} : { name: String(body.name ?? '') }),
      ...(body.description === undefined
        ? {}
        : { description: body.description === null ? null : String(body.description) }),
    });
    if (!updated) return res.status(404).json({ error: 'no such workflow' });
    return res.status(200).json({ workflow: updated });
  } catch (e) {
    if (e instanceof WorkflowError) {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: 'workflow request failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/workflows/[id]' });
