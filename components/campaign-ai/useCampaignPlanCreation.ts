import { apiFetch } from '@/lib/apiFetch';
import type { ChatMessage, StructuredPlan } from './types';

type Params = {
  campaignId?: string;
  isOpen: boolean;
  context?: string;
  selectedPlan: string;
  generateDefaultPlan: () => string;
  selectedProvider: string;
  resolvedCompanyId: string;
  structuredPlan: StructuredPlan | null;
  resolveWorkingDurationWeeks: () => number;
  getProviderName: (provider: any) => string;
  setIsLoading: (value: boolean) => void;
  setRetrievePlanData: (value: any) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setShowDateSelection: (value: boolean) => void;
  setSelectedPlan: (value: string) => void;
};

export function useCampaignPlanCreation({
  campaignId,
  isOpen,
  context,
  selectedPlan,
  generateDefaultPlan,
  selectedProvider,
  resolvedCompanyId,
  structuredPlan,
  resolveWorkingDurationWeeks,
  getProviderName,
  setIsLoading,
  setRetrievePlanData,
  setMessages,
  setShowDateSelection,
  setSelectedPlan,
}: Params) {
  return async function create12WeekPlan(startDate: string, durationWeeks?: number) {
    try {
      setIsLoading(true);
      const aiContent = selectedPlan || generateDefaultPlan();

      if (!campaignId) {
        console.error('Campaign ID is missing. Props received:', { campaignId, isOpen, context });
        throw new Error('Campaign ID is missing. Please refresh the page and try again.');
      }
      if (!startDate) throw new Error('Start date is missing');
      if (!aiContent) throw new Error('AI content is missing');

      const resolvedDuration =
        typeof durationWeeks === 'number' && durationWeeks >= 1 && durationWeeks <= 52
          ? durationWeeks
          : resolveWorkingDurationWeeks();
      const body: Record<string, unknown> = {
        campaignId,
        startDate,
        aiContent,
        provider: selectedProvider,
        companyId: resolvedCompanyId || undefined,
        ...(typeof resolvedDuration === 'number' && resolvedDuration >= 1 && resolvedDuration <= 52
          ? { durationWeeks: resolvedDuration }
          : {}),
      };
      if (structuredPlan?.weeks?.length) {
        body.structuredPlan = { weeks: structuredPlan.weeks };
      }

      const response = await apiFetch('/api/campaigns/create-12week-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const detail = errorData.details || errorData.message || errorData.error || 'Unknown error';
        const hint = errorData.hint ? ` (${errorData.hint})` : '';
        throw new Error(`Failed to create plan: ${detail}${hint}`);
      }

      await response.json();
      const refetchRes = await fetch(`/api/campaigns/retrieve-plan?campaignId=${encodeURIComponent(campaignId)}`);
      if (refetchRes.ok) {
        const refetchData = await refetchRes.json();
        setRetrievePlanData(refetchData);
      }

      const weeksMsg = typeof resolvedDuration === 'number' ? resolvedDuration : resolveWorkingDurationWeeks();
      const successMessage: ChatMessage = {
        id: Date.now(),
        type: 'ai',
        message: `Campaign plan created successfully for ${weeksMsg} weeks, starting ${new Date(startDate).toLocaleDateString()}. Use **View submitted plan** above to open your plan.`,
        timestamp: new Date().toLocaleTimeString(),
        provider: getProviderName(selectedProvider),
        campaignId,
      };
      setMessages((prev) => [...prev, successMessage]);
      setShowDateSelection(false);
      setSelectedPlan('');

      if (typeof window !== 'undefined') {
        const currentUrl = new URL(window.location.href);
        const nextParams = new URLSearchParams();
        const companyIdParam = currentUrl.searchParams.get('companyId') || resolvedCompanyId;
        if (companyIdParam) nextParams.set('companyId', companyIdParam);
        if (currentUrl.searchParams.get('fromRecommendation') === '1') {
          nextParams.set('fromRecommendation', '1');
          const recommendationIdParam = currentUrl.searchParams.get('recommendationId');
          if (recommendationIdParam) nextParams.set('recommendationId', recommendationIdParam);
        }
        nextParams.set('focus', 'weekly-blueprint');
        window.location.href = `/campaign-details/${campaignId}?${nextParams.toString()}`;
      }
    } catch (error) {
      console.error('Error creating campaign plan:', error);
      const errorMessage: ChatMessage = {
        id: Date.now(),
        type: 'ai',
        message: 'Error: Failed to create campaign plan. Please try again.',
        timestamp: new Date().toLocaleTimeString(),
        provider: getProviderName(selectedProvider),
        campaignId,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };
}
