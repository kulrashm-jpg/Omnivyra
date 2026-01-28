import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, reason, ipAddress, userAgent } = req.body;

    if (!campaignId || !reason) {
      return res.status(400).json({ 
        error: 'Missing required fields: campaignId and reason' 
      });
    }

    // Get current user ID (you'll need to implement proper auth)
    const userId = 'current-user-id'; // Replace with actual user ID from auth

    // Call the safe delete function
    const { data, error } = await supabase.rpc('safe_delete_campaign', {
      p_campaign_id: campaignId,
      p_user_id: userId,
      p_reason: reason,
      p_ip_address: ipAddress || '127.0.0.1',
      p_user_agent: userAgent || 'Unknown'
    });

    if (error) {
      console.error('Error deleting campaign:', error);
      return res.status(500).json({ 
        error: 'Failed to delete campaign',
        details: error.message 
      });
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error('Error in delete-campaign API:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}






