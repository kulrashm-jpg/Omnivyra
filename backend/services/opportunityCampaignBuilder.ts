/**
 * Opportunity Campaign Builder
 * Converts an opportunity into prefilled campaign context for the planner.
 * Used when user clicks "Launch Campaign" on an opportunity.
 */

export interface OpportunityInput {
  title: string;
  description: string;
  opportunity_type?: string;
  confidence?: number;
  opportunity_score?: number;
  supporting_signals?: string[];
  recommended_action?: string;
}

export interface IdeaSpineOutput {
  title: string;
  description: string;
  origin: 'opportunity';
  source_id?: string | null;
  raw_input?: string | null;
  refined_title?: string | null;
  refined_description?: string | null;
  selected_angle?: string | null;
}

export interface StrategyContextOutput {
  duration_weeks: number;
  platforms: string[];
  posting_frequency: Record<string, number>;
  content_mix: string[];
  campaign_goal: string;
  target_audience: string;
}

export interface CampaignFromOpportunityResult {
  idea_spine: IdeaSpineOutput;
  strategy_context: StrategyContextOutput;
  campaign_direction: string;
}

const DEFAULT_PLATFORMS = ['linkedin'];
const DEFAULT_POSTING_FREQUENCY: Record<string, number> = { linkedin: 3 };
const DEFAULT_CONTENT_MIX = ['post'];
const DEFAULT_DURATION_WEEKS = 12;

/**
 * Derives campaign direction (selected angle) from opportunity type and recommended action.
 */
function deriveCampaignDirection(opp: OpportunityInput): string {
  const action = (opp.recommended_action ?? '').trim();
  const type = (opp.opportunity_type ?? '').toLowerCase();

  if (action) {
    // Use first meaningful phrase as direction
    const words = action.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const phrase = words.slice(0, 3).join(' ');
      if (phrase.length <= 60) return phrase;
    }
    if (action.length <= 60) return action;
    return action.slice(0, 57) + '...';
  }

  const typeMap: Record<string, string> = {
    content_opportunity: 'Content & Thought Leadership',
    campaign_opportunity: 'Campaign Launch',
    audience_opportunity: 'Audience Engagement',
    market_opportunity: 'Market Positioning',
    engagement_opportunity: 'Engagement & Community',
  };
  return typeMap[type] ?? 'Strategic Campaign';
}

/**
 * Build prefilled campaign context from an opportunity.
 * Returns idea_spine, strategy_context, and campaign_direction for planner prefill.
 */
export function buildCampaignFromOpportunity(
  opportunity: OpportunityInput
): CampaignFromOpportunityResult {
  const title = (opportunity.title ?? '').trim() || 'New campaign from opportunity';
  const description = (opportunity.description ?? '').trim() || title;

  const campaign_direction = deriveCampaignDirection(opportunity);

  const idea_spine: IdeaSpineOutput = {
    title,
    description,
    origin: 'opportunity',
    source_id: null,
    raw_input: `${title}\n\n${description}`,
    refined_title: title,
    refined_description: description,
    selected_angle: campaign_direction,
  };

  const strategy_context: StrategyContextOutput = {
    duration_weeks: DEFAULT_DURATION_WEEKS,
    platforms: [...DEFAULT_PLATFORMS],
    posting_frequency: { ...DEFAULT_POSTING_FREQUENCY },
    content_mix: [...DEFAULT_CONTENT_MIX],
    campaign_goal: (opportunity.recommended_action ?? '').trim() || 'Leverage this opportunity',
    target_audience: '',
  };

  return {
    idea_spine,
    strategy_context,
    campaign_direction,
  };
}
