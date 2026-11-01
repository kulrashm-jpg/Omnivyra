import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET|PUT /api/prospect-campaigns/:id/targeting?company_id=<uuid>
 *
 * How a campaign chooses its population: `manual` (members of its attached lists;
 * manual and intake lists need no ICP) or `icp` (pinned to ONE RATIFIED ICP
 * version of this tenant, with an optional minimum ICP score).
 *
 * Membership, then PROSPECT_ICP_MANAGE; the VERIFIED tenant only. The database
 * refuses a draft/proposed ICP version, another tenant's ICP, and any change once
 * the campaign has selected targets.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../../shared/contracts/security';
import {
  getCampaignTargeting, setCampaignTargeting, ProspectCampaignError,
} from '../../../../backend/services/prospectCampaigns/prospectCampaignStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const METHODS = ['GET', 'PUT'];

const statusFor = (code: string): number => {
  if (code === 'targeting_schema_missing') return 503;
  if (code === 'icp_version_not_found') return 404;
  if (code === 'campaign_icp_not_ratified' || code === 'campaign_targeting_locked') return 409;
  return 400;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!METHODS.includes(req.method ?? '')) {
    res.setHeader('Allow', METHODS.join(', '));
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
    reason: 'read or set how a prospect campaign chooses its population',
  });
  if (guard.ok !== true) return;

  try {
    if (req.method === 'GET') {
      const targeting = await getCampaignTargeting(companyId, campaignId);
      return targeting ? res.status(200).json({ targeting }) : res.status(404).json({ error: 'no such campaign' });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const mode = str(body.mode);
    if (mode !== 'manual' && mode !== 'icp') return res.status(400).json({ error: 'mode must be manual or icp', code: 'invalid_targeting_mode' });
    const targeting = await setCampaignTargeting({
      organizationId: companyId,                     // the VERIFIED tenant
      campaignId,
      mode,
      icpId: body.icpId == null ? null : String(body.icpId),
      icpVersion: body.icpVersion == null ? null : Number(body.icpVersion),
      minIcpScore: body.minIcpScore == null ? null : Number(body.minIcpScore),
    });
    return targeting ? res.status(200).json({ targeting }) : res.status(404).json({ error: 'no such campaign' });
  } catch (e) {
    if (e instanceof ProspectCampaignError) return res.status(statusFor(e.code)).json({ error: e.message, code: e.code });
    return res.status(500).json({ error: 'campaign targeting request failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/prospect-campaigns/[id]/targeting' });
