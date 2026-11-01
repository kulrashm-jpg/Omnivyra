import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * PI-WORKFLOW-DEFINITION-032 — a Workflow's Versions.
 *
 *   GET   /api/workflows/:id/versions?company_id=<uuid>      -> { versions }
 *   POST  /api/workflows/:id/versions   { definition? }      -> { version }   (draft)
 *   PATCH /api/workflows/:id/versions   { versionId, definition }  -> { version }
 *   PATCH /api/workflows/:id/versions   { versionId, status: 'archived' } -> { version }
 *
 * ─── IT CANNOT PUBLISH ────────────────────────────────────────────────────
 * Publication is an explicit authorized action and lives at
 * `/api/workflows/:id/publish`. A PATCH that accepted `status: 'published'` would
 * make publishing indistinguishable from editing, which is precisely what the
 * ratified contract separates: a draft is editable, and publication is the moment
 * content freezes.
 *
 * `status` here therefore accepts `archived` ONLY — retiring a published Version
 * without replacing it. The store scopes that to `status = 'published'` with a
 * database predicate, so a draft or an already-terminal Version matches nothing
 * and returns 404 rather than being silently transitioned.
 *
 * ─── EDITING IS SCOPED TO DRAFTS BY THE DATABASE ──────────────────────────
 * A `definition` PATCH filters `status = 'draft'`. A published Version matches
 * nothing, so the response is 404 — and even if it did match, the immutability
 * guard would refuse it. Two layers, and only the lower one is load-bearing.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../../shared/contracts/security';
import {
  createDraftVersion, updateDraftVersion, archiveWorkflowVersion,
  listWorkflowVersions, WorkflowError,
} from '../../../../backend/services/workflows/workflowStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const METHODS = ['GET', 'POST', 'PATCH'];

const statusFor = (code: string): number => {
  if (code === 'workflow_not_found') return 404;
  if (code === 'workflow_not_active') return 409;
  if (code === 'duplicate_version') return 409;
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

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const guard = await requireCapability(req, res, {
    capability: PROSPECT_ICP_MANAGE,
    organizationId: companyId,
    reason: 'author a version of a reusable outreach workflow definition',
  });
  if (guard.ok !== true) return;

  try {
    if (req.method === 'GET') {
      return res.status(200).json({
        versions: await listWorkflowVersions(companyId, workflowId),
      });
    }

    if (req.method === 'POST') {
      const version = await createDraftVersion({
        organizationId: companyId,                  // the VERIFIED tenant
        workflowId,
        ...(body.definition === undefined ? {} : { definition: body.definition }),
        actorUserId: str((access as { userId?: unknown }).userId),
      });
      return res.status(201).json({ version });
    }

    const versionId = str(body.versionId);
    if (!versionId || !UUID.test(versionId)) {
      return res.status(400).json({ error: 'versionId must be a uuid' });
    }

    const status = str(body.status);
    if (status !== null) {
      // `archived` ONLY. Publishing has its own route, deliberately.
      if (status !== 'archived') {
        return res.status(400).json({
          error: 'status may only be set to "archived" here — publish via /api/workflows/:id/publish',
        });
      }
      const archived = await archiveWorkflowVersion(companyId, versionId);
      if (!archived) {
        return res.status(404).json({ error: 'no published version with that id in this workflow' });
      }
      return res.status(200).json({ version: archived });
    }

    if (body.definition === undefined) {
      return res.status(400).json({ error: 'definition is required to edit a draft' });
    }
    const edited = await updateDraftVersion({
      organizationId: companyId,
      versionId,
      definition: body.definition,
    });
    if (!edited) {
      return res.status(404).json({ error: 'no draft version with that id — a published version cannot be edited' });
    }
    return res.status(200).json({ version: edited });
  } catch (e) {
    if (e instanceof WorkflowError) {
      return res.status(statusFor(e.code)).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: 'workflow version request failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/workflows/[id]/versions' });
