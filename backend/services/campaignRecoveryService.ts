/**
 * Campaign Recovery Service — Step 8
 *
 * When a CRITICAL campaign cannot recover through optimization adjustments,
 * it is paused and a recovery campaign is generated as a replacement.
 *
 * Recovery campaign strategy:
 *   - Switch to highest-performing platform from learnings
 *   - Drop underperforming content types
 *   - Use conservative posting frequency
 *   - Short 4-week duration (rapid test)
 */

import { supabase } from '../db/supabaseClient';
import { getTopLearnings } from './campaignLearningsStore';
import { rankPlatformsByPerformance } from './platformPerformanceRanker';
import { logDecision } from './autonomousDecisionLogger';

export type RecoveryResult = {
  original_campaign_id: string;
  recovery_pending_id: string | null;
  reason: string;
};

/** Get company_id and name for a campaign. */
async function getCampaignMeta(campaignId: string): Promise<{ company_id: string; name: string } | null> {
  const { data } = await supabase
    .from('campaigns')
    .select('company_id, name')
    .eq('id', campaignId)
    .maybeSingle();
  return data as { company_id: string; name: string } | null;
}

/**
 * Pause a campaign and generate a recovery campaign.
 * The recovery campaign is stored in pending_campaigns for immediate review.
 */
export async function generateRecoveryCampaign(
  campaignId: string,
  pauseReason: string,
): Promise<RecoveryResult> {
  const result: RecoveryResult = {
    original_campaign_id: campaignId,
    recovery_pending_id:  null,
    reason:               pauseReason,
  };

  const meta = await getCampaignMeta(campaignId);
  if (!meta) return result;

  const { company_id: companyId } = meta;

  // ── Gather intelligence for recovery plan ─────────────────────────────────
  const [platformRanks, successLearnings] = await Promise.all([
    rankPlatformsByPerformance(campaignId),
    getTopLearnings(companyId, { learning_type: 'success', limit: 5 }),
  ]);

  // Pick top platform from current ranking or fall back to LinkedIn
  const topPlatform = platformRanks[0]?.platform ?? 'linkedin';

  // Exclude content types that failed
  const failureLearnings = await getTopLearnings(companyId, { learning_type: 'failure', limit: 5 });
  const failedContentTypes = new Set(
    failureLearnings
      .filter(l => l.content_type)
      .map(l => l.content_type as string)
  );

  const safeContentMix: Record<string, number> = {};
  if (!failedContentTypes.has('post'))     safeContentMix['post']     = 60;
  if (!failedContentTypes.has('carousel')) safeContentMix['carousel'] = 40;
  if (Object.keys(safeContentMix).length === 0) safeContentMix['post'] = 100;

  // Normalise content mix to 100%
  const total = Object.values(safeContentMix).reduce((s, v) => s + v, 0);
  for (const k of Object.keys(safeContentMix)) {
    safeContentMix[k] = Math.round((safeContentMix[k] / total) * 100);
  }

  const recoveryPlan = {
    company_id: companyId,
    name:       `Recovery Campaign — ${new Date().toLocaleDateString('en-GB')}`,
    description: [
      `Recovery campaign after "${meta.name}" was paused due to: ${pauseReason}.`,
      `Focusing on ${topPlatform} which showed best engagement.`,
      successLearnings.length > 0
        ? `Applying learnings: ${successLearnings.slice(0, 2).map(l => l.pattern).join('; ')}`
        : '',
    ].filter(Boolean).join(' '),
    platforms:         [topPlatform],
    posting_frequency: { [topPlatform]: 3 },
    content_mix:       safeContentMix,
    duration_weeks:    4,  // short recovery sprint
    campaign_goal:     'Re-establish audience engagement with proven content patterns',
    generation_meta: {
      generated_by:          'recovery_agent',
      generated_at:          new Date().toISOString(),
      based_on_campaign_id:  campaignId,
      pause_reason:          pauseReason,
      top_platform:          topPlatform,
      failed_content_types:  Array.from(failedContentTypes),
    },
  };

  // Store as pending_campaign for immediate review
  try {
    const { data, error } = await supabase.from('pending_campaigns').insert({
      company_id:      companyId,
      campaign_plan:   recoveryPlan,
      generation_meta: recoveryPlan.generation_meta,
      status:          'pending',
      expires_at:      new Date(Date.now() + 3 * 86400_000).toISOString(), // 3-day window
      created_at:      new Date().toISOString(),
    }).select('id').maybeSingle();

    if (error) throw new Error(error.message);
    result.recovery_pending_id = (data as { id: string }).id;

    // Notify user
    await supabase.from('notifications').insert({
      company_id: companyId,
      type:       'campaign_recovery_generated',
      title:      'Recovery campaign ready',
      body:       `"${meta.name}" was paused. A recovery campaign has been generated and is ready for your review.`,
      metadata:   {
        paused_campaign_id:   campaignId,
        pending_campaign_id:  result.recovery_pending_id,
        pause_reason:         pauseReason,
      },
      created_at: new Date().toISOString(),
      read:       false,
    });

    await logDecision({
      company_id:    companyId,
      campaign_id:   campaignId,
      decision_type: 'recover',
      reason:        `Generated recovery campaign after pause: ${pauseReason}`,
      metrics_used:  {
        top_platform:         topPlatform,
        content_mix:          safeContentMix,
        failed_content_types: Array.from(failedContentTypes),
      },
      outcome: `Recovery campaign stored as pending: ${result.recovery_pending_id}`,
    });
  } catch (err) {
    console.warn('[campaignRecoveryService] Failed to generate recovery campaign', err);
  }

  return result;
}
