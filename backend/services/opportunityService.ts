import { supabase } from '../db/supabaseClient';
import type { StrategicPayload } from './opportunityGenerators';

export const MAX_SLOTS_PER_TYPE = 10;

export type OpportunityInput = {
  title: string;
  summary?: string | null;
  problem_domain?: string | null;
  region_tags?: string[] | null;
  source_refs?: Record<string, unknown> | null;
  conversion_score?: number | null;
  payload?: Record<string, unknown> | null;
};

export type OpportunityItem = {
  id: string;
  company_id: string;
  type: string;
  title: string;
  summary: string | null;
  problem_domain: string | null;
  region_tags: string[] | null;
  source_refs: Record<string, unknown> | null;
  conversion_score: number | null;
  status: string;
  slot_state: string;
  action_taken: string | null;
  scheduled_for: string | null;
  first_seen_at: string;
  last_seen_at: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

/**
 * List active opportunity items for a company and type, ordered by conversion_score desc, first_seen_at desc.
 */
export async function listActiveOpportunities(
  companyId: string,
  type: string
): Promise<OpportunityItem[]> {
  const { data, error } = await supabase
    .from('opportunity_items')
    .select('*')
    .eq('company_id', companyId)
    .eq('type', type)
    .eq('slot_state', 'ACTIVE')
    .order('conversion_score', { ascending: false, nullsFirst: false })
    .order('first_seen_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list opportunities: ${error.message}`);
  }
  return (data ?? []) as OpportunityItem[];
}

/**
 * Count active opportunity items for a company and type.
 */
export async function countActive(companyId: string, type: string): Promise<number> {
  const { count, error } = await supabase
    .from('opportunity_items')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('type', type)
    .eq('slot_state', 'ACTIVE');

  if (error) {
    throw new Error(`Failed to count opportunities: ${error.message}`);
  }
  return count ?? 0;
}

/**
 * Upsert opportunities: insert new rows with slot_state='ACTIVE', or update last_seen_at and payload
 * when a row with the same (title, problem_domain) already exists for this company/type.
 */
export async function upsertOpportunities(
  companyId: string,
  type: string,
  items: OpportunityInput[]
): Promise<void> {
  if (items.length === 0) return;

  const now = new Date().toISOString();

  for (const item of items) {
    const title = (item.title ?? '').trim();
    if (!title) continue;

    const problemDomain = (item.problem_domain ?? '').trim();

    const { data: existing } = await supabase
      .from('opportunity_items')
      .select('id, last_seen_at, payload')
      .eq('company_id', companyId)
      .eq('type', type)
      .eq('slot_state', 'ACTIVE')
      .eq('title', title)
      .eq('problem_domain', problemDomain)
      .maybeSingle();

    if (existing) {
      const { error: updateError } = await supabase
        .from('opportunity_items')
        .update({
          last_seen_at: now,
          payload: item.payload ?? existing.payload,
          updated_at: now,
        })
        .eq('id', existing.id);

      if (updateError) {
        throw new Error(`Failed to update opportunity: ${updateError.message}`);
      }
    } else {
      const { error: insertError } = await supabase.from('opportunity_items').insert({
        company_id: companyId,
        type,
        title,
        summary: item.summary ?? null,
        problem_domain: problemDomain || null,
        region_tags: item.region_tags ?? null,
        source_refs: item.source_refs ?? null,
        conversion_score: item.conversion_score ?? null,
        status: 'NEW',
        slot_state: 'ACTIVE',
        first_seen_at: now,
        last_seen_at: now,
        payload: item.payload ?? null,
        created_at: now,
        updated_at: now,
      });

      if (insertError) {
        throw new Error(`Failed to insert opportunity: ${insertError.message}`);
      }
    }
  }
}

/**
 * Fill ACTIVE opportunity slots for (companyId, type) up to MAX_SLOTS_PER_TYPE (10).
 *
 * - Count ACTIVE slots for (companyId, type).
 * - If count < 10: call generator(companyId, strategicPayload), then insert up to (10 - count) items via upsertOpportunities.
 * - If count >= 10: do nothing (return without calling generator).
 *
 * Called from:
 * - POST /api/opportunities (fill on demand)
 * - After an action closes a slot (e.g. SCHEDULED, ARCHIVED, DISMISSED in /api/opportunities/[id]/action)
 * - Daily scheduled job (when implemented)
 */
export async function fillOpportunitySlots(
  companyId: string,
  type: string,
  strategicPayload?: StrategicPayload
): Promise<void> {
  const active = await countActive(companyId, type);
  const remaining = MAX_SLOTS_PER_TYPE - active;
  if (remaining <= 0) return;

  const { getGenerator } = await import('./opportunityGenerators');
  const generator = getGenerator(type);
  const items = await generator(companyId, strategicPayload);
  const toUpsert = items.slice(0, remaining);
  if (toUpsert.length === 0) return;

  await upsertOpportunities(companyId, type, toUpsert);
}

export type TakeActionType = 'PROMOTED' | 'SCHEDULED' | 'ARCHIVED' | 'DISMISSED';

export type TakeActionOpts = {
  scheduled_for?: string;
  promoted_by?: string;
};

/**
 * Update opportunity status and close the slot: set status, action_taken, slot_state='CLOSED',
 * and optionally scheduled_for.
 */
export async function takeAction(
  opportunityId: string,
  action: TakeActionType,
  opts?: TakeActionOpts
): Promise<void> {
  const updates: Record<string, unknown> = {
    status: action,
    action_taken: action,
    slot_state: 'CLOSED',
    updated_at: new Date().toISOString(),
  };
  if (opts?.scheduled_for != null) {
    updates.scheduled_for = opts.scheduled_for;
  }

  const { error } = await supabase
    .from('opportunity_items')
    .update(updates)
    .eq('id', opportunityId);

  if (error) {
    throw new Error(`Failed to take action on opportunity: ${error.message}`);
  }
}

/**
 * Promote an opportunity to a new DRAFT campaign using the existing campaigns table.
 * Prefill: name, description (brief), and in campaign_snapshot: source_opportunity_id, target_regions, context_payload.
 * Inserts into opportunity_to_campaign. Does not change campaign workflow or approval logic.
 */
export async function promoteToCampaign(
  opportunityId: string,
  companyId: string,
  userId: string
): Promise<string> {
  const { data: opportunity, error: fetchError } = await supabase
    .from('opportunity_items')
    .select('id, title, summary, region_tags, payload')
    .eq('id', opportunityId)
    .eq('company_id', companyId)
    .single();

  if (fetchError || !opportunity) {
    throw new Error('Opportunity not found');
  }

  const now = new Date().toISOString();

  // DRAFT campaign: prefill name (= opportunity.title), brief (= opportunity.summary via description)
  const campaignInsert: Record<string, unknown> = {
    name: opportunity.title ?? 'Campaign from opportunity',
    description: opportunity.summary ?? null,
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

  // campaign_snapshot: metadata.source_opportunity_id, target_regions, context_payload (for downstream; no workflow change)
  // Hybrid context: opportunity → default focused_context
  const {
    DEFAULT_BUILD_MODE_OPPORTUNITY,
    normalizeCampaignTypes,
    normalizeCampaignWeights,
  } = await import('./campaignContextConfig');
  const campaign_types = normalizeCampaignTypes(
    (opportunity.payload as any)?.campaign_types ?? undefined
  );
  const campaign_weights = normalizeCampaignWeights(
    campaign_types,
    (opportunity.payload as any)?.campaign_weights
  );
  const context_scope = Array.isArray((opportunity.payload as any)?.context_scope)
    ? (opportunity.payload as any).context_scope.filter((s: unknown) => typeof s === 'string')
    : null;

  const market_scope = (opportunity.payload as any)?.market_scope ?? 'niche';
  const company_stage = (opportunity.payload as any)?.company_stage ?? 'early_stage';

  const { error: linkError } = await supabase.from('campaign_versions').insert({
    company_id: companyId,
    campaign_id: campaignId,
    campaign_snapshot: {
      campaign: {
        ...campaignInsert,
        id: campaignId,
      },
      source_opportunity_id: opportunityId,
      metadata: {
        source_opportunity_id: opportunityId,
      },
      target_regions: opportunity.region_tags ?? null,
      context_payload: opportunity.payload ?? null,
    },
    status: 'draft',
    version: 1,
    created_at: now,
    build_mode: DEFAULT_BUILD_MODE_OPPORTUNITY,
    context_scope: context_scope && context_scope.length > 0 ? context_scope : null,
    campaign_types,
    campaign_weights,
    company_stage,
    market_scope,
  });

  if (linkError) {
    throw new Error(`Failed to link campaign to company: ${linkError.message}`);
  }

  const { error: otcError } = await supabase.from('opportunity_to_campaign').insert({
    opportunity_id: opportunityId,
    campaign_id: campaignId,
    promoted_at: now,
    promoted_by: userId,
  });

  if (otcError) {
    throw new Error(`Failed to link opportunity to campaign: ${otcError.message}`);
  }

  await takeAction(opportunityId, 'PROMOTED', { promoted_by: userId });

  return campaignId;
}

/**
 * Mark an opportunity as REVIEWED without closing the slot (slot_state stays ACTIVE).
 */
export async function setOpportunityReviewed(opportunityId: string): Promise<void> {
  const { error } = await supabase
    .from('opportunity_items')
    .update({ status: 'REVIEWED', updated_at: new Date().toISOString() })
    .eq('id', opportunityId);

  if (error) {
    throw new Error(`Failed to mark opportunity reviewed: ${error.message}`);
  }
}

/**
 * Reopen scheduled items where scheduled_for <= now(): set status='NEW', slot_state='ACTIVE'.
 * Used by the daily opportunity slots scheduler.
 */
export async function reopenScheduledOpportunitiesDue(): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('opportunity_items')
    .update({
      status: 'NEW',
      slot_state: 'ACTIVE',
      updated_at: now,
    })
    .not('scheduled_for', 'is', null)
    .lte('scheduled_for', now)
    .eq('slot_state', 'CLOSED')
    .select('id');

  if (error) {
    throw new Error(`Failed to reopen scheduled opportunities: ${error.message}`);
  }
  return data?.length ?? 0;
}
