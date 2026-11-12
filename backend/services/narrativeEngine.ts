import { tenantChildTableOf, tenantTable, type TenantContext } from '../db/tenantTable';
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
 * Load THIS tenant's content opportunities (recent, not yet converted to narratives).
 * S2 tenant seam (e1, 83 ruling 2): this used to read the latest 100 opportunities across ALL tenants.
 */
async function loadOpportunitiesWithoutNarratives(tenant: TenantContext): Promise<OpportunityRow[]> {
  const { data: opportunities, error: oppError } = await tenantTable('content_opportunities', tenant)
    .select('id, opportunity_title, opportunity_description, opportunity_type')
    .order('created_at', { ascending: false })
    .limit(100);

  if (oppError) throw new Error(`Failed to load content_opportunities: ${oppError.message}`);
  const opps = (opportunities ?? []) as OpportunityRow[];

  if (opps.length === 0) return [];

  // campaign_narratives is a child of content_opportunities: every opportunity id is verified as this tenant's.
  const narratives = await tenantChildTableOf('campaign_narratives', tenant, opps.map((o) => o.id));
  const { data: existing, error: existingErr } = await narratives.select('opportunity_id');
  // A failed read is not "no narratives yet" - proceeding would duplicate every narrative.
  if (existingErr) throw new Error(`Failed to load campaign_narratives: ${existingErr.message}`);

  const hasNarrative = new Set((existing ?? []).map((r: { opportunity_id: string }) => r.opportunity_id));
  return opps.filter((o) => !hasNarrative.has(o.id));
}

/**
 * Generate campaign narratives from ONE tenant's content opportunities.
 * Creates 3 narrative angles × 4 platforms per opportunity.
 */
export async function generateCampaignNarratives(tenant: TenantContext): Promise<GenerateCampaignNarrativesResult> {
  const opportunities = await loadOpportunitiesWithoutNarratives(tenant);
  // Inserts go through the child seam: each row's opportunity_id must be one of this tenant's verified opportunities.
  const narratives = await tenantChildTableOf('campaign_narratives', tenant, opportunities.map((o) => o.id));
  let narrativesCreated = 0;
  let narrativesSkipped = 0;

  // ── HARDEN-004: build all (opportunity × angle × platform) rows in memory
  // (same generator, same order) and try ONE bulk insert instead of up to
  // 1,200 sequential INSERTs. On a foreign-key failure (the only per-row
  // error the loop tolerated) fall back to the original per-row path so
  // per-row 23503-skip counting is identical.
  const allRows = opportunities.flatMap((opp) => {
    const title = opp.opportunity_title ?? opp.opportunity_description ?? 'Content opportunity';
    return NARRATIVE_ANGLES.flatMap((angle) => {
      const { angle: narrativeAngle, summary } = generateNarrativeForAngle(title, angle);
      return PLATFORMS.map((platform) => ({
        opportunity_id: opp.id,
        narrative_angle: narrativeAngle,
        narrative_summary: summary,
        target_audience: 'Marketing and growth teams',
        platform,
      }));
    });
  });

  let bulkDone = false;
  if (allRows.length > 0) {
    const { error } = await narratives.insert(allRows);
    if (!error) {
      narrativesCreated = allRows.length;
      bulkDone = true;
    } else if (error.code !== '23503') {
      throw new Error(`campaign_narratives insert failed: ${error.message}`);
    }
  } else {
    bulkDone = true;
  }

  if (!bulkDone) {
    for (const row of allRows) {
      const { error } = await narratives.insert(row);
      if (error) {
        if (error.code === '23503') narrativesSkipped++;
        else throw new Error(`campaign_narratives insert failed: ${error.message}`);
      } else {
        narrativesCreated++;
      }
    }
  }

  return {
    opportunities_processed: opportunities.length,
    narratives_created: narrativesCreated,
    narratives_skipped: narrativesSkipped,
  };
}
