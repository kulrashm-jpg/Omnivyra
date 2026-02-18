import { NextApiRequest, NextApiResponse } from 'next';
import { parseAiPlanToWeeks } from '../../../backend/services/campaignPlanParser';

/**
 * POST /api/campaigns/parse-saved-plan
 * Body: { content: string }
 * Uses AI to parse saved plan text into structured weeks for editing in split view.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { content } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'content (string) is required' });
    }

    const parsed = await parseAiPlanToWeeks(content);

    const weeks = parsed.weeks.map((w: any) => ({
      week: w.week,
      phase_label: w.phase_label || w.theme || `Week ${w.week}`,
      theme: w.theme || w.phase_label || `Week ${w.week}`,
      primary_objective: w.primary_objective || '',
      platform_allocation: w.platform_allocation || {},
      content_type_mix: w.content_type_mix || ['post'],
      cta_type: w.cta_type || 'None',
      total_weekly_content_count: w.total_weekly_content_count || 0,
      weekly_kpi_focus: w.weekly_kpi_focus || 'Reach growth',
      topics_to_cover: w.topics_to_cover,
      platform_content_breakdown: w.platform_content_breakdown,
      platform_topics: w.platform_topics,
      daily: w.daily || [],
    }));

    return res.status(200).json({ weeks });
  } catch (error) {
    console.error('Error in parse-saved-plan API:', error);
    return res.status(500).json({
      error: 'Failed to parse plan',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
