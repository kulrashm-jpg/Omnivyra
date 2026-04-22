import { supabase } from '../db/supabaseClient';

export class CreatorExecutionRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreatorExecutionRateLimitError';
  }
}

export async function assertCreatorExecutionWithinRateLimits(input: {
  campaignId: string;
  userId: string;
}): Promise<void> {
  const now = Date.now();
  const sinceIso = new Date(now - 60_000).toISOString();
  const perCampaignLimit = Math.max(10, Number(process.env.CREATOR_CAMPAIGN_RATE_LIMIT_PER_MINUTE || 60));
  const perUserLimit = Math.max(10, Number(process.env.CREATOR_USER_RATE_LIMIT_PER_MINUTE || 120));
  const globalExecutionBudget = Math.max(1, Number(process.env.CREATOR_CAMPAIGN_CONCURRENT_EXECUTION_BUDGET || 5));

  const [
    { count: campaignCount, error: campaignError },
    { count: userCount, error: userError },
    { count: activeExecutionCount, error: activeExecutionError },
  ] = await Promise.all([
    supabase
      .from('creator_execution_audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', input.campaignId)
      .eq('stage', 'intent')
      .gte('created_at', sinceIso),
    supabase
      .from('creator_execution_audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', input.userId)
      .eq('stage', 'intent')
      .gte('created_at', sinceIso),
    supabase
      .from('daily_content_plans')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', input.campaignId)
      .not('locked_by', 'is', null)
      .gt('lease_expires_at', new Date().toISOString()),
  ]);

  if (campaignError) {
    throw new CreatorExecutionRateLimitError(`Failed to enforce creator campaign rate limit: ${campaignError.message}`);
  }
  if (userError) {
    throw new CreatorExecutionRateLimitError(`Failed to enforce creator user rate limit: ${userError.message}`);
  }
  if (activeExecutionError) {
    throw new CreatorExecutionRateLimitError(`Failed to enforce creator execution budget: ${activeExecutionError.message}`);
  }
  if (Number(campaignCount ?? 0) >= perCampaignLimit) {
    throw new CreatorExecutionRateLimitError(`Creator campaign rate limit exceeded for campaign ${input.campaignId}`);
  }
  if (Number(userCount ?? 0) >= perUserLimit) {
    throw new CreatorExecutionRateLimitError(`Creator user rate limit exceeded for user ${input.userId}`);
  }
  if (Number(activeExecutionCount ?? 0) >= globalExecutionBudget) {
    throw new CreatorExecutionRateLimitError(`Creator execution budget exceeded for campaign ${input.campaignId}`);
  }
}
