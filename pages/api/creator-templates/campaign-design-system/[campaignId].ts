import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../../backend/services/userContextService';
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
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const campaignId = String(req.query.campaignId || '').trim();
  if (!campaignId) return res.status(400).json({ error: 'campaignId required' });

  if (req.method === 'GET') {
    // Authorize on the design system's OWNING company before any read. No design
    // system → nothing creator-scoped to expose (return empty, never query).
    const dsCompanyId = await getCampaignDesignSystemCompanyId(campaignId);
    const family = typeof req.query.family === 'string' ? familyForCreatorType(req.query.family) : null;
    if (!dsCompanyId) return family ? res.status(200).json({ template: null }) : res.status(404).json({ error: 'no design system attached' });
    const access = await enforceCompanyAccess({ req, res, companyId: dsCompanyId });
    if (!access) return;
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
  const existingCompanyId = await getCampaignDesignSystemCompanyId(campaignId);

  if (req.method === 'PUT') {
    const collectionId = String(body.collection_id || '').trim();
    if (!collectionId) return res.status(400).json({ error: 'collection_id required' });
    // Authorize on the COLLECTION's owning company (the resource being linked);
    // the design system is created in that same tenant.
    const collectionCompanyId = await getCollectionCompanyId(collectionId);
    if (!collectionCompanyId) return res.status(404).json({ error: 'collection not found' });
    if (existingCompanyId && existingCompanyId !== collectionCompanyId) return res.status(403).json({ error: 'cross-tenant attachment denied' });
    const access = await enforceCompanyAccess({ req, res, companyId: collectionCompanyId });
    if (!access) return;
    const requiredFamilies = Array.isArray(body.required_families)
      ? body.required_families.map((f) => (typeof f === 'string' ? familyForCreatorType(f) : null)).filter((f): f is NonNullable<typeof f> => !!f)
      : undefined;
    const result = await attachCollectionToCampaign({ companyId: collectionCompanyId, campaignId, collectionId, requiredFamilies });
    if (!result.designSystem) return res.status(422).json({ error: 'attachment failed', validation: result.validation });
    return res.status(200).json(result);
  }

  // POST (upgrade) / DELETE operate on an EXISTING design system → authorize on its company.
  if (!existingCompanyId) return res.status(404).json({ error: 'no design system attached' });
  const access = await enforceCompanyAccess({ req, res, companyId: existingCompanyId });
  if (!access) return;

  if (req.method === 'POST' && String(body.op) === 'upgrade') {
    const upgraded = await upgradeCampaignDesignSystem({ companyId: existingCompanyId, campaignId });
    if (!upgraded) return res.status(503).json({ error: 'upgrade failed' });
    return res.status(200).json({ designSystem: upgraded });
  }

  if (req.method === 'DELETE') {
    const ok = await detachCampaignDesignSystem(campaignId);
    return res.status(ok ? 200 : 503).json({ ok });
  }

  res.setHeader('Allow', 'GET, PUT, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
