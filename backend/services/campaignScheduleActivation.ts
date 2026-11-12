/**
 * The post-schedule campaign activation (status active, current_stage schedule, blueprint_status
 * ACTIVE), ONE implementation for both callers:
 *   - pages/api/campaigns/[id]/schedule-structured-plan.ts, right after posts are scheduled;
 *   - pages/api/campaigns/[id]/retry-activation.ts, the user's "Retry status update" when that first
 *     attempt failed (it never schedules posts).
 *
 * This write is what lets the scheduled posts PUBLISH: lib/campaign/publishAuthorization refuses every
 * campaign-linked post while the campaign is not 'active' (PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE).
 *
 * The write is idempotent (it sets fixed values), so retrying it is safe: up to ACTIVATION_ATTEMPTS
 * tries with a short backoff (e9, 2026-11-12). PostgREST reports a failure in `error` and never throws,
 * so the answer is that error, never an exception. On FINAL failure an alert-ready operational event
 * (CAMPAIGN_ACTIVATION_FAILED) is recorded, so ops sees it even if the user closes the tab. A
 * post-launch sweeper is keyed on that event (never on "has posts but inactive": paused campaigns are
 * inactive on purpose).
 */
import { supabase } from '../db/supabaseClient';
import { recordMonetizationOperationalEvent } from './monetizationOpsService';

/** ok:false always carries the error (a plain object type: the project's compiler settings do not narrow a union on `ok`). */
export type ActivationResult = { ok: boolean; error: { message: string } | null; attempts: number };

export const ACTIVATION_ATTEMPTS = 3;
/** Wait before attempt 2 and attempt 3. Short: this runs inside the user's request. */
export const ACTIVATION_BACKOFF_MS = [250, 750] as const;

export const CAMPAIGN_ACTIVATION_FAILED_EVENT = 'scheduling.campaign_activation_failed';
export const CAMPAIGN_ACTIVATION_RECOVERED_EVENT = 'scheduling.campaign_activation_recovered';

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function activateScheduledCampaign(
  campaignId: string,
  opts: { companyId?: string | null; source?: string; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ActivationResult> {
  const sleep = opts.sleep ?? defaultSleep;
  const write = () => supabase
    .from('campaigns')
    .update({
      status: 'active',
      current_stage: 'schedule',
      blueprint_status: 'ACTIVE',
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaignId);

  let lastError: { message: string } | null = null;
  for (let attempt = 1; attempt <= ACTIVATION_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(ACTIVATION_BACKOFF_MS[attempt - 2]);
    const { error } = await write();
    if (!error) return { ok: true, error: null, attempts: attempt };
    lastError = { message: error.message };
  }

  // best-effort(alert): the event is how ops learns of posts that will not publish; a failure to
  // record it is itself logged, and never masks the activation result.
  try {
    await recordMonetizationOperationalEvent({
      eventName: CAMPAIGN_ACTIVATION_FAILED_EVENT,
      severity: 'ERROR',
      organizationId: opts.companyId ?? null,
      alertKey: 'campaign_activation_failed',
      alertReady: true,
      requiresHumanReview: true,
      metadata: {
        code: 'CAMPAIGN_ACTIVATION_FAILED',
        campaign_id: campaignId,
        attempts: ACTIVATION_ATTEMPTS,
        source: opts.source ?? 'unknown',
        error: lastError?.message ?? 'unknown',
        consequence: 'scheduled posts will not publish until the campaign is active',
      },
    });
  } catch (eventError) {
    console.error('[campaignScheduleActivation] could not record the activation-failed event', {
      campaignId, eventError: eventError instanceof Error ? eventError.message : String(eventError),
    });
  }
  return { ok: false, error: lastError, attempts: ACTIVATION_ATTEMPTS };
}

/**
 * Record that a campaign whose activation had failed is now active (the success marker a post-launch
 * sweeper needs to tell "failed, then fixed" from "failed and still stuck"). Best-effort.
 */
export async function recordActivationRecovered(campaignId: string, companyId: string | null, source: string): Promise<void> {
  try {
    await recordMonetizationOperationalEvent({
      eventName: CAMPAIGN_ACTIVATION_RECOVERED_EVENT,
      severity: 'INFO',
      organizationId: companyId,
      alertKey: 'campaign_activation_failed',
      metadata: { campaign_id: campaignId, source },
    });
  } catch (eventError) {
    console.error('[campaignScheduleActivation] could not record the activation-recovered event', {
      campaignId, eventError: eventError instanceof Error ? eventError.message : String(eventError),
    });
  }
}
