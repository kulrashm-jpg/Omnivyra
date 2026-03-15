/**
 * Auto Completion Trigger.
 * When all scheduled posts for a campaign are published and no future posts exist,
 * automatically transition execution_status to COMPLETED and emit governance events.
 * Non-blocking. Never throws.
 */

import { supabase } from '../db/supabaseClient';
import { isTerminalExecutionState } from '../governance/ExecutionStateMachine';
import { assertValidExecutionTransition } from '../governance/ExecutionStateMachine';
import { recordGovernanceEvent, recordCampaignCompletedEvent } from './GovernanceEventService';
import { updateStrategyMemoryFromSignals } from './campaignStrategyMemoryService';
import { markThemeConsumedForCampaign } from './companyThemeStateService';

/**
 * Check if campaign is eligible for auto-completion and transition if so.
 * Call after: publish success, schedule execution, post-status update to published.
 * Non-blocking. Never throws.
 */
export async function checkAndCompleteCampaignIfEligible(campaignId: string | null | undefined): Promise<void> {
  if (!campaignId) return;
  try {
    const { data: campaign, error: campError } = await supabase
      .from('campaigns')
      .select('id, execution_status')
      .eq('id', campaignId)
      .maybeSingle();

    if (campError || !campaign) return;
    const executionStatus = String((campaign as any).execution_status ?? 'ACTIVE').toUpperCase();
    if (isTerminalExecutionState(executionStatus as any)) return;

    const nowIso = new Date().toISOString();

    const { data: posts, error: postsError } = await supabase
      .from('scheduled_posts')
      .select('id, status, scheduled_for')
      .eq('campaign_id', campaignId);

    if (postsError || !posts || posts.length === 0) return;

    const total = posts.length;
    const published = posts.filter((p: any) => String(p.status || '').toUpperCase() === 'PUBLISHED').length;
    const hasFuture = posts.some((p: any) => {
      const sf = p.scheduled_for;
      if (!sf) return false;
      try {
        return new Date(sf).getTime() > Date.now();
      } catch {
        return false;
      }
    });

    if (total === 0 || published !== total || hasFuture) return;

    const fromState = executionStatus as any;
    try {
      assertValidExecutionTransition(fromState, 'COMPLETED');
    } catch {
      return;
    }

    const { error: updateError } = await supabase
      .from('campaigns')
      .update({
        execution_status: 'COMPLETED',
        updated_at: nowIso,
      })
      .eq('id', campaignId);

    if (updateError) {
      console.error('CampaignCompletionService: failed to update execution_status', updateError);
      return;
    }

    const { data: cv } = await supabase
      .from('campaign_versions')
      .select('company_id')
      .eq('campaign_id', campaignId)
      .limit(1)
      .maybeSingle();

    const companyId = (cv as any)?.company_id ?? null;
    if (companyId) {
      markThemeConsumedForCampaign(campaignId).catch((err) =>
        console.warn('CampaignCompletionService: markThemeConsumedForCampaign failed', err)
      );
      updateStrategyMemoryFromSignals(companyId, campaignId).catch((err) =>
        console.warn('CampaignCompletionService: updateStrategyMemoryFromSignals failed', err)
      );
      await recordGovernanceEvent({
        companyId,
        campaignId,
        eventType: 'EXECUTION_STATE_TRANSITION',
        eventStatus: 'TRANSITIONED',
        metadata: { campaignId, from: fromState, to: 'COMPLETED' },
      });
      await recordCampaignCompletedEvent({
        companyId,
        campaignId,
        completedAt: nowIso,
        totalScheduledPosts: total,
      });
    }
  } catch (err) {
    console.error('CampaignCompletionService: checkAndCompleteCampaignIfEligible failed', err);
  }
}
