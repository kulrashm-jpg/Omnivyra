import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { updateActivity } from '../../../backend/services/executionPlannerService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { dayPlanId, platforms, contentType } = req.body;

    if (!dayPlanId) {
      return res.status(400).json({ error: 'Day plan ID required' });
    }

    // Platform mapping for smart suggestions
    const platformMapping: { [key: string]: string[] } = {
      'Educational Post': ['LinkedIn', 'Twitter'],
      'Case Study': ['LinkedIn'],
      'Question-based Content': ['Twitter', 'Facebook'],
      'Tips & Tutorial': ['LinkedIn', 'YouTube'],
      'Industry News': ['LinkedIn', 'Twitter'],
      'Behind the Scenes': ['Instagram', 'LinkedIn'],
      'Reflection': ['LinkedIn'],
      'Random': ['LinkedIn', 'Twitter', 'Facebook', 'Instagram', 'YouTube', 'TikTok', 'Pinterest'],
    };

    await updateActivity(
      dayPlanId,
      {
        platforms: platforms,
        posting_strategy: `Custom platforms: ${platforms.join(', ')}`,
      },
      'board'
    );

    const { data: updatedPlan } = await supabase
      .from('daily_content_plans')
      .select('*')
      .eq('id', dayPlanId)
      .maybeSingle();

    // Return suggested platforms based on content type
    const suggestedPlatforms = platformMapping[contentType] || [];
    const allPlatforms = ['LinkedIn', 'Twitter', 'Facebook', 'Instagram', 'YouTube', 'TikTok', 'Pinterest'];

    return res.status(200).json({
      success: true,
      updatedPlan,
      suggestedPlatforms,
      allPlatforms,
      contentType
    });

  } catch (error) {
    console.error('Error in update platforms API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}







