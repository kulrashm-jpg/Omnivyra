import { supabase } from './supabaseClient';

export async function savePlatformExecutionPlan(input: {
  companyId: string;
  campaignId?: string;
  weekNumber: number;
  planJson: any;
}): Promise<void> {
  const payload = {
    company_id: input.companyId,
    campaign_id: input.campaignId ?? null,
    week_number: input.weekNumber,
    plan_json: input.planJson,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('platform_execution_plans').insert(payload);
  if (error) {
    throw new Error(`Failed to save platform execution plan: ${error.message}`);
  }
}

export async function getLatestPlatformExecutionPlan(input: {
  companyId: string;
  campaignId?: string;
  weekNumber: number;
}): Promise<any | null> {
  let query = supabase
    .from('platform_execution_plans')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('week_number', input.weekNumber);
  if (input.campaignId) {
    query = query.eq('campaign_id', input.campaignId);
  }
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).single();
  if (error) {
    return null;
  }
  return data;
}

export async function saveSchedulerJobs(input: {
  companyId: string;
  campaignId?: string;
  weekNumber: number;
  jobs: any[];
}): Promise<void> {
  if (!input.jobs || input.jobs.length === 0) return;
  const payload = input.jobs.map((job) => ({
    company_id: input.companyId,
    campaign_id: input.campaignId ?? null,
    week_number: input.weekNumber,
    platform: job.platform,
    scheduled_at: job.scheduledAt,
    status: job.status ?? 'pending',
    payload_json: job,
    created_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from('scheduler_jobs').insert(payload);
  if (error) {
    throw new Error(`Failed to save scheduler jobs: ${error.message}`);
  }
}
