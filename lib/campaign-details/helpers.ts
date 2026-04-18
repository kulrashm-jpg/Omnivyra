import type { DailyPlan } from './types';
import { truncateMeaningfulTitle } from '../../lib/ui/truncateMeaningfulTitle';

export const displayWeeklyTitle = (value: string | undefined | null, fallback = 'Untitled Topic') => {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  return truncateMeaningfulTitle(raw);
};

export const buildCampaignDetailsUrl = (
  campaignId: string,
  effectiveCompanyId: string,
  focus?: string
) => {
  const params = new URLSearchParams();
  if (effectiveCompanyId) params.set('companyId', effectiveCompanyId);
  if (focus) params.set('focus', focus);
  return `/campaign-details/${campaignId}${params.toString() ? `?${params.toString()}` : ''}`;
};

export const buildCampaignCalendarUrl = (
  campaignId: string,
  effectiveCompanyId: string,
  weekNumber?: number,
  day?: string
) => {
  const params = new URLSearchParams();
  if (effectiveCompanyId) params.set('companyId', effectiveCompanyId);
  if (Number.isFinite(weekNumber) && Number(weekNumber) > 0) params.set('week', String(weekNumber));
  if (day) params.set('day', day);
  return `/campaign-calendar/${campaignId}${params.toString() ? `?${params.toString()}` : ''}`;
};

export const buildPlanningWorkspaceUrl = (
  campaignId: string,
  effectiveCompanyId: string,
) => buildCampaignDetailsUrl(campaignId, effectiveCompanyId);

export const getWeekDatesFromCampaignStart = (campaignStartDate: string | null | undefined, weekNumber: number) => {
  const startDateRaw = String(campaignStartDate || '').trim();
  const baseDate = startDateRaw ? new Date(startDateRaw) : new Date();
  const safeBase = Number.isFinite(baseDate.getTime()) ? baseDate : new Date();
  const weekStart = new Date(safeBase);
  weekStart.setDate(safeBase.getDate() + (Math.max(1, weekNumber) - 1) * 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return {
    start: weekStart.toISOString().split('T')[0],
    end: weekEnd.toISOString().split('T')[0],
    startFormatted: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    endFormatted: weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  };
};

export const normalizeComparableText = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export const buildTopicWorkspacePayload = ({
  campaignId,
  campaignStartDate,
  dailyPlans,
  topic,
  weekNumber,
}: {
  campaignId: string | null;
  campaignStartDate?: string | null;
  dailyPlans: DailyPlan[];
  topic: any;
  weekNumber: number;
}) => {
  const topicTitle = String(topic?.topicTitle || '').trim();
  if (!topicTitle) return null;

  const topicPlatforms = Array.isArray(topic?.topicExecution?.platformTargets)
    ? topic.topicExecution.platformTargets.map((p: unknown) => String(p || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const topicContentType = String(topic?.topicExecution?.contentType || 'post').trim().toLowerCase();
  const normalizedTopicTitle = normalizeComparableText(topicTitle);

  const matchedDailyRows = dailyPlans.filter((d) => {
    if (Number(d.weekNumber) !== Number(weekNumber)) return false;
    const dailyTopic =
      normalizeComparableText(d.topic) ||
      normalizeComparableText(d.title) ||
      normalizeComparableText((d.dailyObject as any)?.topicTitle) ||
      normalizeComparableText((d.dailyObject as any)?.topic);
    return dailyTopic === normalizedTopicTitle;
  });

  const weekDates = getWeekDatesFromCampaignStart(campaignStartDate, weekNumber);
  const schedulesFromDaily = matchedDailyRows.map((d) => ({
    id: String(d.id),
    platform: String(d.platform || '').trim().toLowerCase() || 'linkedin',
    contentType: String(d.contentType || topicContentType || 'post').trim().toLowerCase(),
    date: String((d as any).date || weekDates.start),
    time: String(d.scheduledTime || '09:00'),
    status: String(d.status || 'planned'),
    description: String(d.description || d.summary || ''),
    title: String(d.title || topicTitle),
  }));

  const schedulesFallback = topicPlatforms.map((platform, idx) => ({
    id: `wk${weekNumber}-${platform}-${idx}-${Date.now()}`,
    platform,
    contentType: topicContentType || 'post',
    date: weekDates.start,
    time: '09:00',
    status: 'planned',
    description: String(topic?.topicContext?.writingIntent || ''),
    title: topicTitle,
  }));

  const schedules =
    schedulesFromDaily.length > 0
      ? schedulesFromDaily
      : schedulesFallback.length > 0
        ? schedulesFallback
        : [
            {
              id: `wk${weekNumber}-topic-${Date.now()}`,
              platform: 'linkedin',
              contentType: topicContentType || 'post',
              date: weekDates.start,
              time: '09:00',
              status: 'planned',
              description: String(topic?.topicContext?.writingIntent || ''),
              title: topicTitle,
            },
          ];

  const firstDailyObject =
    matchedDailyRows[0]?.dailyObject && typeof matchedDailyRows[0].dailyObject === 'object'
      ? (matchedDailyRows[0].dailyObject as Record<string, unknown>)
      : {};
  const dailyExecutionItem = {
    ...firstDailyObject,
    topic: topicTitle,
    title: topicTitle,
    platform: String(schedules[0]?.platform || 'linkedin'),
    content_type: String(schedules[0]?.contentType || topicContentType || 'post'),
    intent: {
      ...(typeof (firstDailyObject as any)?.intent === 'object'
        ? ((firstDailyObject as any).intent as Record<string, unknown>)
        : {}),
      objective: topic?.topicContext?.topicGoal || undefined,
      cta_type: topic?.topicExecution?.ctaType || undefined,
      pain_point: topic?.whatProblemAreWeAddressing || undefined,
      outcome_promise: topic?.whatShouldReaderLearn || undefined,
    },
    writer_content_brief: {
      ...(typeof (firstDailyObject as any)?.writer_content_brief === 'object'
        ? ((firstDailyObject as any).writer_content_brief as Record<string, unknown>)
        : {}),
      topicTitle,
      writingIntent: topic?.topicContext?.writingIntent || undefined,
      whoAreWeWritingFor: topic?.whoAreWeWritingFor || undefined,
      whatProblemAreWeAddressing: topic?.whatProblemAreWeAddressing || undefined,
      whatShouldReaderLearn: topic?.whatShouldReaderLearn || undefined,
      desiredAction: topic?.desiredAction || undefined,
      narrativeStyle: topic?.narrativeStyle || undefined,
      contentTypeGuidance: topic?.contentTypeGuidance || undefined,
    },
  };

  const dayLabel = String((matchedDailyRows[0] as any)?.dayOfWeek || 'Monday');
  const stableActivityId =
    matchedDailyRows[0]?.id != null
      ? String(matchedDailyRows[0].id)
      : `w${weekNumber}-${dayLabel.toLowerCase()}-${topicTitle
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, '')
          .slice(0, 40)}`;

  return {
    payload: {
      campaignId,
      weekNumber,
      day: dayLabel,
      activityId: stableActivityId,
      title: topicTitle,
      topic: topicTitle,
      description: String(topic?.topicContext?.writingIntent || ''),
      dailyExecutionItem,
      schedules,
    },
    workspaceKey: `activity-workspace-${campaignId ?? 'campaign'}-${stableActivityId}`,
  };
};

export const openTopicWorkspaceWindow = (workspaceData: {
  workspaceKey: string;
  payload: Record<string, unknown>;
}) => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(workspaceData.workspaceKey, JSON.stringify(workspaceData.payload));
  window.open(
    `/activity-workspace?workspaceKey=${encodeURIComponent(workspaceData.workspaceKey)}`,
    '_blank'
  );
};
