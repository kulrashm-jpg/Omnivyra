import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';

// In-memory storage for demo purposes
// In production, this would be a database
let campaignMessages: { [campaignId: string]: any[] } = {};
let campaignLearnings: any[] = [];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    // Get messages for a campaign
    const { campaignId } = req.query;
    
    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }

    // ROUTE-AUTH-001 (STEP 3AH-85): only a caller with access to the campaign
    // may read its messages.
    const access = await requireCampaignAccess(req, res, String(campaignId));
    if (!access) return;

    const messages = campaignMessages[access.campaignId] || [];
    res.status(200).json({ messages });
    
  } else if (req.method === 'POST') {
    // Save a message for a campaign
    const { message, campaignId } = req.body;
    
    if (!message || !campaignId) {
      return res.status(400).json({ error: 'Message and campaign ID are required' });
    }

    // ROUTE-AUTH-001: only a caller with access to the campaign may write to it.
    const access = await requireCampaignAccess(req, res, String(campaignId));
    if (!access) return;

    if (!campaignMessages[access.campaignId]) {
      campaignMessages[access.campaignId] = [];
    }
    
    campaignMessages[access.campaignId].push(message);
    
    res.status(200).json({ success: true });
    
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/ai/campaign-messages' });
