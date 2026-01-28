import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getWeeklyPerformance(req, res);
  } else if (req.method === 'POST') {
    return createWeeklyPerformance(req, res);
  } else if (req.method === 'PUT') {
    return updateWeeklyPerformance(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function getWeeklyPerformance(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { campaignId, weekNumber } = req.query;

    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }

    let query = supabase
      .from('campaign_performance')
      .select('*')
      .eq('campaign_id', campaignId);

    if (weekNumber) {
      query = query.eq('week_number', weekNumber);
    }

    const { data, error } = await query.order('week_number', { ascending: true });

    if (error) {
      console.error('Error fetching weekly performance:', error);
      return res.status(500).json({ error: 'Failed to fetch weekly performance' });
    }

    res.status(200).json(data);

  } catch (error) {
    console.error('Error in getWeeklyPerformance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function createWeeklyPerformance(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      campaign_id,
      week_number,
      week_start_date,
      week_end_date,
      weekly_theme,
      weekly_focus_area,
      target_reach,
      target_engagement,
      target_conversions,
      platform,
      content_type
    } = req.body;

    if (!campaign_id || !week_number) {
      return res.status(400).json({ error: 'Campaign ID and week number are required' });
    }

    const performanceData = {
      campaign_id,
      week_number,
      week_start_date,
      week_end_date,
      weekly_theme,
      weekly_focus_area,
      target_reach: target_reach || 0,
      target_engagement: target_engagement || 0,
      target_conversions: target_conversions || 0,
      platform,
      content_type,
      performance_date: week_start_date || new Date().toISOString().split('T')[0],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('campaign_performance')
      .insert(performanceData)
      .select()
      .single();

    if (error) {
      console.error('Error creating weekly performance:', error);
      return res.status(500).json({ error: 'Failed to create weekly performance record' });
    }

    res.status(201).json({ 
      success: true, 
      message: 'Weekly performance record created successfully',
      data 
    });

  } catch (error) {
    console.error('Error in createWeeklyPerformance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateWeeklyPerformance(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const {
      total_reach,
      total_engagement,
      total_conversions,
      actual_vs_target,
      content_types_performance,
      platform_breakdown,
      content_type_breakdown
    } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Performance record ID is required' });
    }

    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (total_reach !== undefined) updateData.total_reach = total_reach;
    if (total_engagement !== undefined) updateData.total_engagement = total_engagement;
    if (total_conversions !== undefined) updateData.total_conversions = total_conversions;
    if (actual_vs_target !== undefined) updateData.actual_vs_target = actual_vs_target;
    if (content_types_performance !== undefined) updateData.content_types_performance = content_types_performance;
    if (platform_breakdown !== undefined) updateData.platform_breakdown = platform_breakdown;
    if (content_type_breakdown !== undefined) updateData.content_type_breakdown = content_type_breakdown;

    const { data, error } = await supabase
      .from('campaign_performance')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating weekly performance:', error);
      return res.status(500).json({ error: 'Failed to update weekly performance' });
    }

    res.status(200).json({ 
      success: true, 
      message: 'Weekly performance updated successfully',
      data 
    });

  } catch (error) {
    console.error('Error in updateWeeklyPerformance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
