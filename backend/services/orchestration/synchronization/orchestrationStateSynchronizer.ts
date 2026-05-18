/**
 * orchestrationStateSynchronizer — Phase-2 Step-4.
 *
 * Ends the "Activity Workspace dead-end island": after any execution change
 * (content write, lifecycle, scheduling), the canonical projection is
 * recomputed and persisted additively into
 * daily_content_plans.content.orchestration_state, so planner / calendar /
 * campaign overview / diagnostics all see the same readiness.
 *
 * Persistence here uses a RAW single-key merge update (NOT the canonical
 * write adapter) so synchronization can be called from inside the write
 * adapter without recursion. Fire-and-forget by callers — never blocks.
 */

import { supabase } from '../../../db/supabaseClient';
import { getExecutionItem, getExecutionItems } from '../canonicalExecutionAdapter';
import { projectExecutionState } from './orchestrationStateProjector';
import {
  logReadinessChange,
  logStateProject,
  logStatePropagation,
  logStateSync,
} from './orchestrationStateDiagnostics';
import type {
  CampaignExecutionState,
  ExecutionStateProjection,
  ExecutionStateRollup,
  WeekExecutionState,
} from './orchestrationStateTypes';

function parseContent(row: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const c = row?.content;
  if (typeof c === 'string') { try { return JSON.parse(c) || {}; } catch { return {}; } }
  if (c && typeof c === 'object') return c as Record<string, unknown>;
  return {};
}

async function persistProjection(
  rowId: string,
  projection: ExecutionStateProjection,
): Promise<{ ok: boolean; previous: ExecutionStateProjection | null }> {
  try {
    const { data: row } = await supabase
      .from('daily_content_plans')
      .select('id, content')
      .eq('id', rowId)
      .maybeSingle();
    if (!row) return { ok: false, previous: null };
    const content = parseContent(row as Record<string, unknown>);
    const previous = (content.orchestration_state as ExecutionStateProjection | undefined) ?? null;
    const merged = { ...content, orchestration_state: projection };
    const { error } = await supabase
      .from('daily_content_plans')
      .update({ content: JSON.stringify(merged), updated_at: new Date().toISOString() })
      .eq('id', rowId);
    return { ok: !error, previous };
  } catch {
    return { ok: false, previous: null };
  }
}

/**
 * Recompute + persist the canonical projection for one execution item.
 * Safe to call fire-and-forget from any write path.
 */
export async function synchronizeExecutionState(
  campaignId: string,
  executionId: string,
  source: string,
): Promise<ExecutionStateProjection | null> {
  if (!campaignId || !executionId) return null;
  logStateSync(campaignId, executionId, source);
  const item = await getExecutionItem(campaignId, executionId);
  if (!item) {
    logStatePropagation(campaignId, executionId, 'skipped:item_not_found', source);
    return null;
  }
  const projection = projectExecutionState(item);
  logStateProject(campaignId, projection, source);

  const rowId = item.source_reference?.daily_content_plan_id;
  if (rowId) {
    const { ok, previous } = await persistProjection(rowId, projection);
    logReadinessChange(campaignId, executionId, previous, projection, source);
    logStatePropagation(
      campaignId, executionId,
      ok ? 'daily_content_plans.content.orchestration_state' : 'skipped:persist_failed',
      source,
    );
  } else {
    // Blueprint-only item (no row yet) — projection is still computed and
    // available via the read feed; nothing to persist without a row.
    logStatePropagation(campaignId, executionId, 'skipped:no_row', source);
  }
  return projection;
}

/** Same, addressed by activity/row id when campaignId is not in scope. */
export async function synchronizeByActivity(
  activityId: string,
  source: string,
): Promise<ExecutionStateProjection | null> {
  if (!activityId) return null;
  try {
    const { data: row } = await supabase
      .from('daily_content_plans')
      .select('campaign_id, execution_id, id')
      .or(`id.eq.${activityId},execution_id.eq.${activityId}`)
      .limit(1)
      .maybeSingle();
    if (!row) { logStatePropagation(null, activityId, 'skipped:row_not_found', source); return null; }
    const cid = String((row as any).campaign_id ?? '');
    const eid = String((row as any).execution_id ?? activityId);
    if (!cid) { logStatePropagation(null, eid, 'skipped:no_campaign', source); return null; }
    return synchronizeExecutionState(cid, eid, source);
  } catch {
    return null;
  }
}

// ── Planner / calendar / overview canonical READ feed ───────────────────────

function emptyRollup(): ExecutionStateRollup {
  return { total: 0, ready: 0, blocked: 0, scheduled: 0, published: 0, failed: 0, average_readiness: 0, blocking_reasons: {} };
}

function rollup(projections: ExecutionStateProjection[]): ExecutionStateRollup {
  const r = emptyRollup();
  r.total = projections.length;
  let sum = 0;
  for (const p of projections) {
    sum += p.readiness_score;
    if (p.orchestration_state === 'READY') r.ready += 1;
    if (p.orchestration_state === 'BLOCKED') r.blocked += 1;
    if (p.scheduling_state === 'SCHEDULED') r.scheduled += 1;
    if (p.workflow_state === 'PUBLISHED') r.published += 1;
    if (p.workflow_state === 'FAILED') r.failed += 1;
    for (const br of p.blocking_reasons) r.blocking_reasons[br] = (r.blocking_reasons[br] ?? 0) + 1;
  }
  r.average_readiness = projections.length ? Math.round(sum / projections.length) : 0;
  return r;
}

export async function getCampaignExecutionState(
  campaignId: string,
): Promise<CampaignExecutionState> {
  const items = await getExecutionItems(campaignId);
  const byWeek = new Map<string, ExecutionStateProjection[]>();
  const all: ExecutionStateProjection[] = [];
  for (const it of items) {
    const p = projectExecutionState(it);
    all.push(p);
    const wk = it.week_id || 'wk0';
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk)!.push(p);
  }
  const weeks: WeekExecutionState[] = Array.from(byWeek.entries())
    .map(([week_id, ps]) => ({
      week_number: Number(week_id.replace(/^wk/, '')) || 0,
      week_id,
      rollup: rollup(ps),
      items: ps,
    }))
    .sort((a, b) => a.week_number - b.week_number);
  return {
    campaign_id: campaignId,
    rollup: rollup(all),
    weeks,
    resolved_at: new Date().toISOString(),
  };
}

export async function getWeekExecutionState(
  campaignId: string,
  weekNumber: number,
): Promise<WeekExecutionState> {
  const items = await getExecutionItems(campaignId, weekNumber);
  const ps = items.map(projectExecutionState);
  return {
    week_number: weekNumber,
    week_id: `wk${weekNumber}`,
    rollup: rollup(ps),
    items: ps,
  };
}

export async function getExecutionReadinessSummary(
  campaignId: string,
): Promise<ExecutionStateRollup> {
  const items = await getExecutionItems(campaignId);
  return rollup(items.map(projectExecutionState));
}

export const orchestrationStateSynchronizer = {
  synchronizeExecutionState,
  synchronizeByActivity,
  getCampaignExecutionState,
  getWeekExecutionState,
  getExecutionReadinessSummary,
};
