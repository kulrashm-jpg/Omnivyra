
/**
 * POST /api/campaigns/create-from-opportunity
 * Create a campaign from a campaign opportunity (intelligence pipeline).
 * Flow: Campaign Opportunity → Campaign Blueprint → Campaign Builder.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { generateCampaignFromOpportunity } from '../../../backend/services/opportunityCampaignGenerator';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { opportunity_id, company_id } = req.body || {};

    if (!opportunity_id || typeof opportunity_id !== 'string') {
      return res.status(400).json({ error: 'opportunity_id is required' });
    }
    if (!company_id || typeof company_id !== 'string') {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId: company_id,
    });
    if (!access) return;

    const result = await generateCampaignFromOpportunity(
      opportunity_id.trim(),
      company_id.trim(),
      access.userId
    );

    return res.status(201).json({
      campaign_id: result.campaign_id,
      campaign_name: result.campaign_name,
      opportunity_id: result.opportunity_id,
      blueprint: result.blueprint,
    });
  } catch (err: any) {
    const msg = err?.message ?? '';
    if (msg === 'Campaign opportunity not found') {
      return res.status(404).json({ error: 'Campaign opportunity not found' });
    }
    if (msg.includes('Similar campaign') || msg.includes('within 30 days')) {
      return res.status(409).json({ error: msg, duplicate: true });
    }
    console.error('[create-from-opportunity]', err);
    return res.status(500).json({
      error: msg || 'Failed to create campaign from opportunity',
    });
  }
}
