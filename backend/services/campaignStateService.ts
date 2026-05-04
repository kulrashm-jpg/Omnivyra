import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import {
  assertValidExecutionTransition,
  normalizeExecutionState,
  type CampaignExecutionState,
} from '../governance/ExecutionStateMachine';

export async function transitionCampaignState(
  campaignId: string,
  to: CampaignExecutionState,
  metadata: Record<string, unknown> = {},
): Promise<CampaignExecutionState> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('execution_status')
    .eq('id', campaignId)
    .maybeSingle();
  if (error || !data) throw new Error('Campaign not found');

  const from = normalizeExecutionState((data as any).execution_status);
  assertValidExecutionTransition(from, to);

  const { error: updateError } = await supabase
    .from('campaigns')
    .update({
      execution_status: to,
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaignId)
    .eq('execution_status', from);
  if (updateError) throw new Error(`Failed to transition campaign state: ${updateError.message}`);

  console.info(JSON.stringify({
    event: 'campaign_state_transition',
    campaign_id: campaignId,
    from,
    to,
    metadata,
  }));
  return to;
}

export const transition = transitionCampaignState;

export async function ensureCampaignState(
  campaignId: string,
  allowed: CampaignExecutionState[],
): Promise<CampaignExecutionState> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('execution_status')
    .eq('id', campaignId)
    .maybeSingle();
  if (error || !data) throw new Error('Campaign not found');
  const state = normalizeExecutionState((data as any).execution_status);
  if (!allowed.includes(state)) {
    throw new Error(`Invalid campaign execution state: ${state}`);
  }
  return state;
}
