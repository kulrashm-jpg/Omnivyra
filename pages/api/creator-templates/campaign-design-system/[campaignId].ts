import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../../backend/services/userContextService';
import { requireCampaignAccess } from '../../../../backend/services/campaignAccessService';
import {
  getCampaignDesignHealth,
  getCampaignCollectionUpgrade,
  attachCollectionToCampaign,
  detachCampaignDesignSystem,
  upgradeCampaignDesignSystem,
  recommendCampaignTemplate,
  getCampaignDesignSystemCompanyId,
} from '../../../../backend/services/creator/campaignDesignSystemService';
import { getCollectionCompanyId } from '../../../../backend/services/creator/collectionService';
import { familyForCreatorType } from '../../../../lib/creator-templates';

/**
 * GET    /api/creator-templates/campaign-design-system/[campaignId]
 *          → { designSystem, health, upgrade }   (dashboard)
 *        ?family=carousel → { template }          (Creator recommendation)
 * PUT    → attach { company_id, collection_id, required_families? }
 * POST   → { op: 'upgrade', company_id }          (re-pin to latest)
 * DELETE → detach
 *
 * ROUTE-AUTH-001 (STEP 3AH-85) — every method authorizes on the CAMPAIGN's
 * owning company (requireCampaignAccess → campaign_versions), never on a
 * collection or design-system row. Before this, PUT authorized on the
 * collection's company only, so a member of company A could pin A's
 * collection onto company B's campaign (template injection into B's
 * generation), and GET/POST then authorized on that planted row. Now the
 * collection must belong to the campaign's company, and a design-system row
 * written under any other company is never served or upgraded.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const campaignId = String(req.query.campaignId || '').trim();
  if (!campaignId) return res.status(400).json({ error: 'campaignId required' });

  const campaignAccess = await requireCampaignAccess(req, res, campaignId);
  if (!campaignAccess) return;
  const campaignCompanyId = campaignAccess.companyId;

  // The design-system row is keyed by campaign_id alone; it counts as the
  // campaign's own only when it was written under the campaign's company.
  const existingCompanyId = await getCampaignDesignSystemCompanyId(campaignId);
  const ownDesignSystem = existingCompanyId !== null && existingCompanyId === campaignCompanyId;

  if (req.method === 'GET') {
    // No (own) design system → nothing creator-scoped to expose.
    const family = typeof req.query.family === 'string' ? familyForCreatorType(req.query.family) : null;
    if (!ownDesignSystem) return family ? res.status(200).json({ template: null }) : res.status(404).json({ error: 'no design system attached' });
    if (family) {
      const template = await recommendCampaignTemplate(campaignId, family);
      return res.status(200).json({ template });
    }
    const detail = await getCampaignDesignHealth(campaignId);
    if (!detail) return res.status(404).json({ error: 'no design system attached' });
    const upgrade = await getCampaignCollectionUpgrade(campaignId);
    return res.status(200).json({ designSystem: detail.designSystem, health: detail.health, upgrade: upgrade?.diff ?? null });
  }

  const body = (req.body || {}) as Record<string, unknown>;

  if (req.method === 'PUT') {
    const collectionId = String(body.collection_id || '').trim();
    if (!collectionId) return res.status(400).json({ error: 'collection_id required' });
    // The collection being linked must belong to the campaign's company; the
    // design system is created in that same tenant.
    const collectionCompanyId = await getCollectionCompanyId(collectionId);
    if (!collectionCompanyId) return res.status(404).json({ error: 'collection not found' });
    if (collectionCompanyId !== campaignCompanyId) return res.status(403).json({ error: 'cross-tenant attachment denied' });
    if (existingCompanyId && existingCompanyId !== collectionCompanyId) return res.status(403).json({ error: 'cross-tenant attachment denied' });
    const requiredFamilies = Array.isArray(body.required_families)
      ? body.required_families.map((f) => (typeof f === 'string' ? familyForCreatorType(f) : null)).filter((f): f is NonNullable<typeof f> => !!f)
      : undefined;
    const result = await attachCollectionToCampaign({ companyId: campaignCompanyId, campaignId, collectionId, requiredFamilies });
    if (!result.designSystem) return res.status(422).json({ error: 'attachment failed', validation: result.validation });
    return res.status(200).json(result);
  }

  // POST (upgrade) / DELETE operate on an EXISTING design system.
  if (!existingCompanyId) return res.status(404).json({ error: 'no design system attached' });

  if (req.method === 'POST' && String(body.op) === 'upgrade') {
    if (!ownDesignSystem) return res.status(404).json({ error: 'no design system attached' });
    const upgraded = await upgradeCampaignDesignSystem({ companyId: campaignCompanyId, campaignId });
    if (!upgraded) return res.status(503).json({ error: 'upgrade failed' });
    return res.status(200).json({ designSystem: upgraded });
  }

  if (req.method === 'DELETE') {
    // The campaign's own tenant may always detach what is pinned to its
    // campaign — including a row planted under another company before this fix.
    const ok = await detachCampaignDesignSystem(campaignId);
    return res.status(ok ? 200 : 503).json({ ok });
  }

  res.setHeader('Allow', 'GET, PUT, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-templates/campaign-design-system/:campaignId' });
