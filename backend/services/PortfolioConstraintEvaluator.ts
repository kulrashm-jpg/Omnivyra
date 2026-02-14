/**
 * Portfolio-level constraint evaluator.
 * Cross-campaign constraints: team overlap capacity, parallel campaign limits.
 */

import type { ConstraintResult, TradeOffOption } from '../types/CampaignDuration';
import { supabase } from '../db/supabaseClient';
import { calculateEarliestViableStartDate } from './PortfolioTimelineProjection';

export interface PortfolioConstraintOutput {
  constraints: ConstraintResult[];
  suggestedTradeOffs?: TradeOffOption[];
}

export type CampaignPriorityLevel = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export interface PortfolioConstraintParams {
  campaignId: string;
  companyId: string;
  requestedDurationWeeks: number;
  requestedPostsPerWeek: number;
  startDate: string;
  endDate: string;
  existing_content_count?: number;
  /** Current campaign priority (from campaigns.priority_level) */
  priorityLevel?: CampaignPriorityLevel | string | null;
}

export async function evaluatePortfolioConstraints(
  params: PortfolioConstraintParams
): Promise<PortfolioConstraintOutput> {
  const results: ConstraintResult[] = [];
  const suggestedTradeOffs: TradeOffOption[] = [];
  const {
    campaignId,
    requestedDurationWeeks,
    requestedPostsPerWeek,
    startDate,
    endDate,
    existing_content_count = 0,
    priorityLevel: currentPriority = 'NORMAL',
  } = params;

  const priorityOrder: Record<string, number> = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };
  const currentRank = priorityOrder[String(currentPriority).toUpperCase()] ?? 1;
  const isHighOrCritical = currentRank >= 2;

  const { data: myAssignment, error: assignError } = await supabase
    .from('campaign_team_assignment')
    .select('team_id')
    .eq('campaign_id', campaignId)
    .limit(1)
    .maybeSingle();

  if (assignError || !myAssignment?.team_id) {
    return { constraints: [] }; // No team assigned → PASS (no concurrency check)
  }

  const teamId = myAssignment.team_id;

  const { data: capacityRow, error: capError } = await supabase
    .from('team_capacity')
    .select('max_posts_per_week, max_parallel_campaigns')
    .eq('team_id', teamId)
    .maybeSingle();

  if (capError || !capacityRow) {
    return { constraints: [] };
  }

  const maxPostsPerWeek = capacityRow.max_posts_per_week ?? 0;
  const maxParallelCampaigns = capacityRow.max_parallel_campaigns ?? 3;

  const { data: overlapping, error: overlapError } = await supabase
    .from('campaign_team_assignment')
    .select('campaign_id, weekly_capacity_reserved, start_date, end_date')
    .eq('team_id', teamId)
    .neq('campaign_id', campaignId);

  if (overlapError) {
    return { constraints: [] };
  }

  const newStart = new Date(startDate).getTime();
  const newEnd = new Date(endDate).getTime();

  const dateOverlappingAssignments = (overlapping ?? []).filter((a: any) => {
    const aStart = new Date(a.start_date).getTime();
    const aEnd = new Date(a.end_date).getTime();
    return aStart <= newEnd && aEnd >= newStart;
  });

  const overlappingIds = dateOverlappingAssignments.map((a: any) => a.campaign_id);
  const { data: campaignStatusRows } = overlappingIds.length > 0
    ? await supabase.from('campaigns').select('id, execution_status').in('id', overlappingIds)
    : { data: [] };
  const excludedIds = new Set(
    (campaignStatusRows ?? [])
      .filter((r: any) => {
        const status = String(r.execution_status || 'ACTIVE').toUpperCase();
        return status === 'PREEMPTED' || status === 'PAUSED';
      })
      .map((r: any) => r.id)
  );
  const overlappingAssignments = dateOverlappingAssignments.filter(
    (a: any) => !excludedIds.has(a.campaign_id)
  );

  const overlappingReserved = overlappingAssignments.reduce(
    (sum: number, a: any) => sum + (a.weekly_capacity_reserved ?? 0),
    0
  );
  const availableCapacity = Math.max(0, maxPostsPerWeek - overlappingReserved);
  const overlappingCampaignIds = overlappingAssignments.map((a: any) => a.campaign_id);

  const addPreemptionSuggestions = async () => {
    if (!isHighOrCritical || overlappingCampaignIds.length === 0) return;
    const { data: campaignRows } = await supabase
      .from('campaigns')
      .select('id, priority_level')
      .in('id', overlappingCampaignIds);
    const campaignPriorityMap = new Map<string, number>();
    (campaignRows ?? []).forEach((r: any) => {
      campaignPriorityMap.set(r.id, priorityOrder[String(r.priority_level || 'NORMAL').toUpperCase()] ?? 1);
    });
    for (const confId of overlappingCampaignIds) {
      const confRank = campaignPriorityMap.get(confId) ?? 1;
      if (confRank < currentRank) {
        suggestedTradeOffs.push({
          type: 'PREEMPT_LOWER_PRIORITY_CAMPAIGN',
          conflictingCampaignId: confId,
          reasoning: 'Preempt lower-priority campaign to free capacity for higher-priority campaign.',
        });
      }
    }
  };

  if (availableCapacity <= 0) {
    const r: ConstraintResult = {
      name: 'team_overlap',
      status: 'BLOCKING',
      max_weeks_allowed: 0,
      reasoning: `Team capacity fully reserved by overlapping campaigns. ${overlappingReserved} posts/week reserved, ${maxPostsPerWeek} max.`,
    };
    results.push(r);
    console.log('PORTFOLIO_CONSTRAINT_TRIGGERED', {
      team_id: teamId,
      overlapping_campaign_ids: overlappingCampaignIds,
      available_capacity: 0,
      requestedPostsPerWeek,
    });
    const newStartDate = await calculateEarliestViableStartDate({
      teamId,
      requestedPostsPerWeek,
      currentStartDate: new Date(startDate),
      teamCapacityPerWeek: maxPostsPerWeek,
    });
    if (newStartDate) {
      suggestedTradeOffs.push({
        type: 'SHIFT_START_DATE',
        newStartDate: newStartDate.toISOString().slice(0, 10),
        reasoning: 'Start campaign after overlapping campaigns conclude to free required capacity.',
      });
    }
    await addPreemptionSuggestions();
    return { constraints: results, suggestedTradeOffs: suggestedTradeOffs.length > 0 ? suggestedTradeOffs : undefined };
  }

  if (availableCapacity < requestedPostsPerWeek) {
    const totalInventory = existing_content_count > 0
      ? existing_content_count
      : requestedPostsPerWeek * requestedDurationWeeks;
    const impactOnDuration = availableCapacity > 0 ? Math.floor(totalInventory / availableCapacity) : 0;
    const r: ConstraintResult = {
      name: 'team_overlap',
      status: 'LIMITING',
      max_weeks_allowed: impactOnDuration,
      reasoning: `Team capacity limited: ${availableCapacity} posts/week available, ${requestedPostsPerWeek} requested. Overlapping campaigns reserve ${overlappingReserved}.`,
    };
    results.push(r);
    console.log('PORTFOLIO_CONSTRAINT_TRIGGERED', {
      team_id: teamId,
      overlapping_campaign_ids: overlappingCampaignIds,
      available_capacity: availableCapacity,
      requestedPostsPerWeek,
    });
    const newStartDate = await calculateEarliestViableStartDate({
      teamId,
      requestedPostsPerWeek,
      currentStartDate: new Date(startDate),
      teamCapacityPerWeek: maxPostsPerWeek,
    });
    if (newStartDate) {
      suggestedTradeOffs.push({
        type: 'SHIFT_START_DATE',
        newStartDate: newStartDate.toISOString().slice(0, 10),
        reasoning: 'Start campaign after overlapping campaigns conclude to free required capacity.',
      });
    }
    await addPreemptionSuggestions();
  }

  if (overlappingAssignments.length > maxParallelCampaigns + 1) {
    results.push({
      name: 'parallel_campaigns',
      status: 'BLOCKING',
      max_weeks_allowed: 0,
      reasoning: `Team at parallel campaign limit: ${overlappingAssignments.length} overlapping, max ${maxParallelCampaigns}.`,
    });
  } else if (overlappingAssignments.length >= maxParallelCampaigns) {
    results.push({
      name: 'parallel_campaigns',
      status: 'LIMITING',
      max_weeks_allowed: 999,
      reasoning: `Team near parallel campaign limit: ${overlappingAssignments.length} overlapping, max ${maxParallelCampaigns}.`,
    });
  }

  return {
    constraints: results,
    suggestedTradeOffs: suggestedTradeOffs.length > 0 ? suggestedTradeOffs : undefined,
  };
}
