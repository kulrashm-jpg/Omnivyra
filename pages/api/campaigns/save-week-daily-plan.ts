import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

const DAYS_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function toIsoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayNameToIndex(dayName: string): number {
  const i = DAYS_ORDER.indexOf(dayName);
  return i >= 0 ? i + 1 : 1;
}

function computeDayDate(params: { campaignStart: string; weekNumber: number; dayOfWeek: string }): string {
  const start = new Date(params.campaignStart);
  const dayIndex = dayNameToIndex(params.dayOfWeek);
  const offsetDays = (params.weekNumber - 1) * 7 + (dayIndex - 1);
  const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return toIsoDateOnly(date);
}

function tryParseJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s || (!s.startsWith('{') && !s.startsWith('['))) return null;
  try {
    const parsed = JSON.parse(s);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * POST body: { campaignId, weekNumber, items: Array<{ id: string, dayOfWeek: string }> }
 * Updates each daily_content_plan row's day_of_week and date; updates content JSON dayIndex/day_name when present.
 * Marks the week's daily plan as saved for the next stage (daily_plan_populated).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, weekNumber, items } = req.body as {
      campaignId?: string;
      weekNumber?: number;
      items?: Array<{ id: string; dayOfWeek: string }>;
    };

    if (!campaignId || !Number.isFinite(weekNumber) || weekNumber < 1 || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'campaignId, weekNumber, and non-empty items array are required' });
    }

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, start_date')
      .eq('id', campaignId)
      .maybeSingle();

    if (!campaign?.start_date) {
      return res.status(400).json({ error: 'Campaign start_date is required' });
    }

    const campaignStart = String(campaign.start_date);

    for (const item of items) {
      const id = item?.id;
      const dayOfWeek = typeof item?.dayOfWeek === 'string' ? item.dayOfWeek.trim() : '';
      if (!id || !dayOfWeek || !DAYS_ORDER.includes(dayOfWeek)) continue;

      const date = computeDayDate({ campaignStart, weekNumber, dayOfWeek });

      const { data: row } = await supabase
        .from('daily_content_plans')
        .select('id, content')
        .eq('id', id)
        .eq('campaign_id', campaignId)
        .eq('week_number', weekNumber)
        .maybeSingle();

      if (!row) continue;

      let content = row.content;
      const parsed = tryParseJson(content);
      if (parsed && typeof parsed === 'object') {
        const dayIndex = dayNameToIndex(dayOfWeek);
        const updated = { ...parsed, dayIndex, day_name: dayOfWeek, weekNumber };
        content = JSON.stringify(updated);
      }

      await supabase
        .from('daily_content_plans')
        .update({
          day_of_week: dayOfWeek,
          date,
          content,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('campaign_id', campaignId)
        .eq('week_number', weekNumber);
    }

    await supabase
      .from('weekly_content_refinements')
      .update({
        daily_plan_populated: true,
        updated_at: new Date().toISOString(),
      })
      .eq('campaign_id', campaignId)
      .eq('week_number', weekNumber);

    res.status(200).json({
      success: true,
      message: 'Daily plan saved and set for the next stage.',
      weekNumber,
    });
  } catch (error) {
    console.error('Error in save-week-daily-plan API:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
