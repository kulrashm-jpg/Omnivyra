import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { campaignId, name, description } = req.body;

    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID required' });
    }

    // Create or update the campaign in database
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .upsert({
        id: campaignId,
        name: name || 'Campaign ' + campaignId,
        description: description || '',
        status: 'planning',
        current_stage: 'planning',
        timeframe: 'quarter',
        user_id: user.id,
        thread_id: 'thread_' + Date.now(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving campaign:', error);
      return res.status(500).json({ error: 'Failed to save campaign', details: error });
    }

    return res.status(200).json({
      success: true,
      campaign
    });

  } catch (error) {
    console.error('Error in save campaign API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
