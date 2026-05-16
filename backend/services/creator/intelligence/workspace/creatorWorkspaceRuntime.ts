/**
 * Creator Workspace — Step-10 runtime wiring boundary.
 * ──────────────────────────────────────────────────────────────────────────
 * The thin layer that lets the EXISTING activity-workspace endpoints
 * drive the (pure) Step-9 persistence lifecycle. DB I/O is kept HERE so
 * the Step-9 functions stay pure/deterministic; this module performs no
 * DB calls itself either — it only shapes inputs/outputs. Endpoints do
 * the actual supabase read/write with their established auth + write-
 * owner patterns.
 *
 * SAFETY (hard):
 *   - Feature-flagged: ENABLE_CREATOR_WORKSPACE_LIFECYCLE. OFF ⇒ the
 *     helpers report "not enabled" and callers leave existing behavior
 *     byte-identical.
 *   - Creator-only: a row whose reconstructed task is null (Text /
 *     malformed / non-creator) is reported as `skipped` — the caller
 *     MUST fall back to the existing flow. No Text contamination.
 *   - Scheduler isolation preserved: the persisted update writes ONLY
 *     the row `content` (constraint-valid scheduler row + non-strategic
 *     workspace meta). It deliberately does NOT touch `content_status`,
 *     so the existing scheduler gate / human-production upload flow keep
 *     full ownership of that column — no scheduler rewrite.
 *
 * Additive: nothing was removed; existing endpoints keep working when
 * the flag is OFF.
 */

import {
  fromPersistedCreatorRow,
  toPersistableContent,
  applyWorkspaceEdits,
  advanceProductionStatus,
} from './creatorWorkspacePersistence';
import type {
  PersistedCreatorRow,
  WorkspaceEdits,
  EditContext,
  AdvanceContext,
} from './creatorWorkspacePersistence';
import {
  aggregateCreatorBundle,
  syncSharedCoreEdits,
  detectBundleConflicts,
  StaleWorkspaceEditError,
} from './creatorWorkspaceBundle';
import type { SyncSharedCoreResult } from './creatorWorkspaceBundle';
import type {
  CreatorWorkspaceTask,
  CreatorProductionStatus,
  CreatorWorkspaceBundle,
} from './workspaceTypes';

export function isCreatorWorkspaceLifecycleEnabled(): boolean {
  const raw = String(process.env.ENABLE_CREATOR_WORKSPACE_LIFECYCLE ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true';
}

/** Minimal daily_content_plans projection the endpoints already select. */
export interface DailyContentPlanRow {
  id?: string;
  campaign_id?: string;
  execution_id?: string | null;
  content: unknown;
  content_type?: string | null;
  platform?: string | null;
  content_status?: string | null;
  asset_type?: string | null;
  intent_type?: string | null;
  week_number?: number | null;
  topic?: string | null;
  title?: string | null;
}

export type CreatorWorkspaceLoad =
  | { ok: true; task: CreatorWorkspaceTask }
  | { ok: false; reason: 'disabled' | 'skipped' };

function toPersistedShape(row: DailyContentPlanRow): PersistedCreatorRow {
  return {
    content: (row.content ?? null) as PersistedCreatorRow['content'],
    content_type: row.content_type ?? null,
    platform: row.platform ?? null,
    content_status: row.content_status ?? null,
    asset_type: row.asset_type ?? null,
    intent_type: row.intent_type ?? null,
    week_number: row.week_number ?? null,
    topic: row.topic ?? null,
    title: row.title ?? null,
  };
}

/**
 * Phase-1 LOAD. Reconstructs a Creator row into a CreatorWorkspaceTask.
 * Returns `{ ok:false, reason:'disabled' }` when the flag is OFF and
 * `{ ok:false, reason:'skipped' }` for Text / malformed / non-creator
 * rows — in BOTH cases the caller keeps the existing behavior.
 */
export function loadCreatorWorkspace(
  row: DailyContentPlanRow,
  opts: { now?: string } = {},
): CreatorWorkspaceLoad {
  if (!isCreatorWorkspaceLifecycleEnabled()) {
    return { ok: false, reason: 'disabled' };
  }
  const task = fromPersistedCreatorRow(toPersistedShape(row), { now: opts.now });
  if (!task) return { ok: false, reason: 'skipped' };
  return { ok: true, task };
}

/**
 * Phase-2 SAVE projection. Returns the EXACT DB update payload — only
 * the `content` column. `content_status` is intentionally omitted so the
 * existing scheduler / upload-media lifecycle keeps sole ownership of it
 * (scheduler isolation preserved, no scheduler rewrite). Throws
 * fail-closed via toPersistableContent if any boundary is violated.
 */
export function buildCreatorWorkspaceUpdate(
  ws: CreatorWorkspaceTask,
): { content: string } {
  return { content: JSON.stringify(toPersistableContent(ws)) };
}

/** Phase-3 EDIT: apply whitelisted edits (pure) → caller persists. */
export function editCreatorWorkspace(
  ws: CreatorWorkspaceTask,
  edits: WorkspaceEdits,
  ctx: EditContext,
): CreatorWorkspaceTask {
  return applyWorkspaceEdits(ws, edits, ctx);
}

/** Phase-4 HUMAN-PRODUCTION: legal transition (pure) → caller persists.
 *  `uploaded_asset_ref` rides in workspace meta only (never scheduler). */
export function advanceCreatorWorkspace(
  ws: CreatorWorkspaceTask,
  to: CreatorProductionStatus,
  ctx: AdvanceContext,
): CreatorWorkspaceTask {
  return advanceProductionStatus(ws, to, ctx);
}

// ── Step-12: multi-variant bundle wiring ───────────────────────────────

export type CreatorBundleLoad =
  | { ok: true; bundle: CreatorWorkspaceBundle }
  | { ok: false; reason: 'disabled' | 'skipped' };

/**
 * Phase-1/2 LOAD: aggregate sibling rows into a CreatorWorkspaceBundle.
 * Flag-gated + Creator-only (non-creator rows are dropped during
 * aggregation → may yield `skipped` if none reconstruct).
 */
export function loadCreatorBundle(
  rows: DailyContentPlanRow[],
  opts: { now?: string; cardId?: string } = {},
): CreatorBundleLoad {
  if (!isCreatorWorkspaceLifecycleEnabled()) {
    return { ok: false, reason: 'disabled' };
  }
  const bundle = aggregateCreatorBundle(rows.map(toPersistedShape), {
    now: opts.now,
    cardId: opts.cardId,
  });
  if (!bundle) return { ok: false, reason: 'skipped' };
  return { ok: true, bundle };
}

/**
 * Phase-3 sync wrapper. Pure orchestration; caller persists each
 * returned variant content-only via buildBundlePersistUpdates.
 */
export function syncCreatorBundleSharedCore(
  bundle: CreatorWorkspaceBundle,
  sharedEdits: WorkspaceEdits,
  ctx: EditContext,
): SyncSharedCoreResult {
  return syncSharedCoreEdits(bundle, sharedEdits, ctx);
}

/**
 * Phase-5 collaboration-safe persist projection. Returns the
 * content-only update for EVERY variant keyed by platform. The endpoint
 * maps platform → daily_content_plans.id and writes content only
 * (scheduler `content_status` untouched — isolation preserved).
 */
export function buildBundlePersistUpdates(
  bundle: CreatorWorkspaceBundle,
): Array<{ platform: string; content: string }> {
  return bundle.variants.map((v) => ({
    platform: v.platform_context.platform,
    content: JSON.stringify(toPersistableContent(v)),
  }));
}

export { detectBundleConflicts, StaleWorkspaceEditError };
