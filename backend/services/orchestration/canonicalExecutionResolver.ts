/**
 * canonicalExecutionResolver — execution_id continuity + locus resolution.
 * Phase-2 Step-1 / Step-5.
 *
 * INVARIANT: an execution_id, once assigned by ANY stage (planner / workspace
 * / scheduler / creator), must never be silently replaced. This module is the
 * single place that decides "what is the id for this slot" and loudly logs
 * any cross-source mismatch instead of papering over it (the root cause of
 * the blank-card / 404 drift).
 */

const LOG = (tag: string, payload: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, JSON.stringify(payload));

/** Stable, deterministic id used ONLY when no id exists anywhere. */
function synthesizeExecutionId(input: {
  weekNumber: number;
  platform: string;
  contentType: string;
  index: number;
}): string {
  const p = String(input.platform || 'linkedin').toLowerCase();
  const c = String(input.contentType || 'post').toLowerCase();
  return `wk${input.weekNumber || 1}-${p}-${c}-${input.index}`;
}

/**
 * Preserve any existing id; only synthesize when none is present.
 * Logs [EXECUTION_ID_MISMATCH] when two sources disagree (does not throw —
 * Step-1 is stabilization/observability, not enforcement).
 */
export function resolveOrCreateExecutionId(input: {
  campaignId: string;
  plannerId?: string | null;
  workspaceId?: string | null;
  schedulerId?: string | null;
  creatorId?: string | null;
  weekNumber: number;
  platform: string;
  contentType: string;
  index: number;
}): { execution_id: string; mismatch: boolean; source: string } {
  const candidates: Array<{ source: string; id: string }> = [];
  if (input.plannerId) candidates.push({ source: 'planner', id: String(input.plannerId) });
  if (input.workspaceId) candidates.push({ source: 'workspace', id: String(input.workspaceId) });
  if (input.schedulerId) candidates.push({ source: 'scheduler', id: String(input.schedulerId) });
  if (input.creatorId) candidates.push({ source: 'creator', id: String(input.creatorId) });

  if (candidates.length === 0) {
    const synthesized = synthesizeExecutionId(input);
    LOG('ORCHESTRATION_RECONCILE', {
      campaign_id: input.campaignId,
      execution_id: synthesized,
      source: 'synthesized',
      resolution_strategy: 'no_existing_id',
    });
    return { execution_id: synthesized, mismatch: false, source: 'synthesized' };
  }

  const first = candidates[0];
  const mismatch = candidates.some((c) => c.id !== first.id);
  if (mismatch) {
    LOG('EXECUTION_ID_MISMATCH', {
      campaign_id: input.campaignId,
      execution_id: first.id,
      source: first.source,
      resolution_strategy: 'preserve_first_existing',
      conflicting: candidates,
    });
  }
  // Preserve the first existing id (planner > workspace > scheduler > creator).
  return { execution_id: first.id, mismatch, source: first.source };
}

/** Assert two ids agree for the same logical slot; log if not. Never throws in Step-1. */
export function assertExecutionIdContinuity(
  campaignId: string,
  expected: string,
  observed: string,
  stage: string,
): boolean {
  if (expected && observed && expected !== observed) {
    LOG('EXECUTION_ID_MISMATCH', {
      campaign_id: campaignId,
      execution_id: expected,
      observed,
      source: stage,
      resolution_strategy: 'continuity_check',
    });
    return false;
  }
  return true;
}

/** Find a blueprint item by execution_id across daily_execution_items / execution_items. */
export function findBlueprintItem(
  blueprint: { weeks?: Array<Record<string, unknown>> } | null | undefined,
  executionId: string,
): { week: Record<string, unknown>; item: Record<string, unknown> } | null {
  const weeks = Array.isArray(blueprint?.weeks) ? blueprint!.weeks : [];
  for (const week of weeks) {
    const lists = [
      Array.isArray((week as any).daily_execution_items) ? (week as any).daily_execution_items : [],
      Array.isArray((week as any).execution_items) ? (week as any).execution_items : [],
    ];
    for (const list of lists) {
      for (const item of list as Array<Record<string, unknown>>) {
        const eid = String(item?.execution_id ?? item?.id ?? '').trim();
        if (eid && eid === executionId) return { week, item };
      }
    }
  }
  return null;
}

/** Enumerate every blueprint item (week, item) pair in stable order. */
export function listBlueprintItems(
  blueprint: { weeks?: Array<Record<string, unknown>> } | null | undefined,
): Array<{ week: Record<string, unknown>; item: Record<string, unknown> }> {
  const out: Array<{ week: Record<string, unknown>; item: Record<string, unknown> }> = [];
  const weeks = Array.isArray(blueprint?.weeks) ? blueprint!.weeks : [];
  for (const week of weeks) {
    const list =
      (Array.isArray((week as any).daily_execution_items) && (week as any).daily_execution_items.length
        ? (week as any).daily_execution_items
        : Array.isArray((week as any).execution_items)
          ? (week as any).execution_items
          : []) as Array<Record<string, unknown>>;
    for (const item of list) out.push({ week, item });
  }
  return out;
}
