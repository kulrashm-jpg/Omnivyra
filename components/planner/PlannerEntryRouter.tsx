/**
 * Planner Entry Router
 * Parses URL parameters and determines planner entry mode.
 * Passes normalized planner context to children.
 */

import React, { useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';

export type PlannerEntryMode = 'direct' | 'turbo' | 'recommendation' | 'campaign' | 'opportunity';

export interface PlannerContext {
  entry_mode: PlannerEntryMode;
  recommendation_id: string | null;
  campaign_id: string | null;
  source_theme: Record<string, unknown> | null;
  source_opportunity_id: string | null;
  initial_idea: string | null;
}

interface PlannerEntryRouterProps {
  children: (context: PlannerContext) => React.ReactNode;
}

export function PlannerEntryRouter({ children }: PlannerEntryRouterProps) {
  const router = useRouter();
  const { query, isReady } = router;

  const context = useMemo((): PlannerContext => {
    const mode = typeof query.mode === 'string' ? query.mode : null;
    const recommendationId =
      typeof query.recommendationId === 'string' && query.recommendationId.trim()
        ? query.recommendationId.trim()
        : null;
    const campaignId =
      typeof query.campaignId === 'string' && query.campaignId.trim()
        ? query.campaignId.trim()
        : null;
    const opportunityId =
      typeof query.opportunityId === 'string' && query.opportunityId.trim()
        ? query.opportunityId.trim()
        : null;
    const sourceOpportunityId =
      opportunityId ??
      (typeof query.sourceOpportunityId === 'string' && query.sourceOpportunityId.trim()
        ? query.sourceOpportunityId.trim()
        : null);

    let sourceTheme: Record<string, unknown> | null = null;
    if (query.sourceTheme) {
      if (typeof query.sourceTheme === 'string') {
        try {
          sourceTheme = JSON.parse(query.sourceTheme) as Record<string, unknown>;
        } catch {
          sourceTheme = { topic: query.sourceTheme };
        }
      } else if (typeof query.sourceTheme === 'object' && query.sourceTheme !== null && !Array.isArray(query.sourceTheme)) {
        sourceTheme = query.sourceTheme as Record<string, unknown>;
      }
    }

    const initialIdea =
      typeof query.initialIdea === 'string' && query.initialIdea.trim()
        ? query.initialIdea.trim()
        : null;

    let entry_mode: PlannerEntryMode = 'direct';
    if (recommendationId || sourceTheme) {
      entry_mode = 'recommendation';
    } else if (campaignId) {
      entry_mode = 'campaign';
    } else if (sourceOpportunityId) {
      entry_mode = 'opportunity';
    } else if (mode === 'turbo') {
      entry_mode = 'turbo';
    } else if (mode === 'direct') {
      entry_mode = 'direct';
    } else {
      entry_mode = 'direct';
    }

    return {
      entry_mode,
      recommendation_id: recommendationId,
      campaign_id: campaignId,
      source_theme: sourceTheme,
      source_opportunity_id: sourceOpportunityId,
      initial_idea: initialIdea,
    };
  }, [
    query.mode,
    query.recommendationId,
    query.campaignId,
    query.sourceTheme,
    query.opportunityId,
    query.sourceOpportunityId,
    query.initialIdea,
  ]);

  if (!isReady) {
    return (
      <div className="flex items-center justify-center min-h-[200px] text-gray-500">
        Loading planner...
      </div>
    );
  }

  return <>{children(context)}</>;
}
