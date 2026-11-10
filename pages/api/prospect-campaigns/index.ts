import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * PI-CAMPAIGN-IDENTITY-014 — the tenant's canonical prospect campaigns.
 *
 *   GET  /api/prospect-campaigns?company_id=<uuid>[&status=]  -> { campaigns }
 *   POST /api/prospect-campaigns                              -> { campaign }
 *
 * ─── AUTHORIZATION: PROSPECT_ICP_MANAGE, AND NOT campaign.* ───────────────
 * `company_id` is membership-verified with `enforceCompanyAccess`, then gated on
 * `PROSPECT_ICP_MANAGE` — the same capability `prospect-icp/*`, `offerings/*` and
 * `prospect-lists/*` use. A prospect campaign is that same class of authority: a
 * tenant-wide PI definition.
 *
 * The existing `CAMPAIGN_EXECUTE` / `CAMPAIGN_VIEW` / `CAMPAIGN_DELETE` are
 * deliberately NOT used. They gate `pages/api/campaigns/*` — the CONTENT/social
 * campaign routes (`campaigns/[id].ts`, `campaigns/[id]/release.ts`,
 * `campaigns/pending/[id]/approve.ts`), which 013 established is a different
 * domain. Reusing them would hand content-campaign managers authority over
 * prospect targeting, and `campaign.execute` would additionally imply that
 * creating this entity makes something executable — which it does not.
 *
 * No new capability is created: the registry is frozen, and `prospect-icp/*`
 * already refuses to extend it for convenience.
 *
 * Every write uses the VERIFIED tenant; the body's `company_id` is never trusted.
 *
 * ─── IT CREATES NOTHING BUT A CAMPAIGN ────────────────────────────────────
 * No target, no list, no membership, no prospect, no person, no task, no
 * outcome. Nothing is enriched, scored, recommended or dispatched, and no
 * contact governance is consulted — there is nobody to contact.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../shared/contracts/security';
import {
  createProspectCampaign, listProspectCampaigns,
  PROSPECT_CAMPAIGN_STATUSES, ProspectCampaignError,
  type ProspectCampaignStatus,
} from '../../../backend/services/prospectCampaigns/prospectCampaignStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

const asStatus = (v: unknown): ProspectCampaignStatus | undefined => {
  const s = str(v);
  if (s === null) return undefined;
  return PROSPECT_CAMPAIGN_STATUSES.includes(s as ProspectCampaignStatus)
    ? (s as ProspectCampaignStatus)
    : ('__invalid__' as ProspectCampaignStatus);
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
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
  // `ok !== true`, not `!ok`: `{ ok:false, sent:true }` is truthy and the root
  // tsconfig sets `strict: false`, disabling narrowing on a negated boolean.
  if (guard.ok !== true) return;

  try {
    if (req.method === 'GET') {
      const status = asStatus(req.query.status);
      const campaigns = await listProspectCampaigns(
        companyId,
        status === undefined ? {} : { status },
      );
      return res.status(200).json({ campaigns });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const status = asStatus(body.status);
    const campaign = await createProspectCampaign({
      organizationId: companyId,          // the VERIFIED tenant, never the body's
      name: String(body.name ?? ''),
      description: str(body.description),
      ...(status === undefined ? {} : { status }),
    });
    return res.status(201).json({ campaign });
  } catch (e) {
    if (e instanceof ProspectCampaignError) {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: 'prospect campaign request failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/prospect-campaigns' });
