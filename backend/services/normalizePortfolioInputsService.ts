import { supabase } from '../db/supabaseClient';
import { aggregateCampaignPerformance } from './performanceFeedbackService';

export type NormalizedPortfolioCampaign = {
  campaign_id: string;
  campaign_name: string;
  engagement_rate: number;
  status: string;
};

export async function loadNormalizedPortfolioInputs(companyId: string): Promise<NormalizedPortfolioCampaign[]> {
  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select('id, name, status')
    .eq('company_id', companyId)
    .in('status', ['active', 'scheduled', 'execution_ready', 'twelve_week_plan']);

  if (error) {
    throw new Error(`Failed to load campaigns for portfolio normalization: ${error.message}`);
  }

  const rows = (campaigns ?? []) as Array<{ id: string; name: string; status: string }>;
  const scored = await Promise.all(
    rows.map(async (row) => {
      const perf = await aggregateCampaignPerformance(row.id).catch(() => null);
      return {
        campaign_id: row.id,
        campaign_name: row.name,
        engagement_rate: Number(perf?.engagement_rate ?? 0),
        status: String(row.status || '').toLowerCase(),
      };
    })
  );

  return scored;
}
