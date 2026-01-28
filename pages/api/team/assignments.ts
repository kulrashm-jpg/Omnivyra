/**
 * Team Assignments API
 * GET /api/team/assignments - Get user assignments
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getUserAssignments, getCampaignTeam } from '../../../backend/services/teamService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user_id, campaign_id, status } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'user_id is required' });
    }

    if (campaign_id) {
      // Get team for a campaign
      const teamMembers = await getCampaignTeam(campaign_id as string);
      return res.status(200).json({
        success: true,
        data: teamMembers,
      });
    }

    // Get assignments for a user
    const assignments = await getUserAssignments(user_id, {
      status: status as any,
    });

    res.status(200).json({
      success: true,
      data: assignments,
    });
  } catch (error: any) {
    console.error('Assignments API error:', error);
    res.status(500).json({
      error: 'Failed to fetch assignments',
      message: error.message,
    });
  }
}

