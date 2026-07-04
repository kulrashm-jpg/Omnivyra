import { NextApiRequest, NextApiResponse } from 'next';
import { runAutopilotForWeek, persistAutopilotSchedule } from '../../../backend/services/autopilotExecutionPipeline';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { week, options } = req.body || {};
    if (!week || typeof week !== 'object') {
      return res.status(400).json({ error: 'week is required' });
    }

    const timezone = typeof options?.timezone === 'string' ? options.timezone : 'UTC';
    const result = await runAutopilotForWeek(week, { timezone });

    // Persist the scheduling decision exactly once via the canonical write
    // boundary so the schedule survives reload (the pipeline itself is pure
    // compute). Resolve campaign/week from the week payload or its items.
    const items = Array.isArray((result.week as { daily_execution_items?: unknown })?.daily_execution_items)
      ? (result.week as { daily_execution_items: Array<Record<string, unknown>> }).daily_execution_items
      : [];
    const firstItem = items[0] || {};
    const campaignId =
      (typeof (week as { campaignId?: unknown }).campaignId === 'string' && (week as { campaignId?: string }).campaignId) ||
      (typeof (week as { campaign_id?: unknown }).campaign_id === 'string' && (week as { campaign_id?: string }).campaign_id) ||
      (typeof firstItem.campaign_id === 'string' ? firstItem.campaign_id : null);
    const weekNumberRaw =
      (week as { weekNumber?: unknown }).weekNumber ??
      (week as { week_number?: unknown }).week_number ??
      firstItem.week_number;
    const weekNumber = Number(weekNumberRaw);

    const { persisted } = await persistAutopilotSchedule(items as never, { campaignId, weekNumber });

    return res.status(200).json({
      success: true,
      week: result.week,
      summary: result.summary,
      persisted,
    });
  } catch (error) {
    console.error('[autopilot-week] failed', error);
    return res.status(500).json({
      error: 'Failed to run autopilot week',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
