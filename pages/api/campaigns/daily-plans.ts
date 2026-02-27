import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

function tryParseJson(value: unknown): any | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s || (!s.startsWith('{') && !s.startsWith('['))) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId } = req.query;

    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }

    // Get daily plans for the campaign
    const { data: dailyPlans, error } = await supabase
      .from('daily_content_plans')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('week_number', { ascending: true })
      .order('day_of_week', { ascending: true });

    if (error) {
      console.error('Error fetching daily plans:', error);
      return res.status(500).json({ error: 'Failed to fetch daily plans' });
    }

    // Transform the data to match the expected format (include all fields for day detail modal)
    // Supports both legacy rows and v2 rows where `content` stores the normalized daily object as JSON.
    const transformedPlans =
      dailyPlans?.map((plan: any) => {
        const parsed = tryParseJson(plan.content);
        const isV2 =
          parsed &&
          typeof parsed === 'object' &&
          Number.isFinite(Number(parsed.dayIndex)) &&
          Number.isFinite(Number(parsed.weekNumber)) &&
          typeof parsed.topicTitle === 'string';

        const keyPoints = (() => {
          const k = plan.key_points ?? plan.main_points;
          if (Array.isArray(k)) return k;
          if (typeof k === 'string') {
            try {
              const p = JSON.parse(k);
              return Array.isArray(p) ? p : [];
            } catch {
              return [];
            }
          }
          return [];
        })();

        if (isV2) {
          const daily = parsed as any;
          return {
            id: plan.id,
            weekNumber: Number(daily.weekNumber) || plan.week_number,
            dayOfWeek: plan.day_of_week,
            platform: plan.platform,
            contentType: String(daily.contentType ?? plan.content_type ?? 'post'),
            title: String(daily.topicTitle ?? plan.title ?? ''),
            content: String(daily.dailyObjective ?? ''),
            description: String(daily.writingIntent ?? ''),
            topic: String(daily.topicTitle ?? plan.topic ?? ''),
            introObjective: String(daily.whatShouldReaderLearn ?? plan.intro_objective ?? ''),
            summary: String(daily.whatProblemAreWeAddressing ?? plan.summary ?? ''),
            objective: String(daily.dailyObjective ?? plan.objective ?? ''),
            keyPoints,
            cta: String(daily.desiredAction ?? plan.cta ?? ''),
            brandVoice: String(daily.narrativeStyle ?? plan.brand_voice ?? ''),
            themeLinkage: plan.theme_linkage,
            formatNotes:
              plan.format_notes ||
              (daily.contentGuidance
                ? `${daily.contentGuidance.primaryFormat}; max ${daily.contentGuidance.maxWordTarget} words`
                : undefined),
            weekTheme: plan.week_theme,
            campaignTheme: plan.campaign_theme,
            hashtags: plan.hashtags || [],
            scheduledTime: plan.scheduled_time || plan.optimal_posting_time,
            status: plan.status || 'planned',
            dailyObject: daily,
          };
        }

        return {
          id: plan.id,
          weekNumber: plan.week_number,
          dayOfWeek: plan.day_of_week,
          platform: plan.platform,
          contentType: plan.content_type,
          title: plan.title,
          content: plan.content,
          description: plan.description,
          topic: plan.topic,
          introObjective: plan.intro_objective,
          summary: plan.summary,
          objective: plan.objective,
          keyPoints,
          cta: plan.cta,
          brandVoice: plan.brand_voice,
          themeLinkage: plan.theme_linkage,
          formatNotes: plan.format_notes,
          weekTheme: plan.week_theme,
          campaignTheme: plan.campaign_theme,
          hashtags: plan.hashtags || [],
          scheduledTime: plan.scheduled_time || plan.optimal_posting_time,
          status: plan.status || 'planned',
        };
      }) || [];

    res.status(200).json(transformedPlans);

  } catch (error) {
    console.error('Error in daily plans API:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}