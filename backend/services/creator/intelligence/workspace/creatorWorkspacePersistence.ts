/**
 * Creator Workspace — persistence + round-trip projection (pure).
 * ──────────────────────────────────────────────────────────────────────────
 *   daily_content_plans row  ──fromPersistedCreatorRow──►  CreatorWorkspaceTask
 *   CreatorWorkspaceTask      ──applyWorkspaceEdits──────►  CreatorWorkspaceTask'
 *   CreatorWorkspaceTask      ──toPersistableSchedulerRow─►  CreatorSchedulerRow
 *   CreatorWorkspaceTask      ──toPersistableContent──────►  row content JSON
 *
 * Hard invariants:
 *   - Reconstruction NEVER trusts a raw payload blindly: every field is
 *     validated/coerced; strategic keys are scrubbed; a broken
 *     asset_payload is rebuilt to a constraint-valid skeleton.
 *   - The scheduler boundary is fail-closed: re-projection throws if any
 *     strategic key is present or the row shape is not the exact 5-key
 *     CreatorSchedulerRow.
 *   - Pure + deterministic: no DB, no scheduler, no clock, no random.
 *     Timestamps/editor/source are caller-supplied (Phase-4).
 *   - Non-creator rows return null (no Text/Creator contamination).
 *
 * Runtime-inert / additive: nothing in pages/ or backend/queue/ imports
 * this. Existing runtime + feature-flag isolation is unchanged.
 */

import { getPlatformVariation } from '../planning/platformVariation';
// Step-13 Phase-8 cutover: human-production truth derives from the
// canonical CreatorAssetRegistry (behavior-preserving for reel/video/
// short; de-drifts aliases like reels/tiktok/youtube_short).
import { isHumanProductionAsset } from '../canonical';
import type {
  CreatorSchedulerRow,
  CreatorReuseClassification,
} from '../planning/creatorCardTypes';
import type {
  CreatorWorkspaceTask,
  CreatorWorkspaceMeta,
  CreatorProductionStatus,
  WorkspacePackagingContext,
} from './workspaceTypes';


/** Strategic keys that must NEVER appear on a scheduler-bound object —
 *  single source of the invariant across Steps 7/8/9. */
const FORBIDDEN_SCHEDULER_KEYS = [
  'blueprint', 'emotional_goal', 'hook_strategy', 'creative_objective',
  'continuity_context', 'adaptation_notes', 'visual_direction',
  'platform_strategy', 'reuse_strategy', 'cta_strategy', 'packaging_strategy',
  'planning_context', 'production_context', 'adaptation_context',
  'creator_planning_source', 'creator_workspace_meta', 'render_envelope',
] as const;

const SCHEDULER_ROW_KEYS = [
  'asset_instruction', 'asset_payload', 'asset_type', 'intent_type', 'packaging',
];

/** Phase-2 editable surface. Anything NOT here is locked (planning
 *  metadata, continuity, scheduler boundary, governance identifiers). */
export const WORKSPACE_EDITABLE_FIELDS = [
  'caption', 'hashtags', 'keywords', 'cta',
  'overlays', 'creator_notes', 'adaptation_note', 'production_notes',
] as const;

const LIFECYCLE: CreatorProductionStatus[] = [
  'draft',
  'awaiting_human_production',
  'in_production',
  'asset_uploaded',
  'approval_ready',
  'ready_for_scheduling',
  'scheduled',
];
/** Legal forward transitions (Phase-5). draft is image/carousel only. */
const LEGAL_TRANSITIONS: Record<CreatorProductionStatus, CreatorProductionStatus[]> = {
  draft: ['ready_for_scheduling', 'awaiting_human_production'],
  awaiting_human_production: ['in_production'],
  in_production: ['asset_uploaded'],
  asset_uploaded: ['approval_ready', 'in_production'],
  approval_ready: ['ready_for_scheduling', 'in_production'],
  ready_for_scheduling: ['scheduled'],
  scheduled: [],
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function asStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter((s) => s.length > 0) : [];
}
function deepFreezeClone<T>(v: T): T {
  const c = JSON.parse(JSON.stringify(v)) as T;
  const freeze = (o: unknown) => {
    if (o && typeof o === 'object') {
      Object.values(o as Record<string, unknown>).forEach(freeze);
      Object.freeze(o);
    }
  };
  freeze(c);
  return c;
}

/** Constraint-valid asset_payload skeleton per asset_type (matches the
 *  deployed is_valid_creator_daily_content_payload acceptance). */
function emptyPayloadFor(at: string): Record<string, unknown> {
  switch (at) {
    case 'carousel': return { slides: [] };
    case 'image': return { visual_descriptor: {} };
    case 'video': return { scenes: [] };
    case 'post_with_asset':
    case 'thread_with_asset': return { caption_blueprint: {} };
    default: return {};
  }
}

/** Validate (don't trust) a payload's required shape; rebuild if broken. */
function sanitizePayload(at: string, raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return emptyPayloadFor(at);
  if (at === 'carousel') {
    return Array.isArray(raw.slides) ? raw : { ...raw, slides: Array.isArray(raw.slides) ? raw.slides : [] };
  }
  if (at === 'image') {
    return isPlainObject(raw.visual_descriptor) ? raw : { ...raw, visual_descriptor: {} };
  }
  if (at === 'video') {
    return Array.isArray(raw.scenes) ? raw : { ...raw, scenes: [] };
  }
  if (at === 'post_with_asset' || at === 'thread_with_asset') {
    return isPlainObject(raw.caption_blueprint) ? raw : { ...raw, caption_blueprint: {} };
  }
  return raw;
}

function coercePackaging(raw: unknown): WorkspacePackagingContext {
  const p = isPlainObject(raw) ? raw : {};
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (!['caption', 'hashtags', 'keywords', 'meta_description', 'cta'].includes(k)
        && !(FORBIDDEN_SCHEDULER_KEYS as readonly string[]).includes(k)) {
      extras[k] = v;
    }
  }
  return {
    ...extras,
    caption: asStr(p.caption),
    hashtags: asStrArray(p.hashtags),
    keywords: asStrArray(p.keywords),
    meta_description: asStr(p.meta_description),
    cta: asStr(p.cta),
  };
}

/** Offline mirror of the deployed creator-payload constraint — used for
 *  fail-fast hardening before any persistence write. */
export function isConstraintValidSchedulerRow(row: unknown): row is CreatorSchedulerRow {
  if (!isPlainObject(row)) return false;
  if (row.intent_type !== 'creator') return false;
  if (typeof row.asset_type !== 'string' || !row.asset_type) return false;
  if (!isPlainObject(row.packaging)) return false;
  if (!isPlainObject(row.asset_instruction)) return false;
  if (!isPlainObject(row.asset_payload)) return false;
  const pk = row.packaging as Record<string, unknown>;
  for (const k of ['caption', 'hashtags', 'meta_description', 'keywords', 'cta']) {
    if (!(k in pk)) return false;
  }
  if (!Array.isArray(pk.hashtags) || !Array.isArray(pk.keywords)) return false;
  const at = row.asset_type;
  const ap = row.asset_payload as Record<string, unknown>;
  if (at === 'carousel' && !Array.isArray(ap.slides)) return false;
  if (at === 'image' && !isPlainObject(ap.visual_descriptor)) return false;
  if (at === 'video' && !Array.isArray(ap.scenes)) return false;
  return true;
}

export interface PersistedCreatorRow {
  content: string | Record<string, unknown> | null;
  content_type?: string | null;
  platform?: string | null;
  content_status?: string | null;
  asset_type?: string | null;
  intent_type?: string | null;
  week_number?: number | null;
  topic?: string | null;
  title?: string | null;
}

export interface ReconstructOptions {
  /** Deterministic timestamp seed for the default meta (no clock here). */
  now?: string;
}

function deriveStatus(
  human: boolean,
  contentStatus: string | null | undefined,
  metaStatus: CreatorProductionStatus | undefined,
  hasPackaging: boolean,
): CreatorProductionStatus {
  if (metaStatus && LIFECYCLE.includes(metaStatus)) return metaStatus;
  const cs = String(contentStatus ?? '').trim();
  if ((LIFECYCLE as string[]).includes(cs)) return cs as CreatorProductionStatus;
  if (human) return 'awaiting_human_production';
  return hasPackaging ? 'ready_for_scheduling' : 'draft';
}

/**
 * PHASE-1/6 reconstruction. Returns null for non-creator / unparseable
 * rows (caller skips — no contamination, backward compatible).
 */
export function fromPersistedCreatorRow(
  row: PersistedCreatorRow,
  opts: ReconstructOptions = {},
): CreatorWorkspaceTask | null {
  let parsed: Record<string, unknown> | null = null;
  if (isPlainObject(row.content)) parsed = row.content;
  else if (typeof row.content === 'string') {
    try { const p = JSON.parse(row.content); parsed = isPlainObject(p) ? p : null; }
    catch { return null; }
  }
  if (!parsed) return null;

  const intentType = asStr(parsed.intent_type) || asStr(row.intent_type);
  // NOTE: the non-creator skip is deferred to after `human` is computed.
  // Video / Group-B formats are intentionally persisted in the human-
  // production lane (intent_type='text' + content_status='guidance_ready')
  // because daily_content_plans_creator_capability_check gates
  // intent_type='creator'. Read-side only: we still reconstruct those rows
  // as a Group-B creator brief so the workspace shows the video/creator
  // brief instead of the text brief. Pure BOLT-text rows (not human-
  // production) are still skipped below — behaviour unchanged for them.

  const assetType =
    asStr(parsed.asset_type) || asStr(row.asset_type) ||
    String(row.content_type ?? '').trim().toLowerCase();
  const platform = String(row.platform ?? '').trim().toLowerCase() || 'default';
  const variation = getPlatformVariation(platform);

  const breadcrumb = isPlainObject(parsed.creator_planning_source)
    ? parsed.creator_planning_source : {};
  const persistedMeta = isPlainObject(parsed.creator_workspace_meta)
    ? parsed.creator_workspace_meta : {};

  const classification: CreatorReuseClassification =
    (['shared_content', 'platform_native_content', 'hybrid_content'] as const)
      .find((c) => c === breadcrumb.reuse_classification) ?? 'shared_content';

  const fmt = String(row.content_type ?? '').trim().toLowerCase();
  const human =
    parsed.requires_human_production === true ||
    isHumanProductionAsset(fmt, assetType);

  // Deferred skip: keep only creator rows OR Group-B human-production rows
  // (video/reel/short/podcast). Pure BOLT-text rows still return null exactly
  // as before — no contamination, backward compatible.
  if (intentType !== 'creator' && !human) return null;

  const packaging = coercePackaging(parsed.packaging);
  const assetPayload = sanitizePayload(assetType, parsed.asset_payload);
  const assetInstruction = isPlainObject(parsed.asset_instruction)
    ? parsed.asset_instruction : {};

  const metaStatus = LIFECYCLE.includes(persistedMeta.production_status as CreatorProductionStatus)
    ? (persistedMeta.production_status as CreatorProductionStatus)
    : undefined;
  const status = deriveStatus(human, row.content_status, metaStatus,
    packaging.caption.length > 0 || packaging.hashtags.length > 0);

  const schedulerRow: CreatorSchedulerRow = {
    intent_type: 'creator',
    asset_type: assetType,
    packaging: { ...packaging } as CreatorSchedulerRow['packaging'],
    asset_payload: assetPayload,
    asset_instruction: assetInstruction,
  };

  const workspaceMeta: CreatorWorkspaceMeta = {
    workspace_revision: Number.isFinite(persistedMeta.workspace_revision as number)
      ? Number(persistedMeta.workspace_revision) : 0,
    updated_at: asStr(persistedMeta.updated_at) || asStr(opts.now),
    last_editor: asStr(persistedMeta.last_editor) || 'system',
    change_source: asStr(persistedMeta.change_source) || 'reconstructed',
    uploaded_asset_ref: typeof persistedMeta.uploaded_asset_ref === 'string'
      ? persistedMeta.uploaded_asset_ref : null,
    override_provenance: isPlainObject(persistedMeta.override_provenance)
      ? (persistedMeta.override_provenance as CreatorWorkspaceMeta['override_provenance'])
      : {},
    synced_from_core_revision:
      Number.isFinite(persistedMeta.synced_from_core_revision as number)
        ? Number(persistedMeta.synced_from_core_revision)
        : null,
  };

  // Storyboard skeleton from the (validated) payload — blueprint itself
  // is NOT persisted by the boundary, so it stays null.
  const ap = assetPayload as Record<string, unknown>;
  const storyboard: unknown[] = Array.isArray(ap.slides)
    ? ap.slides as unknown[]
    : Array.isArray(ap.scenes)
      ? ap.scenes as unknown[]
      : ap.visual_descriptor ? [ap.visual_descriptor] : [];

  return {
    domain: 'creator',
    task_id: asStr(breadcrumb.task_id) || `task:reconstructed:${platform}`,
    blueprint_id: null,
    asset_family: (assetType || null) as CreatorWorkspaceTask['asset_family'],

    planning_context: {
      card_id: asStr(breadcrumb.card_id) || 'card:reconstructed',
      week_index: Number.isFinite(row.week_number as number) ? Number(row.week_number) : 0,
      reuse_classification: classification,
      // Deep strategy is intentionally NOT persisted (scheduler boundary)
      // → reconstructed as neutral placeholders, never fabricated.
      creative_objective: '',
      core_message: '',
      audience_intent: '',
      emotional_goal: { pain_point: '', outcome_promise: '', tone: '' },
      continuity_context: {},
      brand_grounding: {},
    },
    production_context: {
      asset_family: (assetType || null) as CreatorWorkspaceTask['asset_family'],
      blueprint: null,
      storyboard,
      overlays: asStrArray((persistedMeta as Record<string, unknown>).overlays),
      pacing_guidance: '',
      scene_direction: '',
      production_notes: asStrArray((persistedMeta as Record<string, unknown>).production_notes),
      creator_notes: asStrArray((persistedMeta as Record<string, unknown>).creator_notes),
    },
    platform_context: {
      platform,
      adaptation_note: asStr((persistedMeta as Record<string, unknown>).adaptation_note) || variation.note,
      platform_strategy: '',
      hook_angle: variation.hookAngle,
      pacing: variation.pacing,
    },
    packaging_context: packaging,
    adaptation_context: {
      classification,
      is_shared_core_variant: classification !== 'platform_native_content',
      shared_core_id: typeof persistedMeta.shared_core_id === 'string'
        ? persistedMeta.shared_core_id : null,
      override_layer: isPlainObject(persistedMeta.override_layer)
        ? persistedMeta.override_layer : {},
    },
    production_status: status,
    requires_human_production: human,
    scheduler_eligible: !human && (status === 'ready_for_scheduling' || status === 'scheduled'),
    scheduler_row: deepFreezeClone(schedulerRow),
    render_envelope: {
      render_ready: false,
      render_target: null,
      attach_ref: { task_id: asStr(breadcrumb.task_id) || `task:reconstructed:${platform}`, blueprint_id: null },
    },
    workspace_meta: workspaceMeta,
  };
}

export interface WorkspaceEdits {
  caption?: string;
  hashtags?: string[];
  keywords?: string[];
  cta?: string;
  overlays?: string[];
  creator_notes?: string[];
  adaptation_note?: string;
  production_notes?: string[];
}
export interface EditContext {
  now: string;
  editor: string;
  change_source: string;
  /** Step-12 Phase-5 optimistic concurrency. When provided and it does
   *  NOT match the task's current workspace_revision, the edit is
   *  rejected (StaleWorkspaceEditError) — prevents silent overwrite. */
  expectedRevision?: number;
  /** Step-12 Phase-4: mark the edited fields as PLATFORM overrides so
   *  shared-core synchronization will not clobber them. */
  asOverride?: boolean;
  /** Step-12 Phase-3: stamp which shared-core revision this variant was
   *  synchronized from (collaboration lineage). */
  syncedFromCoreRevision?: number | null;
}

/** Step-12 stale-edit rejection (optimistic concurrency). Carries the
 *  numbers so the endpoint can surface a CreatorWorkspaceConflict. */
export class StaleWorkspaceEditError extends Error {
  readonly code = 'STALE_WORKSPACE_EDIT';
  constructor(
    readonly expected_revision: number,
    readonly current_revision: number,
    readonly last_editor: string,
  ) {
    super(
      `STALE_WORKSPACE_EDIT: expected revision ${expected_revision} but current is ${current_revision} (last edited by ${last_editor})`,
    );
    this.name = 'StaleWorkspaceEditError';
  }
}

/** Packaging/production fields that participate in override provenance
 *  + shared-core synchronization. */
const OVERRIDABLE_FIELDS = [
  'caption', 'hashtags', 'keywords', 'cta',
  'overlays', 'creator_notes', 'production_notes', 'adaptation_note',
] as const;

/**
 * PHASE-2 controlled edit. Only whitelisted fields mutate; locked
 * strategic/continuity/scheduler/governance state is untouched.
 * Returns a NEW task (input not mutated). scheduler_row is intentionally
 * NOT re-projected here — that is the explicit Phase-3 step.
 */
export function applyWorkspaceEdits(
  ws: CreatorWorkspaceTask,
  edits: WorkspaceEdits,
  ctx: EditContext,
): CreatorWorkspaceTask {
  const prev = ws.workspace_meta;
  // Phase-5 optimistic concurrency — reject stale edits BEFORE mutating.
  if (
    typeof ctx.expectedRevision === 'number' &&
    ctx.expectedRevision !== (prev?.workspace_revision ?? 0)
  ) {
    throw new StaleWorkspaceEditError(
      ctx.expectedRevision,
      prev?.workspace_revision ?? 0,
      prev?.last_editor ?? 'unknown',
    );
  }

  const next: CreatorWorkspaceTask = JSON.parse(JSON.stringify(ws));
  const pc = next.packaging_context;
  const touched: string[] = [];
  if (typeof edits.caption === 'string') { pc.caption = edits.caption; touched.push('caption'); }
  if (Array.isArray(edits.hashtags)) { pc.hashtags = edits.hashtags.map(String); touched.push('hashtags'); }
  if (Array.isArray(edits.keywords)) { pc.keywords = edits.keywords.map(String); touched.push('keywords'); }
  if (typeof edits.cta === 'string') { pc.cta = edits.cta; touched.push('cta'); }
  if (Array.isArray(edits.overlays)) { next.production_context.overlays = edits.overlays.map(String); touched.push('overlays'); }
  if (Array.isArray(edits.creator_notes)) { next.production_context.creator_notes = edits.creator_notes.map(String); touched.push('creator_notes'); }
  if (Array.isArray(edits.production_notes)) { next.production_context.production_notes = edits.production_notes.map(String); touched.push('production_notes'); }
  if (typeof edits.adaptation_note === 'string') { next.platform_context.adaptation_note = edits.adaptation_note; touched.push('adaptation_note'); }

  // Phase-4 override provenance: carry prior provenance forward; when the
  // edit is an explicit platform override, stamp provenance for each
  // touched overridable field so future shared-core syncs skip them.
  const provenance: Record<string, { by: string; at: string; source: string }> = {
    ...(prev?.override_provenance ?? {}),
  };
  if (ctx.asOverride) {
    for (const f of touched) {
      if ((OVERRIDABLE_FIELDS as readonly string[]).includes(f)) {
        provenance[f] = { by: ctx.editor, at: ctx.now, source: ctx.change_source };
      }
    }
  }

  next.workspace_meta = {
    workspace_revision: (prev?.workspace_revision ?? 0) + 1,
    updated_at: ctx.now,
    last_editor: ctx.editor,
    change_source: ctx.change_source,
    uploaded_asset_ref: prev?.uploaded_asset_ref ?? null,
    override_provenance: provenance,
    synced_from_core_revision:
      ctx.syncedFromCoreRevision !== undefined
        ? ctx.syncedFromCoreRevision
        : prev?.synced_from_core_revision ?? null,
  };
  return next;
}

/**
 * PHASE-3 safe re-projection. Edited packaging wins; asset_payload /
 * asset_instruction are NOT editable and carried from the frozen base
 * (validated, rebuilt if broken). Fail-closed: throws if a strategic
 * key leaked or the shape is not exactly the 5-key scheduler row.
 */
export function toPersistableSchedulerRow(ws: CreatorWorkspaceTask): CreatorSchedulerRow {
  const base = ws.scheduler_row;
  const at = String(base.asset_type || ws.asset_family || '').trim();

  const edited = ws.packaging_context;
  const basePk = base.packaging as Record<string, unknown>;
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(edited)) {
    if (!['caption', 'hashtags', 'keywords', 'meta_description', 'cta'].includes(k)
        && !(FORBIDDEN_SCHEDULER_KEYS as readonly string[]).includes(k)) {
      extras[k] = v;
    }
  }
  const packaging = {
    ...extras,
    caption: asStr(edited.caption) || asStr(basePk.caption),
    hashtags: edited.hashtags.length ? edited.hashtags : asStrArray(basePk.hashtags),
    keywords: edited.keywords.length ? edited.keywords : asStrArray(basePk.keywords),
    meta_description: asStr(edited.meta_description) || asStr(basePk.meta_description),
    cta: asStr(edited.cta) || asStr(basePk.cta),
  };

  const row: CreatorSchedulerRow = {
    intent_type: 'creator',
    asset_type: at,
    packaging: packaging as CreatorSchedulerRow['packaging'],
    asset_payload: sanitizePayload(at, base.asset_payload),
    asset_instruction: isPlainObject(base.asset_instruction) ? base.asset_instruction : {},
  };

  for (const k of FORBIDDEN_SCHEDULER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(row, k)) {
      throw new Error(`Scheduler-boundary violation: strategic key "${k}"`);
    }
  }
  if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(SCHEDULER_ROW_KEYS)) {
    throw new Error(`Scheduler-boundary violation: shape [${Object.keys(row).sort().join(', ')}]`);
  }
  if (!isConstraintValidSchedulerRow(row)) {
    throw new Error(`Re-projection produced a constraint-invalid row (asset_type=${at})`);
  }
  return deepFreezeClone(row);
}

/**
 * Full persistable content for daily_content_plans.content. The
 * scheduler reads ONLY the 5 row keys; the breadcrumb + workspace meta
 * are co-located NON-strategic lifecycle data (not scheduler input).
 */
export function toPersistableContent(ws: CreatorWorkspaceTask): Record<string, unknown> {
  const row = toPersistableSchedulerRow(ws);
  return {
    ...row,
    requires_human_production: ws.requires_human_production,
    creator_planning_source: {
      via: 'workspace_round_trip',
      card_id: ws.planning_context.card_id,
      task_id: ws.task_id,
      reuse_classification: ws.adaptation_context.classification,
    },
    creator_workspace_meta: {
      ...(ws.workspace_meta ?? {
        workspace_revision: 0, updated_at: '', last_editor: 'system',
        change_source: 'persist', uploaded_asset_ref: null,
      }),
      production_status: ws.production_status,
      shared_core_id: ws.adaptation_context.shared_core_id,
      override_layer: ws.adaptation_context.override_layer,
      overlays: ws.production_context.overlays,
      creator_notes: ws.production_context.creator_notes,
      production_notes: ws.production_context.production_notes,
      adaptation_note: ws.platform_context.adaptation_note,
    },
  };
}

export interface AdvanceContext extends EditContext {
  uploaded_asset_ref?: string | null;
}

/**
 * PHASE-5 human-production round-trip transition. Enforces the legal
 * forward graph; throws on an illegal transition. `asset_uploaded`
 * requires an external uploaded asset ref — stored in workspace_meta,
 * NEVER in the scheduler row. Returns a NEW task.
 */
export function advanceProductionStatus(
  ws: CreatorWorkspaceTask,
  next: CreatorProductionStatus,
  ctx: AdvanceContext,
): CreatorWorkspaceTask {
  const allowed = LEGAL_TRANSITIONS[ws.production_status] ?? [];
  if (!allowed.includes(next)) {
    throw new Error(
      `Illegal production transition: ${ws.production_status} → ${next}`,
    );
  }
  if (next === 'asset_uploaded' && !ctx.uploaded_asset_ref) {
    throw new Error('asset_uploaded requires ctx.uploaded_asset_ref');
  }
  const out: CreatorWorkspaceTask = JSON.parse(JSON.stringify(ws));
  out.production_status = next;
  out.scheduler_eligible =
    !out.requires_human_production
      ? next === 'ready_for_scheduling' || next === 'scheduled'
      : next === 'ready_for_scheduling' || next === 'scheduled';
  const prev = ws.workspace_meta;
  out.workspace_meta = {
    workspace_revision: (prev?.workspace_revision ?? 0) + 1,
    updated_at: ctx.now,
    last_editor: ctx.editor,
    change_source: ctx.change_source,
    uploaded_asset_ref:
      ctx.uploaded_asset_ref ?? prev?.uploaded_asset_ref ?? null,
  };
  return out;
}
