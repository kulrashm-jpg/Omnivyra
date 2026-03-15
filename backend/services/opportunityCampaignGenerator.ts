/**
 * Campaign Launch From Opportunity
 * Converts a campaign_opportunities row into a campaign with blueprint (content pillars).
 * Does not modify intelligence pipeline components.
 */

import { supabase } from '../db/supabaseClient';
import { checkCampaignDuplicate } from './campaignDuplicateGuardService';
import { emitIntelligenceEvent } from './intelligenceEventService';
import type { OpportunityType } from './campaignOpportunityEngine';
import type { CampaignBlueprint, CampaignBlueprintWeek } from '../types/CampaignBlueprint';

type CampaignOpportunityRow = {
  id: string;
  theme_id: string;
  cluster_id: string;
  opportunity_title: string;
  opportunity_description: string;
  opportunity_type: string;
  momentum_score: number | null;
  keywords: unknown;
};

/** Content pillars per opportunity_type (rule-based). */
const PILLARS_BY_TYPE: Record<OpportunityType, string[]> = {
  content_marketing: [
    'Educational Content',
    'Practical Use Cases',
    'Expert Insights',
    'Customer Stories',
  ],
  thought_leadership: [
    'Executive Perspective',
    'Industry Trends',
    'Strategic Implications',
    'Future Outlook',
  ],
  product_positioning: [
    'Product Benefits',
    'Customer Outcomes',
    'Implementation Strategy',
    'Competitive Advantage',
  ],
  industry_education: [
    'Market Trends',
    'Technology Overview',
    'Industry Adoption',
    'Best Practices',
  ],
};

function log(event: 'campaign_created_from_opportunity', data: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...data }));
}

/**
 * Load opportunity from campaign_opportunities by id.
 */
async function loadOpportunity(opportunityId: string): Promise<CampaignOpportunityRow | null> {
  const { data, error } = await supabase
    .from('campaign_opportunities')
    .select('id, theme_id, cluster_id, opportunity_title, opportunity_description, opportunity_type, momentum_score, keywords')
    .eq('id', opportunityId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load campaign_opportunity: ${error.message}`);
  return data as CampaignOpportunityRow | null;
}

/**
 * Get content pillars for an opportunity type.
 */
export function getContentPillarsForType(opportunityType: string): string[] {
  const pillars = PILLARS_BY_TYPE[opportunityType as OpportunityType];
  return pillars ?? PILLARS_BY_TYPE.content_marketing;
}

/**
 * Build campaign blueprint: content pillars + minimal weeks (one week per pillar).
 */
function buildBlueprint(
  opportunity: CampaignOpportunityRow,
  campaignId: string
): CampaignBlueprint & { content_pillars: string[] } {
  const pillars = getContentPillarsForType(opportunity.opportunity_type);
  const weeks: CampaignBlueprintWeek[] = pillars.map((pillar, idx) => ({
    week_number: idx + 1,
    phase_label: pillar,
    primary_objective: pillar,
    topics_to_cover: [],
    platform_allocation: {},
    content_type_mix: ['post'],
    cta_type: 'None',
    weekly_kpi_focus: 'Reach growth',
  }));

  return {
    campaign_id: campaignId,
    duration_weeks: weeks.length,
    weeks,
    content_pillars: pillars,
  };
}

export type GenerateCampaignFromOpportunityResult = {
  campaign_id: string;
  campaign_name: string;
  opportunity_id: string;
  blueprint: CampaignBlueprint & { content_pillars: string[] };
};

/**
 * Generate a campaign from a campaign opportunity.
 * 1. Load opportunity
 * 2. Build campaign blueprint (content pillars + weeks)
 * 3. Create campaign record
 * 4. Store opportunity_id, theme_id, cluster_id, momentum_score in campaign metadata
 */
export async function generateCampaignFromOpportunity(
  opportunityId: string,
  companyId: string,
  userId: string
): Promise<GenerateCampaignFromOpportunityResult> {
  const opportunity = await loadOpportunity(opportunityId);
  if (!opportunity) {
    throw new Error('Campaign opportunity not found');
  }

  const topic = `${opportunity.opportunity_title} ${opportunity.opportunity_description ?? ''}`.trim();
  const dup = await checkCampaignDuplicate(companyId, topic);
  if (!dup.allowed) {
    throw new Error(dup.warning ?? 'Similar campaign exists within 30 days');
  }

  const campaignName = opportunity.opportunity_title;
  const campaignDescription = opportunity.opportunity_description ?? '';
  const now = new Date().toISOString();

  const campaignInsert: Record<string, unknown> = {
    name: campaignName,
    description: campaignDescription,
    status: 'draft',
    current_stage: 'planning',
    user_id: userId,
    created_at: now,
    updated_at: now,
    duration_weeks: null,
    duration_locked: false,
    blueprint_status: null,
  };

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .insert(campaignInsert)
    .select('id')
    .single();

  if (campaignError || !campaign) {
    throw new Error(`Failed to create campaign: ${campaignError?.message ?? 'unknown'}`);
  }

  const campaignId = campaign.id as string;
  const blueprint = buildBlueprint(opportunity, campaignId);

  const metadata = {
    source: 'trend_opportunity',
    opportunity_id: opportunityId,
    theme_id: opportunity.theme_id,
    cluster_id: opportunity.cluster_id,
    momentum_score: opportunity.momentum_score ?? null,
  };

  const {
    DEFAULT_BUILD_MODE_OPPORTUNITY,
    normalizeCampaignTypes,
    normalizeCampaignWeights,
  } = await import('./campaignContextConfig');
  const campaign_types = normalizeCampaignTypes(['brand_awareness']);
  const campaign_weights = normalizeCampaignWeights(campaign_types, null);

  const { error: versionError } = await supabase.from('campaign_versions').insert({
    company_id: companyId,
    campaign_id: campaignId,
    campaign_snapshot: {
      campaign: { ...campaignInsert, id: campaignId },
      metadata,
      planning_context: {
        campaign_type: 'trend_campaign',
        content_pillars: blueprint.content_pillars,
        source_opportunity_id: opportunityId,
        theme_id: opportunity.theme_id,
        cluster_id: opportunity.cluster_id,
        momentum_score: opportunity.momentum_score,
        keywords: opportunity.keywords ?? [],
      },
    },
    status: 'draft',
    version: 1,
    created_at: now,
    build_mode: DEFAULT_BUILD_MODE_OPPORTUNITY,
    context_scope: null,
    campaign_types,
    campaign_weights,
    company_stage: 'early_stage',
    market_scope: 'niche',
  });

  if (versionError) {
    throw new Error(`Failed to create campaign version: ${versionError.message}`);
  }

  log('campaign_created_from_opportunity', {
    opportunity_id: opportunityId,
    campaign_id: campaignId,
    momentum_score: opportunity.momentum_score ?? undefined,
  });

  emitIntelligenceEvent(companyId, 'campaign_launched', {
    campaign_id: campaignId,
    campaign_name: campaignName,
    source_opportunity_id: opportunityId,
    momentum_score: opportunity.momentum_score ?? null,
  }).catch((e) => console.warn('[opportunityCampaignGenerator] emit event failed:', e));

  return {
    campaign_id: campaignId,
    campaign_name: campaignName,
    opportunity_id: opportunityId,
    blueprint,
  };
}
