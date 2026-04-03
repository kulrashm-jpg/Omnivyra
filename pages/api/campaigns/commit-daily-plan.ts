import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { syncCampaignVersionStage } from '../../../backend/db/campaignVersionStore';
import { buildDailyExecutionMetadata, parseDailyExecutionMetadata } from '../../../lib/dailyExecutionMetadata';
import { applyDefaultRetention } from '../../../backend/services/contentRetentionLifecycle';

type DailyExecutionItem = {
  execution_id: string;
  source_type: 'planned' | 'manual';
  campaign_id?: string;
  week_number?: number;
  platform: string;
  content_type: string;
  topic?: string;
  title?: string;
  content?: string;
  intent?: Record<string, unknown>;
  writer_content_brief?: Record<string, unknown>;
  narrative_role?: string;
  progression_step?: number;
  global_progression_index?: number;
  status: 'draft';
  scheduled_time?: string;
  retention_state?: 'temporary' | 'saved' | 'archived';
  expires_at?: string | null;
  archived_at?: string | null;
  content_visibility?: boolean;
  retention_reminders?: Array<{
    days_before: 30 | 15 | 7 | 1;
    remind_at: string;
    sent: boolean;
  }>;
  created_at?: string | null;
};

function warnDailyNormalizationIssue(item: Partial<DailyExecutionItem>, context: string): void {
  const source = String(item.source_type ?? '').trim().toLowerCase();
  if (source && source !== 'planned' && source !== 'manual') {
    console.warn('[daily-normalization][unknown-source-type]', {
      context,
      execution_id: item.execution_id ?? null,
      source_type: item.source_type ?? null,
    });
  }
  if (source === 'planned' && !String(item.execution_id ?? '').trim()) {
    console.warn('[daily-normalization][missing-execution-id-planned]', { context });
  } else if (!source && !String(item.execution_id ?? '').trim()) {
    console.warn('[daily-normalization][missing-execution-id]', { context });
  }
  if (!String(item.source_type ?? '').trim()) {
    console.warn('[daily-normalization][missing-source-type]', { context, execution_id: item.execution_id ?? null });
  }
  if (!String(item.platform ?? '').trim()) {
    console.warn('[daily-normalization][missing-platform]', { context, execution_id: item.execution_id ?? null });
  }
  if (!String(item.content_type ?? '').trim()) {
    console.warn('[daily-normalization][missing-content-type]', { context, execution_id: item.execution_id ?? null });
  }
}

function normalizeToDailyExecutionItem(activity: any, campaignId: string, weekNumber: number): DailyExecutionItem {
  const incoming = activity?.dailyExecutionItem && typeof activity.dailyExecutionItem === 'object'
    ? activity.dailyExecutionItem
    : null;
  const sourceTypeRaw = incoming?.source_type ?? activity?.sourceType;
  if (!String(sourceTypeRaw ?? '').trim()) {
    console.warn('[daily-normalization][missing-source-type]', {
      context: 'commit-daily-plan-normalize',
      execution_id: incoming?.execution_id ?? activity?.executionId ?? null,
    });
  } else if (!['planned', 'manual'].includes(String(sourceTypeRaw).trim().toLowerCase())) {
    console.warn('[daily-normalization][unknown-source-type]', {
      context: 'commit-daily-plan-normalize',
      execution_id: incoming?.execution_id ?? activity?.executionId ?? null,
      source_type: sourceTypeRaw,
    });
  }
  const normalized: DailyExecutionItem = {
    execution_id: String(incoming?.execution_id ?? activity?.executionId ?? `manual-${Date.now()}`).trim(),
    source_type: sourceTypeRaw === 'planned' ? 'planned' : 'manual',
    campaign_id: String(incoming?.campaign_id ?? campaignId),
    week_number: Number(incoming?.week_number ?? weekNumber),
    platform: String(incoming?.platform ?? activity?.platform ?? 'linkedin').trim().toLowerCase(),
    content_type: String(incoming?.content_type ?? activity?.contentType ?? 'post').trim().toLowerCase(),
    topic: typeof incoming?.topic === 'string' ? incoming.topic : activity?.topic,
    title: typeof incoming?.title === 'string' ? incoming.title : activity?.title,
    content: typeof incoming?.content === 'string' ? incoming.content : (activity?.description || activity?.content || ''),
    intent: incoming?.intent && typeof incoming.intent === 'object' ? incoming.intent : undefined,
    writer_content_brief:
      incoming?.writer_content_brief && typeof incoming.writer_content_brief === 'object'
        ? incoming.writer_content_brief
        : undefined,
    narrative_role: typeof incoming?.narrative_role === 'string' ? incoming.narrative_role : undefined,
    progression_step: Number.isFinite(Number(incoming?.progression_step)) ? Number(incoming.progression_step) : undefined,
    global_progression_index: Number.isFinite(Number(incoming?.global_progression_index))
      ? Number(incoming.global_progression_index)
      : undefined,
    status: 'draft',
    scheduled_time: typeof incoming?.scheduled_time === 'string' ? incoming.scheduled_time : activity?.time,
    retention_state:
      incoming?.retention_state === 'saved' || incoming?.retention_state === 'archived' || incoming?.retention_state === 'temporary'
        ? incoming.retention_state
        : undefined,
    expires_at: typeof incoming?.expires_at === 'string' || incoming?.expires_at === null ? incoming.expires_at : undefined,
    archived_at:
      typeof incoming?.archived_at === 'string' || incoming?.archived_at === null ? incoming.archived_at : undefined,
    content_visibility: typeof incoming?.content_visibility === 'boolean' ? incoming.content_visibility : undefined,
    retention_reminders: Array.isArray(incoming?.retention_reminders) ? incoming.retention_reminders : undefined,
    created_at:
      typeof incoming?.created_at === 'string'
        ? incoming.created_at
        : (typeof activity?.created_at === 'string' ? activity.created_at : new Date().toISOString()),
  };
  const withRetention = applyDefaultRetention(normalized);
  warnDailyNormalizationIssue(withRetention, 'commit-daily-plan');
  return withRetention;
}

function mapDailyItemToLegacyDbRow(args: {
  activity: any;
  dailyItem: DailyExecutionItem;
  campaignId: string;
  weekNumber: number;
  day: string;
  activityDate: Date;
  refinementId: string | null;
}) {
  const { activity, dailyItem, campaignId, weekNumber, day, activityDate, refinementId } = args;
  const normalizedScheduledTime = (() => {
    const raw = String(dailyItem.scheduled_time ?? activity.time ?? '').trim();
    if (!raw) return null;
    return raw.includes(':') ? (raw.length === 5 ? `${raw}:00` : raw) : `${raw}:00`;
  })();
  const existingResources = Array.isArray(activity?.requiredResources) ? activity.requiredResources : [];
  const sourceMarker = `daily_source:${dailyItem.source_type}`;
  const committedMarker = 'is_committed:true';
  const requiredResources = existingResources.includes(sourceMarker)
    ? existingResources
    : [...existingResources, sourceMarker];
  const requiredResourcesWithCommit = requiredResources.includes(committedMarker)
    ? requiredResources
    : [...requiredResources, committedMarker];
  const existingFormatNotes = String(activity.formatNotes ?? '').trim();
  const metadataSection = buildDailyExecutionMetadata({
    execution_id: dailyItem.execution_id,
    source_type: dailyItem.source_type,
    is_committed: true,
    retention_state: dailyItem.retention_state,
    expires_at: dailyItem.expires_at,
    archived_at: dailyItem.archived_at,
    content_visibility: dailyItem.content_visibility,
    retention_reminders: dailyItem.retention_reminders,
  });
  const cleanedFormatNotes = existingFormatNotes
    .replace(/(?:^|[\s|;])execution_id:[^|;]*/gi, '')
    .replace(/(?:^|[\s|;])source_type:[^|;]*/gi, '')
    .replace(/(?:^|[\s|;])is_committed:(?:true|false)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[|;]\s*/g, '')
    .replace(/\s*[|;]\s*$/g, '');
  // Validate any existing metadata block without failing (legacy-safe).
  parseDailyExecutionMetadata(existingFormatNotes);
  const format_notes = [cleanedFormatNotes, metadataSection].filter(Boolean).join(' | ');
  return {
    campaign_id: campaignId,
    week_number: weekNumber,
    day_of_week: day,
    date: activityDate.toISOString().split('T')[0],
    platform: dailyItem.platform || 'linkedin',
    content_type: dailyItem.content_type || 'post',
    title: dailyItem.title || activity.title || `${day} Content`,
    content: dailyItem.content || activity.description || activity.content || '',
    topic: dailyItem.topic || activity.topic,
    intro_objective: activity.introObjective,
    objective: activity.objective,
    summary: activity.summary || activity.description,
    key_points: Array.isArray(activity.keyPoints) ? activity.keyPoints : (activity.keyPoints ? [activity.keyPoints] : null),
    cta: activity.cta,
    brand_voice: activity.brandVoice,
    theme_linkage: activity.themeLinkage,
    format_notes: format_notes || null,
    hashtags: activity.hashtags || [],
    mentions: activity.mentions || [],
    media_urls: activity.mediaUrls || [],
    media_types: activity.mediaTypes || [],
    required_resources: requiredResourcesWithCommit,
    scheduled_time: normalizedScheduledTime,
    timezone: 'UTC',
    posting_strategy: activity.postingStrategy || 'organic',
    status: 'planned',
    priority: activity.priority || 'medium',
    ai_generated: activity.aiSuggested || false,
    expected_engagement: activity.expectedEngagement || 0,
    target_audience: activity.targetAudience || '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...(refinementId && { source_refinement_id: refinementId }),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, weekNumber, day, activities, commitType } = req.body;

    if (!campaignId || !weekNumber || !day || !activities) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Calculate the date for this day
    const weekStartDate = new Date();
    weekStartDate.setDate(weekStartDate.getDate() + (weekNumber - 1) * 7);
    const dayIndex = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(day);
    const activityDate = new Date(weekStartDate);
    activityDate.setDate(weekStartDate.getDate() + dayIndex);

    // Get weekly_refinement_id for FK link
    const { data: refinement } = await supabase
      .from('weekly_content_refinements')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('week_number', weekNumber)
      .maybeSingle();

    // Replace day via execution engine: fetch existing week, merge, saveWeekPlans
    const { data: existingWeek } = await supabase
      .from('daily_content_plans')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('week_number', weekNumber);

    const refinementId = refinement?.id ?? null;
    const newDayRows = activities.map((activity: any) => {
      const dailyItem = normalizeToDailyExecutionItem(activity, campaignId, Number(weekNumber));
      return mapDailyItemToLegacyDbRow({
        activity,
        dailyItem,
        campaignId,
        weekNumber: Number(weekNumber),
        day,
        activityDate,
        refinementId,
      });
    });

    const otherDays = (existingWeek ?? []).filter((p: { day_of_week?: string }) => p.day_of_week !== day);
    const mergedRows = [...otherDays.map((p: Record<string, unknown>) => ({ ...p, id: undefined })), ...newDayRows];

    const { saveWeekPlans } = await import('../../../backend/services/executionPlannerService');
    await saveWeekPlans(campaignId, Number(weekNumber), mergedRows as any, 'manual');

    // Update weekly refinement to mark daily plan as populated
    await supabase
      .from('weekly_content_refinements')
      .update({
        daily_plan_populated: true,
        updated_at: new Date().toISOString()
      })
      .eq('campaign_id', campaignId)
      .eq('week_number', weekNumber);

    // Advance campaign to daily_plan stage
    await supabase
      .from('campaigns')
      .update({
        current_stage: 'daily_plan',
        updated_at: new Date().toISOString()
      })
      .eq('id', campaignId);
    void syncCampaignVersionStage(campaignId, 'daily_plan').catch(() => {});

    res.status(200).json({
      success: true,
      message: `${day} plan committed successfully`,
      data: {
        day,
        weekNumber,
        activitiesCount: activities.length,
        committedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error in commit-daily-plan API:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
