/**
 * Planner Opportunity Advisor
 * Generates campaign suggestions from detected opportunities.
 */

export type OpportunityInput = {
  id?: string;
  opportunity_type: string;
  title: string;
  description?: string | null;
  signal_count?: number;
  confidence_score?: number;
  topic_keywords?: string[];
  related_campaign_id?: string | null;
};

export type CampaignSuggestion = {
  action: string;
  week_hint?: number;
  topic?: string;
  priority: 'high' | 'medium' | 'low';
};

const SUGGESTION_TEMPLATES: Record<string, (opp: OpportunityInput) => CampaignSuggestion> = {
  buyer_intent: (opp) => ({
    action: `Create a campaign addressing ${opp.topic_keywords?.[0] || 'demand'} signals. ${opp.signal_count || 0} engagement signals indicate buyer interest.`,
    topic: opp.topic_keywords?.[0],
    priority: 'high',
  }),
  topic_trend: (opp) => ({
    action: `Add Week ${opp.related_campaign_id ? '5' : '4'} content focused on ${opp.topic_keywords?.[0] || 'emerging topic'}. Community discussion trending.`,
    week_hint: 5,
    topic: opp.topic_keywords?.[0],
    priority: 'medium',
  }),
  community_discussion: (opp) => ({
    action: `Create content addressing community discussion: "${opp.title}". Consider Q&A or educational post.`,
    topic: opp.title,
    priority: 'medium',
  }),
  competitor_mention: (opp) => ({
    action: `Launch comparison campaign addressing competitor mentions. ${opp.signal_count || 0} signals mention competitors or product comparisons.`,
    topic: 'comparison',
    priority: 'high',
  }),
  product_question: (opp) => ({
    action: `Create a campaign addressing pricing concerns and product questions. ${opp.signal_count || 0} questions detected.`,
    topic: 'product questions',
    priority: 'high',
  }),
};

const DEFAULT_TEMPLATE = (opp: OpportunityInput): CampaignSuggestion => ({
  action: `Incorporate opportunity: "${opp.title}". ${opp.description || ''}`,
  topic: opp.topic_keywords?.[0],
  priority: 'medium',
});

export function generateCampaignSuggestions(opportunity: OpportunityInput): CampaignSuggestion[] {
  const template = SUGGESTION_TEMPLATES[opportunity.opportunity_type] || DEFAULT_TEMPLATE;
  return [template(opportunity)];
}
