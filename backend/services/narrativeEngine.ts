/**
 * Narrative Engine
 * Converts content opportunities into story-driven campaign angles.
 * New layer after content_opportunities. Does not modify existing intelligence pipeline.
 */

import { supabase } from '../db/supabaseClient';

const NARRATIVE_ANGLES = [
  'founder_insight',
  'industry_shift',
  'practical_guide',
] as const;

const PLATFORMS = ['LinkedIn', 'Twitter/X', 'Blog', 'Newsletter'] as const;

type NarrativeAngle = (typeof NARRATIVE_ANGLES)[number];
type Platform = (typeof PLATFORMS)[number];

type OpportunityRow = {
  id: string;
  opportunity_title: string;
  opportunity_description: string;
  opportunity_type: string;
};

function generateNarrativeForAngle(
  title: string,
  angle: NarrativeAngle
): { angle: string; summary: string } {
  const topic = title.slice(0, 50);
  switch (angle) {
    case 'founder_insight':
      return {
        angle: `What Most Companies Get Wrong About ${topic}`,
        summary: `Founder perspective on common mistakes and overlooked opportunities in ${topic}.`,
      };
    case 'industry_shift':
      return {
        angle: `${topic} Is Entering Its Next Era`,
        summary: `How the industry is shifting and what it means for stakeholders.`,
      };
    case 'practical_guide':
      return {
        angle: `How Teams Can Adopt ${topic} Without Replacing Their Stack`,
        summary: `Step-by-step guide for practical adoption with minimal disruption.`,
      };
    default:
      return {
        angle: `Content angle: ${topic}`,
        summary: `Campaign narrative for ${topic}.`,
      };
  }
}

export type GenerateCampaignNarrativesResult = {
  opportunities_processed: number;
  narratives_created: number;
  narratives_skipped: number;
};

/**
 * Load content opportunities (recent, not yet converted to narratives).
 */
async function loadOpportunitiesWithoutNarratives(): Promise<OpportunityRow[]> {
  const { data: opportunities, error: oppError } = await supabase
    .from('content_opportunities')
    .select('id, opportunity_title, opportunity_description, opportunity_type')
    .order('created_at', { ascending: false })
    .limit(100);

  if (oppError) throw new Error(`Failed to load content_opportunities: ${oppError.message}`);
  const opps = (opportunities ?? []) as OpportunityRow[];

  if (opps.length === 0) return [];

  const { data: existing } = await supabase
    .from('campaign_narratives')
    .select('opportunity_id')
    .in('opportunity_id', opps.map((o) => o.id));

  const hasNarrative = new Set((existing ?? []).map((r: { opportunity_id: string }) => r.opportunity_id));
  return opps.filter((o) => !hasNarrative.has(o.id));
}

/**
 * Generate campaign narratives from content opportunities.
 * Creates 3 narrative angles × 4 platforms per opportunity.
 */
export async function generateCampaignNarratives(): Promise<GenerateCampaignNarrativesResult> {
  const opportunities = await loadOpportunitiesWithoutNarratives();
  let narrativesCreated = 0;
  let narrativesSkipped = 0;

  for (const opp of opportunities) {
    const title = opp.opportunity_title ?? opp.opportunity_description ?? 'Content opportunity';

    for (const angle of NARRATIVE_ANGLES) {
      const { angle: narrativeAngle, summary } = generateNarrativeForAngle(title, angle);

      for (const platform of PLATFORMS) {
        const { error } = await supabase.from('campaign_narratives').insert({
          opportunity_id: opp.id,
          narrative_angle: narrativeAngle,
          narrative_summary: summary,
          target_audience: 'Marketing and growth teams',
          platform,
        });

        if (error) {
          if (error.code === '23503') narrativesSkipped++;
          else throw new Error(`campaign_narratives insert failed: ${error.message}`);
        } else {
          narrativesCreated++;
        }
      }
    }
  }

  return {
    opportunities_processed: opportunities.length,
    narratives_created: narrativesCreated,
    narratives_skipped: narrativesSkipped,
  };
}
