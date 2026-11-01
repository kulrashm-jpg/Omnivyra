import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/prospect-campaigns/:id/select?company_id=<uuid>
 * Body: { selectionKey, dryRun? }
 *
 * Records the campaign's targets for ONE selection occurrence (the caller's
 * `selectionKey`): a retry re-finds the same targets, a new key is a deliberate
 * re-selection. `dryRun: true` previews the population, the would-be targets and
 * every exclusion reason, and writes nothing.
 *
 * Membership, then PROSPECT_ICP_MANAGE; the VERIFIED tenant and actor only.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../../shared/contracts/security';
import { selectCampaignTargets, CampaignSelectionError } from '../../../../backend/services/prospectCampaigns/campaignSelectionService';
import { CampaignTargetError } from '../../../../backend/services/prospectCampaigns/campaignTargetStore';
import { CampaignListError } from '../../../../backend/services/prospectCampaigns/campaignListStore';
import { ProspectCampaignError } from '../../../../backend/services/prospectCampaigns/prospectCampaignStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

const statusFor = (code: string): number => {
  if (code === 'targeting_schema_missing' || code === 'targets_schema_missing') return 503;
  if (code === 'campaign_not_found' || code === 'icp_version_not_found') return 404;
  if (code === 'campaign_archived' || code === 'campaign_icp_not_ratified') return 409;
  if (code === 'cross_tenant_or_missing_reference') return 422;
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
    reason: 'select the target population of a prospect campaign',
  });
  if (guard.ok !== true) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const selectionKey = str(body.selectionKey);
  if (!selectionKey) return res.status(400).json({ error: 'selectionKey is required — it names this selection occurrence', code: 'invalid_selection_key' });
  if (!access.userId) return res.status(401).json({ error: 'an authenticated actor is required' });

  try {
    const report = await selectCampaignTargets({
      organizationId: companyId,
      campaignId,
      selectionKey,
      origin: 'human',
      actorUserId: access.userId,                  // the VERIFIED actor
      dryRun: body.dryRun === true,
    });
    return res.status(200).json({ report });
  } catch (e) {
    if (e instanceof CampaignSelectionError || e instanceof CampaignTargetError
      || e instanceof CampaignListError || e instanceof ProspectCampaignError) {
      return res.status(statusFor(e.code)).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: 'campaign selection failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/prospect-campaigns/[id]/select' });
