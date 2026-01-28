import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient.js';
import { evaluateCampaignReadiness } from '../../../backend/services/campaignReadinessService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  if (req.method === 'DELETE') {
    try {
      // Delete campaign and all related data
      const { error } = await supabase
        .from('campaigns')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error deleting campaign:', error);
        return res.status(500).json({ error: 'Failed to delete campaign' });
      }

      res.status(200).json({ 
        success: true, 
        message: 'Campaign deleted successfully' 
      });

    } catch (error) {
      console.error('Error in delete campaign API:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  } else if (req.method === 'PUT') {
    try {
      const { name, description, status, current_stage, start_date, end_date } = req.body;

      if (status === 'active') {
        const readiness = await evaluateCampaignReadiness(id);
        if (readiness.readiness_state !== 'ready') {
          return res.status(409).json({
            error: 'Campaign is not ready to activate',
            readiness: {
              readiness_percentage: readiness.readiness_percentage,
              readiness_state: readiness.readiness_state,
              blocking_issues: readiness.blocking_issues,
            },
          });
        }
      }

      // Update campaign
      const { data: campaign, error } = await supabase
        .from('campaigns')
        .update({
          name,
          description,
          status,
          current_stage,
          start_date,
          end_date,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Error updating campaign:', error);
        return res.status(500).json({ error: 'Failed to update campaign' });
      }

      res.status(200).json({ 
        success: true, 
        campaign,
        message: 'Campaign updated successfully' 
      });

    } catch (error) {
      console.error('Error in update campaign API:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

