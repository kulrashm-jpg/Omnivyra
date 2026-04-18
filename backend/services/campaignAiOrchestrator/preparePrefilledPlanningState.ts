import { validateCapacityAndFrequency, type CapacityValidationResult } from '../capacityFrequencyValidationGateway';
import { buildDeterministicWeeklySkeleton, DeterministicWeeklySkeletonError } from '../deterministicWeeklySkeleton';
import { mapStrategyToSkeleton, type MappedWeeklySkeleton } from '../strategyMapper';
import {
  buildPrefilledPlanning,
  extractPlanningContextFromHistory,
  getNextMondayISO,
  mapRecommendationContextToGatherKeys,
} from '../campaign-ai/campaignAiPlanningContext';
import {
  normalizeCapacityCounts,
  normalizeCapacityCountsWithBreakdown,
  parseFrequencyPerWeek,
} from '../campaignAiCapacity';

export async function preparePrefilledPlanningState(args: {
  input: any;
  campaignRow: any;
  versionRow: any;
  resolvedDurationWeeks: number;
  sourcedDurationWeeks: number | null;
}) {
  const { input, campaignRow, versionRow, resolvedDurationWeeks, sourcedDurationWeeks } = args;

  let prefilledPlanning: Record<string, unknown> = buildPrefilledPlanning({
    campaign: campaignRow,
    versionRow,
  });
  const recommendationPrefilled = mapRecommendationContextToGatherKeys(input.recommendationContext);
  if (Object.keys(recommendationPrefilled).length > 0) {
    prefilledPlanning = { ...prefilledPlanning, ...recommendationPrefilled };
  }

  const incomingCollectedPlanningContext =
    input.collectedPlanningContext && typeof input.collectedPlanningContext === 'object'
      ? (input.collectedPlanningContext as Record<string, unknown>)
      : null;
  if (incomingCollectedPlanningContext && Object.keys(incomingCollectedPlanningContext).length > 0) {
    prefilledPlanning = { ...prefilledPlanning, ...incomingCollectedPlanningContext };
  }

  const prefilledExecConfig = (prefilledPlanning as any)?.execution_config;
  if (prefilledExecConfig != null && typeof prefilledExecConfig === 'object' && !Array.isArray(prefilledExecConfig)) {
    const ec = prefilledExecConfig as Record<string, unknown>;
    const hasTopLevelAvailable = (prefilledPlanning as any)?.available_content != null;
    const execAvailable = ec.available_content;
    const hasExecAvailable =
      execAvailable != null &&
      (typeof execAvailable === 'string' ? String(execAvailable).trim().length > 0 : typeof execAvailable === 'object');
    if (!hasTopLevelAvailable && hasExecAvailable) {
      prefilledPlanning = { ...prefilledPlanning, available_content: execAvailable };
    }

    const hasTopLevelCapacity =
      (prefilledPlanning as any)?.content_capacity != null || (prefilledPlanning as any)?.weekly_capacity != null;
    const execContentCapacity = ec.content_capacity;
    const hasExecCapacity =
      execContentCapacity != null &&
      (typeof execContentCapacity === 'string'
        ? String(execContentCapacity).trim().length > 0
        : typeof execContentCapacity === 'object' || typeof execContentCapacity === 'number');
    if (!hasTopLevelCapacity && hasExecCapacity) {
      prefilledPlanning = {
        ...prefilledPlanning,
        content_capacity: execContentCapacity,
        weekly_capacity: execContentCapacity,
      };
    }

    const hasPlatformRequests =
      (prefilledPlanning as any)?.platform_content_requests != null &&
      (Array.isArray((prefilledPlanning as any).platform_content_requests)
        ? (prefilledPlanning as any).platform_content_requests.length > 0
        : Object.keys((prefilledPlanning as any).platform_content_requests || {}).length > 0);
    const freqRaw = ec.frequency_per_week;
    const hasFreq = freqRaw != null && typeof freqRaw === 'string' && String(freqRaw).trim().length > 0;
    if (!hasPlatformRequests && hasFreq) {
      const n = parseFrequencyPerWeek(String(freqRaw).trim());
      if (n > 0) {
        const hasTopLevelCapacity =
          (prefilledPlanning as any)?.content_capacity != null || (prefilledPlanning as any)?.weekly_capacity != null;
        const capacityFromFreq = hasTopLevelCapacity ? undefined : { post: n };
        prefilledPlanning = {
          ...prefilledPlanning,
          platform_content_requests: [{ platform: 'linkedin', content_type: 'post', count_per_week: n }],
          ...(capacityFromFreq != null && {
            weekly_capacity: capacityFromFreq,
            content_capacity: capacityFromFreq,
          }),
        };
      }
    }

    const hasPlatformRequestsNow =
      (prefilledPlanning as any)?.platform_content_requests != null &&
      (Array.isArray((prefilledPlanning as any).platform_content_requests)
        ? (prefilledPlanning as any).platform_content_requests.length > 0
        : Object.keys((prefilledPlanning as any).platform_content_requests || {}).length > 0);
    const hasExecConfig =
      hasPlatformRequestsNow || hasExecCapacity || (freqRaw != null && typeof freqRaw === 'string' && String(freqRaw).trim().length > 0);
    const noTentativeStart = !(prefilledPlanning as any)?.tentative_start && !ec?.tentative_start;
    if (hasExecConfig && noTentativeStart) {
      prefilledPlanning = { ...prefilledPlanning, tentative_start: getNextMondayISO() };
    }
  }

  const incomingHasAvailableContent = Boolean(
    incomingCollectedPlanningContext &&
      Object.prototype.hasOwnProperty.call(incomingCollectedPlanningContext, 'available_content')
  );
  const incomingHasWeeklyCapacity = Boolean(
    incomingCollectedPlanningContext &&
      (Object.prototype.hasOwnProperty.call(incomingCollectedPlanningContext, 'weekly_capacity') ||
        Object.prototype.hasOwnProperty.call(incomingCollectedPlanningContext, 'content_capacity'))
  );

  const getTrustedUtcTodayISO = async (): Promise<string> => {
    if (process.env.NODE_ENV === 'test') return new Date().toISOString().slice(0, 10);
    try {
      const f = (globalThis as any)?.fetch as undefined | ((...args: any[]) => Promise<any>);
      if (typeof f === 'function') {
        const res = await f('https://www.google.com/generate_204', { method: 'HEAD' });
        const headerDate = res?.headers?.get?.('date');
        if (headerDate) {
          const d = new Date(String(headerDate));
          if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        }
      }
    } catch {
      // ignore
    }
    return new Date().toISOString().slice(0, 10);
  };
  const trustedUtcTodayISO = await getTrustedUtcTodayISO();

  const hasMeaningfulProvidedValue = (v: unknown): boolean => {
    if (v == null) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v === 'object' && !Array.isArray(v)) return Object.keys(v as Record<string, unknown>).length > 0;
    return false;
  };

  const hasExplicitCapacityAnswer = (v: unknown): boolean => {
    if (v == null) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      if (Boolean((obj as any)._declared_none || (obj as any).declared_none || (obj as any).declaredNone)) return true;
      const breakdown =
        obj.breakdown && typeof obj.breakdown === 'object' && !Array.isArray(obj.breakdown)
          ? (obj.breakdown as Record<string, unknown>)
          : null;
      if (breakdown && Object.values(breakdown).some((x) => Number(x) > 0)) return true;
      const counts = normalizeCapacityCounts(obj);
      return counts.post + counts.video + counts.blog + counts.story + counts.thread > 0;
    }
    return false;
  };

  const normalizedAvailableContent = normalizeCapacityCountsWithBreakdown((prefilledPlanning as any)?.available_content);
  const normalizedWeeklyCapacity = normalizeCapacityCountsWithBreakdown(
    (prefilledPlanning as any)?.weekly_capacity ?? (prefilledPlanning as any)?.content_capacity
  );
  prefilledPlanning = {
    ...prefilledPlanning,
    available_content: normalizedAvailableContent,
    weekly_capacity: normalizedWeeklyCapacity,
    content_capacity: normalizedWeeklyCapacity,
  };

  if ((prefilledPlanning as any)?.cross_platform_sharing == null && prefilledExecConfig != null) {
    prefilledPlanning = {
      ...prefilledPlanning,
      cross_platform_sharing: { enabled: true },
    };
  }

  const validation_result =
    input.mode === 'generate_plan'
      ? validateCapacityAndFrequency({
          weekly_capacity: (prefilledPlanning as any)?.weekly_capacity,
          available_content: (prefilledPlanning as any)?.available_content,
          exclusive_campaigns: (prefilledPlanning as any)?.exclusive_campaigns,
          platform_content_requests: (prefilledPlanning as any)?.platform_content_requests,
          cross_platform_sharing: (prefilledPlanning as any)?.cross_platform_sharing,
          content_repurposing: (prefilledPlanning as any)?.content_repurposing ?? { enabled: true },
          campaign_duration_weeks: (prefilledPlanning as any)?.campaign_duration ?? (prefilledPlanning as any)?.duration_weeks,
          message: input.message,
          override_confirmed: Boolean((prefilledPlanning as any)?.validation_result?.override_confirmed),
        })
      : null;
  if (validation_result) {
    prefilledPlanning = { ...prefilledPlanning, validation_result };
    if (incomingCollectedPlanningContext) (incomingCollectedPlanningContext as any).validation_result = validation_result;
    if ((validation_result as any)?.status === 'balanced' && Array.isArray((validation_result as any)?.balanced_requests)) {
      prefilledPlanning = {
        ...prefilledPlanning,
        platform_content_requests: (validation_result as any).balanced_requests,
      };
    }
  }

  let deterministicSkeleton: any = null;
  if (input.mode === 'generate_plan' && (prefilledPlanning as any)?.platform_content_requests) {
    const vr: any = (prefilledPlanning as any)?.validation_result ?? null;
    const shouldSkipSkeleton = vr && typeof vr === 'object' && vr.status === 'invalid' && !Boolean(vr.override_confirmed);
    if (!shouldSkipSkeleton) {
      try {
        deterministicSkeleton = await buildDeterministicWeeklySkeleton(prefilledPlanning as any);
        let mappedWeeklySkeleton: MappedWeeklySkeleton | null = null;
        try {
          const pcr = (prefilledPlanning as any)?.platform_content_requests;
          const platformsForMapper = Array.isArray(pcr)
            ? [...new Set((pcr as any[]).map((r: any) => String(r?.platform ?? '')).filter(Boolean))]
            : typeof pcr === 'object' && pcr !== null
              ? Object.keys(pcr).filter(Boolean)
              : [];
          const postingFreqForMapper: Record<string, number> = {};
          for (const p of platformsForMapper) postingFreqForMapper[p] = 3;
          mappedWeeklySkeleton = mapStrategyToSkeleton(
            deterministicSkeleton,
            {
              duration_weeks: resolvedDurationWeeks,
              platforms: platformsForMapper,
              posting_frequency: postingFreqForMapper,
              campaign_goal: (prefilledPlanning as any)?.campaign_goal ?? null,
              target_audience: (prefilledPlanning as any)?.target_audience ?? null,
            },
            input.account_context ?? null
          );
        } catch (mapErr) {
          console.warn('[campaign-ai][strategy-mapper] Non-fatal: failed to map strategy to skeleton:', mapErr);
        }

        if (incomingCollectedPlanningContext) {
          (incomingCollectedPlanningContext as any).deterministic_plan_skeleton = deterministicSkeleton;
          if (mappedWeeklySkeleton) (incomingCollectedPlanningContext as any).mapped_weekly_skeleton = mappedWeeklySkeleton;
        }
        prefilledPlanning = {
          ...prefilledPlanning,
          deterministic_plan_skeleton: deterministicSkeleton,
          ...(mappedWeeklySkeleton && { mapped_weekly_skeleton: mappedWeeklySkeleton }),
        };
      } catch (err) {
        if (err instanceof DeterministicWeeklySkeletonError) {
          const details = (err.details ?? {}) as any;
          const requested_total = Number(details.requested) || 0;
          const available_content_total = Number(details.available_content_total) || 0;
          const weekly_capacity_total = Number(details.content_capacity_total) || 0;
          const exclusive_campaigns_total = Number(details.exclusive_campaigns_reduction) || 0;
          const effective_capacity_total =
            Number(details.effective_capacity_total) || Math.max(0, weekly_capacity_total - exclusive_campaigns_total);
          const supply_total = available_content_total + effective_capacity_total;
          const deficit = Math.max(0, requested_total - supply_total);
          const normalized: CapacityValidationResult = {
            status: deficit > 0 ? 'invalid' : 'valid',
            override_confirmed: false,
            requested_total,
            requested_platform_postings_total: Number(details.requested_platform_postings_total) || undefined,
            weekly_capacity_total,
            exclusive_campaigns_total,
            effective_capacity_total,
            available_content_total,
            supply_total,
            deficit,
            requested_by_platform: {},
            suggested_adjustments: deficit > 0 ? { reduce_total_by: deficit } : undefined,
            explanation:
              deficit > 0
                ? 'Requested weekly execution exceeds available_content + weekly_capacity (after exclusive_campaigns consume capacity first).'
                : 'Requested weekly execution is within available_content + weekly_capacity (after exclusive_campaigns consume capacity first).',
          };
          prefilledPlanning = { ...prefilledPlanning, validation_result: normalized };
          if (incomingCollectedPlanningContext) (incomingCollectedPlanningContext as any).validation_result = normalized;
          deterministicSkeleton = null;
        } else {
          throw err;
        }
      }
    }
  }

  if (sourcedDurationWeeks != null && sourcedDurationWeeks >= 1 && sourcedDurationWeeks <= 52) {
    prefilledPlanning = { ...prefilledPlanning, campaign_duration: resolvedDurationWeeks };
  }
  if (sourcedDurationWeeks != null) {
    prefilledPlanning = { ...prefilledPlanning, preplanning_form_completed: true };
  }

  const fromHistory = extractPlanningContextFromHistory(input.conversationHistory ?? []);
  if (Object.keys(fromHistory).length > 0) {
    const merged = { ...fromHistory };
    const rawCps = fromHistory.cross_platform_sharing;
    if (rawCps != null && typeof rawCps === 'string') {
      const t = String(rawCps).trim().toLowerCase();
      merged.cross_platform_sharing =
        /^(unique|different|per platform|unique per platform)/.test(t) || (t.includes('unique') && !t.includes('shared'))
          ? { enabled: false }
          : { enabled: true };
    }
    prefilledPlanning = { ...prefilledPlanning, ...merged };
  }

  const fromHistoryHasAvailableContent = Boolean(
    fromHistory?.available_content != null &&
      (hasExplicitCapacityAnswer(fromHistory.available_content) ||
        /^(no|none|zero|don'?t have|do not have|no content|not yet)\b/i.test(String(fromHistory.available_content).trim()))
  );
  const fromHistoryHasContentCapacity = Boolean(
    fromHistory?.content_capacity != null && hasExplicitCapacityAnswer(fromHistory.content_capacity)
  );

  const computeQaPrefilledKeys = (values: Record<string, unknown>) => {
    const ec = (values as any)?.execution_config as Record<string, unknown> | null | undefined;
    const tentativeStart = (values as any)?.tentative_start ?? ec?.tentative_start;
    const hasTrustedIntelligentMixPrefill =
      (values as any)?.intelligent_mix_prefill === true || ec?.intelligent_mix_prefill === true;
    const hasMeaningfulGatherValue = (key: string, value: unknown): boolean => {
      if (key === 'platforms') {
        if (Array.isArray(value)) return value.length > 0;
        return value != null && String(value).trim().length > 0;
      }
      if (key === 'platform_content_requests') {
        if (Array.isArray(value)) return value.length > 0;
        if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
        return value != null && String(value).trim().length > 0;
      }
      if (key === 'exclusive_campaigns') {
        if (Array.isArray(value)) return true;
        return value != null && String(value).trim().length > 0;
      }
      if (key === 'available_content') return hasMeaningfulProvidedValue(value);
      if (key === 'weekly_capacity' || key === 'content_capacity') return hasExplicitCapacityAnswer(value);
      return value != null && (typeof value !== 'string' || String(value).trim().length > 0);
    };
    const keysToCheck = new Set(Object.keys(values || {}));
    if (ec?.tentative_start != null) keysToCheck.add('tentative_start');
    if (ec?.platforms != null) keysToCheck.add('platforms');
    if (ec?.platform_content_requests != null) keysToCheck.add('platform_content_requests');
    if (ec?.exclusive_campaigns != null) keysToCheck.add('exclusive_campaigns');
    if (ec?.available_content != null) keysToCheck.add('available_content');
    if (ec?.content_capacity != null) keysToCheck.add('content_capacity');
    return Array.from(keysToCheck).filter((k) => {
      if (k === 'available_content') {
        return (
          incomingHasAvailableContent ||
          fromHistoryHasAvailableContent ||
          (hasTrustedIntelligentMixPrefill && hasMeaningfulProvidedValue((values as any)?.available_content ?? ec?.available_content))
        );
      }
      if (k === 'weekly_capacity' || k === 'content_capacity') {
        return (
          incomingHasWeeklyCapacity ||
          fromHistoryHasContentCapacity ||
          (hasTrustedIntelligentMixPrefill && hasExplicitCapacityAnswer((values as any)?.[k] ?? ec?.[k]))
        );
      }
      if (k === 'tentative_start') {
        const t = typeof tentativeStart === 'string' ? tentativeStart.trim() : '';
        return /^\d{4}-\d{2}-\d{2}$/.test(t) && t >= trustedUtcTodayISO;
      }
      return hasMeaningfulGatherValue(k, (values as any)?.[k] ?? ec?.[k]);
    });
  };

  const qaPrefilledKeys = computeQaPrefilledKeys(prefilledPlanning || {});

  return {
    prefilledPlanning,
    incomingCollectedPlanningContext,
    trustedUtcTodayISO,
    fromHistoryHasAvailableContent,
    fromHistoryHasContentCapacity,
    qaPrefilledKeys,
    deterministicSkeleton,
  };
}
