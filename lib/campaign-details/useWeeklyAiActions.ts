import { apiFetch } from '@/lib/apiFetch';
import type { Campaign, DailyPlan, WeeklyPlan } from './types';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

export function buildDailyPlanPageUrl(campaignId: string, effectiveCompanyId: string) {
  const params = new URLSearchParams();
  if (effectiveCompanyId) params.set('companyId', effectiveCompanyId);
  return `/campaign-daily-plan/${campaignId}${params.toString() ? `?${params.toString()}` : ''}`;
}

export function useWeeklyAiActions({
  id,
  campaign,
  effectiveCompanyId,
  weeklyPlans,
  dailyPlans,
  distributionMode,
  editedWeekDailyPlans,
  setEditedWeekDailyPlans,
  loadCampaignDetails,
  notify,
  setIsGeneratingWeek,
  isRegeneratingBlueprint,
  setIsRegeneratingBlueprint,
  blueprintImmutable,
  governanceLocked,
  setBlueprintRegenerateFailedMsg,
  setIsEnhancingAllWeeks,
  setIsSavingWeekPlan,
  router,
}: {
  id: string | undefined;
  campaign: Campaign | null;
  effectiveCompanyId: string;
  weeklyPlans: WeeklyPlan[];
  dailyPlans: DailyPlan[];
  distributionMode: 'staggered' | 'same_day_per_topic';
  editedWeekDailyPlans: Record<number, DailyPlan[]>;
  setEditedWeekDailyPlans: React.Dispatch<React.SetStateAction<Record<number, DailyPlan[]>>>;
  loadCampaignDetails: (campaignId: string) => Promise<void>;
  notify: Notify;
  setIsGeneratingWeek: React.Dispatch<React.SetStateAction<number | null>>;
  isRegeneratingBlueprint: boolean;
  setIsRegeneratingBlueprint: React.Dispatch<React.SetStateAction<boolean>>;
  blueprintImmutable: boolean;
  governanceLocked: boolean;
  setBlueprintRegenerateFailedMsg: React.Dispatch<React.SetStateAction<string | null>>;
  setIsEnhancingAllWeeks: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSavingWeekPlan: React.Dispatch<React.SetStateAction<number | null>>;
  router: { push: (url: string) => Promise<boolean> | void };
}) {
  const enhanceWeekWithAI = async (weekNumber: number) => {
    if (!id) return;
    const weekPlan = weeklyPlans.find((week) => week.weekNumber === weekNumber);
    setIsGeneratingWeek(weekNumber);
    try {
      const response = await apiFetch('/api/campaigns/generate-weekly-structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: effectiveCompanyId,
          campaignId: id,
          week: weekNumber,
          theme: weekPlan?.theme || `Week ${weekNumber} Theme`,
          contentFocus: weekPlan?.focusArea || `Week ${weekNumber} Content Focus`,
          targetAudience: 'General Audience',
          distribution_mode: distributionMode,
        }),
      });

      if (response.ok) {
        await loadCampaignDetails(id);
        setEditedWeekDailyPlans((prev) => {
          const next = { ...prev };
          delete next[weekNumber];
          return next;
        });
        notify('success', `Week ${weekNumber} has been enhanced with AI.`);
      } else {
        const fallbackRes = await apiFetch('/api/campaigns/generate-ai-daily-plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaignId: id,
            weekNumber,
            companyId: effectiveCompanyId,
            provider: 'demo',
          }),
        });
        if (fallbackRes.ok) {
          await loadCampaignDetails(id);
          setEditedWeekDailyPlans((prev) => {
            const next = { ...prev };
            delete next[weekNumber];
            return next;
          });
          notify('success', `Generated 7 daily plans for week ${weekNumber}.`);
        } else {
          const fallbackError = await fallbackRes.json().catch(() => ({}));
          notify('error', fallbackError?.error || 'Failed to generate daily plans.');
        }
      }
    } catch (error) {
      console.error('Error enhancing week:', error);
      notify('error', 'Error enhancing week. Please try again.');
    } finally {
      setIsGeneratingWeek(null);
    }
  };

  const regenerateWeekDailyPlan = async (weekNumber: number) => {
    await enhanceWeekWithAI(weekNumber);
  };

  const createWeekPlanFromStoredContext = async () => {
    if (!id || !campaign || !effectiveCompanyId || isRegeneratingBlueprint || blueprintImmutable || governanceLocked) return;
    if ((campaign as { duration_weeks?: number }).duration_weeks == null) {
      notify('error', 'Set campaign duration first (pre-planning).');
      setTimeout(() => {
        const el = document.getElementById('pre-planning') || document.querySelector('[data-preplanning]');
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return;
    }
    setIsRegeneratingBlueprint(true);
    setBlueprintRegenerateFailedMsg(null);
    try {
      let planningContext: Record<string, unknown> | undefined;
      if (typeof window !== 'undefined') {
        const stored = sessionStorage.getItem(`campaign_planning_context_${campaign.id}`);
        if (stored) {
          try {
            planningContext = JSON.parse(stored) as Record<string, unknown>;
          } catch {}
        }
      }
      const res = await apiFetch('/api/campaigns/regenerate-blueprint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: campaign.id,
          companyId: effectiveCompanyId,
          ...(planningContext && Object.keys(planningContext).length > 0 ? { planningContext } : {}),
        }),
      });
      if (res.ok) {
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem(`campaign_planning_context_${campaign.id}`);
        }
        notify('success', 'Week plan created from stored strategic theme and context.');
        await loadCampaignDetails(id);
      } else {
        const errData = await res.json().catch(() => ({}));
        const msg = errData?.message || errData?.error || 'Failed to create plan from stored context';
        setBlueprintRegenerateFailedMsg(msg);
        notify('error', msg);
      }
    } catch (err) {
      console.error('Create week plan from stored context failed', err);
      const msg = err instanceof Error ? err.message : 'Failed to create plan from stored context';
      setBlueprintRegenerateFailedMsg(msg);
      notify('error', msg);
    } finally {
      setIsRegeneratingBlueprint(false);
    }
  };

  const enhanceAllWeeksWithAI = async () => {
    if (!id || !campaign?.start_date || !(campaign as any).duration_weeks || !effectiveCompanyId) return;
    const total = (campaign as any).duration_weeks as number;
    const allWeeks = Array.from({ length: total }, (_, index) => index + 1);
    setIsEnhancingAllWeeks(true);
    let generatedCount = 0;
    try {
      for (const weekNumber of allWeeks) {
        const weekPlan = weeklyPlans.find((week) => week.weekNumber === weekNumber);
        const response = await apiFetch('/api/campaigns/generate-weekly-structure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId: effectiveCompanyId,
            campaignId: id,
            week: weekNumber,
            theme: (weekPlan as any)?.theme || `Week ${weekNumber} Theme`,
            contentFocus: (weekPlan as any)?.focusArea || `Week ${weekNumber} Content Focus`,
            targetAudience: 'General Audience',
            distribution_mode: distributionMode,
          }),
        });
        if (!response.ok) {
          const fallbackRes = await apiFetch('/api/campaigns/generate-ai-daily-plans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ campaignId: id, weekNumber, companyId: effectiveCompanyId, provider: 'demo' }),
          });
          if (!fallbackRes.ok) {
            const fallbackError = await fallbackRes.json().catch(() => ({}));
            notify('error', fallbackError?.error || `Failed to generate plans for week ${weekNumber}.`);
            break;
          }
        }
        generatedCount += 1;
      }
      notify('success', `Daily plans generated for ${generatedCount} of ${total} week(s). Opening daily plan page.`);
      await router.push(buildDailyPlanPageUrl(id, effectiveCompanyId));
    } catch (error) {
      console.error('Error enhancing all weeks:', error);
      notify('error', 'Error generating daily plans. Please try again.');
    } finally {
      setIsEnhancingAllWeeks(false);
    }
  };

  const saveWeekDailyPlan = async (weekNumber: number) => {
    if (!id) return;
    const weekList = editedWeekDailyPlans[weekNumber] ?? dailyPlans.filter((day) => day.weekNumber === weekNumber);
    if (weekList.length === 0) {
      notify('info', 'No daily plan items to save.');
      return;
    }
    setIsSavingWeekPlan(weekNumber);
    try {
      const response = await apiFetch('/api/campaigns/save-week-daily-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: id,
          weekNumber,
          items: weekList.map((plan) => ({ id: plan.id, dayOfWeek: plan.dayOfWeek })),
        }),
      });
      const data = response.ok ? await response.json() : null;
      if (data?.success) {
        await loadCampaignDetails(id);
        setEditedWeekDailyPlans((prev) => {
          const next = { ...prev };
          delete next[weekNumber];
          return next;
        });
        notify('success', 'Plan saved and set for the next stage.');
      } else {
        notify('error', data?.error || 'Failed to save plan.');
      }
    } catch (error) {
      console.error('Error saving week daily plan:', error);
      notify('error', 'Error saving plan. Please try again.');
    } finally {
      setIsSavingWeekPlan(null);
    }
  };

  return {
    enhanceWeekWithAI,
    regenerateWeekDailyPlan,
    createWeekPlanFromStoredContext,
    enhanceAllWeeksWithAI,
    saveWeekDailyPlan,
  };
}
