/**
 * Creator Workspace consumption adapter (pure).
 * ──────────────────────────────────────────────────────────────────────────
 *   CreatorBlueprintCard  +  CreatorDailyTask   →   CreatorWorkspaceTask
 *
 * Phase-3 consumption: lifts the rich blueprint/strategic context onto a
 * workspace task FOR THE EDITOR, while the flat `scheduler_row` is
 * carried as a FROZEN, deep-cloned projection (Phase-4 isolation —
 * editing workspace context can never mutate what the scheduler sees).
 *
 * Purity: no DB / scheduler / queue / rendering / UI / mutation of
 * inputs. Deterministic: same (card, task) → byte-identical workspace
 * task. Runtime-inert: nothing in pages/ or backend/queue/ imports this.
 * This step is architecturally ADDITIVE.
 */

import type {
  CreatorBlueprintCard,
  CreatorDailyTask,
  CreatorSchedulerRow,
  CreatorDailyExpansion,
} from '../planning/creatorCardTypes';
import { getPlatformVariation } from '../planning/platformVariation';
import type { ContentBlueprint } from '../blueprintTypes';
import type {
  CreatorWorkspaceTask,
  CreatorWorkspaceBundle,
  CreatorProductionStatus,
  WorkspaceProductionContext,
} from './workspaceTypes';

// Step-13 Phase-8 cutover: human-production truth derives from the
// canonical CreatorAssetRegistry (behavior-preserving for reel/video/
// short + the video asset_family; de-drifts aliases). NO rendering
// implied — canonical rendering_capability is always 'none'.
import { isHumanProductionAsset } from '../canonical';

/** Strategic keys that must NEVER appear on a scheduler-bound object
 *  (mirrors the Step-7 boundary list — single source of truth for the
 *  invariant, re-asserted at the workspace layer). */
const FORBIDDEN_SCHEDULER_KEYS = [
  'blueprint', 'emotional_goal', 'hook_strategy', 'creative_objective',
  'continuity_context', 'adaptation_notes', 'visual_direction',
  'platform_strategy', 'reuse_strategy', 'cta_strategy', 'packaging_strategy',
  'planning_context', 'production_context', 'adaptation_context',
] as const;

function deepFreezeClone<T>(v: T): T {
  // Deterministic structural clone — inputs are plain JSON-able rows.
  const clone = JSON.parse(JSON.stringify(v)) as T;
  const freeze = (o: unknown) => {
    if (o && typeof o === 'object') {
      Object.values(o as Record<string, unknown>).forEach(freeze);
      Object.freeze(o);
    }
  };
  freeze(clone);
  return clone;
}

function isHumanProduction(
  card: CreatorBlueprintCard,
  task: CreatorDailyTask,
): boolean {
  const fmt = String(task.format ?? card.format ?? '').trim().toLowerCase();
  return isHumanProductionAsset(fmt, card.asset_family, task.asset_type);
}

/** Asset-family-discriminated rich extraction. Defensive `in` checks so
 *  a card-derived (no blueprint) task still yields a sane workspace. */
function extractProduction(
  card: CreatorBlueprintCard,
  task: CreatorDailyTask,
): WorkspaceProductionContext {
  const bp = task.blueprint as ContentBlueprint | null;
  const base: WorkspaceProductionContext = {
    asset_family: card.asset_family,
    blueprint: bp,
    storyboard: [],
    overlays: [],
    pacing_guidance: '',
    scene_direction: card.visual_direction.scene_direction,
    production_notes: card.production_notes.slice(),
    creator_notes: [],
  };
  if (!bp) {
    // No adapter blueprint: fall back to the scheduler payload shape so
    // the editor still has the structural skeleton to work from.
    const ap = task.scheduler_row.asset_payload as Record<string, unknown>;
    if (Array.isArray(ap.slides)) base.storyboard = ap.slides as unknown[];
    else if (Array.isArray(ap.scenes)) base.storyboard = ap.scenes as unknown[];
    else if (ap.visual_descriptor) base.storyboard = [ap.visual_descriptor];
    return base;
  }
  if (bp.asset_family === 'video') {
    return {
      ...base,
      storyboard: bp.scene_sequence as unknown[],
      overlays: bp.overlays.slice(),
      pacing_guidance: bp.pacing_guidance,
      creator_notes: bp.creator_notes.slice(),
    };
  }
  if (bp.asset_family === 'carousel') {
    return {
      ...base,
      storyboard: bp.asset_payload.slides as unknown[],
      pacing_guidance: bp.sequencing_strategy,
      creator_notes: bp.slide_objectives.slice(),
    };
  }
  // image family (Image / Infographic / Story). Defensive access: the
  // ContentBlueprint union also structurally admits post_with_asset
  // (no visual_descriptor) — our registry never emits it here, but the
  // extraction stays type-sound and graceful regardless.
  const overlayCopy =
    'overlay_copy' in bp && typeof (bp as { overlay_copy?: unknown }).overlay_copy === 'string'
      ? [(bp as { overlay_copy: string }).overlay_copy]
      : [];
  const composition =
    'composition_notes' in bp && typeof (bp as { composition_notes?: unknown }).composition_notes === 'string'
      ? [(bp as { composition_notes: string }).composition_notes]
      : [];
  const ap = bp.asset_payload as Record<string, unknown>;
  const visualDescriptor =
    ap && typeof ap === 'object' && 'visual_descriptor' in ap
      ? ap.visual_descriptor
      : ap;
  return {
    ...base,
    storyboard: [visualDescriptor],
    overlays: overlayCopy,
    creator_notes: composition,
  };
}

function productionStatus(
  humanProduction: boolean,
  hasBlueprint: boolean,
): CreatorProductionStatus {
  if (humanProduction) return 'awaiting_human_production';
  return hasBlueprint ? 'ready_for_scheduling' : 'draft';
}

export interface ToWorkspaceTaskOptions {
  /** Workspace-side initial status override (e.g. resuming an in-flight
   *  human-production task). Defaults to the derived initial status. */
  productionStatus?: CreatorProductionStatus;
}

/**
 * Phase-2/3 core mapping. Pure, deterministic. The card supplies
 * strategy (the daily task deliberately does not carry it — Step-6/7
 * boundary); the task supplies the platform-resolved blueprint +
 * scheduler row.
 */
export function toCreatorWorkspaceTask(
  card: CreatorBlueprintCard,
  task: CreatorDailyTask,
  opts: ToWorkspaceTaskOptions = {},
): CreatorWorkspaceTask {
  const humanProduction = isHumanProduction(card, task);
  const variation = getPlatformVariation(task.platform);
  const production = extractProduction(card, task);

  const classification = card.reuse_classification;
  const isSharedVariant = classification !== 'platform_native_content';

  const status =
    opts.productionStatus ??
    productionStatus(humanProduction, task.blueprint !== null);

  return {
    domain: 'creator',
    task_id: task.task_id,
    blueprint_id: task.blueprint ? task.blueprint.blueprint_id : null,
    asset_family: card.asset_family,

    planning_context: {
      card_id: card.card_id,
      week_index: card.week_index,
      reuse_classification: classification,
      creative_objective: card.creative_objective,
      core_message: card.core_message,
      audience_intent: card.audience_intent,
      emotional_goal: card.emotional_goal,
      continuity_context: card.continuity_context,
      brand_grounding: card.brand_grounding,
    },

    production_context: production,

    platform_context: {
      platform: task.platform,
      adaptation_note: card.adaptation_notes[task.platform] ?? variation.note,
      platform_strategy: card.platform_strategy[task.platform] ?? '',
      hook_angle: variation.hookAngle,
      pacing: variation.pacing,
    },

    packaging_context: {
      ...(task.scheduler_row.packaging as Record<string, unknown>),
    } as CreatorWorkspaceTask['packaging_context'],

    adaptation_context: {
      classification,
      is_shared_core_variant: isSharedVariant,
      shared_core_id:
        isSharedVariant && task.blueprint ? task.blueprint.blueprint_id : null,
      override_layer:
        card.packaging_strategy.per_platform_overrides[task.platform] ?? {},
    },

    production_status: status,
    requires_human_production: humanProduction,
    // image/carousel are scheduler-eligible immediately (constraint-valid
    // row exists). Human-production assets are NOT until uploaded +
    // approved → ready_for_scheduling/scheduled (Phase-5 lane).
    scheduler_eligible:
      !humanProduction &&
      (status === 'ready_for_scheduling' || status === 'scheduled'),

    // Phase-4 isolation: frozen deep clone — mutating workspace context
    // can never reach the scheduler projection.
    scheduler_row: deepFreezeClone(task.scheduler_row),

    render_envelope: {
      render_ready: false,
      render_target: null,
      attach_ref: {
        task_id: task.task_id,
        blueprint_id: task.blueprint ? task.blueprint.blueprint_id : null,
      },
    },
  };
}

/**
 * Phase-6 bundle. shared_content / hybrid_content → a shared core +
 * editable per-platform variants. platform_native_content → independent
 * variants (shared_core null).
 */
export function toCreatorWorkspaceBundle(
  card: CreatorBlueprintCard,
  expansion: CreatorDailyExpansion,
  opts: ToWorkspaceTaskOptions = {},
): CreatorWorkspaceBundle {
  const variants = expansion.tasks.map((t) =>
    toCreatorWorkspaceTask(card, t, opts),
  );
  const sharedCore =
    card.reuse_classification === 'platform_native_content'
      ? null
      : variants.length > 0
        ? variants[0]!
        : null;
  return {
    card_id: card.card_id,
    week_index: card.week_index,
    classification: card.reuse_classification,
    shared_core: sharedCore,
    variants,
  };
}

/**
 * Phase-3/4 boundary enforcement. The ONLY accessor that yields a
 * scheduler-bound object from a workspace task. Throws if any strategic
 * key leaked into the projection — fail-closed, in code.
 */
export function toSchedulerView(ws: CreatorWorkspaceTask): CreatorSchedulerRow {
  const row = ws.scheduler_row;
  for (const k of FORBIDDEN_SCHEDULER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(row, k)) {
      throw new Error(
        `Scheduler-boundary violation: strategic key "${k}" present in scheduler_row`,
      );
    }
  }
  const keys = Object.keys(row).sort();
  const expected = [
    'asset_instruction', 'asset_payload', 'asset_type',
    'intent_type', 'packaging',
  ];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error(
      `Scheduler-boundary violation: unexpected scheduler_row shape [${keys.join(', ')}]`,
    );
  }
  return row;
}

/** Phase-1 / Validation-8 domain guard — refuses Text contamination. */
export function assertCreatorDomain(ws: CreatorWorkspaceTask): CreatorWorkspaceTask {
  if (ws.domain !== 'creator') {
    throw new Error(`Domain contamination: expected 'creator', got '${ws.domain}'`);
  }
  if (ws.scheduler_row.intent_type !== 'creator') {
    throw new Error(
      `Domain contamination: scheduler_row.intent_type='${ws.scheduler_row.intent_type}'`,
    );
  }
  return ws;
}
