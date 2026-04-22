import { supabase } from '../db/supabaseClient';

export async function getLatestCampaignPlanVersion(campaignId: string): Promise<number> {
  const { data } = await supabase
    .from('campaign_versions')
    .select('version')
    .eq('campaign_id', campaignId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  return Number((data as any)?.version ?? 1);
}

export function isStalePlanVersion(input: {
  current: number | null | undefined;
  latest: number;
}): boolean {
  return Number(input.current ?? 0) > 0 && Number(input.current) < input.latest;
}
