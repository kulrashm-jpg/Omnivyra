import { ownedDbTable } from '../db/writeOwner';

export interface CompanyExecutionFlags {
  insights: {
    market_trends: boolean;
    competitor_tracking: boolean;
    ai_recommendations: boolean;
  };
  frequency: {
    insights: '1h' | '2h' | '8h';
  };
}

export function defaultCompanyExecutionFlags(): CompanyExecutionFlags {
  return {
    insights: { market_trends: true, competitor_tracking: true, ai_recommendations: true },
    frequency: { insights: '2h' },
  };
}

function rowToCompanyExecutionFlags(row: Record<string, unknown>): CompanyExecutionFlags {
  return {
    insights: {
      market_trends: Boolean(row.insights_market_trends ?? true),
      competitor_tracking: Boolean(row.insights_competitor_tracking ?? true),
      ai_recommendations: Boolean(row.insights_ai_recommendations ?? true),
    },
    frequency: {
      insights: (['1h', '2h', '8h'].includes(row.frequency_insights as string)
        ? (row.frequency_insights as '1h' | '2h' | '8h')
        : '2h'),
    },
  };
}

export async function readCompanyExecutionFlags(companyId: string): Promise<CompanyExecutionFlags | null> {
  const { data } = await ownedDbTable('company_execution_config')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();

  return data ? rowToCompanyExecutionFlags(data as Record<string, unknown>) : null;
}

export async function writeCompanyExecutionFlags(
  companyId: string,
  flags: CompanyExecutionFlags,
): Promise<void> {
  await ownedDbTable('company_execution_config').upsert(
    {
      company_id: companyId,
      insights_market_trends: flags.insights.market_trends,
      insights_competitor_tracking: flags.insights.competitor_tracking,
      insights_ai_recommendations: flags.insights.ai_recommendations,
      frequency_insights: flags.frequency.insights,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id' },
  );
}

export async function readAllCompanyExecutionFlags(): Promise<Map<string, CompanyExecutionFlags>> {
  const out = new Map<string, CompanyExecutionFlags>();
  const { data } = await ownedDbTable('company_execution_config')
    .select('company_id, insights_market_trends, insights_competitor_tracking, insights_ai_recommendations, frequency_insights');

  for (const row of data ?? []) {
    out.set(row.company_id, rowToCompanyExecutionFlags(row as Record<string, unknown>));
  }

  return out;
}
