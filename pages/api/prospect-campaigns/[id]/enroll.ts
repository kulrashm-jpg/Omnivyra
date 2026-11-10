import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/prospect-campaigns/:id/enroll?company_id=<uuid>
 * Body: { workflowId, selectionEventKey?, dryRun?, acknowledgeUncertainByProspect? }
 *
 * Follow-up E: a person with an unresolved uncertain communication from an earlier run is
 * reported `needs_acknowledgement` with its warning and is not enrolled, until the request
 * carries `acknowledgeUncertainByProspect: { [prospectId]: warning.acknowledgementKey }`. The
 * acknowledgement is recorded per person; it authorizes no send. A wrong field or shape
 * (including the single-enrolment `acknowledgeUncertain`) is 400 acknowledgement_shape_invalid
 * before anyone is enrolled (PI review F1).
 *
 * Enrolls the campaign's selected targets into ONE workflow, under its current
 * published version: one journey per distinct prospect, the version's
 * enrollment conditions applied, already-enrolled people left alone. Repeated or
 * concurrent calls converge (the journey's unique index decides). `dryRun: true`
 * previews who would be enrolled and every exclusion reason, writing nothing.
 *
 * Enrollment starts journeys; it sends nothing. Every step still meets every
 * engine gate, and WS-3 actions still need human approval.
 *
 * Membership, then PROSPECT_ICP_MANAGE; the VERIFIED tenant only. No version is
 * accepted as input — the store resolves and pins the published one.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../../shared/contracts/security';
import { enrollCampaignTargets, CampaignEnrollmentError } from '../../../../backend/services/orchestration/campaignEnrollment';
import { CampaignTargetError } from '../../../../backend/services/prospectCampaigns/campaignTargetStore';
import { ExecutionInstanceError } from '../../../../backend/services/executionInstances/executionInstanceStore';
import { acknowledgementShapeError } from '../../../../backend/services/orchestration/uncertainCommunicationAcknowledgement';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

const statusFor = (code: string): number => {
  if (code === 'targets_schema_missing' || code === 'targets_not_installed') return 503;
  if (code === 'campaign_not_found' || code === 'workflow_not_found') return 404;
  if (code === 'campaign_archived' || code === 'workflow_not_active' || code === 'no_published_version') return 409;
  if (code === 'target_mismatch') return 422;
  return 400;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const campaignId = str(req.query.id);
  if (!campaignId || !UUID.test(campaignId)) return res.status(400).json({ error: 'campaign id must be a uuid' });
  const companyId = str(req.query.company_id);
  if (!companyId || !UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const guard = await requireCapability(req, res, {
    capability: PROSPECT_ICP_MANAGE,
    organizationId: companyId,
    reason: 'enroll a prospect campaign\'s targets into a workflow',
  });
  if (guard.ok !== true) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const workflowId = str(body.workflowId);
  if (!workflowId || !UUID.test(workflowId)) return res.status(400).json({ error: 'workflowId must be a uuid' });
  const selectionEventKey = str(body.selectionEventKey) ?? undefined;
  const shapeError = acknowledgementShapeError(body, 'by_prospect');
  if (shapeError) return res.status(400).json(shapeError);

  try {
    const report = await enrollCampaignTargets({
      organizationId: companyId,                     // the VERIFIED tenant
      campaignId,
      workflowId,
      ...(selectionEventKey ? { selectionEventKey } : {}),
      dryRun: body.dryRun === true,
      actorUserId: guard.principal.userId,           // the authenticated person, never the body's
      acknowledgements: body.acknowledgeUncertainByProspect,
    });
    return res.status(200).json({ report });
  } catch (e) {
    if (e instanceof CampaignEnrollmentError || e instanceof CampaignTargetError || e instanceof ExecutionInstanceError) {
      return res.status(statusFor(e.code)).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: 'campaign enrollment failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/prospect-campaigns/[id]/enroll' });
