import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getUnifiedCampaignBlueprint } from '@/backend/services/campaignBlueprintService';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import {
  isContentArchitectSession,
  checkContentArchitectAccess,
} from '@/backend/services/contentArchitectService';
import { blueprintItemToUnifiedExecutionUnit } from '@/lib/planning/unifiedExecutionAdapter';
import { buildRepurposingContext } from '@/lib/planning/repurposingContext';
import { buildMasterContentDocument } from '@/lib/planning/masterContentDocument';

/**
 * GET /api/activity-workspace/resolve?workspaceKey=... OR ?campaignId=...&executionId=...
 * Returns workspace payload for an activity so Content Architect (or team) can open activity workspace by ID
 * when sessionStorage is empty (e.g. direct link or different browser).
 */
function nonEmpty(v: unknown): string {
  return String(v ?? '').trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let campaignId: string;
  let executionId: string;

  const workspaceKey = typeof req.query.workspaceKey === 'string' ? req.query.workspaceKey.trim() : '';
  if (workspaceKey.startsWith('activity-workspace-')) {
    const suffix = workspaceKey.replace(/^activity-workspace-/, '');
    if (suffix.length > 37 && suffix[36] === '-') {
      campaignId = suffix.slice(0, 36);
      executionId = suffix.slice(37).trim();
    }
    if (!campaignId || !executionId) {
      campaignId = typeof req.query.campaignId === 'string' ? req.query.campaignId.trim() : '';
      executionId = typeof req.query.executionId === 'string' ? req.query.executionId.trim() : '';
    }
  } else {
    campaignId = typeof req.query.campaignId === 'string' ? req.query.campaignId.trim() : '';
    executionId = typeof req.query.executionId === 'string' ? req.query.executionId.trim() : '';
  }

  if (!campaignId || !executionId) {
    return res.status(400).json({
      error: 'Missing workspace identifier',
      message: 'Provide workspaceKey (e.g. activity-workspace-<campaignId>-<executionId>) or campaignId and executionId',
    });
  }

  try {
    let companyId: string | null =
      (typeof req.query.companyId === 'string' ? req.query.companyId : null) || null;
    if (!companyId) {
      const { data: ver } = await supabase
        .from('campaign_versions')
        .select('company_id')
        .eq('campaign_id', campaignId)
        .limit(1)
        .maybeSingle();
      if (ver?.company_id) companyId = ver.company_id as string;
      else {
        const { data: camp } = await supabase
          .from('campaigns')
          .select('company_id')
          .eq('id', campaignId)
          .maybeSingle();
        if (camp?.company_id) companyId = camp.company_id as string;
      }
    }

    if (isContentArchitectSession(req)) {
      const archAccess = checkContentArchitectAccess(req, res, companyId ?? undefined);
      if (archAccess === null) return;
    } else {
      const access = await enforceCompanyAccess({
        req,
        res,
        companyId,
        campaignId,
        requireCampaignId: false,
      });
      if (!access) return;
    }

    const blueprint = await getUnifiedCampaignBlueprint(campaignId);
    if (!blueprint?.weeks?.length) {
      return res.status(404).json({ error: 'Campaign plan not found', campaignId });
    }

    const targetExecId = executionId;
    let found: { week: any; item: any; weekNumber: number; day: string } | null = null;

    for (const week of blueprint.weeks) {
      const weekNumber = Number((week as any).week_number ?? (week as any).week ?? 0) || 0;
      const items: any[] =
        Array.isArray((week as any).daily_execution_items)
          ? (week as any).daily_execution_items
          : Array.isArray((week as any).execution_items)
            ? (week as any).execution_items
            : [];
      for (const item of items) {
        const eid = nonEmpty(item?.execution_id ?? item?.id ?? '');
        if (eid === targetExecId) {
          const day = nonEmpty(item?.day ?? '');
          found = { week, item, weekNumber, day };
          break;
        }
      }
      if (found) break;
    }

    if (!found) {
      return res.status(404).json({
        error: 'Activity not found',
        campaignId,
        executionId: targetExecId,
      });
    }

    const raw = found.item && typeof found.item === 'object' ? found.item : {};
    const hasNested =
      (raw as any)?.writer_content_brief != null || (raw as any)?.intent != null;
    const dailyExecutionItem = hasNested
      ? { ...raw }
      : {
          ...raw,
          topic: raw.topic ?? found.item?.title,
          title: raw.title ?? found.item?.topic,
          platform: (raw as any)?.platform ?? 'linkedin',
          content_type: (raw as any)?.content_type ?? 'post',
          execution_id: targetExecId,
          intent: {
            objective: (raw as any)?.dailyObjective ?? (raw as any)?.objective,
            pain_point: (raw as any)?.whatProblemAreWeAddressing ?? (raw as any)?.summary,
            outcome_promise: (raw as any)?.whatShouldReaderLearn ?? (raw as any)?.introObjective,
            cta_type: (raw as any)?.desiredAction ?? (raw as any)?.cta,
          },
          writer_content_brief: {
            topicTitle:
              (raw as any)?.topicTitle ?? (raw as any)?.topic ?? found.item?.title ?? 'Untitled',
            writingIntent: (raw as any)?.writingIntent ?? (raw as any)?.description,
            whatShouldReaderLearn: (raw as any)?.whatShouldReaderLearn ?? (raw as any)?.introObjective,
            whatProblemAreWeAddressing:
              (raw as any)?.whatProblemAreWeAddressing ?? (raw as any)?.summary,
            desiredAction: (raw as any)?.desiredAction ?? (raw as any)?.cta,
            narrativeStyle: (raw as any)?.narrativeStyle ?? (raw as any)?.brandVoice,
            topicGoal: (raw as any)?.dailyObjective ?? (raw as any)?.objective,
          },
        };

    const title =
      nonEmpty((raw as any)?.title ?? (raw as any)?.topic ?? (raw as any)?.writer_content_brief?.topicTitle) ||
      'Untitled';
    const master_content_id = (raw as any)?.master_content_id ?? (dailyExecutionItem as any)?.master_content_id;
    const creator_card = (raw as any)?.creator_card ?? (dailyExecutionItem as any)?.creator_card;
    const distribution_strategy = (found.week as any)?.distribution_strategy ?? null;
    const distribution_reason = (found.week as any)?.distribution_reason ?? null;
    const planning_adjustment_reason = (found.week as any)?.planning_adjustment_reason ?? null;
    const planning_adjustments_summary = (found.week as any)?.planning_adjustments_summary ?? null;
    const momentum_adjustments = (found.week as any)?.momentum_adjustments ?? null;
    const week_extras = (found.week as any)?.week_extras ?? null;

    const weekItems: any[] =
      Array.isArray((found.week as any).daily_execution_items)
        ? (found.week as any).daily_execution_items
        : Array.isArray((found.week as any).execution_items)
          ? (found.week as any).execution_items
          : [];
    const units = weekItems.map((item: any) =>
      blueprintItemToUnifiedExecutionUnit(item, found.week, campaignId)
    );
    const repurposing_context = buildRepurposingContext(units, targetExecId);
    const master_content_document = buildMasterContentDocument(
      repurposing_context,
      targetExecId
    );

    const payload = {
      campaignId,
      weekNumber: found.weekNumber,
      day: found.day,
      activityId: targetExecId,
      title,
      topic: title,
      description: nonEmpty(
        (raw as any)?.writingIntent ?? (raw as any)?.description ?? ''
      ),
      dailyExecutionItem: {
        ...dailyExecutionItem,
        ...(master_content_id != null ? { master_content_id } : {}),
        ...(creator_card != null && typeof creator_card === 'object' ? { creator_card } : {}),
      },
      schedules: [],
      ...(master_content_id != null ? { master_content_id } : {}),
      ...(creator_card != null && typeof creator_card === 'object' ? { creator_card } : {}),
      ...(distribution_strategy != null ? { distribution_strategy } : {}),
      ...(distribution_reason != null ? { distribution_reason } : {}),
      ...(planning_adjustment_reason != null ? { planning_adjustment_reason } : {}),
      ...(planning_adjustments_summary != null ? { planning_adjustments_summary } : {}),
      ...(momentum_adjustments != null ? { momentum_adjustments } : {}),
      ...(week_extras != null ? { week_extras } : {}),
      ...(repurposing_context != null ? { repurposing_context } : {}),
      ...(master_content_document != null ? { master_content_document } : {}),
    };

    return res.status(200).json({
      workspaceKey: `activity-workspace-${campaignId}-${targetExecId}`,
      payload,
    });
  } catch (err) {
    console.error('activity-workspace resolve error:', err);
    return res.status(500).json({
      error: 'Failed to resolve activity workspace',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
