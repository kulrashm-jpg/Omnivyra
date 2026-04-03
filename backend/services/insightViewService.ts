import { z } from 'zod';
import { supabase } from '../db/supabaseClient';
import type { PersistedDecisionObject } from './decisionObjectService';
import { assertDecisionArray } from './decisionRuntimeGuardService';
import { assertApiReadContext } from './intelligenceExecutionContext';

const DecisionFeatureViewNameSchema = z.enum([
  'campaign_insights_view',
  'engagement_insights_view',
  'lead_intelligence_view',
  'content_opportunities_view',
]);

const MarketPulseRowSchema = z.object({
  company_id: z.string().uuid(),
  pulse_key: z.string(),
  issue_type: z.string(),
  action_type: z.string(),
  decision_count: z.coerce.number(),
  avg_impact_traffic: z.coerce.number(),
  avg_impact_conversion: z.coerce.number(),
  avg_impact_revenue: z.coerce.number(),
  avg_confidence_score: z.coerce.number(),
  max_execution_score: z.coerce.number(),
  latest_decision_at: z.string(),
});

export type DecisionFeatureViewName = z.infer<typeof DecisionFeatureViewNameSchema>;
export type MarketPulseRow = z.infer<typeof MarketPulseRowSchema>;

export async function listDecisionFeatureView(params: {
  viewName: DecisionFeatureViewName;
  companyId: string;
  limit?: number;
  status?: Array<'open' | 'resolved' | 'ignored'>;
}): Promise<PersistedDecisionObject[]> {
  assertApiReadContext('insightViewService.listDecisionFeatureView');

  const parsedViewName = DecisionFeatureViewNameSchema.parse(params.viewName);
  let query = supabase
    .from(parsedViewName)
    .select('*')
    .eq('company_id', params.companyId)
    .order('execution_score', { ascending: false })
    .order('priority_score', { ascending: false })
    .order('impact_revenue', { ascending: false })
    .limit(params.limit ?? 50);

  if (params.status?.length) {
    query = query.in('status', params.status);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to read ${parsedViewName}: ${error.message}`);
  }

  return assertDecisionArray('insightViewService.listDecisionFeatureView', (data ?? []) as PersistedDecisionObject[]);
}

export async function listMarketPulseView(params: {
  companyId: string;
  limit?: number;
}): Promise<MarketPulseRow[]> {
  assertApiReadContext('insightViewService.listMarketPulseView');

  const { data, error } = await supabase
    .from('market_pulse_view')
    .select('*')
    .eq('company_id', params.companyId)
    .order('max_execution_score', { ascending: false })
    .order('avg_impact_revenue', { ascending: false })
    .limit(params.limit ?? 25);

  if (error) {
    throw new Error(`Failed to read market_pulse_view: ${error.message}`);
  }

  const parsed = z.array(MarketPulseRowSchema).safeParse(data ?? []);
  if (!parsed.success) {
    throw new Error('insightViewService.listMarketPulseView returned non-view output.');
  }

  return parsed.data;
}
