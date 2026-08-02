import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/apiFetch';
import { ApiFetchError } from '@/lib/swr/swrClient';
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

/* OPT-005 Phase 2C — the three read surfaces (resolve, weekly plans, daily
 * plans) are SWR entries keyed on their exact request URLs (workspace key or
 * campaign+execution for resolve; campaign for the plan lists). The
 * imperative application logic — storage-first hydration, payload/schedule
 * matching, write ordering — is unchanged; SWR only owns the GETs, so
 * duplicate mounts and revisits share one request per key. Generation,
 * planner writes and save operations are untouched. Focus/reconnect
 * revalidation is disabled: these were one-shot reads and must stay so. */
const WORKSPACE_SWR_OPTS = { revalidateOnFocus: false, revalidateOnReconnect: false } as const;

async function fetchResolvePayload(url: string): Promise<{ payload?: unknown; workspaceKey?: string }> {
  const response = await apiFetch(url);
  if (!response.ok) throw new ApiFetchError(url, response.status);
  return response.json();
}

/** Plan-list reads: parse failures degrade to [] exactly like the old inline
 *  `.json().catch(() => [])`; non-OK throws and the apply step treats the
 *  error as an empty list (old behaviour for `!res.ok`). */
async function fetchPlanList(url: string): Promise<unknown> {
  const response = await apiFetch(url);
  if (!response.ok) throw new ApiFetchError(url, response.status);
  return response.json().catch(() => []);
}

type HydrateTarget = {
  campaignId: string;
  weekNumber: number;
  currentTitle: string;
  currentDaily: Record<string, unknown>;
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
  const [resolveUrl, setResolveUrl] = useState<string | null>(null);
  const { data: resolveData, error: resolveError } = useSWR(resolveUrl, fetchResolvePayload, WORKSPACE_SWR_OPTS);

  useEffect(() => {
    if (!routerIsReady) return;
    if (!workspaceKey) {
      setIsLoaded(true);
      return;
    }
    try {
      const raw = typeof window !== 'undefined'
        ? (window.sessionStorage.getItem(workspaceKey) ?? window.localStorage.getItem(workspaceKey))
        : null;
      if (raw) {
        const parsed = JSON.parse(raw) as WorkspacePayload;
        setPayload(parsed);
        setSchedules(Array.isArray(parsed?.schedules) ? parsed.schedules : []);
        setIsHydratingContext(false);
        setIsLoaded(true);
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
        // Hand the read to the SWR entry; completion is applied below.
        setResolveUrl(`/api/activity-workspace/resolve?${params}`);
        return;
      }
    } catch (error) {
      console.error('Failed to load workspace payload:', error);
    }
    setIsHydratingContext(false);
    setIsLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerIsReady, workspaceKey, queryCampaignId, queryExecutionId, queryWorkspaceKey]);

  // Apply the resolved payload once the SWR entry settles — the same success
  // branch, storage writes and finally-ordering as the old inline fetch.
  useEffect(() => {
    if (!resolveUrl) return;
    if (resolveData === undefined && resolveError === undefined) return; // in flight
    if (resolveData) {
      const resolvedPayload = resolveData?.payload;
      if (resolvedPayload && typeof resolvedPayload === 'object') {
        setPayload(resolvedPayload as WorkspacePayload);
        setSchedules(
          Array.isArray((resolvedPayload as WorkspacePayload)?.schedules)
            ? ((resolvedPayload as WorkspacePayload).schedules as ScheduleItem[])
            : []
        );
        const resolvedKey = resolveData?.workspaceKey || workspaceKey;
        try {
          window.sessionStorage.setItem(resolvedKey, JSON.stringify(resolvedPayload));
          window.localStorage.setItem(resolvedKey, JSON.stringify(resolvedPayload));
        } catch {}
      }
    } else if (resolveError) {
      console.error('Failed to load workspace payload:', resolveError);
    }
    setIsHydratingContext(false);
    setIsLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveUrl, resolveData, resolveError, workspaceKey]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  // ── Weekly/daily context hydration ─────────────────────────────────────────
  // The gate below is the old effect's early-exit logic verbatim; when it
  // decides to hydrate it snapshots the matching context and lets the two SWR
  // entries fetch. The apply effect runs the unchanged matching logic once
  // both entries settle, then closes with the same finally-flags.
  const [hydrateTarget, setHydrateTarget] = useState<HydrateTarget | null>(null);

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

    setIsHydratingContext(true);
    setHydrateTarget({ campaignId, weekNumber, currentTitle, currentDaily });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, hasTriedHydration, isHydratingContext, schedules]);

  const { data: weeklyRaw, error: weeklyError } = useSWR(
    hydrateTarget ? `/api/campaigns/get-weekly-plans?campaignId=${encodeURIComponent(hydrateTarget.campaignId)}` : null,
    fetchPlanList,
    WORKSPACE_SWR_OPTS
  );
  const { data: dailyRaw, error: dailyError } = useSWR(
    hydrateTarget ? `/api/campaigns/daily-plans?campaignId=${encodeURIComponent(hydrateTarget.campaignId)}` : null,
    fetchPlanList,
    WORKSPACE_SWR_OPTS
  );

  useEffect(() => {
    if (!hydrateTarget || hasTriedHydration) return;
    const weeklySettled = weeklyRaw !== undefined || weeklyError !== undefined;
    const dailySettled = dailyRaw !== undefined || dailyError !== undefined;
    if (!weeklySettled || !dailySettled) return;

    const { weekNumber, currentTitle, currentDaily } = hydrateTarget;
    try {
      const weeklyData = weeklyError ? [] : weeklyRaw;
      const dailyData = dailyError ? [] : dailyRaw;

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
        return; // finally-flags below close out the attempt
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
      setIsHydratingContext(false);
      setHasTriedHydration(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrateTarget, hasTriedHydration, weeklyRaw, dailyRaw, weeklyError, dailyError]);

  return {
    didInitialLoadRef,
  };
}
