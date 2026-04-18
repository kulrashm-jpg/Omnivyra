import type { Dispatch, SetStateAction } from 'react';
import type { NextRouter } from 'next/router';
import { htmlToPlainText } from '@/components/RichTextEditor';
import { apiFetch } from '@/lib/apiFetch';
import type { ScheduleItem } from '../types/activityWorkspace';
import type { RefineChatMessage, WorkspacePayload } from '@/lib/activity-workspace/shared';

type NotifyFn = (type: 'success' | 'error' | 'info', message: string) => void;

type Params = {
  payload: WorkspacePayload | null;
  schedules: ScheduleItem[];
  platformVariants: Array<Record<string, unknown>>;
  workspaceKey: string;
  queryCampaignId: string;
  selectedCompanyId: string | null | undefined;
  connectedPlatforms: Set<string>;
  router: NextRouter;
  normalizeKey: (value: unknown) => string;
  labelize: (value: string) => string;
  notify: NotifyFn;
  findVariantForSchedule: (item: ScheduleItem) => Record<string, unknown> | null;
  updateSchedule: (id: string, updates: Partial<ScheduleItem>) => void;
  setPayload: Dispatch<SetStateAction<WorkspacePayload | null>>;
  setConnectedPlatforms: Dispatch<SetStateAction<Set<string>>>;
  setIsRefiningByScheduleId: Dispatch<SetStateAction<Record<string, boolean>>>;
  setRefineMessagesByScheduleId: Dispatch<SetStateAction<Record<string, RefineChatMessage[]>>>;
  setRefineInputByScheduleId: Dispatch<SetStateAction<Record<string, string>>>;
  setFinalizedByScheduleId: Dispatch<SetStateAction<Record<string, boolean>>>;
  setSchedulingByScheduleId: Dispatch<SetStateAction<Record<string, boolean>>>;
  refineInputByScheduleId: Record<string, string>;
};

function buildActivityRequestPayload(payload: WorkspacePayload | null, schedules: ScheduleItem[]) {
  const primary = schedules[0];
  return {
    id: payload?.activityId || primary?.id || `workspace-${Date.now()}`,
    platform: primary?.platform || 'linkedin',
    contentType: primary?.contentType || 'post',
    topic: payload?.topic || payload?.title || '',
    title: payload?.title || payload?.topic || '',
    description: payload?.description || '',
  };
}

export function useActivityWorkspaceRefinementOps({
  payload,
  schedules,
  platformVariants,
  workspaceKey,
  queryCampaignId,
  selectedCompanyId,
  connectedPlatforms,
  router,
  normalizeKey,
  labelize,
  notify,
  findVariantForSchedule,
  updateSchedule,
  setPayload,
  setConnectedPlatforms,
  setIsRefiningByScheduleId,
  setRefineMessagesByScheduleId,
  setRefineInputByScheduleId,
  setFinalizedByScheduleId,
  setSchedulingByScheduleId,
  refineInputByScheduleId,
}: Params) {
  const upsertVariantForSchedule = (schedule: ScheduleItem, updates: Record<string, unknown>) => {
    const next = [...platformVariants];
    const existingIndex = next.findIndex(
      (variant) =>
        normalizeKey((variant as any)?.platform) === normalizeKey(schedule.platform) &&
        normalizeKey((variant as any)?.content_type) === normalizeKey(schedule.contentType)
    );
    const base =
      existingIndex >= 0
        ? (next[existingIndex] as Record<string, unknown>)
        : ({
            platform: schedule.platform,
            content_type: schedule.contentType,
            generated_content: '',
            generation_status: 'generated',
            adapted_from_master: true,
            locked_variant: false,
          } as Record<string, unknown>);
    const merged = {
      ...base,
      platform: schedule.platform,
      content_type: schedule.contentType,
      ...updates,
    };
    if (existingIndex >= 0) {
      next[existingIndex] = merged;
    } else {
      next.push(merged);
    }
    const nextDaily = {
      ...(payload?.dailyExecutionItem || {}),
      platform_variants: next,
    };
    setPayload((prev) => (prev ? { ...prev, dailyExecutionItem: nextDaily } : prev));
  };

  const handleRefineWithAi = async (schedule: ScheduleItem) => {
    const prompt = String(refineInputByScheduleId[schedule.id] || '').trim();
    if (!prompt) {
      notify('info', 'Type refinement instruction first.');
      return;
    }
    const variant = findVariantForSchedule(schedule);
    const currentContent = String((variant as any)?.generated_content || '').trim();
    if (!currentContent) {
      notify('info', 'Generate repurposed content first.');
      return;
    }
    try {
      setIsRefiningByScheduleId((prev) => ({ ...prev, [schedule.id]: true }));
      const response = await apiFetch('/api/activity-workspace/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'refine_variant',
          activity: buildActivityRequestPayload(payload, schedules),
          schedule,
          refinement_prompt: prompt,
          current_content: currentContent,
          dailyExecutionItem: payload?.dailyExecutionItem || null,
          companyId: selectedCompanyId || payload?.companyId || null,
          campaignId: payload?.campaignId || queryCampaignId || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.message || data?.error || 'Failed to refine content'));
      }
      const refinedContent = String(data?.refined_content || '').trim();
      if (!refinedContent) {
        throw new Error('AI returned empty refined content');
      }
      upsertVariantForSchedule(schedule, {
        generated_content: refinedContent,
        generation_status: 'generated',
        refinement_status: 'in_progress',
        refinement_finalized: false,
      });
      setRefineMessagesByScheduleId((prev) => ({
        ...prev,
        [schedule.id]: [
          ...(prev[schedule.id] || []),
          { role: 'user', content: prompt },
          { role: 'assistant', content: refinedContent },
        ],
      }));
      setRefineInputByScheduleId((prev) => ({ ...prev, [schedule.id]: '' }));
      setFinalizedByScheduleId((prev) => ({ ...prev, [schedule.id]: false }));
      updateSchedule(schedule.id, { status: 'in-progress' });
    } catch (error) {
      console.error('Refine with AI failed:', error);
      notify('error', `Failed to refine content: ${String((error as any)?.message || error)}`);
    } finally {
      setIsRefiningByScheduleId((prev) => ({ ...prev, [schedule.id]: false }));
    }
  };

  const finalizeRepurposeForSchedule = (schedule: ScheduleItem) => {
    const variant = findVariantForSchedule(schedule);
    const content = String((variant as any)?.generated_content || '').trim();
    if (!content) {
      notify('info', 'Generate content before finalizing.');
      return;
    }
    setFinalizedByScheduleId((prev) => ({ ...prev, [schedule.id]: true }));
    upsertVariantForSchedule(schedule, {
      refinement_status: 'finalized',
      refinement_finalized: true,
    });
    updateSchedule(schedule.id, { status: 'finalized' });
  };

  const refreshConnectedPlatforms = async () => {
    const companyId = String(payload?.companyId || '').trim();
    if (!companyId) return;
    try {
      const response = await apiFetch(`/api/social-accounts/status?companyId=${encodeURIComponent(companyId)}`);
      const data = response.ok ? await response.json().catch(() => null) : null;
      if (!data?.accounts) return;
      const connected = new Set<string>(
        (data.accounts as Array<{ platform_key: string; connected: boolean }>)
          .filter((account) => account.connected)
          .map((account) => account.platform_key)
      );
      setConnectedPlatforms(connected);
    } catch {}
  };

  const scheduleFinalizedContent = async (schedule: ScheduleItem) => {
    const variant = findVariantForSchedule(schedule);
    const rawContent = htmlToPlainText(String((variant as any)?.generated_content || '')).trim();

    if (!rawContent) {
      notify('info', 'Generate and finalize content before scheduling.');
      return;
    }
    if (!schedule.date) {
      notify('info', 'Set a date for this schedule item first.');
      return;
    }

    const hashtags: string[] = Array.isArray((variant as any)?.discoverability_meta?.hashtags)
      ? (variant as any).discoverability_meta.hashtags
      : [];
    const hashtagLine = hashtags.filter(Boolean).join(' ');
    const fullContent = hashtagLine ? `${rawContent}\n\n${hashtagLine}` : rawContent;

    const campaignId = String(payload?.campaignId || '').trim();
    const companyId = String(payload?.companyId || '').trim();
    const executionId = String(
      schedule.executionId ||
        (payload?.dailyExecutionItem as any)?.execution_id ||
        ''
    ).trim();

    setSchedulingByScheduleId((prev) => ({ ...prev, [schedule.id]: true }));
    try {
      const response = await apiFetch('/api/activity-workspace/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          companyId,
          executionId,
          platform: schedule.platform,
          contentType: schedule.contentType,
          title: String(payload?.title || payload?.topic || schedule.title || '').trim(),
          content: fullContent,
          scheduledDate: schedule.date,
          scheduledTime: schedule.time || '09:00',
          repurposeIndex: schedule.sequence_index ?? 1,
          repurposeTotal: schedule.total_distributions ?? 1,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = String(errorData?.error || 'Failed to schedule post');
        notify('error', errorMessage);
        if (response.status === 422 && !connectedPlatforms.has(normalizeKey(schedule.platform))) {
          await refreshConnectedPlatforms();
        }
        return;
      }
      updateSchedule(schedule.id, { status: 'scheduled' });
      notify('success', `Scheduled ${labelize(schedule.platform)} ${labelize(schedule.contentType)} for ${schedule.date} - visible on the dashboard calendar.`);
    } catch (error: any) {
      notify('error', String(error?.message || 'Failed to schedule post'));
    } finally {
      setSchedulingByScheduleId((prev) => ({ ...prev, [schedule.id]: false }));
    }
  };

  const saveAndSendBack = () => {
    if (workspaceKey) {
      try {
        const nextPayload = { ...(payload || {}), schedules };
        window.sessionStorage.setItem(workspaceKey, JSON.stringify(nextPayload));
      } catch (error) {
        console.warn('Failed to persist workspace payload:', error);
      }
    }
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        {
          type: 'ACTIVITY_WORKSPACE_SAVE',
          workspaceKey,
          schedules,
          dailyExecutionItem: payload?.dailyExecutionItem || null,
        },
        window.location.origin
      );
    }
    notify('success', 'Changes saved to daily planner.');
  };

  const getBackToWeekPlanUrl = (): string | null => {
    const campaignId = String(payload?.campaignId || '').trim();
    if (!campaignId) return null;
    const params = new URLSearchParams();
    const companyId = payload?.companyId != null ? String(payload.companyId) : '';
    if (companyId) params.set('companyId', companyId);
    if (payload?.weekNumber != null && Number.isFinite(payload.weekNumber)) {
      params.set('week', String(payload.weekNumber));
    }
    const queryString = params.toString();
    return `/campaign-details/${campaignId}${queryString ? `?${queryString}` : ''}`;
  };

  const handleBackToWeekPlan = () => {
    const url = getBackToWeekPlanUrl();
    if (url) {
      router.push(url);
    } else {
      router.back();
    }
  };

  return {
    buildActivityRequestPayload: () => buildActivityRequestPayload(payload, schedules),
    upsertVariantForSchedule,
    handleRefineWithAi,
    finalizeRepurposeForSchedule,
    scheduleFinalizedContent,
    saveAndSendBack,
    getBackToWeekPlanUrl,
    handleBackToWeekPlan,
  };
}
