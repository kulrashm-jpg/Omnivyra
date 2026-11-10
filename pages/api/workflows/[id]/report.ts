import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/workflows/:id/report?company_id=<uuid>
 *
 * Orchestration business intelligence for one tenant workflow, per version:
 * enrollment, journey states, per-step decisions, per-engine outcomes and
 * objective attainment. READ-ONLY — see backend/services/orchestration/journeyReport.ts.
 *
 * Same authorization as the workflow resource itself: membership, then
 * PROSPECT_ICP_MANAGE, with the VERIFIED tenant (never a body value) passed down.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../../shared/contracts/security';
import { buildJourneyReport } from '../../../../backend/services/orchestration/journeyReport';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const METHODS = ['GET'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!METHODS.includes(req.method ?? '')) {
    res.setHeader('Allow', METHODS.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const workflowId = str(req.query.id);
  if (!workflowId || !UUID.test(workflowId)) {
    return res.status(400).json({ error: 'workflow id must be a uuid' });
  }
  const companyId = str(req.query.company_id);
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const guard = await requireCapability(req, res, {
    capability: PROSPECT_ICP_MANAGE,
    organizationId: companyId,
    reason: 'read a workflow journey report',
  });
  if (guard.ok !== true) return;

  try {
    const report = await buildJourneyReport({ organizationId: companyId, workflowId });
    if (report === null) return res.status(404).json({ error: 'no such workflow' });
    return res.status(200).json({ report });
  } catch {
    return res.status(500).json({ error: 'journey report failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/workflows/[id]/report' });
