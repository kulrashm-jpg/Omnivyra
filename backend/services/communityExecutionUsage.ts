/**
 * Plan usage of a community engagement send: METERING (ledger event + monthly meter) and the A20
 * usage RESERVATION it settles.
 *
 * recordCommunityExecutionUsage - moved verbatim from communityAiActionExecutorRuntime (recordUsage);
 *   the executor meters a synchronous send (executed / sent_unverified) with it.
 * settleBrowserDispatchUsage - a BROWSER-dispatched send finishes later, in the extension's
 *   action-result route, which never metered it (e9 2026-11-12: plan usage under-counted every
 *   extension send) and never released its A20 reservation (it then counted for its full 24 h TTL,
 *   and - once metered - would count TWICE). Now, on the action's first terminal transition:
 *     executed / sent_unverified -> meter it, THEN release the reservation (never a gap where neither
 *                                   counts);
 *     failed                     -> release (the extension reports nothing was sent; a post-submit
 *                                   failure is 'uncertain', never 'failed');
 *     uncertain                  -> keep: it may have acted, a human reconciles, the TTL bounds it.
 * Never throws: it runs AFTER a real send, and a throw there could make a caller retry into a second.
 */
import { logUsageEvent } from './usageLedgerService';
import { incrementUsageMeter } from './usageMeterService';
import { releaseUsageReservationForAction } from './usageEnforcementService';

type UsageAction = { id: string; organization_id: string; platform: string; action_type: string };

export const recordCommunityExecutionUsage = async (action: UsageAction) => {
  try {
    await logUsageEvent({
      organization_id: action.organization_id,
      campaign_id: null,
      user_id: null,
      source_type: 'automation_execution',
      provider_name: action.platform,
      model_name: null,
      model_version: null,
      source_name: `${action.platform}:${action.action_type}`,
      process_type: 'community_execution',
      metadata: { action_id: action.id },
    });
  } catch (error: any) {
    console.warn('COMMUNITY_AI_USAGE_LOG_FAILED', error?.message || error);
  }
  try {
    await incrementUsageMeter({
      organization_id: action.organization_id,
      source_type: 'automation_execution',
    });
  } catch (error: any) {
    console.warn('COMMUNITY_AI_USAGE_METER_FAILED', error?.message || error);
  }
};

export async function settleBrowserDispatchUsage(input: {
  actionId: string;
  organizationId: string;
  platform: string | null;
  actionType: string | null;
  finalStatus: 'executed' | 'sent_unverified' | 'failed' | 'uncertain';
}): Promise<void> {
  try {
    if (input.finalStatus === 'uncertain') return;
    if (input.finalStatus === 'executed' || input.finalStatus === 'sent_unverified') {
      await recordCommunityExecutionUsage({
        id: input.actionId,
        organization_id: input.organizationId,
        platform: input.platform ?? 'unknown',
        action_type: input.actionType ?? 'unknown',
      });
    }
    await releaseUsageReservationForAction(input.organizationId, input.actionId);
  } catch (error: any) {
    console.error('COMMUNITY_BROWSER_USAGE_SETTLE_FAILED', { action_id: input.actionId, error: error?.message ?? String(error) });
  }
}
