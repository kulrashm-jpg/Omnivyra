/**
 * orchestrationCalendarView — Phase-2 Step-14. READ-ONLY calendar feed.
 */

import { buildCalendarExecutionView, type CalendarExecutionView } from './orchestrationViewMapper';
import { viewDiagnostics } from './orchestrationViewDiagnostics';

export async function getCalendarExecutionView(
  campaignId: string,
): Promise<CalendarExecutionView[]> {
  if (!campaignId) return [];
  try {
    const views = await buildCalendarExecutionView(campaignId);
    const blocked = views.filter((v) => v.orchestration_flags.blocked).length;
    const creator = views.filter((v) => v.creator_state !== 'NONE').length;
    const owned = views.filter((v) => v.owned_content_state !== 'NONE').length;
    viewDiagnostics.calendar({
      campaign_id: campaignId,
      execution_count: views.length,
      blocked_count: blocked,
      creator_count: creator,
      owned_content_count: owned,
    });
    viewDiagnostics.view({
      campaign_id: campaignId,
      surface: 'calendar',
      execution_count: views.length,
    });
    return views;
  } catch {
    return [];
  }
}
