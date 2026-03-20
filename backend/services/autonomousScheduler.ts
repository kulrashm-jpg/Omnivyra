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
import { hasEnoughCredits, CREDIT_COSTS } from './creditDeductionService';

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

  const { data } = await supabase
    .from('campaigns')
    .select('id, end_date, status')
    .eq('company_id', companyId)
    .in('status', ['active', 'scheduled', 'execution_ready', 'twelve_week_plan'])
    .or(`end_date.is.null,end_date.gt.${threshold}`)
    .limit(1);

  return (data?.length ?? 0) > 0;
}

/** Store a generated plan in pending_campaigns for human review. */
async function storePendingCampaign(
  companyId: string,
  plan: Awaited<ReturnType<typeof generateNextCampaign>>,
): Promise<string> {
  const { data, error } = await supabase.from('pending_campaigns').insert({
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
  const { data, error } = await supabase.from('campaigns').insert({
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
  try {
    await supabase.from('notifications').insert({
      company_id: companyId,
      type:       'campaign_pending_approval',
      title:      'New campaign ready for approval',
      body:       `"${planName}" was generated autonomously and is ready for your review.`,
      metadata:   { pending_campaign_id: pendingId },
      created_at: new Date().toISOString(),
      read:       false,
    });
  } catch (_) { /* non-blocking */ }
}

/** Expire pending campaigns past their expiry date. */
async function expireOldPending(): Promise<number> {
  const { data } = await supabase
    .from('pending_campaigns')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
    .select('id');
  return data?.length ?? 0;
}

/** Find campaigns that just ended (for learning distillation). */
async function getRecentlyCompletedCampaigns(): Promise<Array<{ id: string; company_id: string }>> {
  const since = new Date(Date.now() - 25 * 3600_000).toISOString(); // last 25h
  const { data } = await supabase
    .from('campaigns')
    .select('id, company_id')
    .in('status', ['completed', 'ended'])
    .gte('updated_at', since);
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
    // ── 1. Expire stale pending campaigns ─────────────────────────────────
    result.expired_pending = await expireOldPending();

    // ── 2. Distil learnings from campaigns completed in last 24h ──────────
    const completed = await getRecentlyCompletedCampaigns();
    for (const { id, company_id } of completed) {
      const n = await distilCampaignLearnings(company_id, id).catch(() => 0);
      result.learnings_distilled += n;
    }

    // ── 3. Load all companies with autonomous_mode = true ─────────────────
    const { data: settingsRows } = await supabase
      .from('company_settings')
      .select('company_id, autonomous_mode, approval_required, risk_tolerance')
      .eq('autonomous_mode', true);

    if (!settingsRows?.length) return result;

    for (const row of settingsRows) {
      const companyId      = (row as any).company_id as string;
      const approvalRequired = Boolean((row as any).approval_required ?? true);

      result.companies_evaluated++;

      try {
        const hasActive = await hasActiveCampaign(companyId);
        if (hasActive) continue; // campaign in flight — skip

        // ── Credit gate — skip generation if balance is critically low ─────
        const creditCheck = await hasEnoughCredits(companyId, 'campaign_generation');
        if (!creditCheck.sufficient) {
          result.errors.push(`[${companyId}] Insufficient credits (${creditCheck.balance ?? 0}/${creditCheck.required}) — skipping campaign generation`);
          continue;
        }
        // Warn mode: <20% of a typical campaign budget signals to reduce extras
        const LOW_CREDIT_THRESHOLD = CREDIT_COSTS.campaign_generation * 5; // 250 credits
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
