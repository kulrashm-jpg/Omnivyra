/**
 * The post-schedule campaign activation (status active, current_stage schedule, blueprint_status
 * ACTIVE), ONE implementation for both callers:
 *   - pages/api/campaigns/[id]/schedule-structured-plan.ts, right after posts are scheduled;
 *   - pages/api/campaigns/[id]/retry-activation.ts, the user's "Retry status update" when that first
 *     attempt failed (it never schedules posts).
 *
 * The write is idempotent (it sets fixed values), so retrying it is safe. It is attempted at most
 * twice. PostgREST reports a failure in `error` and never throws, so the answer is that error, never
 * an exception (unread-error pkg 2, e9 2026-11-12).
 */
import { supabase } from '../db/supabaseClient';

/** ok:false always carries the error (a plain object type: the project's compiler settings do not narrow a union on `ok`). */
export type ActivationResult = { ok: boolean; error: { message: string } | null };

export async function activateScheduledCampaign(campaignId: string): Promise<ActivationResult> {
  const write = () => supabase
    .from('campaigns')
    .update({
      status: 'active',
      current_stage: 'schedule',
      blueprint_status: 'ACTIVE',
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaignId);
  let { error } = await write();
  if (error) ({ error } = await write());
  return error ? { ok: false, error: { message: error.message } } : { ok: true, error: null };
}
