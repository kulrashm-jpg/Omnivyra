export type DecisionTypeCategory =
  | 'performance'
  | 'governance'
  | 'execution'
  | 'content_strategy'
  | 'market'
  | 'distribution'
  | 'authority'
  | 'trust'
  | 'geo'
  | 'velocity'
  | 'risk'
  | 'opportunity';

export type DecisionTypeMetadata = {
  category: DecisionTypeCategory;
  description: string;
};

export const DECISION_TYPE_TAXONOMY_VERSION = '2026-03-30.v1';

const DECISION_TYPE_REGISTRY: Record<string, DecisionTypeMetadata> = {
  advanced_revenue_gap: { category: 'performance', description: 'Revenue attribution indicates actionable leakage.' },
  allocation_gap: { category: 'performance', description: 'Budget allocation does not match performance concentration.' },
  authority_deficit: { category: 'authority', description: 'Authority signals are insufficient versus demand potential.' },
  authority_gap: { category: 'authority', description: 'Domain authority progression is constrained.' },
  backlink_gap: { category: 'authority', description: 'Backlink footprint does not support ranking goals.' },
  brand_trust_gap: { category: 'trust', description: 'Brand trust baseline is below required confidence levels.' },
  cta_clarity_gap: { category: 'execution', description: 'Call-to-action path lacks clarity for users.' },
  channel_mismatch: { category: 'distribution', description: 'Traffic source and destination intent are misaligned.' },
  competitor_backlink_advantage: { category: 'authority', description: 'Competitors show stronger backlink authority momentum.' },
  competitor_content_gap: { category: 'content_strategy', description: 'Competitor content depth is greater in key areas.' },
  competitor_dominance: { category: 'market', description: 'Competitor share of demand or attention is dominant.' },
  competitor_gap: { category: 'market', description: 'Competitor capability gap is affecting outcomes.' },
  content_discussion_strength: { category: 'content_strategy', description: 'Discussion-driving content pattern is outperforming.' },
  content_gap: { category: 'content_strategy', description: 'Content supply or quality does not satisfy intent.' },
  conversion_intent_gap: { category: 'performance', description: 'Intentful traffic is not converting as expected.' },
  credibility_gap: { category: 'trust', description: 'Proof points and credibility signals are insufficient.' },
  dead_end_pages: { category: 'execution', description: 'Pages terminate user flow without next-step progression.' },
  demand_opportunity: { category: 'opportunity', description: 'Demand signal indicates a capture opportunity.' },
  distribution_inefficiency: { category: 'distribution', description: 'Distribution effort is yielding poor efficiency.' },
  engagement_drop: { category: 'risk', description: 'Engagement performance is declining materially.' },
  engagement_opportunity: { category: 'opportunity', description: 'Engagement conditions support an expansion move.' },
  execution_delay: { category: 'velocity', description: 'Decision execution latency is reducing value realization.' },
  forecast_confidence_gap: { category: 'governance', description: 'Forecast confidence is not sufficient for scale decisions.' },
  geo_expansion_opportunity: { category: 'geo', description: 'Secondary geos show stronger growth economics.' },
  geo_gap: { category: 'geo', description: 'Regional performance indicates a strategic geography gap.' },
  geo_mismatch: { category: 'geo', description: 'Dominant geo traffic does not align with engagement quality.' },
  geo_opportunity: { category: 'geo', description: 'Regional signal indicates viable expansion opportunity.' },
  high_dropoff_lead: { category: 'execution', description: 'Lead progression is stalling before conversion.' },
  high_dropoff_page: { category: 'execution', description: 'Page-level flow exhibits high exit/drop-off behavior.' },
  high_revenue_driver: { category: 'performance', description: 'A source/channel is generating outsized revenue.' },
  high_value_source: { category: 'performance', description: 'Lead source is delivering strong downstream value.' },
  impression_click_gap: { category: 'performance', description: 'Search impressions are not translating into clicks.' },
  intent_gap: { category: 'market', description: 'User intent profile does not match current offer/content.' },
  keyword_decay: { category: 'risk', description: 'Previously performing keyword trend is decaying.' },
  keyword_opportunity: { category: 'opportunity', description: 'Keyword momentum indicates a growth window.' },
  learning_loop_not_applied: { category: 'governance', description: 'Closed-loop learning is not applied in operations.' },
  localized_content_gap: { category: 'geo', description: 'Localized content does not match regional demand.' },
  low_conversion_source: { category: 'performance', description: 'Source traffic converts at low efficiency.' },
  low_quality_lead: { category: 'performance', description: 'Lead quality is below qualification threshold.' },
  low_quality_traffic: { category: 'performance', description: 'Traffic quality is below engagement/conversion viability.' },
  low_roi_channel: { category: 'performance', description: 'Channel ROI is below acceptable benchmark.' },
  market_opportunity: { category: 'opportunity', description: 'Market conditions indicate exploitable upside.' },
  market_shift: { category: 'market', description: 'External market behavior has shifted meaningfully.' },
  missed_market_capture: { category: 'market', description: 'Addressable capture is being lost to alternatives.' },
  missed_opportunity_due_to_lag: { category: 'velocity', description: 'Execution lag caused opportunity loss.' },
  missing_cluster_support: { category: 'content_strategy', description: 'Primary cluster lacks supporting assets.' },
  missing_supporting_content: { category: 'content_strategy', description: 'Supporting content inventory is incomplete.' },
  negative_roi_risk: { category: 'risk', description: 'Current economics suggest negative ROI risk.' },
  negative_sentiment_risk: { category: 'trust', description: 'Negative sentiment trajectory threatens performance.' },
  opportunity_activation_gap: { category: 'opportunity', description: 'Detected opportunities are not being activated.' },
  platform_fit_gap: { category: 'distribution', description: 'Platform mix is not aligned to offer and audience.' },
  platform_mismatch: { category: 'distribution', description: 'Current platform emphasis is mismatched to outcomes.' },
  platform_performance_gap: { category: 'performance', description: 'Platform performance variance indicates optimization gap.' },
  publishing_failure_risk: { category: 'risk', description: 'Publishing pipeline reliability is at risk.' },
  ranking_gap: { category: 'performance', description: 'Keyword ranking is too low to capture traffic.' },
  ranking_opportunity: { category: 'opportunity', description: 'Ranking is within striking range for uplift.' },
  regional_mismatch: { category: 'geo', description: 'Regional channel/content strategy is mismatched.' },
  revenue_leak: { category: 'performance', description: 'Revenue is leaking in pipeline progression.' },
  revenue_leak_path: { category: 'performance', description: 'Specific journey path is leaking monetizable value.' },
  roi_inefficiency: { category: 'performance', description: 'Spend-to-return efficiency is below target.' },
  seo_gap: { category: 'performance', description: 'SEO coverage or quality gap is suppressing growth.' },
  sentiment_risk: { category: 'trust', description: 'Sentiment trajectory poses trust and conversion risk.' },
  slow_response_risk: { category: 'velocity', description: 'Response latency increases downside risk.' },
  spend_misalignment: { category: 'performance', description: 'Spend levels are misaligned with decision evidence.' },
  strategic_market_opportunity: { category: 'opportunity', description: 'Strategic market expansion or capture opportunity exists.' },
  topic_gap: { category: 'content_strategy', description: 'Coverage gap in high-value thematic area.' },
  trust_gap: { category: 'trust', description: 'Trust signals are insufficient for conversion confidence.' },
  unqualified_lead_source: { category: 'performance', description: 'Lead source generates weak-fit prospects.' },
  weak_backlink_profile: { category: 'authority', description: 'Backlink profile lacks quality/diversity.' },
  weak_brand_presence: { category: 'trust', description: 'Brand presence and advocacy are insufficient.' },
  weak_cluster_depth: { category: 'content_strategy', description: 'Content cluster depth is below competitive level.' },
  weak_content_depth: { category: 'content_strategy', description: 'Content depth does not satisfy user need.' },
  weak_conversion_path: { category: 'execution', description: 'Conversion path has friction and weak directional flow.' },
  wrong_geo_traffic: { category: 'geo', description: 'Traffic geography is mismatched to target outcomes.' },
  community_trust_gap: { category: 'trust', description: 'Community discourse reveals trust weakness.' },
};

export function listAllowedDecisionTypes(): string[] {
  return Object.keys(DECISION_TYPE_REGISTRY).sort();
}

export function getDecisionTypeMetadata(decisionType: string): DecisionTypeMetadata | null {
  const key = String(decisionType || '').trim();
  if (!key) return null;
  return DECISION_TYPE_REGISTRY[key] ?? null;
}

export function isAllowedDecisionType(decisionType: string): boolean {
  return Boolean(getDecisionTypeMetadata(decisionType));
}

export function assertAllowedDecisionType(decisionType: string, sourceService: string): void {
  const normalized = String(decisionType || '').trim();
  if (!normalized) {
    throw new Error(`Decision type is required (taxonomy=${DECISION_TYPE_TAXONOMY_VERSION}).`);
  }

  if (isAllowedDecisionType(normalized)) return;

  throw new Error(
    `Unknown decision type "${normalized}" from ${sourceService || 'unknown_service'} ` +
      `(taxonomy=${DECISION_TYPE_TAXONOMY_VERSION}).`
  );
}

export function classifyDecisionType(decisionType: string): DecisionTypeCategory {
  return getDecisionTypeMetadata(decisionType)?.category ?? 'risk';
}
