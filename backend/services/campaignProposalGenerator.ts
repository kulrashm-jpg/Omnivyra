/**
 * Campaign Proposal Generator
 * Generates structured campaign plan drafts from high-strength opportunities.
 * Used when opportunity_strength > 70 (campaign_recommended).
 */

export type OpportunityForProposal = {
  id?: string;
  organization_id?: string;
  opportunity_type: string;
  title: string;
  description?: string | null;
  topic_keywords?: string[];
  confidence_score?: number;
  signal_count?: number;
  engagement_score_avg?: number;
};

export type CampaignProposalOutput = {
  campaign_title: string;
  campaign_objective: string;
  recommended_duration_weeks: number;
  recommended_platforms: string[];
  weekly_structure: Array<{ week: number; phase: string; focus: string }>;
  topics_to_cover: string[];
};

const DEFAULT_WEEKLY_STRUCTURE: Array<{ week: number; phase: string; focus: string }> = [
  { week: 1, phase: 'Awareness', focus: 'Introduce topic and establish relevance' },
  { week: 2, phase: 'Problem discussion', focus: 'Surface pain points and audience challenges' },
  { week: 3, phase: 'Solution introduction', focus: 'Present approach and key value props' },
  { week: 4, phase: 'Case study', focus: 'Share proof and social proof' },
  { week: 5, phase: 'Objection handling', focus: 'Address common concerns and FAQs' },
  { week: 6, phase: 'Conversion CTA', focus: 'Drive clear next steps and offers' },
];

const PLATFORMS_BY_OPPORTUNITY_TYPE: Record<string, string[]> = {
  buyer_intent: ['linkedin', 'twitter', 'email'],
  topic_trend: ['linkedin', 'twitter', 'youtube'],
  community_discussion: ['linkedin', 'reddit', 'twitter', 'slack'],
  competitor_mention: ['linkedin', 'twitter', 'blog'],
  product_question: ['linkedin', 'twitter', 'youtube', 'documentation'],
};

/**
 * Generate a campaign proposal from an opportunity.
 * Produces a structured plan draft ready for review and conversion.
 */
export function generateCampaignProposal(opportunity: OpportunityForProposal): CampaignProposalOutput {
  const title = opportunity.title || 'Untitled Opportunity';
  const description = opportunity.description || '';
  const topicKeywords = opportunity.topic_keywords ?? [];
  const opportunityType = opportunity.opportunity_type || 'topic_trend';

  const campaignTitle = buildCampaignTitle(title, opportunityType);
  const campaignObjective = buildCampaignObjective(title, description, opportunityType);
  const recommendedPlatforms = PLATFORMS_BY_OPPORTUNITY_TYPE[opportunityType] ?? ['linkedin', 'twitter'];
  const durationWeeks = Math.min(6, Math.max(4, Math.ceil((topicKeywords.length || 3) / 2) + 3));
  const weeklyStructure = DEFAULT_WEEKLY_STRUCTURE.slice(0, durationWeeks).map((w, idx) => ({
    ...w,
    week: idx + 1,
  }));
  const topicsToCover = buildTopicsToCover(topicKeywords, title, description);

  return {
    campaign_title: campaignTitle,
    campaign_objective: campaignObjective,
    recommended_duration_weeks: durationWeeks,
    recommended_platforms: recommendedPlatforms,
    weekly_structure: weeklyStructure,
    topics_to_cover: topicsToCover,
  };
}

function buildCampaignTitle(baseTitle: string, opportunityType: string): string {
  const typePrefix: Record<string, string> = {
    buyer_intent: 'Capture demand: ',
    topic_trend: 'Ride the trend: ',
    community_discussion: 'Engage community: ',
    competitor_mention: 'Competitive response: ',
    product_question: 'Answer demand: ',
  };
  const prefix = typePrefix[opportunityType] || 'Campaign: ';
  return prefix + baseTitle;
}

function buildCampaignObjective(title: string, description: string, opportunityType: string): string {
  const typeObjectives: Record<string, string> = {
    buyer_intent: 'Convert high-intent signals into qualified leads and demos.',
    topic_trend: 'Establish thought leadership on trending topics and capture audience attention.',
    community_discussion: 'Participate in and steer community conversations with valuable content.',
    competitor_mention: 'Position product strengths and address competitive comparisons.',
    product_question: 'Answer frequently asked product questions with educational content.',
  };
  const base = typeObjectives[opportunityType] || 'Leverage opportunity signals to drive awareness and engagement.';
  if (description) {
    return `${base} Focus: ${description.slice(0, 150)}${description.length > 150 ? '...' : ''}`;
  }
  return `${base} Focus: ${title}.`;
}

function buildTopicsToCover(keywords: string[], title: string, description: string): string[] {
  const fromKeywords = keywords.slice(0, 8).filter(Boolean);
  const fromTitle = title.split(/\s+/).filter((w) => w.length > 3).slice(0, 3);
  const fromDesc = description
    ? description
        .split(/\s+/)
        .filter((w) => w.length > 4)
        .slice(0, 3)
    : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of [...fromKeywords, ...fromTitle, ...fromDesc]) {
    const normalized = t.toLowerCase().replace(/[^\w\s]/g, '');
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(t);
    }
  }
  if (result.length === 0) {
    result.push(title, 'Problem-solution fit', 'Proof and case studies', 'Call to action');
  }
  return result.slice(0, 12);
}
