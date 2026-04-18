import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { asObject, type WorkspacePayload } from '@/lib/activity-workspace/shared';
import type { ScheduleItem } from '../types/activityWorkspace';

type Params = {
  routerIsReady: boolean;
  workspaceKey: string;
  queryCampaignId: string;
  queryExecutionId: string;
  queryWorkspaceKey: string;
  payload: WorkspacePayload | null;
  schedules: ScheduleItem[];
  isLoaded: boolean;
  hasTriedHydration: boolean;
  isHydratingContext: boolean;
  setPayload: Dispatch<SetStateAction<WorkspacePayload | null>>;
  setSchedules: Dispatch<SetStateAction<ScheduleItem[]>>;
  setIsLoaded: Dispatch<SetStateAction<boolean>>;
  setHasTriedHydration: Dispatch<SetStateAction<boolean>>;
  setIsHydratingContext: Dispatch<SetStateAction<boolean>>;
  setFinalizedByScheduleId: Dispatch<SetStateAction<Record<string, boolean>>>;
  buildScheduleRows: (item: Record<string, unknown>, existingSchedules: ScheduleItem[]) => ScheduleItem[];
  normalizeKey: (value: unknown) => string;
  normalizeComparableText: (value: unknown) => string;
};

export function useActivityWorkspacePersistence({
  routerIsReady,
  workspaceKey,
  queryCampaignId,
  queryExecutionId,
  queryWorkspaceKey,
  payload,
  schedules,
  isLoaded,
  hasTriedHydration,
  isHydratingContext,
  setPayload,
  setSchedules,
  setIsLoaded,
  setHasTriedHydration,
  setIsHydratingContext,
  setFinalizedByScheduleId,
  buildScheduleRows,
  normalizeKey,
  normalizeComparableText,
}: Params) {
  useEffect(() => {
    if (!routerIsReady) return;
    if (!workspaceKey) {
      setIsLoaded(true);
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        const raw = typeof window !== 'undefined'
          ? (window.sessionStorage.getItem(workspaceKey) ?? window.localStorage.getItem(workspaceKey))
          : null;
        if (raw) {
          const parsed = JSON.parse(raw) as WorkspacePayload;
          if (!cancelled) {
            setPayload(parsed);
            setSchedules(Array.isArray(parsed?.schedules) ? parsed.schedules : []);
          }
          if (!cancelled) setIsLoaded(true);
          return;
        }

        const canResolve =
          (queryCampaignId && queryExecutionId) ||
          (queryWorkspaceKey && String(queryWorkspaceKey).startsWith('activity-workspace-'));
        if (canResolve && typeof window !== 'undefined') {
          setHasTriedHydration(true);
          setIsHydratingContext(true);
          const params = new URLSearchParams();
          if (queryWorkspaceKey) params.set('workspaceKey', queryWorkspaceKey);
          else {
            params.set('campaignId', queryCampaignId);
            params.set('executionId', queryExecutionId);
          }
          const response = await apiFetch(`/api/activity-workspace/resolve?${params}`);
          if (!cancelled && response.ok) {
            const data = await response.json();
            const resolvedPayload = data?.payload;
            if (resolvedPayload && typeof resolvedPayload === 'object') {
              setPayload(resolvedPayload);
              setSchedules(Array.isArray(resolvedPayload?.schedules) ? resolvedPayload.schedules : []);
              const resolvedKey = data?.workspaceKey || workspaceKey;
              try {
                window.sessionStorage.setItem(resolvedKey, JSON.stringify(resolvedPayload));
                window.localStorage.setItem(resolvedKey, JSON.stringify(resolvedPayload));
              } catch {}
            }
          }
        }
      } catch (error) {
        if (!cancelled) console.error('Failed to load workspace payload:', error);
      } finally {
        if (!cancelled) {
          setIsHydratingContext(false);
          setIsLoaded(true);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [routerIsReady, workspaceKey, queryCampaignId, queryExecutionId, queryWorkspaceKey]);

  const didInitialLoadRef = useRef(false);
  useEffect(() => {
    if (!isLoaded || !workspaceKey) return;
    if (!didInitialLoadRef.current) {
      didInitialLoadRef.current = true;
      return;
    }
    try {
      window.sessionStorage.setItem(workspaceKey, JSON.stringify({ ...(payload || {}), schedules }));
      window.localStorage.setItem(workspaceKey, JSON.stringify({ ...(payload || {}), schedules }));
    } catch {}
  }, [payload, schedules, isLoaded, workspaceKey]);

  useEffect(() => {
    if (!isLoaded || schedules.length === 0) return;
    const restored: Record<string, boolean> = {};
    schedules.forEach((schedule) => {
      if (schedule.status === 'finalized' || schedule.status === 'scheduled') {
        restored[schedule.id] = true;
      }
    });
    if (Object.keys(restored).length > 0) {
      setFinalizedByScheduleId(restored);
    }
  }, [isLoaded]);

  useEffect(() => {
    if (!payload || hasTriedHydration || isHydratingContext) return;
    const campaignId = String(payload.campaignId || '').trim();
    const weekNumber = Number(payload.weekNumber);
    const currentTitle = normalizeComparableText(payload.title || payload.topic || '');
    if (!campaignId || !Number.isFinite(weekNumber) || !currentTitle) {
      setHasTriedHydration(true);
      return;
    }

    const currentDaily = asObject(payload.dailyExecutionItem) || {};
    const hasRichContext =
      Boolean(asObject(currentDaily.intent)) &&
      Boolean(asObject(currentDaily.writer_content_brief));
    if (hasRichContext && schedules.length > 1) {
      setHasTriedHydration(true);
      return;
    }

    let cancelled = false;
    const hydrate = async () => {
      try {
        setIsHydratingContext(true);
        const [weeklyRes, dailyRes] = await Promise.all([
          apiFetch(`/api/campaigns/get-weekly-plans?campaignId=${encodeURIComponent(campaignId)}`),
          apiFetch(`/api/campaigns/daily-plans?campaignId=${encodeURIComponent(campaignId)}`),
        ]);

        const weeklyData = weeklyRes.ok ? await weeklyRes.json().catch(() => []) : [];
        const dailyData = dailyRes.ok ? await dailyRes.json().catch(() => []) : [];
        if (cancelled) return;

        const weeks = Array.isArray(weeklyData) ? weeklyData : [];
        const weekMatch =
          weeks.find((week: any) => Number(week?.weekNumber) === weekNumber) ||
          weeks.find((week: any) => Number(week?.week_number) === weekNumber) ||
          null;
        const executionItems = Array.isArray((weekMatch as any)?.execution_items)
          ? (weekMatch as any).execution_items
          : [];

        const matchedExecution = executionItems.find((item: any) => {
          const titleValue = normalizeComparableText(item?.title || '');
          const topicValue = normalizeComparableText(item?.topic || '');
          return titleValue === currentTitle || topicValue === currentTitle;
        }) || null;

        const dailyPlans = Array.isArray(dailyData) ? dailyData : [];
        const matchedDailyRows = dailyPlans.filter((row: any) => {
          const rowWeek = Number(row?.weekNumber || row?.week_number);
          const rowTitle = normalizeComparableText(row?.title || row?.topic || '');
          return rowWeek === weekNumber && rowTitle === currentTitle;
        });

        if (!matchedExecution && matchedDailyRows.length === 0) {
          setHasTriedHydration(true);
          return;
        }

        const fromDailyRow = matchedDailyRows[0];
        const dailyRowBrief = fromDailyRow && (asObject((fromDailyRow as any)?.dailyObject) || fromDailyRow);
        const builtBriefFromRow = dailyRowBrief && !asObject((currentDaily as any)?.writer_content_brief) && !asObject((matchedExecution as any)?.writer_content_brief) ? {
          topicTitle: (dailyRowBrief.topicTitle ?? dailyRowBrief.topic ?? payload?.title ?? payload?.topic) as string,
          writingIntent: (dailyRowBrief.writingIntent ?? dailyRowBrief.description) as string,
          whatShouldReaderLearn: (dailyRowBrief.whatShouldReaderLearn ?? dailyRowBrief.introObjective) as string,
          whatProblemAreWeAddressing: (dailyRowBrief.whatProblemAreWeAddressing ?? dailyRowBrief.summary) as string,
          desiredAction: (dailyRowBrief.desiredAction ?? dailyRowBrief.cta) as string,
          narrativeStyle: (dailyRowBrief.narrativeStyle ?? dailyRowBrief.brandVoice) as string,
          topicGoal: (dailyRowBrief.dailyObjective ?? dailyRowBrief.objective) as string,
        } as Record<string, unknown> : null;
        const builtIntentFromRow = dailyRowBrief && !asObject((currentDaily as any)?.intent) && !asObject((matchedExecution as any)?.intent) ? {
          objective: (dailyRowBrief.dailyObjective ?? dailyRowBrief.objective) as string,
          pain_point: (dailyRowBrief.whatProblemAreWeAddressing ?? dailyRowBrief.summary ?? dailyRowBrief.pain_point) as string,
          outcome_promise: (dailyRowBrief.whatShouldReaderLearn ?? dailyRowBrief.introObjective ?? dailyRowBrief.outcome_promise) as string,
          cta_type: (dailyRowBrief.desiredAction ?? dailyRowBrief.cta ?? dailyRowBrief.cta_type) as string,
        } as Record<string, unknown> : null;

        const nextDailyExecution = {
          ...(matchedExecution || {}),
          ...currentDaily,
          intent: asObject((currentDaily as any)?.intent) || asObject((matchedExecution as any)?.intent) || builtIntentFromRow || undefined,
          writer_content_brief:
            asObject((currentDaily as any)?.writer_content_brief) ||
            asObject((matchedExecution as any)?.writer_content_brief) ||
            builtBriefFromRow ||
            undefined,
          master_content:
            asObject((currentDaily as any)?.master_content) ||
            asObject((matchedExecution as any)?.master_content) ||
            undefined,
          platform_variants:
            Array.isArray((currentDaily as any)?.platform_variants) && (currentDaily as any).platform_variants.length > 0
              ? (currentDaily as any).platform_variants
              : (Array.isArray((matchedExecution as any)?.platform_variants) ? (matchedExecution as any).platform_variants : undefined),
        };

        const hydratedSchedules = buildScheduleRows(nextDailyExecution, schedules).map((row) => {
          const matchingDaily = matchedDailyRows.find(
            (daily: any) =>
              normalizeKey(daily?.platform) === normalizeKey(row.platform) &&
              normalizeKey(daily?.contentType) === normalizeKey(row.contentType)
          );
          const scheduledTime = String(matchingDaily?.scheduledTime || '').trim();
          const normalizedTime = scheduledTime ? scheduledTime.split(':').slice(0, 2).join(':') : row.time;
          return {
            ...row,
            time: normalizedTime || row.time || '09:00',
          };
        });

        setPayload((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            dailyExecutionItem: nextDailyExecution,
            ...((weekMatch as any)?.distribution_strategy != null ? { distribution_strategy: (weekMatch as any).distribution_strategy } : {}),
            ...((weekMatch as any)?.distribution_reason != null ? { distribution_reason: (weekMatch as any).distribution_reason } : {}),
            ...((weekMatch as any)?.planning_adjustment_reason != null ? { planning_adjustment_reason: (weekMatch as any).planning_adjustment_reason } : {}),
            ...((weekMatch as any)?.planning_adjustments_summary != null ? { planning_adjustments_summary: (weekMatch as any).planning_adjustments_summary } : {}),
            ...((weekMatch as any)?.momentum_adjustments != null ? { momentum_adjustments: (weekMatch as any).momentum_adjustments } : {}),
            ...((weekMatch as any)?.week_extras != null ? { week_extras: (weekMatch as any).week_extras } : {}),
          };
        });
        setSchedules(hydratedSchedules);
      } catch (error) {
        console.warn('Workspace hydration failed:', error);
      } finally {
        if (!cancelled) {
          setIsHydratingContext(false);
          setHasTriedHydration(true);
        }
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [payload, hasTriedHydration, isHydratingContext, schedules]);

  return {
    didInitialLoadRef,
  };
}
