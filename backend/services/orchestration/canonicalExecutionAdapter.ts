/**
 * canonicalExecutionAdapter — the ONE read/write layer for execution state.
 * Phase-2 Step-1 (canonical execution model unification).
 *
 * Reads reconcile the two legacy persistence targets WITHOUT changing them:
 *   1. enriched daily_content_plans row   (preferred)
 *   2. blueprint execution_items          (fallback)
 *   3. legacy adapters                    (already normalized into the
 *                                          blueprint upstream by
 *                                          getUnifiedCampaignBlueprint)
 *
 * Backward compatible: legacy callers that still read the blueprint or
 * daily_content_plans directly keep working. New/migrated read paths call
 * getExecutionItem / getExecutionItems and get a single reconciled shape.
 *
 * Writes: writeExecutionItem is the forward contract. It is additive (merges
 * canonical fields into daily_content_plans.content only) and is intentionally
 * NOT wired into existing writers in Step-1 (no writer rewrite this phase).
 */

import { supabase } from '../../db/supabaseClient';
import { getUnifiedCampaignBlueprint } from '../campaignBlueprintService';
import { getDailyPlans } from '../executionPlannerService';
import {
  mapBlueprintItemToCanonical,
  mapDailyRowToCanonical,
  reconcile,
} from './canonicalExecutionMapper';
import {
  assertExecutionIdContinuity,
  findBlueprintItem,
  listBlueprintItems,
} from './canonicalExecutionResolver';
import { reconcileContentWrite } from './canonicalWriteReconciliation';
import type { CanonicalExecutionItem } from '../../types/orchestration/CanonicalExecutionItem';
import type { CanonicalExecutionCampaign } from '../../types/orchestration/CanonicalExecutionCampaign';
import type { CanonicalExecutionWeek } from '../../types/orchestration/CanonicalExecutionWeek';

const LOG = (tag: string, payload: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, JSON.stringify(payload));

function rowMatchesExecId(row: Record<string, unknown>, executionId: string): boolean {
  const direct = String(row.execution_id ?? '').trim();
  if (direct && direct === executionId) return true;
  if (String(row.id ?? '').trim() === executionId) return true;
  const c = row.content;
  if (typeof c === 'string') {
    try {
      const p = JSON.parse(c);
      if (p && typeof p === 'object' && String((p as any).execution_id ?? '').trim() === executionId) return true;
    } catch { /* ignore */ }
  } else if (c && typeof c === 'object') {
    if (String((c as any).execution_id ?? '').trim() === executionId) return true;
  }
  return false;
}

async function loadSources(campaignId: string): Promise<{
  blueprint: { weeks?: Array<Record<string, unknown>> } | null;
  rows: Record<string, unknown>[];
}> {
  let blueprint: { weeks?: Array<Record<string, unknown>> } | null = null;
  let rows: Record<string, unknown>[] = [];
  try {
    blueprint = (await getUnifiedCampaignBlueprint(campaignId)) as any;
  } catch (e) {
    LOG('ORCHESTRATION_READ', { campaign_id: campaignId, source: 'blueprint', error: (e as Error)?.message ?? 'blueprint_load_failed' });
  }
  try {
    rows = await getDailyPlans(campaignId);
  } catch (e) {
    LOG('ORCHESTRATION_READ', { campaign_id: campaignId, source: 'daily_content_plans', error: (e as Error)?.message ?? 'rows_load_failed' });
  }
  return { blueprint, rows };
}

/**
 * Resolve ONE execution item by execution_id, reconciled across both sources.
 * This is the canonical replacement for direct blueprint item lookups.
 */
export async function getExecutionItem(
  campaignId: string,
  executionId: string,
): Promise<CanonicalExecutionItem | null> {
  if (!campaignId || !executionId) return null;
  const { blueprint, rows } = await loadSources(campaignId);

  const matchedRow = rows.find((r) => rowMatchesExecId(r, executionId)) ?? null;
  const bp = findBlueprintItem(blueprint, executionId);

  const rowItem = matchedRow ? mapDailyRowToCanonical(campaignId, matchedRow) : null;
  const blueprintItem = bp ? mapBlueprintItemToCanonical(campaignId, bp.week, bp.item) : null;

  if (rowItem && blueprintItem) {
    assertExecutionIdContinuity(campaignId, blueprintItem.execution_id, rowItem.execution_id, 'adapter.getExecutionItem');
  }

  const result = reconcile(rowItem, blueprintItem);
  LOG('ORCHESTRATION_READ', {
    campaign_id: campaignId,
    execution_id: executionId,
    source: matchedRow && bp ? 'row+blueprint' : matchedRow ? 'row' : bp ? 'blueprint' : 'none',
    resolution_strategy: result?.resolution_strategy ?? 'not_found',
  });
  if (result?.resolution_strategy === 'blueprint_fallback') {
    LOG('BLUEPRINT_FALLBACK', { campaign_id: campaignId, execution_id: executionId });
  }
  if (result && (result.resolution_strategy === 'row_only' || result.resolution_strategy === 'row_enriched') && !bp) {
    LOG('ROW_FALLBACK', { campaign_id: campaignId, execution_id: executionId });
  }
  return result;
}

/**
 * All execution items for a campaign (optionally one week), reconciled.
 * Canonical replacement for direct daily_content_plans / blueprint scans.
 */
export async function getExecutionItems(
  campaignId: string,
  weekNumber?: number,
): Promise<CanonicalExecutionItem[]> {
  if (!campaignId) return [];
  const { blueprint, rows } = await loadSources(campaignId);

  const byId = new Map<string, { row?: Record<string, unknown>; bp?: { week: Record<string, unknown>; item: Record<string, unknown> } }>();

  for (const r of rows) {
    const id = String(r.execution_id ?? r.id ?? '').trim();
    if (!id) continue;
    byId.set(id, { ...(byId.get(id) ?? {}), row: r });
  }
  for (const pair of listBlueprintItems(blueprint)) {
    const id = String(pair.item.execution_id ?? pair.item.id ?? '').trim();
    if (!id) continue;
    byId.set(id, { ...(byId.get(id) ?? {}), bp: pair });
  }

  let mismatches = 0;
  const items: CanonicalExecutionItem[] = [];
  for (const [, src] of byId) {
    const rowItem = src.row ? mapDailyRowToCanonical(campaignId, src.row) : null;
    const blueprintItem = src.bp ? mapBlueprintItemToCanonical(campaignId, src.bp.week, src.bp.item) : null;
    if (rowItem && blueprintItem && rowItem.execution_id !== blueprintItem.execution_id) mismatches += 1;
    const merged = reconcile(rowItem, blueprintItem);
    if (merged) items.push(merged);
  }

  const filtered = typeof weekNumber === 'number'
    ? items.filter((i) => i.week_id === `wk${weekNumber}`)
    : items;

  LOG('ORCHESTRATION_READ', {
    campaign_id: campaignId,
    source: 'campaign_scan',
    resolution_strategy: 'reconciled_set',
    blueprint_items: listBlueprintItems(blueprint).length,
    row_items: rows.length,
    reconciled_items: filtered.length,
    execution_id_mismatches: mismatches,
    week: weekNumber ?? 'all',
  });
  return filtered;
}

/** Campaign-level canonical view (weeks + reconciled items + diagnostics). */
export async function getExecutionCampaign(
  campaignId: string,
): Promise<CanonicalExecutionCampaign | null> {
  if (!campaignId) return null;
  const items = await getExecutionItems(campaignId);
  if (items.length === 0) {
    return {
      campaign_id: campaignId,
      strategy_context: null,
      weeks: [],
      orchestration_metadata: {
        sources_present: { blueprint: false, daily_content_plans: false },
        counts: { blueprint_items: 0, row_items: 0, reconciled_items: 0, execution_id_mismatches: 0 },
        resolved_at: new Date().toISOString(),
      },
    };
  }
  const weekMap = new Map<string, CanonicalExecutionWeek>();
  for (const it of items) {
    const wn = Number(it.week_id.replace(/^wk/, '')) || 0;
    if (!weekMap.has(it.week_id)) {
      weekMap.set(it.week_id, { week_number: wn, week_id: it.week_id, theme: it.theme, objectives: [], execution_items: [] });
    }
    weekMap.get(it.week_id)!.execution_items.push(it);
  }
  const weeks = Array.from(weekMap.values()).sort((a, b) => a.week_number - b.week_number);
  return {
    campaign_id: campaignId,
    strategy_context: null,
    weeks,
    orchestration_metadata: {
      sources_present: { blueprint: true, daily_content_plans: true },
      counts: {
        blueprint_items: 0,
        row_items: 0,
        reconciled_items: items.length,
        execution_id_mismatches: items.filter((i) => i.metadata?.reconciled_with_blueprint).length,
      },
      resolved_at: new Date().toISOString(),
    },
  };
}

export interface CanonicalWriteResult {
  ok: boolean;
  reason?: string;
  changed_fields?: string[];
  preserved_fields?: string[];
  prevented?: string[];
  invariant_violations?: string[];
}

function parseContent(row: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const c = row?.content;
  if (typeof c === 'string') { try { return JSON.parse(c) || {}; } catch { return {}; } }
  if (c && typeof c === 'object') return c as Record<string, unknown>;
  return {};
}

/**
 * THE single content write core. Locates the existing row (by execution_id /
 * id / content.execution_id), reconciles the incoming delta against the
 * persisted blob (blank/stale/ID/metadata guards + log-only invariants),
 * preserves legacy row shape, and emits write observability. Never creates
 * rows, never mutates the blueprint (legacy blueprint commit untouched).
 */
async function applyContentWrite(
  campaignId: string | null,
  key: string,
  incoming: Record<string, unknown>,
  sourceWriter: string,
): Promise<CanonicalWriteResult> {
  if (!key) return { ok: false, reason: 'missing_key' };
  try {
    let query = supabase
      .from('daily_content_plans')
      .select('id, campaign_id, execution_id, content');
    if (campaignId) query = query.eq('campaign_id', campaignId);
    const { data: rows } = await query;
    const row = (rows ?? []).find((r: any) =>
      campaignId ? rowMatchesExecId(r, key) : (String(r.execution_id ?? '') === key || String(r.id ?? '') === key || rowMatchesExecId(r, key)),
    );
    if (!row) {
      LOG('ORCHESTRATION_WRITE', { campaign_id: campaignId, execution_id: key, source_writer: sourceWriter, write_target: 'daily_content_plans', resolution_strategy: 'row_not_found' });
      return { ok: false, reason: 'row_not_found' };
    }
    const existing = parseContent(row as Record<string, unknown>);
    const rec = reconcileContentWrite(existing, incoming, {
      source_writer: sourceWriter,
      campaign_id: campaignId,
      execution_id: key,
    });

    LOG('WRITE_RECONCILE', {
      campaign_id: campaignId, execution_id: key, source_writer: sourceWriter,
      write_target: 'daily_content_plans', reconciliation_strategy: 'enrichment_priority_merge',
      changed_fields: rec.changed_fields, preserved_fields: rec.preserved_fields,
    });
    if (rec.prevented.length > 0) {
      LOG('STALE_OVERWRITE_PREVENTED', { campaign_id: campaignId, execution_id: key, source_writer: sourceWriter, prevented: rec.prevented });
    }
    if (rec.invariant_violations.length > 0) {
      LOG('WRITE_CONFLICT', { campaign_id: campaignId, execution_id: key, source_writer: sourceWriter, invariant_violations: rec.invariant_violations });
    }

    const { error } = await supabase
      .from('daily_content_plans')
      .update({ content: JSON.stringify(rec.merged), updated_at: new Date().toISOString() })
      .eq('id', (row as any).id);

    LOG('ORCHESTRATION_WRITE', {
      campaign_id: campaignId, execution_id: key, source_writer: sourceWriter,
      write_target: 'daily_content_plans', resolution_strategy: error ? 'write_failed' : 'reconciled_merge',
      changed_fields: rec.changed_fields, preserved_fields: rec.preserved_fields,
    });
    if (error) {
      LOG('EXECUTION_WRITE_FAILED', { campaign_id: campaignId, execution_id: key, source_writer: sourceWriter, reason: error.message });
      return { ok: false, reason: error.message, ...rec };
    }
    LOG('WRITE_TARGET_SYNC', { campaign_id: campaignId, execution_id: key, source_writer: sourceWriter, write_target: 'daily_content_plans', synced: true });
    // Phase-2 Step-4: propagate canonical state upstream (fire-and-forget;
    // dynamic import avoids the adapter↔synchronizer static cycle; raw
    // projection persist inside the synchronizer prevents write recursion).
    void import('./synchronization')
      .then((m) => (campaignId
        ? m.synchronizeExecutionState(campaignId, key, sourceWriter)
        : m.synchronizeByActivity(key, sourceWriter)))
      .catch(() => {});
    return { ok: true, changed_fields: rec.changed_fields, preserved_fields: rec.preserved_fields, prevented: rec.prevented, invariant_violations: rec.invariant_violations };
  } catch (e) {
    LOG('EXECUTION_WRITE_FAILED', { campaign_id: campaignId, execution_id: key, source_writer: sourceWriter, reason: (e as Error)?.message ?? 'write_exception' });
    return { ok: false, reason: (e as Error)?.message ?? 'write_exception' };
  }
}

/** Canonical single-item write (reconciled). Legacy blueprint shape untouched. */
export async function writeExecutionItem(
  campaignId: string,
  executionId: string,
  patch: Partial<Pick<CanonicalExecutionItem,
    'title' | 'objective' | 'theme' | 'intent' | 'writer_content_brief' |
    'creator_workspace' | 'asset_payload' | 'status' | 'creator_lifecycle_state'>>,
  sourceWriter = 'writeExecutionItem',
): Promise<CanonicalWriteResult> {
  if (!campaignId || !executionId) return { ok: false, reason: 'missing_ids' };
  const incoming: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) incoming[k] = v;
  return applyContentWrite(campaignId, executionId, incoming, sourceWriter);
}

/** Bulk reconciled writes. */
export async function writeExecutionItems(
  campaignId: string,
  patches: Array<{ executionId: string; patch: Record<string, unknown> }>,
  sourceWriter = 'writeExecutionItems',
): Promise<CanonicalWriteResult[]> {
  const out: CanonicalWriteResult[] = [];
  for (const p of patches) out.push(await applyContentWrite(campaignId, p.executionId, p.patch, sourceWriter));
  return out;
}

export async function updateExecutionStatus(
  campaignId: string, executionId: string, status: { status?: string; content_status?: string }, sourceWriter = 'updateExecutionStatus',
): Promise<CanonicalWriteResult> {
  return applyContentWrite(campaignId, executionId, { ...status }, sourceWriter);
}

export async function updateExecutionScheduling(
  campaignId: string, executionId: string,
  scheduling: { scheduled_at?: string | null; scheduling_status?: string; scheduled_post_id?: string | null },
  sourceWriter = 'updateExecutionScheduling',
): Promise<CanonicalWriteResult> {
  return applyContentWrite(campaignId, executionId, { ...scheduling }, sourceWriter);
}

export async function updateExecutionLifecycle(
  campaignIdOrNull: string | null, key: string,
  lifecycle: { creator_lifecycle_state?: string; content_status?: string; extra?: Record<string, unknown> },
  sourceWriter = 'updateExecutionLifecycle',
): Promise<CanonicalWriteResult> {
  const { extra, ...rest } = lifecycle;
  return applyContentWrite(campaignIdOrNull, key, { ...rest, ...(extra ?? {}) }, sourceWriter);
}

/**
 * Content write addressed by activity-id only (no campaign in scope) using a
 * transform over the existing blob. Used by activity-workspace/content.ts
 * (master/variants persistence) so those enrichment writes are reconciled
 * (blank/stale-overwrite-safe) and observable. Behaviour-compatible with the
 * prior load→transform→update, plus guards + logging.
 */
export async function updateExecutionContentByActivity(
  activityId: string,
  transform: (existing: Record<string, unknown>) => Record<string, unknown>,
  sourceWriter = 'updateExecutionContentByActivity',
): Promise<CanonicalWriteResult> {
  if (!activityId) return { ok: false, reason: 'missing_activity_id' };
  try {
    const { data: rows } = await supabase
      .from('daily_content_plans')
      .select('id, campaign_id, execution_id, content')
      .or(`id.eq.${activityId},execution_id.eq.${activityId}`);
    const row = (rows ?? [])[0];
    if (!row) {
      LOG('ORCHESTRATION_WRITE', { execution_id: activityId, source_writer: sourceWriter, write_target: 'daily_content_plans', resolution_strategy: 'row_not_found' });
      return { ok: false, reason: 'row_not_found' };
    }
    const existing = parseContent(row as Record<string, unknown>);
    const desired = transform({ ...existing });
    const rec = reconcileContentWrite(existing, desired, { source_writer: sourceWriter, execution_id: activityId });
    LOG('WRITE_RECONCILE', { campaign_id: (row as any).campaign_id ?? null, execution_id: activityId, source_writer: sourceWriter, write_target: 'daily_content_plans', reconciliation_strategy: 'enrichment_priority_merge', changed_fields: rec.changed_fields, preserved_fields: rec.preserved_fields });
    if (rec.prevented.length > 0) LOG('STALE_OVERWRITE_PREVENTED', { execution_id: activityId, source_writer: sourceWriter, prevented: rec.prevented });
    if (rec.invariant_violations.length > 0) LOG('WRITE_CONFLICT', { execution_id: activityId, source_writer: sourceWriter, invariant_violations: rec.invariant_violations });
    const { error } = await supabase
      .from('daily_content_plans')
      .update({ content: JSON.stringify(rec.merged), updated_at: new Date().toISOString() })
      .eq('id', (row as any).id);
    LOG('ORCHESTRATION_WRITE', { campaign_id: (row as any).campaign_id ?? null, execution_id: activityId, source_writer: sourceWriter, write_target: 'daily_content_plans', resolution_strategy: error ? 'write_failed' : 'reconciled_merge', changed_fields: rec.changed_fields });
    if (error) { LOG('EXECUTION_WRITE_FAILED', { execution_id: activityId, source_writer: sourceWriter, reason: error.message }); return { ok: false, reason: error.message }; }
    LOG('WRITE_TARGET_SYNC', { execution_id: activityId, source_writer: sourceWriter, write_target: 'daily_content_plans', synced: true });
    void import('./synchronization')
      .then((m) => m.synchronizeByActivity(activityId, sourceWriter))
      .catch(() => {});
    return { ok: true, changed_fields: rec.changed_fields, preserved_fields: rec.preserved_fields, prevented: rec.prevented, invariant_violations: rec.invariant_violations };
  } catch (e) {
    LOG('EXECUTION_WRITE_FAILED', { execution_id: activityId, source_writer: sourceWriter, reason: (e as Error)?.message ?? 'write_exception' });
    return { ok: false, reason: (e as Error)?.message ?? 'write_exception' };
  }
}

export const updateExecutionContent = updateExecutionContentByActivity;

/**
 * NON-DESTRUCTIVE canonical reconcile + invariant pass. Reads the campaign's
 * reconciled items and emits parity/invariant diagnostics. Wired into the
 * bulk creators (planner-finalize / generate-weekly-structure) AFTER their
 * existing persistence so we observe drift without rewriting their inserts
 * (compatibility-first; full insert migration is a later step).
 */
export async function reconcileExecution(
  campaignId: string,
  sourceWriter: string,
): Promise<{ items: number; mismatches: number; conflicts: number }> {
  try {
    const items = await getExecutionItems(campaignId);
    let conflicts = 0;
    let mismatches = 0;
    for (const it of items) {
      if (it.metadata?.reconciled_with_blueprint) mismatches += 1;
      const probe = reconcileContentWrite(
        (it.metadata?.__legacy_raw as Record<string, unknown>) ?? {},
        {},
        { source_writer: sourceWriter, campaign_id: campaignId, execution_id: it.execution_id },
      );
      if (probe.invariant_violations.length > 0) {
        conflicts += 1;
        LOG('WRITE_CONFLICT', { campaign_id: campaignId, execution_id: it.execution_id, source_writer: sourceWriter, invariant_violations: probe.invariant_violations });
      }
    }
    LOG('WRITE_RECONCILE', {
      campaign_id: campaignId, source_writer: sourceWriter, write_target: 'campaign',
      reconciliation_strategy: 'post_persist_parity_scan',
      items: items.length, mismatches, conflicts,
    });
    return { items: items.length, mismatches, conflicts };
  } catch (e) {
    LOG('EXECUTION_WRITE_FAILED', { campaign_id: campaignId, source_writer: sourceWriter, reason: (e as Error)?.message ?? 'reconcile_exception' });
    return { items: 0, mismatches: 0, conflicts: 0 };
  }
}

export const canonicalExecutionAdapter = {
  getExecutionItem,
  getExecutionItems,
  getExecutionCampaign,
  writeExecutionItem,
  writeExecutionItems,
  updateExecutionStatus,
  updateExecutionContent,
  updateExecutionContentByActivity,
  updateExecutionScheduling,
  updateExecutionLifecycle,
  reconcileExecution,
};
