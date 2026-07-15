import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
// Phase-2 Step-1: blueprint item discovery now goes through the ONE
// canonical orchestration adapter (reconciles enriched daily_content_plans
// row > blueprint execution items > legacy, preserving execution_id).
import { canonicalExecutionAdapter, resolveAuthoritativeWorkspace } from '@/backend/services/orchestration';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import {
  isContentArchitectSession,
  checkContentArchitectAccess,
} from '@/backend/services/contentArchitectService';
import { blueprintItemToUnifiedExecutionUnit } from '@/lib/planning/unifiedExecutionAdapter';
import { buildRepurposingContext } from '@/lib/planning/repurposingContext';
import { buildMasterContentDocument } from '@/lib/planning/masterContentDocument';
// Step-10: flag-gated, Creator-only load enrichment. Returns
// `{ok:false}` for Text / malformed / flag-OFF ⇒ Text behavior is
// byte-identical (the block below is a no-op in those cases).
import { loadCreatorWorkspace } from '@/backend/services/creator/intelligence/workspace';
// PHASE CREATOR-BRIEF-UNIVERSAL-COVERAGE — read-time creator-brief synthesis.
// Gap-fills empty creator briefs at the single read authority so no creator row
// renders "-", regardless of creation path. Creator-only; writer rows untouched.
import { synthesizeCreatorBrief, isCreatorContentType } from '@/lib/shared/creatorBriefSynthesis';
import { runWithRequestMemo } from '@/backend/services/requestScopedMemo';

/**
 * GET /api/activity-workspace/resolve?workspaceKey=... OR ?campaignId=...&executionId=...
 * Returns workspace payload for an activity so Content Architect (or team) can open activity workspace by ID
 * when sessionStorage is empty (e.g. direct link or different browser).
 */
function nonEmpty(v: unknown): string {
  return String(v ?? '').trim();
}

function handler(req: NextApiRequest, res: NextApiResponse) {
  // PERF-001: seed a request-scoped memo. resolve() runs loadSources 2-3× per
  // request; this collapses the duplicate blueprint + daily-plan loads to one each.
  return runWithRequestMemo(() => handlerImpl(req, res));
}

async function handlerImpl(req: NextApiRequest, res: NextApiResponse) {
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

    const targetExecId = executionId;

    // Phase-2 Step-1: single canonical read. Reconciles enriched
    // daily_content_plans row > blueprint execution_items > legacy, and
    // preserves the execution_id (no synth). __legacy_raw carries the exact
    // legacy object the rest of this handler reads field-by-field, so
    // downstream behavior is byte-compatible while the source is unified.
    const canonical = await canonicalExecutionAdapter.getExecutionItem(campaignId, targetExecId);
    if (!canonical) {
      return res.status(404).json({
        error: 'Activity not found',
        campaignId,
        executionId: targetExecId,
      });
    }

    const legacyRaw: Record<string, any> =
      canonical.metadata && typeof canonical.metadata.__legacy_raw === 'object' && canonical.metadata.__legacy_raw
        ? (canonical.metadata.__legacy_raw as Record<string, any>)
        : {};

    const found: { week: any; item: any; weekNumber: number; day: string } = {
      week: {},
      item: {
        ...legacyRaw,
        title: legacyRaw.title ?? canonical.title,
        topic: legacyRaw.topic ?? canonical.title,
        platform: legacyRaw.platform ?? canonical.platform,
        content_type: legacyRaw.content_type ?? canonical.content_type,
        execution_id: canonical.execution_id,
        theme: legacyRaw.theme ?? canonical.theme,
        objective: legacyRaw.objective ?? canonical.objective,
        dailyObjective: legacyRaw.dailyObjective ?? canonical.objective,
        intent: legacyRaw.intent ?? canonical.intent ?? undefined,
        writer_content_brief:
          legacyRaw.writer_content_brief ?? canonical.writer_content_brief ?? undefined,
        asset_payload: legacyRaw.asset_payload ?? canonical.asset_payload ?? undefined,
        creator_workspace: legacyRaw.creator_workspace ?? canonical.creator_workspace ?? undefined,
      },
      weekNumber: Number(String(canonical.week_id).replace(/^wk/, '')) || 0,
      day: canonical.day_id || '',
    };

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
    let creator_asset = (raw as any)?.creator_asset ?? (dailyExecutionItem as any)?.creator_asset;
    let content_status = (raw as any)?.content_status ?? (dailyExecutionItem as any)?.content_status;
    const { data: dailyPlanRow } = await supabase
      .from('daily_content_plans')
      .select('creator_asset, content_status')
      .eq('campaign_id', campaignId)
      .eq('execution_id', targetExecId)
      .maybeSingle();
    if (dailyPlanRow?.creator_asset != null) {
      creator_asset = dailyPlanRow.creator_asset;
    }
    if (dailyPlanRow?.content_status != null) {
      content_status = dailyPlanRow.content_status;
    }
    // ── Step-10 Phase-1: Creator-only workspace reconstruction ──────────
    // Additive + flag-gated. Fetches the FULL row separately (the
    // existing creator_asset/content_status query above is left intact)
    // and attaches `payload.creator_workspace` ONLY when the row
    // reconstructs as a Creator task. Text rows / flag OFF / malformed
    // ⇒ `creatorWorkspace` stays null and the payload is unchanged.
    let creatorWorkspace: unknown = null;
    let creatorWorkspaceRowId: string | null = null;
    try {
      const { data: fullRow } = await supabase
        .from('daily_content_plans')
        .select(
          'id, content, content_type, platform, content_status, asset_type, intent_type, week_number, topic, title',
        )
        .eq('campaign_id', campaignId)
        .eq('execution_id', targetExecId)
        .maybeSingle();
      if (fullRow) {
        const loaded = loadCreatorWorkspace(fullRow as any, {
          now: new Date().toISOString(),
        });
        if (loaded.ok) {
          creatorWorkspace = loaded.task;
          // The daily_content_plans row id — the path param the
          // creator-lifecycle endpoint needs for save/advance.
          creatorWorkspaceRowId = String((fullRow as { id?: unknown }).id ?? '') || null;
        }
      }
    } catch {
      /* non-fatal: never block the existing load on reconstruction */
    }

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

    // Collect ALL platforms for this topic across ALL weeks
    const topicKey = title.toLowerCase().trim();
    type RawScheduleEntry = {
      executionId: string;
      weekNumber: number;
      day: string;
      platform: string;
      contentType: string;
    };
    // Phase-2 Step-1: enumerate all execution items via the canonical adapter
    // (reconciled across blueprint + daily_content_plans) instead of scanning
    // the raw blueprint directly.
    const allTopicEntries: RawScheduleEntry[] = [];
    const allCanonicalItems = await canonicalExecutionAdapter.getExecutionItems(campaignId);
    for (const ci of allCanonicalItems) {
      const itemTitle = nonEmpty(ci.title ?? '').toLowerCase();
      if (itemTitle === topicKey || itemTitle.includes(topicKey) || topicKey.includes(itemTitle)) {
        const eid = nonEmpty(ci.execution_id ?? '');
        if (!eid) continue;
        allTopicEntries.push({
          executionId: eid,
          weekNumber: Number(String(ci.week_id).replace(/^wk/, '')) || 0,
          day: nonEmpty(ci.day_id ?? ''),
          platform: nonEmpty(ci.platform ?? 'linkedin'),
          contentType: nonEmpty(ci.content_type ?? 'post'),
        });
      }
    }

    // Load scheduled_posts for all collected execution IDs
    const allExecIds = allTopicEntries.map((e) => e.executionId);
    let scheduledPostsMap: Record<string, { scheduled_for: string | null; status: string | null; content: string | null }> = {};
    if (allExecIds.length > 0) {
      const { data: scheduledPosts } = await supabase
        .from('scheduled_posts')
        .select('execution_id, scheduled_for, status, content')
        .in('execution_id', allExecIds)
        .eq('campaign_id', campaignId);
      if (Array.isArray(scheduledPosts)) {
        for (const sp of scheduledPosts) {
          if (sp.execution_id) {
            scheduledPostsMap[sp.execution_id as string] = {
              scheduled_for: sp.scheduled_for ?? null,
              status: sp.status ?? null,
              content: sp.content ?? null,
            };
          }
        }
      }
    }

    // Build schedules array — deduplicate by executionId+platform
    const seenScheduleKeys = new Set<string>();
    const schedules = allTopicEntries
      .filter((entry) => {
        const key = `${entry.executionId}::${entry.platform}`;
        if (seenScheduleKeys.has(key)) return false;
        seenScheduleKeys.add(key);
        return true;
      })
      .map((entry, idx) => {
        const sp = scheduledPostsMap[entry.executionId];
        return {
          id: `schedule-${entry.executionId}-${entry.platform}`,
          executionId: entry.executionId,
          weekNumber: entry.weekNumber,
          day: entry.day,
          platform: entry.platform,
          contentType: entry.contentType,
          scheduledFor: sp?.scheduled_for ?? null,
          status: sp?.status ?? (entry.executionId === targetExecId ? 'draft' : 'pending'),
          content: sp?.content ?? null,
          isPrimary: entry.executionId === targetExecId,
          sortOrder: idx,
        };
      })
      .sort((a, b) => {
        // Primary execution first, then by week number, then by day
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        if (a.weekNumber !== b.weekNumber) return a.weekNumber - b.weekNumber;
        return a.day.localeCompare(b.day);
      });

    // PHASE CREATOR-BRIEF-UNIVERSAL-COVERAGE — read-time gap-fill for creator
    // rows ONLY. Writer/text rows skip this entirely → byte-identical payload.
    const briefContentType = nonEmpty((dailyExecutionItem as any)?.content_type) || nonEmpty((raw as any)?.content_type);
    const isCreatorRow =
      isCreatorContentType(briefContentType) ||
      nonEmpty((raw as any)?.intent_type) === 'creator' ||
      (creator_asset != null && typeof creator_asset === 'object');
    let effectiveCreatorCard: unknown = creator_card;
    let effectiveIntent: unknown = (dailyExecutionItem as any)?.intent;
    if (isCreatorRow) {
      const synth = synthesizeCreatorBrief({
        existingCard: creator_card && typeof creator_card === 'object' ? (creator_card as Record<string, any>) : null,
        rawItem: raw as Record<string, any>,
        intent: (dailyExecutionItem as any)?.intent ?? null,
        topic: title,
        contentType: briefContentType,
      });
      effectiveCreatorCard = synth.creator_card;
      effectiveIntent = synth.intent;
    }

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
        ...(isCreatorRow ? { intent: effectiveIntent } : {}),
        ...(master_content_id != null ? { master_content_id } : {}),
        ...(effectiveCreatorCard != null && typeof effectiveCreatorCard === 'object' ? { creator_card: effectiveCreatorCard } : {}),
        ...(creator_asset != null && typeof creator_asset === 'object' ? { creator_asset } : {}),
        ...(content_status != null ? { content_status } : {}),
      },
      schedules,
      ...(master_content_id != null ? { master_content_id } : {}),
      ...(effectiveCreatorCard != null && typeof effectiveCreatorCard === 'object' ? { creator_card: effectiveCreatorCard } : {}),
      ...(distribution_strategy != null ? { distribution_strategy } : {}),
      ...(distribution_reason != null ? { distribution_reason } : {}),
      ...(planning_adjustment_reason != null ? { planning_adjustment_reason } : {}),
      ...(planning_adjustments_summary != null ? { planning_adjustments_summary } : {}),
      ...(momentum_adjustments != null ? { momentum_adjustments } : {}),
      ...(week_extras != null ? { week_extras } : {}),
      ...(repurposing_context != null ? { repurposing_context } : {}),
      ...(master_content_document != null ? { master_content_document } : {}),
      ...(creatorWorkspace != null ? { creator_workspace: creatorWorkspace } : {}),
      ...(creatorWorkspaceRowId != null ? { creator_workspace_row_id: creatorWorkspaceRowId } : {}),
    };

    // Phase-2 Step-27: attach the canonical authoritative workspace
    // projection ADDITIVELY (new key only — no existing field is mutated,
    // so SHADOW/legacy behavior is byte-identical). The resolver is
    // fail-soft and self-isolates to LEGACY when canonical state is
    // missing / rollback / cutover LEGACY. Diff diagnostics are emitted
    // inside the resolver ([WORKSPACE_EXECUTION_DIFF]).
    let workspaceProjection: unknown = null;
    try {
      const authoritative = await resolveAuthoritativeWorkspace(campaignId, targetExecId);
      if (authoritative.projection) {
        workspaceProjection = {
          mode: authoritative.mode,
          fallback_active: authoritative.fallback_active,
          projection: authoritative.projection,
          diff: authoritative.diff,
        };
      }
    } catch {
      /* fail-soft: never block the existing workspace load */
    }

    return res.status(200).json({
      workspaceKey: `activity-workspace-${campaignId}-${targetExecId}`,
      payload: {
        ...payload,
        ...(workspaceProjection != null ? { workspace_projection: workspaceProjection } : {}),
      },
    });
  } catch (err) {
    console.error('activity-workspace resolve error:', err);
    return res.status(500).json({
      error: 'Failed to resolve activity workspace',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/activity-workspace/resolve' });
