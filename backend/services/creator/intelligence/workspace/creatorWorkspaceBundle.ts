/**
 * Creator Workspace — Step-12 multi-variant orchestration (pure).
 * ──────────────────────────────────────────────────────────────────────────
 *   PersistedCreatorRow[]  ──aggregateCreatorBundle──►  CreatorWorkspaceBundle
 *   CreatorWorkspaceBundle ──syncSharedCoreEdits─────►  CreatorWorkspaceBundle'
 *
 * Phase-1  bundle aggregation (group sibling rows of one card lineage)
 * Phase-3  shared-core edits propagate to NON-overridden variants
 * Phase-4  per-field override provenance is preserved across sync
 * Phase-5  conflict surface (optimistic revision mismatch → object, not throw)
 *
 * Purity: no DB / scheduler / clock / random. Deterministic: same rows
 * (in any order) → same bundle. Scheduler isolation is inherited from
 * the Step-9 functions this composes — sync never touches scheduler_row
 * (re-projection stays server-side in toPersistableSchedulerRow).
 *
 * Additive + runtime-inert: nothing in pages/ or backend/queue/ imports
 * this module directly; the endpoint composes it.
 */

import {
  fromPersistedCreatorRow,
  applyWorkspaceEdits,
  StaleWorkspaceEditError,
} from './creatorWorkspacePersistence';
import type {
  PersistedCreatorRow,
  WorkspaceEdits,
  EditContext,
} from './creatorWorkspacePersistence';
import type {
  CreatorWorkspaceTask,
  CreatorWorkspaceBundle,
  CreatorWorkspaceConflict,
} from './workspaceTypes';

/** Shared-core synchronizable fields (Phase-3). adaptation_note is
 *  intentionally NOT synced — it is inherently per-platform. */
const SYNCABLE_FIELDS = [
  'caption', 'hashtags', 'keywords', 'cta',
  'overlays', 'creator_notes', 'production_notes',
] as const;
type SyncableField = (typeof SYNCABLE_FIELDS)[number];

function rev(t: CreatorWorkspaceTask | null): number {
  return t?.workspace_meta?.workspace_revision ?? 0;
}
function overriddenFields(t: CreatorWorkspaceTask): string[] {
  return Object.keys(t.workspace_meta?.override_provenance ?? {});
}

/**
 * Phase-1/2 aggregation. Reconstructs each row, drops non-creator rows
 * (Text isolation), groups by card lineage (planning_context.card_id),
 * and assembles the bundle. When multiple card lineages are present the
 * LARGEST group wins (callers should pass siblings of one card; this is
 * a deterministic safety net, not a feature).
 */
export function aggregateCreatorBundle(
  rows: PersistedCreatorRow[],
  opts: { now?: string; cardId?: string } = {},
): CreatorWorkspaceBundle | null {
  const tasks: CreatorWorkspaceTask[] = [];
  for (const r of rows) {
    const t = fromPersistedCreatorRow(r, { now: opts.now });
    if (!t) continue;
    // When a target card lineage is given, restrict to it so the bundle
    // is exactly that card's siblings (deterministic, not "largest").
    if (opts.cardId && t.planning_context.card_id !== opts.cardId) continue;
    tasks.push(t);
  }
  if (tasks.length === 0) return null;

  // Group by card lineage; pick the largest, then deterministically by
  // card_id so identical input → identical bundle.
  const byCard = new Map<string, CreatorWorkspaceTask[]>();
  for (const t of tasks) {
    const k = t.planning_context.card_id;
    (byCard.get(k) ?? byCard.set(k, []).get(k)!).push(t);
  }
  const chosen = [...byCard.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  )[0]!;
  const variants = chosen[1]
    .slice()
    .sort((a, b) => a.platform_context.platform.localeCompare(b.platform_context.platform));

  const head = variants[0]!;
  const classification = head.adaptation_context.classification;
  const sharedCore =
    classification === 'platform_native_content'
      ? null
      : variants.find((v) => v.adaptation_context.is_shared_core_variant) ?? variants[0]!;

  const override_layers: Record<string, string[]> = {};
  const variant_revisions: Record<string, number> = {};
  for (const v of variants) {
    override_layers[v.platform_context.platform] = overriddenFields(v);
    variant_revisions[v.platform_context.platform] = rev(v);
  }
  const coreRev = rev(sharedCore);
  const inSync =
    sharedCore == null
      ? true
      : variants.every(
          (v) =>
            v === sharedCore ||
            (v.workspace_meta?.synced_from_core_revision ?? null) === coreRev,
        );

  return {
    card_id: head.planning_context.card_id,
    week_index: head.planning_context.week_index,
    classification,
    shared_core: sharedCore,
    variants,
    override_layers,
    synchronization: {
      core_revision: coreRev,
      variant_revisions,
      in_sync: inSync,
    },
  };
}

export interface SyncSharedCoreResult {
  bundle: CreatorWorkspaceBundle;
  /** Platforms whose variant received the propagated change. */
  propagated_to: string[];
  /** Per-variant, the fields skipped because they are platform overrides. */
  skipped_overrides: Record<string, string[]>;
}

/**
 * Phase-3/4 shared-core synchronization. Applies `sharedEdits` to the
 * shared core (Phase-5 optimistic check via ctx.expectedRevision), then
 * propagates ONLY non-overridden syncable fields to every other variant,
 * stamping each with the new core revision. Per-platform overrides are
 * preserved verbatim. Pure — returns a new bundle.
 */
export function syncSharedCoreEdits(
  bundle: CreatorWorkspaceBundle,
  sharedEdits: WorkspaceEdits,
  ctx: EditContext,
): SyncSharedCoreResult {
  if (!bundle.shared_core) {
    throw new Error(
      'SYNC_NOT_APPLICABLE: platform_native_content has no shared core',
    );
  }

  // 1) Update the shared core (optimistic concurrency enforced here).
  const newCore = applyWorkspaceEdits(bundle.shared_core, sharedEdits, ctx);
  const newCoreRev = newCore.workspace_meta!.workspace_revision;
  const corePlatform = newCore.platform_context.platform;

  const propagated_to: string[] = [];
  const skipped_overrides: Record<string, string[]> = {};

  const nextVariants = bundle.variants.map((v) => {
    if (v.platform_context.platform === corePlatform) return newCore;

    const overridden = new Set(overriddenFields(v));
    const propagate: WorkspaceEdits = {};
    const skipped: string[] = [];
    for (const f of SYNCABLE_FIELDS) {
      if (!(f in sharedEdits)) continue;
      if (overridden.has(f)) { skipped.push(f); continue; }
      (propagate as Record<string, unknown>)[f] =
        (sharedEdits as Record<string, unknown>)[f];
    }
    skipped_overrides[v.platform_context.platform] = skipped;
    if (Object.keys(propagate).length === 0) {
      // Still record sync lineage so in_sync stays meaningful.
      const synced = applyWorkspaceEdits(v, {}, {
        ...ctx,
        change_source: `${ctx.change_source}:sync`,
        syncedFromCoreRevision: newCoreRev,
        expectedRevision: undefined,
      });
      return synced;
    }
    propagated_to.push(v.platform_context.platform);
    return applyWorkspaceEdits(v, propagate, {
      ...ctx,
      change_source: `${ctx.change_source}:sync`,
      syncedFromCoreRevision: newCoreRev,
      expectedRevision: undefined, // variants follow the core, not their own token
    });
  });

  const override_layers: Record<string, string[]> = {};
  const variant_revisions: Record<string, number> = {};
  for (const v of nextVariants) {
    override_layers[v.platform_context.platform] = overriddenFields(v);
    variant_revisions[v.platform_context.platform] = rev(v);
  }

  return {
    bundle: {
      ...bundle,
      shared_core: newCore,
      variants: nextVariants,
      override_layers,
      synchronization: {
        core_revision: newCoreRev,
        variant_revisions,
        in_sync: true,
      },
    },
    propagated_to,
    skipped_overrides,
  };
}

/**
 * Phase-5 conflict surface. Given the revisions the caller last saw,
 * return a conflict object per variant whose persisted revision moved
 * (another editor won). Non-throwing so the UI can present a merge
 * affordance.
 */
export function detectBundleConflicts(
  bundle: CreatorWorkspaceBundle,
  expectedRevisions: Record<string, number>,
): CreatorWorkspaceConflict[] {
  const out: CreatorWorkspaceConflict[] = [];
  for (const v of bundle.variants) {
    const p = v.platform_context.platform;
    if (!(p in expectedRevisions)) continue;
    const current = rev(v);
    if (expectedRevisions[p] !== current) {
      out.push({
        conflict: true,
        task_id: v.task_id,
        platform: p,
        expected_revision: expectedRevisions[p]!,
        current_revision: current,
        last_editor: v.workspace_meta?.last_editor ?? 'unknown',
      });
    }
  }
  return out;
}

export { StaleWorkspaceEditError };
