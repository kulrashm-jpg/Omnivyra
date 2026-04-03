import { supabase } from '../db/supabaseClient';
import type { DecisionReportTier, PersistedDecisionObject } from './decisionObjectService';

export interface IntelligenceUnit {
  id: string;
  name: string;
  category: string;
  decision_types: string[];
  required_entities: string[];
  cost_weight: number;
  report_tiers: DecisionReportTier[];
}

export interface CompanyIntelligenceUnitConfig {
  company_id: string;
  iu_id: string;
  enabled: boolean;
  priority_override: number | null;
}

export type IntelligenceUnitWithConfig = IntelligenceUnit & {
  enabled: boolean;
  priority_override: number | null;
};

export const DEFAULT_INTELLIGENCE_UNITS: IntelligenceUnit[] = [
  {
    id: 'IU-01',
    name: 'Traffic Intelligence',
    category: 'traffic',
    decision_types: ['low_quality_traffic', 'wrong_geo_traffic', 'channel_mismatch'],
    required_entities: ['canonical_sessions', 'canonical_users', 'canonical_page_views'],
    cost_weight: 1.25,
    report_tiers: ['growth', 'deep'],
  },
  {
    id: 'IU-02',
    name: 'Funnel Intelligence',
    category: 'funnel',
    decision_types: ['high_dropoff_page', 'weak_conversion_path', 'dead_end_pages'],
    required_entities: ['canonical_page_views', 'canonical_pages'],
    cost_weight: 1.15,
    report_tiers: ['deep'],
  },
  {
    id: 'IU-03',
    name: 'SEO Intelligence',
    category: 'seo',
    decision_types: ['seo_gap', 'ranking_gap', 'impression_click_gap', 'ranking_opportunity', 'keyword_decay', 'keyword_opportunity'],
    required_entities: ['canonical_keywords', 'keyword_metrics'],
    cost_weight: 0.95,
    report_tiers: ['snapshot', 'growth'],
  },
  {
    id: 'IU-04',
    name: 'Content Authority',
    category: 'content',
    decision_types: ['topic_gap', 'weak_content_depth', 'missing_cluster_support', 'weak_cluster_depth', 'missing_supporting_content', 'content_gap'],
    required_entities: ['canonical_pages', 'page_content', 'page_links'],
    cost_weight: 1.1,
    report_tiers: ['growth', 'deep'],
  },
  {
    id: 'IU-05',
    name: 'Revenue Intelligence',
    category: 'revenue',
    decision_types: ['low_quality_lead', 'high_dropoff_lead', 'unqualified_lead_source', 'high_value_source', 'low_conversion_source', 'revenue_leak'],
    required_entities: ['canonical_leads', 'canonical_revenue_events', 'leads'],
    cost_weight: 1.4,
    report_tiers: ['deep'],
  },
  {
    id: 'IU-06',
    name: 'Conversion Quality',
    category: 'conversion',
    decision_types: ['low_quality_lead', 'high_dropoff_lead', 'unqualified_lead_source', 'high_dropoff_page', 'weak_conversion_path'],
    required_entities: ['canonical_leads', 'canonical_revenue_events', 'canonical_page_views', 'canonical_pages'],
    cost_weight: 1.3,
    report_tiers: ['deep'],
  },
  {
    id: 'IU-07',
    name: 'Engagement Depth',
    category: 'engagement',
    decision_types: ['low_quality_traffic', 'weak_content_depth', 'missing_cluster_support', 'weak_cluster_depth', 'dead_end_pages'],
    required_entities: ['canonical_sessions', 'canonical_pages', 'page_content', 'page_links'],
    cost_weight: 1.1,
    report_tiers: ['growth', 'deep'],
  },
  {
    id: 'IU-08',
    name: 'Behavioral Patterns',
    category: 'behavior',
    decision_types: ['channel_mismatch', 'wrong_geo_traffic', 'high_dropoff_lead', 'low_conversion_source'],
    required_entities: ['canonical_sessions', 'canonical_leads', 'canonical_revenue_events'],
    cost_weight: 1.0,
    report_tiers: ['growth', 'deep'],
  },
  {
    id: 'IU-09',
    name: 'Channel Effectiveness',
    category: 'channel',
    decision_types: ['low_quality_traffic', 'wrong_geo_traffic', 'channel_mismatch', 'unqualified_lead_source', 'low_conversion_source'],
    required_entities: ['canonical_sessions', 'canonical_leads', 'canonical_revenue_events'],
    cost_weight: 1.2,
    report_tiers: ['growth', 'deep'],
  },
  {
    id: 'IU-10',
    name: 'Journey Analysis',
    category: 'journey',
    decision_types: ['high_dropoff_page', 'dead_end_pages', 'weak_conversion_path', 'revenue_leak'],
    required_entities: ['canonical_page_views', 'canonical_pages', 'canonical_leads', 'canonical_revenue_events'],
    cost_weight: 1.15,
    report_tiers: ['deep'],
  },
  {
    id: 'IU-11',
    name: 'Opportunity Signals',
    category: 'opportunity',
    decision_types: ['high_value_source', 'ranking_opportunity', 'keyword_opportunity', 'missing_supporting_content', 'topic_gap'],
    required_entities: ['canonical_keywords', 'keyword_metrics', 'canonical_leads', 'canonical_pages', 'page_content'],
    cost_weight: 1.05,
    report_tiers: ['growth'],
  },
  {
    id: 'IU-12',
    name: 'Risk Signals',
    category: 'risk',
    decision_types: ['low_quality_traffic', 'low_quality_lead', 'keyword_decay', 'seo_gap', 'content_gap'],
    required_entities: ['canonical_sessions', 'canonical_keywords', 'keyword_metrics', 'canonical_pages', 'page_content'],
    cost_weight: 1.15,
    report_tiers: ['snapshot', 'growth'],
  },
  {
    id: 'IU-13',
    name: 'Growth Levers',
    category: 'growth',
    decision_types: ['ranking_opportunity', 'keyword_opportunity', 'missing_cluster_support', 'missing_supporting_content', 'topic_gap'],
    required_entities: ['canonical_keywords', 'keyword_metrics', 'canonical_pages', 'page_content', 'page_links'],
    cost_weight: 1.1,
    report_tiers: ['growth'],
  },
  {
    id: 'IU-14',
    name: 'Efficiency Signals',
    category: 'efficiency',
    decision_types: ['high_dropoff_page', 'dead_end_pages', 'channel_mismatch', 'impression_click_gap'],
    required_entities: ['canonical_page_views', 'canonical_pages', 'canonical_sessions', 'canonical_keywords', 'keyword_metrics'],
    cost_weight: 1.05,
    report_tiers: ['growth', 'deep'],
  },
  {
    id: 'IU-15',
    name: 'Strategic Insights',
    category: 'strategic',
    decision_types: ['seo_gap', 'ranking_gap', 'content_gap', 'high_value_source', 'revenue_leak', 'weak_cluster_depth'],
    required_entities: ['canonical_keywords', 'keyword_metrics', 'canonical_pages', 'page_content', 'canonical_leads', 'canonical_revenue_events'],
    cost_weight: 1.2,
    report_tiers: ['snapshot', 'growth', 'deep'],
  },
];

async function listIntelligenceUnits(): Promise<IntelligenceUnit[]> {
  const { data, error } = await supabase
    .from('intelligence_units')
    .select('id, name, category, decision_types, required_entities, cost_weight, report_tiers')
    .order('id');

  if (error) {
    if (error.message.includes(`Could not find the table 'public.intelligence_units'`)) {
      return DEFAULT_INTELLIGENCE_UNITS;
    }
    throw new Error(`Failed to load intelligence units: ${error.message}`);
  }

  return (data ?? []) as IntelligenceUnit[];
}

async function listCompanyConfig(companyId: string): Promise<CompanyIntelligenceUnitConfig[]> {
  const { data, error } = await supabase
    .from('company_intelligence_config')
    .select('company_id, iu_id, enabled, priority_override')
    .eq('company_id', companyId);

  if (error) {
    if (error.message.includes(`Could not find the table 'public.company_intelligence_config'`)) {
      return [];
    }
    throw new Error(`Failed to load company intelligence config for ${companyId}: ${error.message}`);
  }

  return (data ?? []) as CompanyIntelligenceUnitConfig[];
}

export async function listCompanyIntelligenceUnits(companyId: string): Promise<IntelligenceUnitWithConfig[]> {
  const [units, config] = await Promise.all([
    listIntelligenceUnits(),
    listCompanyConfig(companyId),
  ]);

  const configByUnitId = new Map(config.map((item) => [item.iu_id, item]));

  return units.map((unit) => {
    const configured = configByUnitId.get(unit.id);
    return {
      ...unit,
      enabled: configured?.enabled ?? true,
      priority_override: configured?.priority_override ?? null,
    };
  });
}

export async function setCompanyIntelligenceUnitConfig(input: {
  companyId: string;
  iuId: string;
  enabled: boolean;
  priorityOverride?: number | null;
}): Promise<CompanyIntelligenceUnitConfig> {
  const payload = {
    company_id: input.companyId,
    iu_id: input.iuId,
    enabled: input.enabled,
    priority_override: input.priorityOverride ?? null,
  };

  const { data, error } = await supabase
    .from('company_intelligence_config')
    .upsert(payload, { onConflict: 'company_id,iu_id' })
    .select('company_id, iu_id, enabled, priority_override')
    .single();

  if (error) {
    throw new Error(`Failed to update company intelligence config: ${error.message}`);
  }

  return data as CompanyIntelligenceUnitConfig;
}

export function mapDecisionToIntelligenceUnit(
  decision: Pick<PersistedDecisionObject, 'issue_type' | 'report_tier'>,
  units: IntelligenceUnitWithConfig[]
): IntelligenceUnitWithConfig | null {
  for (const unit of units) {
    if (!unit.enabled) continue;
    if (!unit.report_tiers.includes(decision.report_tier)) continue;
    if (unit.decision_types.includes(decision.issue_type)) return unit;
  }

  return null;
}
