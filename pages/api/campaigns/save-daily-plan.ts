import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { applyDefaultRetention } from '../../../backend/services/contentRetentionLifecycle';
import { buildDailyExecutionMetadata } from '../../../lib/dailyExecutionMetadata';

function warnDailyNormalizationIssue(input: { execution_id?: string; source_type?: string; platform?: string; content_type?: string }, context: string): void {
  if (!String(input.execution_id ?? '').trim()) {
    console.warn('[daily-normalization][missing-execution-id]', { context });
  }
  if (!String(input.source_type ?? '').trim()) {
    console.warn('[daily-normalization][missing-source-type]', { context, execution_id: input.execution_id ?? null });
  }
  if (!String(input.platform ?? '').trim()) {
    console.warn('[daily-normalization][missing-platform]', { context, execution_id: input.execution_id ?? null });
  }
  if (!String(input.content_type ?? '').trim()) {
    console.warn('[daily-normalization][missing-content-type]', { context, execution_id: input.execution_id ?? null });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, dailyPlan } = req.body;

    if (!campaignId || !dailyPlan) {
      return res.status(400).json({ error: 'Campaign ID and daily plan are required' });
    }

    const dailyExecutionRaw = dailyPlan?.dailyExecutionItem && typeof dailyPlan.dailyExecutionItem === 'object'
      ? dailyPlan.dailyExecutionItem
      : null;
    const dailyExecution = dailyExecutionRaw
      ? applyDefaultRetention({
          ...dailyExecutionRaw,
          created_at:
            typeof dailyExecutionRaw.created_at === 'string'
              ? dailyExecutionRaw.created_at
              : new Date().toISOString(),
        })
      : null;
    warnDailyNormalizationIssue(
      {
        execution_id: dailyExecution?.execution_id ?? dailyPlan?.executionId,
        source_type: dailyExecution?.source_type ?? dailyPlan?.sourceType,
        platform: dailyExecution?.platform ?? dailyPlan?.platform,
        content_type: dailyExecution?.content_type ?? dailyPlan?.contentType,
      },
      'save-daily-plan'
    );

    const metadataSection = buildDailyExecutionMetadata({
      execution_id: dailyExecution?.execution_id ?? dailyPlan?.executionId,
      source_type: dailyExecution?.source_type ?? dailyPlan?.sourceType,
      is_committed: false,
      retention_state: dailyExecution?.retention_state,
      expires_at: dailyExecution?.expires_at,
      archived_at: dailyExecution?.archived_at,
      content_visibility: dailyExecution?.content_visibility,
      retention_reminders: dailyExecution?.retention_reminders,
    });
    const existingFormatNotes = String(dailyPlan?.formatNotes ?? '').trim();
    const cleanedFormatNotes = existingFormatNotes
      .replace(/(?:^|[\s|;])execution_id:[^|;]*/gi, '')
      .replace(/(?:^|[\s|;])source_type:[^|;]*/gi, '')
      .replace(/(?:^|[\s|;])is_committed:(?:true|false)/gi, '')
      .replace(/(?:^|[\s|;])retention_state:[^|;]*/gi, '')
      .replace(/(?:^|[\s|;])expires_at:[^|;]*/gi, '')
      .replace(/(?:^|[\s|;])archived_at:[^|;]*/gi, '')
      .replace(/(?:^|[\s|;])content_visibility:(?:true|false)/gi, '')
      .replace(/(?:^|[\s|;])retention_reminders:[^|;]*/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .replace(/^[|;]\s*/g, '')
      .replace(/\s*[|;]\s*$/g, '');
    const format_notes = [cleanedFormatNotes, metadataSection].filter(Boolean).join(' | ');

    // Save daily plan via execution engine (updateActivity or insertActivity)
    const platform = dailyExecution?.platform ?? dailyPlan.platform ?? 'linkedin';
    const contentType = dailyExecution?.content_type ?? dailyPlan.contentType ?? 'post';
    const { data: existing } = await supabase
      .from('daily_content_plans')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('week_number', dailyPlan.weekNumber)
      .eq('day_of_week', dailyPlan.dayOfWeek)
      .eq('platform', platform)
      .eq('content_type', contentType)
      .maybeSingle();

    const updates = {
      date: dailyPlan.date,
      title: dailyExecution?.title ?? dailyPlan.title,
      content: dailyExecution?.content ?? dailyPlan.content,
      description: dailyPlan.description,
      media_requirements: dailyPlan.mediaRequirements,
      hashtags: dailyPlan.hashtags,
      call_to_action: dailyPlan.callToAction,
      optimal_posting_time: dailyPlan.optimalPostingTime,
      target_metrics: dailyPlan.targetMetrics,
      format_notes: format_notes || null,
      status: dailyPlan.status,
      priority: dailyPlan.priority,
      ai_generated: dailyPlan.aiGenerated || false,
    };

    const { updateActivity, insertActivity } = await import('../../../backend/services/executionPlannerService');
    let planData: Record<string, unknown>;

    if (existing?.id) {
      await updateActivity(existing.id, updates, 'board');
      const { data } = await supabase
        .from('daily_content_plans')
        .select('*')
        .eq('id', existing.id)
        .single();
      planData = data as Record<string, unknown>;
    } else {
      const row = {
        campaign_id: campaignId,
        week_number: dailyPlan.weekNumber,
        day_of_week: dailyPlan.dayOfWeek,
        date: dailyPlan.date,
        platform,
        content_type: contentType,
        title: updates.title,
        content: updates.content,
        ...updates,
      };
      const { id } = await insertActivity(row as any, 'board');
      const { data } = await supabase
        .from('daily_content_plans')
        .select('*')
        .eq('id', id)
        .single();
      planData = data as Record<string, unknown>;
    }

    res.status(200).json({
      success: true,
      message: 'Daily plan saved successfully',
      data: planData
    });

  } catch (error) {
    console.error('Error in save-daily-plan API:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}



