import { ownedDbTable } from '../db/writeOwner';
/**
 * Autonomous Scheduler — Step 3
 *
 * Runs daily (via cron). For each company in autonomous mode:
 *   1. Check if there is an active campaign or one ending soon (≤ 7 days)
 *   2. If not, generate next campaign
 *   3. Route through approval or auto-activate based on company settings
 *
 * Also handles:
 *   - Expiring pending_campaigns (marks as 'expired' after 7 days)
 *   - Post-campaign learning distillation
 */

import { supabase } from '../db/supabaseClient';
import { generateNextCampaign, getAutonomousSettings } from './autonomousCampaignAgent';
import { distilCampaignLearnings } from './campaignLearningsStore';
import { logDecision } from './autonomousDecisionLogger';
import { getCreditCost, hasEnoughCredits } from './creditDeductionService';

export type SchedulerRunResult = {
  companies_evaluated: number;
  campaigns_generated: number;
  campaigns_auto_activated: number;
  pending_created: number;
  learnings_distilled: number;
  expired_pending: number;
  errors: string[];
};

const ENDING_SOON_DAYS = 7;

/** Check if a company has an active campaign or one ending within N days. */
async function hasActiveCampaign(companyId: string): Promise<boolean> {
  const threshold = new Date(Date.now() + ENDING_SOON_DAYS * 86400_000).toISOString();

  // A failed read is not "no active campaign" (that would generate - and
  // charge for - a duplicate campaign). Throw: the per-company catch skips it.
  const { data, error } = await ownedDbTable('campaigns')
    .select('id, end_date, status')
    .eq('company_id', companyId)
    .in('status', ['active', 'scheduled', 'execution_ready', 'campaign_week_plan'])
    .or(`end_date.is.null,end_date.gt.${threshold}`)
    .limit(1);
  if (error) throw new Error(`active campaign read failed: ${error.message}`);

  return (data?.length ?? 0) > 0;
}

/** Store a generated plan in pending_campaigns for human review. */
async function storePendingCampaign(
  companyId: string,
  plan: Awaited<ReturnType<typeof generateNextCampaign>>,
): Promise<string> {
  const { data, error } = await ownedDbTable('pending_campaigns').insert({
    company_id:      companyId,
    campaign_plan:   plan,
    generation_meta: plan.generation_meta,
    status:          'pending',
    expires_at:      new Date(Date.now() + 7 * 86400_000).toISOString(),
    created_at:      new Date().toISOString(),
  }).select('id').maybeSingle();

  if (error) throw new Error(`Failed to store pending campaign: ${error.message}`);
  return (data as { id: string }).id;
}

/** Auto-activate a campaign (create it directly in campaigns table). */
async function autoActivateCampaign(
  companyId: string,
  plan: Awaited<ReturnType<typeof generateNextCampaign>>,
): Promise<string> {
  const { data, error } = await ownedDbTable('campaigns').insert({
    company_id:        companyId,
    name:              plan.name,
    description:       plan.description,
    status:            'scheduled',
    platforms:         plan.platforms,
    posting_frequency: plan.posting_frequency,
    content_mix:       plan.content_mix,
    duration_weeks:    plan.duration_weeks,
    campaign_goal:     plan.campaign_goal,
    generation_meta:   plan.generation_meta,
    created_at:        new Date().toISOString(),
    updated_at:        new Date().toISOString(),
  }).select('id').maybeSingle();

  if (error) throw new Error(`Failed to auto-activate campaign: ${error.message}`);
  return (data as { id: string }).id;
}

/** Notify user of pending campaign awaiting approval. */
async function notifyPendingApproval(companyId: string, pendingId: string, planName: string): Promise<void> {
  // Best-effort: supabase returns {error} rather than throwing, so the error is
  // read and logged here; the catch only covers a thrown transport fault.
  try {
    const { error } = await ownedDbTable('notifications').insert({
      company_id: companyId,
      type:       'campaign_pending_approval',
      title:      'New campaign ready for approval',
      body:       `"${planName}" was generated autonomously and is ready for your review.`,
      metadata:   { pending_campaign_id: pendingId },
      created_at: new Date().toISOString(),
      read:       false,
    });
    if (error) console.error('[autonomousScheduler] pending-approval notification failed:', error.message);
  } catch (_) { /* non-blocking */ }
}

/** Expire pending campaigns past their expiry date. */
async function expireOldPending(): Promise<number> {
  // Best-effort housekeeping: a failure is logged, never reported as "0 expired"
  // silently. Not fatal - the next daily run retries.
  const { data, error } = await ownedDbTable('pending_campaigns')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
    .select('id');
  if (error) console.error('[autonomousScheduler] pending expiry failed:', error.message);
  return data?.length ?? 0;
}

/** Find campaigns that just ended (for learning distillation). */
async function getRecentlyCompletedCampaigns(): Promise<Array<{ id: string; company_id: string }>> {
  const since = new Date(Date.now() - 25 * 3600_000).toISOString(); // last 25h
  // Best-effort (learning only, no money): log a failed read, never silent.
  const { data, error } = await ownedDbTable('campaigns')
    .select('id, company_id')
    .in('status', ['completed', 'ended'])
    .gte('updated_at', since);
  if (error) console.error('[autonomousScheduler] completed campaigns read failed:', error.message);
  return (data ?? []) as Array<{ id: string; company_id: string }>;
}

/**
 * Main scheduler entry point. Called by a daily cron job.
 */
export async function runAutonomousScheduler(): Promise<SchedulerRunResult> {
  const result: SchedulerRunResult = {
    companies_evaluated:      0,
    campaigns_generated:      0,
    campaigns_auto_activated: 0,
    pending_created:          0,
    learnings_distilled:      0,
    expired_pending:          0,
    errors:                   [],
  };

  try {
    const campaignGenerationCost = await getCreditCost('campaign_generation');
    // ── 1. Expire stale pending campaigns ─────────────────────────────────
    result.expired_pending = await expireOldPending();

    // ── 2. Distil learnings from campaigns completed in last 24h ──────────
    const completed = await getRecentlyCompletedCampaigns();
    for (const { id, company_id } of completed) {
      const n = await distilCampaignLearnings(company_id, id).catch(() => 0);
      result.learnings_distilled += n;
    }

    // ── 3. Load all companies with autonomous_mode = true ─────────────────
    // A failed read is not "no autonomous companies": throw so the run reports
    // "Scheduler failed" instead of a clean zero.
    const { data: settingsRows, error: settingsErr } = await ownedDbTable('company_settings')
      .select('company_id, autonomous_mode, approval_required, risk_tolerance')
      .eq('autonomous_mode', true);
    if (settingsErr) throw new Error(`autonomous settings read failed: ${settingsErr.message}`);

    if (!settingsRows?.length) return result;

    for (const row of settingsRows) {
      const companyId      = (row as any).company_id as string;
      const approvalRequired = Boolean((row as any).approval_required ?? true);

      result.companies_evaluated++;

      try {
        const hasActive = await hasActiveCampaign(companyId);
        if (hasActive) continue; // campaign in flight — skip

        // ── Credit gate — skip generation if balance is critically low ─────
        // REAL balance read (2026-11-12): this was hard-coded sufficient with a
        // fake balance of 10x cost, so the gate never closed and the low-credit
        // flag below never fired. A wallet read error THROWS (getWalletSnapshot)
        // and the per-company catch skips this company - never generate on an
        // unread balance. The charge itself is still enforced by
        // reserveCreditsForWork in generateNextCampaign; this gate keeps a
        // short-balance company from being attempted at all.
        const creditCheck = await hasEnoughCredits(companyId, 'campaign_generation');
        if (!creditCheck.sufficient) {
          result.errors.push(`[${companyId}] Insufficient credits (${creditCheck.balance ?? 0}/${creditCheck.required}) — skipping campaign generation`);
          continue;
        }
        // Warn mode: <20% of a typical campaign budget signals to reduce extras
        const LOW_CREDIT_THRESHOLD = campaignGenerationCost * 5;
        const creditIsLow = (creditCheck.balance ?? 0) < LOW_CREDIT_THRESHOLD;

        // ── Generate next campaign ─────────────────────────────────────────
        const plan = await generateNextCampaign(companyId);
        // If credits are low, attach a flag to the plan's meta for downstream services
        if (creditIsLow) {
          plan.generation_meta.optimization_notes = [
            ...(plan.generation_meta.optimization_notes ?? []),
            'Credit balance low — reduced intelligence analysis mode active',
          ];
        }
        result.campaigns_generated++;

        if (approvalRequired) {
          // ── Store for human review ─────────────────────────────────────
          const pendingId = await storePendingCampaign(companyId, plan);
          await notifyPendingApproval(companyId, pendingId, plan.name);
          result.pending_created++;

          await logDecision({
            company_id:    companyId,
            decision_type: 'generate',
            reason:        `Campaign "${plan.name}" stored pending approval (pending_id: ${pendingId})`,
            metrics_used:  { plan_name: plan.name, approval_required: true },
          });
        } else {
          // ── Auto-activate immediately ──────────────────────────────────
          const campaignId = await autoActivateCampaign(companyId, plan);
          result.campaigns_auto_activated++;

          await logDecision({
            company_id:    companyId,
            campaign_id:   campaignId,
            decision_type: 'auto_activate',
            reason:        `Campaign "${plan.name}" auto-activated (approval not required)`,
            metrics_used:  {
              plan_name: plan.name,
              predicted_engagement: plan.generation_meta.predicted_engagement_rate,
            },
          });
        }
      } catch (err: unknown) {
        result.errors.push(`${companyId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err: unknown) {
    result.errors.push(`Scheduler failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}
