import { NextApiRequest, NextApiResponse } from 'next';

// In-memory storage for demo purposes
// In production, this would be a database
let campaignMessages: { [campaignId: string]: any[] } = {};
let campaignLearnings: any[] = [];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    // Get messages for a campaign
    const { campaignId } = req.query;
    
    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }

    const messages = campaignMessages[campaignId as string] || [];
    res.status(200).json({ messages });
    
  } else if (req.method === 'POST') {
    // Save a message for a campaign
    const { message, campaignId } = req.body;
    
    if (!message || !campaignId) {
      return res.status(400).json({ error: 'Message and campaign ID are required' });
    }

    if (!campaignMessages[campaignId]) {
      campaignMessages[campaignId] = [];
    }
    
    campaignMessages[campaignId].push(message);
    
    res.status(200).json({ success: true });
    
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
