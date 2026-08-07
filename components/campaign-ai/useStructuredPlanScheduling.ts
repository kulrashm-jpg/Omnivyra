import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import { createIdempotentOperation } from '../../lib/idempotency';
import type { StructuredPlan } from './types';

type Params = {
  campaignId?: string;
  structuredPlan: StructuredPlan | null;
  setIsSchedulingPlan: (value: boolean) => void;
  setUiErrorMessage: (value: string | null) => void;
  setUiSuccessMessage: (value: string | null) => void;
  setRetrievePlanData: (value: any) => void;
  setShowScheduleConfirm: (value: boolean) => void;
};

export function useStructuredPlanScheduling({
  campaignId,
  structuredPlan,
  setIsSchedulingPlan,
  setUiErrorMessage,
  setUiSuccessMessage,
  setRetrievePlanData,
  setShowScheduleConfirm,
}: Params) {
  return async function scheduleStructuredPlan() {
    if (!campaignId || !structuredPlan) {
      setUiErrorMessage('Campaign and structured plan are required to schedule.');
      return;
    }

    try {
      setIsSchedulingPlan(true);
      setUiErrorMessage(null);
      setUiSuccessMessage(null);

      // OR-07 Action 1: keyed on the campaign, so retrying the scheduling of
      // this structured plan reuses the key.
      const planOp = createIdempotentOperation(`campaign-schedule-structured-plan-${campaignId}`);
      const response = await fetchWithAuth(`/api/campaigns/${campaignId}/schedule-structured-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...planOp.headers },
        body: JSON.stringify({ plan: structuredPlan }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const message = errorData.message || errorData.error || 'Schedule API error';
        throw new Error(message);
      }

      const data = await response.json();
      setUiSuccessMessage(
        `Scheduled ${data.scheduled_count || 0} posts. Skipped ${data.skipped_count || 0}. Use **View submitted plan** above to open your plan.`
      );

      const refetchRes = await fetch(`/api/campaigns/retrieve-plan?campaignId=${encodeURIComponent(campaignId)}`);
      if (refetchRes.ok) {
        const refetchData = await refetchRes.json();
        setRetrievePlanData(refetchData);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to schedule the plan. Please try again.';
      console.error('Error scheduling structured plan:', error);
      setUiErrorMessage(message);
    } finally {
      setIsSchedulingPlan(false);
      setShowScheduleConfirm(false);
    }
  };
}
