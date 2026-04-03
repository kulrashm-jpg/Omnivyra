import { NextApiRequest, NextApiResponse } from 'next';
import { runAutopilotForWeek } from '../../../backend/services/autopilotExecutionPipeline';

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
    return res.status(200).json({
      success: true,
      week: result.week,
      summary: result.summary,
    });
  } catch (error) {
    console.error('[autopilot-week] failed', error);
    return res.status(500).json({
      error: 'Failed to run autopilot week',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
