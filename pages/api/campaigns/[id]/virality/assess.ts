import { NextApiRequest, NextApiResponse } from 'next';
import { assessVirality } from '../../../../../backend/services/viralityAdvisorService';
import { buildCampaignSnapshotWithHash } from '../../../../../backend/services/viralitySnapshotBuilder';
import { requireCampaignAccess } from '../../../../../backend/services/campaignAccessService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // SECURITY: enforce caller has access to this campaign's company.
  const access = await requireCampaignAccess(req, res, id);
  if (!access) return;

  try {
    const { snapshot, snapshot_hash } = await buildCampaignSnapshotWithHash(id);
    const assessment = await assessVirality(id, {
      snapshot,
      snapshot_hash,
      organizationId: access.companyId,
    });
    return res.status(200).json(assessment);
  } catch (error: any) {
    console.error('Error in virality assess API:', error);
    return res.status(500).json({ error: 'Failed to assess virality' });
  }
}
