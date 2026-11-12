/**
 * The advisory start-date conflict warning shown by POST /api/campaigns/ai/plan (extracted from the
 * route so its failure handling is testable where it lives).
 *
 * The check is NON-BLOCKING by design: the plan is produced either way. But "no warning" must mean
 * "checked, no conflict". Every read on this path used to fail silently (PostgREST returns an error,
 * never throws, and detectCampaignConflicts answered [] on a failed read), so the user could not tell
 * "no conflicts" from "not checked" (unread-error pkg 2). Any failure now yields CONFLICT_UNCHECKED_NOTE,
 * appended to whatever the check had already found.
 */
import { supabase } from '../db/supabaseClient';
import { detectCampaignConflicts, suggestAvailableDateRange } from './schedulingService';

export const CONFLICT_UNCHECKED_NOTE =
  '⚠️ **Date check unavailable:** Could not check this start date against your other campaigns right now. Review your calendar for overlaps before you commit to it.';

const PLAN_DAYS = 12 * 7;

type Deps = {
  readCampaignUserId: (campaignId: string) => Promise<{ userId: string | null; error: { message: string } | null }>;
  detect: typeof detectCampaignConflicts;
  suggest: typeof suggestAvailableDateRange;
};

const defaultDeps: Deps = {
  readCampaignUserId: async (campaignId) => {
    const { data, error } = await supabase.from('campaigns').select('user_id').eq('id', campaignId).maybeSingle();
    if (error) return { userId: null, error: { message: error.message } };
    return { userId: (data as { user_id?: string | null } | null)?.user_id ?? null, error: null };
  },
  detect: detectCampaignConflicts,
  suggest: suggestAvailableDateRange,
};

/** null = checked (or nothing to check) and no conflict. */
export async function buildStartDateConflictWarning(
  campaignId: string,
  tentativeStart: string | null,
  deps: Partial<Deps> = {},
): Promise<string | null> {
  if (!tentativeStart || !/^\d{4}-\d{2}-\d{2}$/.test(tentativeStart)) return null;
  const d: Deps = { ...defaultDeps, ...deps };
  let warning: string | null = null;
  try {
    const owner = await d.readCampaignUserId(campaignId);
    if (owner.error) throw new Error(`campaign owner unreadable: ${owner.error.message}`);
    if (!owner.userId) return null;
    const startDate = new Date(tentativeStart);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + PLAN_DAYS);
    const conflicts = await d.detect(owner.userId, startDate, endDate, campaignId);
    if (conflicts.length === 0) return null;
    const lines = conflicts.map(
      (c) => `• "${c.campaign_name}" (${c.start_date.toLocaleDateString()} – ${c.end_date.toLocaleDateString()}, ${c.overlap_days} day overlap)`,
    );
    warning = `⚠️ **Date conflict:** This start date overlaps with ${conflicts.length} existing campaign(s):\n\n${lines.join('\n')}\n\nConsider choosing a different start date or finishing the overlapping campaign(s) first.`;
    const suggestion = await d.suggest(owner.userId, PLAN_DAYS, startDate);
    if (suggestion) {
      warning += `\n\nSuggested alternative: start **${suggestion.start_date.toLocaleDateString()}** (after current campaigns).`;
    }
    return warning;
  } catch (err) {
    console.warn('[plan] Start date conflict check failed (non-blocking; the user is told it did not run):', (err as Error)?.message ?? err);
    return warning ? `${warning}\n\n${CONFLICT_UNCHECKED_NOTE}` : CONFLICT_UNCHECKED_NOTE;
  }
}
