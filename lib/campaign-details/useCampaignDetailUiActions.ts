import type React from 'react';
import type { NextRouter } from 'next/router';
import {
  buildCampaignCalendarUrl,
  buildTopicWorkspacePayload,
  openTopicWorkspaceWindow,
} from './helpers';
import { buildDroppedWeekPlans, toggleExpandedKey } from './uiStateHelpers';
import type { Campaign, DailyPlan } from './types';

export function useCampaignDetailUiActions({
  campaign,
  id,
  effectiveCompanyId,
  router,
  dailyPlans,
  editedWeekDailyPlans,
  setEditedWeekDailyPlans,
  setExpandedDiagnostics,
  expandedWeeks,
  setExpandedWeeks,
}: {
  campaign: Campaign | null;
  id: string | string[] | undefined;
  effectiveCompanyId: string;
  router: NextRouter;
  dailyPlans: DailyPlan[];
  editedWeekDailyPlans: Record<number, DailyPlan[]>;
  setEditedWeekDailyPlans: React.Dispatch<React.SetStateAction<Record<number, DailyPlan[]>>>;
  setExpandedDiagnostics: React.Dispatch<React.SetStateAction<Set<string>>>;
  expandedWeeks: Set<number>;
  setExpandedWeeks: React.Dispatch<React.SetStateAction<Set<number>>>;
}) {
  const toggleWeekExpansion = (weekNumber: number) => {
    const next = new Set(expandedWeeks);
    if (next.has(weekNumber)) {
      next.delete(weekNumber);
    } else {
      next.add(weekNumber);
    }
    setExpandedWeeks(next);
  };

  const openCampaignCalendar = (weekNumber?: number, day?: string) => {
    if (typeof id !== 'string') return;
    router.push(buildCampaignCalendarUrl(id, effectiveCompanyId, weekNumber, day));
  };

  const openTopicWorkspaceFromWeeklyCard = (weekNumber: number, topic: any) => {
    const workspaceData = buildTopicWorkspacePayload({
      campaignId: typeof id === 'string' ? id : null,
      campaignStartDate: campaign?.start_date,
      dailyPlans,
      topic,
      weekNumber,
    });
    if (!workspaceData) return;
    try {
      openTopicWorkspaceWindow(workspaceData);
    } catch (error) {
      console.error('Failed to open topic workspace from weekly card:', error);
    }
  };

  const handleDailyPlanDrop = (weekNumber: number, targetDay: string, e: React.DragEvent) => {
    e.preventDefault();
    let payload: { planId: string; dayOfWeek: string };
    try {
      payload = JSON.parse(e.dataTransfer.getData('application/json') || '{}');
    } catch {
      return;
    }
    const nextWeekPlan = buildDroppedWeekPlans(weekNumber, targetDay, payload, editedWeekDailyPlans, dailyPlans);
    if (!nextWeekPlan) return;
    setEditedWeekDailyPlans((prev) => ({ ...prev, [weekNumber]: nextWeekPlan }));
  };

  const toggleDiagnostic = (key: string) => {
    setExpandedDiagnostics((prev) => toggleExpandedKey(prev, key));
  };

  return {
    toggleWeekExpansion,
    openCampaignCalendar,
    openTopicWorkspaceFromWeeklyCard,
    handleDailyPlanDrop,
    toggleDiagnostic,
  };
}
