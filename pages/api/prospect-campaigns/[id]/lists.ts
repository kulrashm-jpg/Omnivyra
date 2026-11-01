import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET|POST|DELETE /api/prospect-campaigns/:id/lists?company_id=<uuid>
 *
 * Which canonical prospect lists a campaign selects from. POST { listId }
 * attaches (idempotent); DELETE ?list_id= detaches. An attachment is not history:
 * what a campaign actually selected is the immutable target record.
 *
 * Membership, then PROSPECT_ICP_MANAGE; the VERIFIED tenant only. A list of
 * another tenant cannot be attached (composite foreign key → 404).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../../shared/contracts/security';
import {
  attachListToCampaign, detachListFromCampaign, listCampaignListAttachments, CampaignListError,
} from '../../../../backend/services/prospectCampaigns/campaignListStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const METHODS = ['GET', 'POST', 'DELETE'];

const statusFor = (code: string): number => {
  if (code === 'targeting_schema_missing') return 503;
  if (code === 'not_found') return 404;
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
    reason: 'attach or detach a prospect list for a campaign',
  });
  if (guard.ok !== true) return;

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ lists: await listCampaignListAttachments(companyId, campaignId) });
    }
    if (req.method === 'POST') {
      const listId = str(((req.body ?? {}) as Record<string, unknown>).listId);
      if (!listId || !UUID.test(listId)) return res.status(400).json({ error: 'listId must be a uuid' });
      const out = await attachListToCampaign({ organizationId: companyId, campaignId, listId, actorUserId: access.userId ?? null });
      return res.status(out.created ? 201 : 200).json(out);
    }
    const listId = str(req.query.list_id);
    if (!listId || !UUID.test(listId)) return res.status(400).json({ error: 'list_id must be a uuid' });
    const detached = await detachListFromCampaign({ organizationId: companyId, campaignId, listId });
    return res.status(detached ? 200 : 404).json({ detached });
  } catch (e) {
    if (e instanceof CampaignListError) return res.status(statusFor(e.code)).json({ error: e.message, code: e.code });
    return res.status(500).json({ error: 'campaign list request failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/prospect-campaigns/[id]/lists' });
