import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { updateActivity } from '../../../backend/services/executionPlannerService';
import { requireCampaignTenantAccess } from '../../../backend/security/TenantGuard';

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
async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    const access = await requireCampaignTenantAccess(req, res, campaignId);
    if (!access) return;

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, start_date')
      .eq('id', campaignId)
      .maybeSingle();

    if (!campaign?.start_date) {
      return res.status(400).json({ error: 'Campaign start_date is required' });
    }

    const campaignStart = String(campaign.start_date);

    // OPT-010 W2-4: ONE batched .in() select (scoped to the same campaign_id +
    // week_number filters) replaces the per-item lookups, and the per-item
    // updateActivity writes run concurrently — each targets a distinct row id,
    // and setWriteAllowed() inside updateActivity is a documented no-op
    // (executionPlannerService.ts:51), so no shared state is involved.
    // Invalid or missing items are skipped exactly as before.
    const validItems = items
      .filter((item) => {
        const id = item?.id;
        const dayOfWeek = typeof item?.dayOfWeek === 'string' ? item.dayOfWeek.trim() : '';
        return Boolean(id && dayOfWeek && DAYS_ORDER.includes(dayOfWeek));
      })
      .map((item) => ({ id: item.id, dayOfWeek: item.dayOfWeek.trim() }));

    const { data: rows } =
      validItems.length > 0
        ? await supabase
            .from('daily_content_plans')
            .select('id, content')
            .in('id', validItems.map((i) => i.id))
            .eq('campaign_id', campaignId)
            .eq('week_number', weekNumber)
        : { data: [] as Array<{ id: string; content: unknown }> };
    const rowById = new Map(
      (rows ?? []).map((r: { id: string; content: unknown }) => [r.id, r])
    );

    await Promise.all(
      validItems.map(async ({ id, dayOfWeek }) => {
        const row = rowById.get(id);
        if (!row) return;

        const date = computeDayDate({ campaignStart, weekNumber, dayOfWeek });

        let content = row.content;
        const parsed = tryParseJson(content);
        if (parsed && typeof parsed === 'object') {
          const dayIndex = dayNameToIndex(dayOfWeek);
          const updated = { ...parsed, dayIndex, day_name: dayOfWeek, weekNumber };
          content = JSON.stringify(updated);
        }

        await updateActivity(id, { day_of_week: dayOfWeek, date, content }, 'board');
      })
    );

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/save-week-daily-plan' });
