import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * PI-CAMPAIGN-IDENTITY-014 — one canonical prospect campaign.
 *
 *   GET   /api/prospect-campaigns/:id?company_id=<uuid>  -> { campaign }
 *   PATCH /api/prospect-campaigns/:id                    -> { campaign }
 *
 * PATCH edits in place; a campaign carries no version. There is no DELETE:
 * archiving preserves the record, which a future outcome attributed to this
 * campaign will need in order to say what it was attributed to.
 *
 * `organization_id` is never patchable — it is not read from the body at all,
 * and the database's own trigger would refuse it anyway.
 *
 * 404 means "not in this tenant": every statement is tenant-scoped and returns
 * null when nothing matched, so another tenant's campaign id is
 * indistinguishable from a missing one. The id in the path is never
 * authorization.
 *
 * Authorization is `PROSPECT_ICP_MANAGE`, for the reasons set out in
 * `index.ts` — notably NOT the content domain's `campaign.*` capabilities.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../shared/contracts/security';
import {
  getProspectCampaign, updateProspectCampaign, setProspectCampaignStatus,
  PROSPECT_CAMPAIGN_STATUSES, ProspectCampaignError,
  type ProspectCampaignStatus,
} from '../../../backend/services/prospectCampaigns/prospectCampaignStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const campaignId = str(req.query.id);
  if (!campaignId || !UUID.test(campaignId)) {
    return res.status(400).json({ error: 'campaign id must be a uuid' });
  }

  const companyId = str(req.query.company_id) ?? str((req.body ?? {}).company_id);
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const guard = await requireCapability(req, res, {
    capability: PROSPECT_ICP_MANAGE,
    organizationId: companyId,
    reason: 'manage the tenant canonical prospect campaigns',
  });
  if (guard.ok !== true) return;

  try {
    if (req.method === 'GET') {
      const campaign = await getProspectCampaign(companyId, campaignId);
      if (!campaign) return res.status(404).json({ error: 'campaign not found' });
      return res.status(200).json({ campaign });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const status = str(body.status);

    // Status first and on its own: it has its own writer, and folding it into the
    // patch would bypass that separation — the same shape `prospect-lists/[id]`
    // uses.
    if (status !== null) {
      if (!PROSPECT_CAMPAIGN_STATUSES.includes(status as ProspectCampaignStatus)) {
        return res.status(400).json({
          error: `status must be one of ${PROSPECT_CAMPAIGN_STATUSES.join(', ')}`,
          code: 'invalid_status',
        });
      }
      const moved = await setProspectCampaignStatus(
        companyId, campaignId, status as ProspectCampaignStatus,
      );
      if (!moved.changed) return res.status(404).json({ error: 'campaign not found' });
      const otherKeys = ['name', 'description'].filter((k) => body[k] !== undefined);
      if (otherKeys.length === 0) return res.status(200).json({ campaign: moved.campaign });
    }

    const updated = await updateProspectCampaign({
      organizationId: companyId,          // the VERIFIED tenant, never the body's
      campaignId,
      ...(body.name !== undefined ? { name: String(body.name) } : {}),
      ...(body.description !== undefined ? { description: str(body.description) } : {}),
    });
    if (!updated.changed) return res.status(404).json({ error: 'campaign not found' });
    return res.status(200).json({ campaign: updated.campaign });
  } catch (e) {
    if (e instanceof ProspectCampaignError) {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: 'prospect campaign request failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/prospect-campaigns/[id]' });
