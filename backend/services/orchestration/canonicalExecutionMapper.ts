/**
 * canonicalExecutionMapper — transforms legacy entities into the canonical
 * orchestration shape. Phase-2 Step-1.
 *
 *  - mapBlueprintItemToCanonical: blueprint week + execution/daily item
 *  - mapDailyRowToCanonical:       a daily_content_plans row
 *  - reconcile:                    merge the two (row preferred) into one
 *
 * Pure transforms — NO DB access here (the adapter owns I/O). Loose parsing
 * by design: legacy blobs are heterogeneous and must never throw.
 */

// Phase-2 Step-2: classification is no longer derived here from registries
// directly — it defers to the ONE centralized routing engine.
import { resolveExecutionRouting } from './routing';
import type {
  CanonicalActivityType,
  CanonicalApprovalStatus,
  CanonicalAssetRequirements,
  CanonicalExecutionItem,
  CanonicalExecutionType,
  CanonicalSchedulingStatus,
  CanonicalSourceType,
  CanonicalStatus,
} from '../../types/orchestration/CanonicalExecutionItem';

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
export function parseRowContent(row: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!row) return {};
  const c = (row as Record<string, unknown>).content;
  if (c && typeof c === 'object' && !Array.isArray(c)) return c as Record<string, unknown>;
  if (typeof c === 'string') {
    try {
      const p = JSON.parse(c);
      return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function classify(contentType: string): {
  execution_type: CanonicalExecutionType;
  workflow: CanonicalExecutionItem['workflow_type'];
  reqs: CanonicalAssetRequirements;
} {
  // Single source of truth: the centralized routing engine. The canonical
  // model (and therefore resolve.ts / the Activity Workspace) now classifies
  // through exactly the same authority as generate-weekly-structure.
  const d = resolveExecutionRouting({ content_type: contentType, platform: 'linkedin' });
  const execution_type: CanonicalExecutionType =
    d.execution_type === 'BOLT_TEXT' ? 'text'
    : d.execution_type === 'BOLT_CREATOR' || d.execution_type === 'VIDEO_WORKFLOW' ? 'creator'
    : d.execution_type === 'HYBRID' ? 'hybrid'
    : 'unknown';
  const workflow: CanonicalExecutionItem['workflow_type'] =
    d.execution_type === 'BOLT_TEXT' ? 'bolt_text'
    : d.execution_type === 'VIDEO_WORKFLOW' ? 'video_brief'
    : d.execution_type === 'BOLT_CREATOR' ? 'creator_autonomous'
    : d.execution_type === 'HYBRID' ? (d.creator_requirement ? 'creator_autonomous' : 'bolt_text')
    : 'unsupported';
  return {
    execution_type,
    workflow,
    reqs: {
      media_upload_required:
        d.diagnostics.media_upload_required === true || d.execution_type === 'VIDEO_WORKFLOW',
      autonomous_renderable: d.diagnostics.autonomous_renderable === true,
      canonical_asset_family:
        (d.diagnostics.classification_asset_family as string | null) ?? null,
    },
  };
}

function activityType(contentType: string, reqs: CanonicalAssetRequirements): CanonicalActivityType {
  const ct = contentType.toLowerCase();
  if (ct === 'post_with_asset' || ct === 'thread_with_asset') return 'post_with_asset';
  if (reqs.media_upload_required) return 'brief';
  if (reqs.autonomous_renderable) return 'asset';
  return 'post';
}

function deriveStatus(raw: string, lifecycle: string, hasContent: boolean): CanonicalStatus {
  const s = raw.toLowerCase();
  if (s === 'published') return 'published';
  if (s === 'failed' || s === 'render_failed' || s === 'upload_failed') return 'failed';
  if (s === 'scheduled') return 'scheduled';
  const l = lifecycle.toLowerCase();
  if (l === 'scheduled') return 'scheduled';
  if (hasContent) return 'ready';
  if (s === 'generating') return 'generating';
  return 'planned';
}

function deriveApproval(content: Record<string, unknown>, rowStatus: string): CanonicalApprovalStatus {
  const a = str(content.approval_status || content.approval).toLowerCase();
  if (a === 'approved') return 'approved';
  if (a === 'rejected') return 'rejected';
  if (a === 'pending') return 'pending';
  if (rowStatus.toLowerCase() === 'reapproval_required') return 'reapproval_required';
  return 'none';
}

function deriveScheduling(
  scheduledPostId: string | null,
  scheduledAt: string | null,
  reqs: CanonicalAssetRequirements,
  lifecycle: string,
): CanonicalSchedulingStatus {
  if (scheduledPostId) return 'scheduled';
  if (scheduledAt) return 'scheduled';
  if (reqs.media_upload_required) {
    const l = lifecycle.toLowerCase();
    return l === 'ready_for_schedule' || l === 'media_uploaded' || l === 'scheduled'
      ? 'schedulable'
      : 'blocked';
  }
  return 'schedulable';
}

/** daily_content_plans row → canonical (the preferred/enriched source). */
export function mapDailyRowToCanonical(
  campaignId: string,
  row: Record<string, unknown>,
): CanonicalExecutionItem {
  const content = parseRowContent(row);
  const platform = str(row.platform || content.platform || 'linkedin').toLowerCase();
  const contentType = str(row.content_type || content.content_type || content.contentType || 'post').toLowerCase();
  const weekNum = Number(row.week_number ?? content.weekNumber ?? 0) || 0;
  const day = str(row.day_of_week || content.day || 'Monday');
  const execId = str(row.execution_id || content.execution_id || row.id);
  const { execution_type, workflow, reqs } = classify(contentType);

  const wcb = asObj(content.writer_content_brief);
  const creatorWs = asObj(content.creator_workspace);
  const masterContent = content.master_content;
  const variants = content.platform_variants;
  const enriched = Boolean(
    wcb || creatorWs || masterContent ||
    (Array.isArray(variants) && variants.length > 0),
  );
  const lifecycle = str(content.creator_lifecycle_state || row.content_status);
  const rowStatus = str(row.status);
  const scheduledPostId = str(row.scheduled_post_id || content.scheduled_post_id) || null;
  const scheduledAt = str(row.scheduled_at || row.scheduled_for) || null;
  const reqsBlockPublish = reqs.media_upload_required &&
    !['media_uploaded', 'ready_for_schedule', 'scheduled'].includes(lifecycle.toLowerCase());

  return {
    execution_id: execId,
    campaign_id: campaignId,
    week_id: `wk${weekNum}`,
    day_id: day,
    platform,
    platform_variant_key: `${platform}:${contentType}`,
    content_type: contentType,
    execution_type,
    activity_type: activityType(contentType, reqs),
    source_type: (str(content.source_type) as CanonicalSourceType) || 'planner',
    workflow_type: workflow,
    title: str(row.title || content.title || content.topic || content.topicTitle),
    objective: str(content.objective || content.dailyObjective || (wcb && wcb.topicGoal)),
    theme: str(row.week_theme || content.theme || content.weekTheme),
    intent: asObj(content.intent),
    status: deriveStatus(rowStatus, lifecycle, enriched),
    approval_status: deriveApproval(content, rowStatus),
    scheduling_status: deriveScheduling(scheduledPostId, scheduledAt, reqs, lifecycle),
    creator_lifecycle_state: lifecycle || null,
    publish_readiness: scheduledPostId ? 'ready' : reqsBlockPublish ? 'blocked' : enriched ? 'ready' : 'unknown',
    scheduled_at: scheduledAt,
    asset_requirements: reqs,
    asset_payload: asObj(content.asset_payload),
    writer_content_brief: wcb,
    creator_workspace: creatorWs,
    source_reference: {
      campaign_id: campaignId,
      execution_id: execId,
      blueprint_week_index: weekNum || null,
      daily_content_plan_id: str(row.id) || null,
      scheduled_post_id: scheduledPostId,
    },
    resolution_strategy: enriched ? 'row_enriched' : 'row_only',
    metadata: {
      row_status: rowStatus,
      intent_type: str(row.intent_type || content.intent_type),
      asset_type: str(row.asset_type || content.asset_type),
      // Backward-compat passthrough: the exact legacy object downstream
      // consumers (e.g. activity-workspace/resolve) already read field-by-field.
      __legacy_raw: {
        ...content,
        title: str(row.title || content.title || content.topic),
        topic: str(content.topic || row.topic || content.topicTitle),
        platform,
        content_type: contentType,
        execution_id: execId,
        master_content_id: content.master_content_id ?? (row as Record<string, unknown>).master_content_id,
        creator_card: content.creator_card,
        creator_asset: (row as Record<string, unknown>).creator_asset ?? content.creator_asset,
        content_status: (row as Record<string, unknown>).content_status ?? content.content_status,
      },
    },
    created_at: str(row.created_at) || null,
    updated_at: str(row.updated_at) || null,
  };
}

/** blueprint week + execution/daily item → canonical (fallback source). */
export function mapBlueprintItemToCanonical(
  campaignId: string,
  week: Record<string, unknown>,
  item: Record<string, unknown>,
): CanonicalExecutionItem {
  const weekNum = Number(week.week_number ?? (week as { week?: number }).week ?? 0) || 0;
  const platform = str(item.platform || 'linkedin').toLowerCase();
  const contentType = str(item.content_type || item.contentType || item.type || 'post').toLowerCase();
  const day = str(item.day || 'Monday');
  const execId = str(item.execution_id || item.id);
  const { execution_type, workflow, reqs } = classify(contentType);
  const wcb = asObj(item.writer_content_brief);
  const intent = asObj(item.intent);
  const enriched = Boolean(wcb || intent);

  return {
    execution_id: execId,
    campaign_id: campaignId,
    week_id: `wk${weekNum}`,
    day_id: day,
    platform,
    platform_variant_key: `${platform}:${contentType}`,
    content_type: contentType,
    execution_type,
    activity_type: activityType(contentType, reqs),
    source_type: 'planner',
    workflow_type: workflow,
    title: str(item.title || item.topic || item.topicTitle),
    objective: str(item.objective || item.dailyObjective || (wcb && wcb.topicGoal)),
    theme: str(item.theme || week.phase_label || week.theme),
    intent,
    status: enriched ? 'ready' : 'planned',
    approval_status: 'none',
    scheduling_status: 'unscheduled',
    creator_lifecycle_state: null,
    publish_readiness: 'unknown',
    scheduled_at: null,
    asset_requirements: reqs,
    asset_payload: asObj(item.asset_payload),
    writer_content_brief: wcb,
    creator_workspace: asObj(item.creator_workspace),
    source_reference: {
      campaign_id: campaignId,
      execution_id: execId,
      blueprint_week_index: weekNum || null,
      daily_content_plan_id: null,
      scheduled_post_id: null,
    },
    resolution_strategy: 'blueprint',
    metadata: { source: 'blueprint', __legacy_raw: { ...item } },
    created_at: null,
    updated_at: null,
  };
}

/**
 * Reconcile a (possibly present) enriched row item with a (possibly present)
 * blueprint item into ONE canonical item.
 *
 * Priority (Phase-2 Step-4):
 *   1. enriched daily_content_plans row
 *   2. blueprint execution_items
 *   3. legacy adapters (already normalized into the blueprint upstream)
 *
 * The row is the base when enriched; blueprint fills gaps (theme/objective/
 * brief) the row may lack. execution_id continuity is enforced by the
 * resolver before this is called, so both ids are expected to agree.
 */
export function reconcile(
  rowItem: CanonicalExecutionItem | null,
  blueprintItem: CanonicalExecutionItem | null,
): CanonicalExecutionItem | null {
  if (!rowItem && !blueprintItem) return null;
  if (rowItem && !blueprintItem) return rowItem;
  if (!rowItem && blueprintItem) return { ...blueprintItem, resolution_strategy: 'blueprint_fallback' };

  // Both present — row is canonical base; blueprint backfills empties.
  const r = rowItem as CanonicalExecutionItem;
  const b = blueprintItem as CanonicalExecutionItem;
  const pick = (rv: string, bv: string) => (rv && rv.trim() ? rv : bv);
  return {
    ...r,
    title: pick(r.title, b.title),
    objective: pick(r.objective, b.objective),
    theme: pick(r.theme, b.theme),
    intent: r.intent ?? b.intent,
    writer_content_brief: r.writer_content_brief ?? b.writer_content_brief,
    creator_workspace: r.creator_workspace ?? b.creator_workspace,
    asset_payload: r.asset_payload ?? b.asset_payload,
    source_reference: {
      ...r.source_reference,
      blueprint_week_index:
        r.source_reference.blueprint_week_index ?? b.source_reference.blueprint_week_index ?? null,
    },
    resolution_strategy: 'reconciled',
    metadata: { ...b.metadata, ...r.metadata, reconciled_with_blueprint: true },
  };
}
