/**
 * Timeline projection utility for portfolio start-date shift suggestions.
 * Computes earliest viable start date when team capacity is constrained by overlapping campaigns.
 */

import { supabase } from '../db/supabaseClient';

export interface CalculateEarliestViableStartDateParams {
  teamId: string;
  requestedPostsPerWeek: number;
  currentStartDate: Date;
  teamCapacityPerWeek: number;
}

interface OverlappingAssignment {
  campaign_id: string;
  weekly_capacity_reserved: number;
  start_date: string;
  end_date: string;
}

/**
 * Calculate the earliest date when requested capacity becomes available
 * by simulating capacity release as overlapping campaigns end.
 * Reuses overlap query logic from PortfolioConstraintEvaluator.
 */
export async function calculateEarliestViableStartDate(
  params: CalculateEarliestViableStartDateParams
): Promise<Date | null> {
  const { teamId, requestedPostsPerWeek, currentStartDate, teamCapacityPerWeek } = params;

  if (teamCapacityPerWeek < requestedPostsPerWeek) return null;

  const currentStartTime = currentStartDate.getTime();
  const proposedEnd = new Date(currentStartDate);
  proposedEnd.setFullYear(proposedEnd.getFullYear() + 1); // reasonable horizon

  const { data: overlapping, error: overlapError } = await supabase
    .from('campaign_team_assignment')
    .select('campaign_id, weekly_capacity_reserved, start_date, end_date')
    .eq('team_id', teamId);

  if (overlapError || !overlapping?.length) return null;

  const overlappingAssignments = (overlapping as OverlappingAssignment[]).filter((a) => {
    const aStart = new Date(a.start_date).getTime();
    const aEnd = new Date(a.end_date).getTime();
    return aStart <= proposedEnd.getTime() && aEnd >= currentStartTime;
  });

  if (overlappingAssignments.length === 0) return currentStartDate;

  const sorted = [...overlappingAssignments].sort(
    (a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime()
  );

  for (const assignment of sorted) {
    const endDate = new Date(assignment.end_date);
    const releaseDate = new Date(endDate);
    releaseDate.setDate(releaseDate.getDate() + 1);

    const thisEndTime = new Date(assignment.end_date).getTime();
    const reservedByStillActive = overlappingAssignments
      .filter((a) => new Date(a.end_date).getTime() > thisEndTime)
      .reduce((sum, a) => sum + (a.weekly_capacity_reserved ?? 0), 0);

    const availableCapacity = Math.max(0, teamCapacityPerWeek - reservedByStillActive);

    if (availableCapacity >= requestedPostsPerWeek) {
      return releaseDate;
    }
  }

  return null;
}
