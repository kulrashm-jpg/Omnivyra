/**
 * applyCreatorPlanningFlow — Step-7 controlled runtime cutover of the
 * Creator Week→Daily planning hierarchy.
 * ──────────────────────────────────────────────────────────────────────────
 * The SINGLE planning-hierarchy entry point. Both the main generation
 * loop AND the auto-optimize branch in
 * `pages/api/campaigns/generate-weekly-structure.ts` route through this
 * one helper (no duplicate planning wiring — the same structural
 * guarantee Step-4 introduced for adapters).
 *
 *   buildCreatorBlueprintCard()  →  expandCardToDailyTasks()  →  toSchedulerRow()
 *
 * SCOPE GUARD (hard):
 *   - Acts ONLY when ENABLE_CREATOR_PLANNING_HIERARCHY is ON.
 *   - Live scheduling support is image + carousel ONLY. reel/video are
 *     explicitly excluded from this scheduler-bound path (Step-7
 *     reel/video safety rule) and return `false` so the existing
 *     human-production/guidance lane is left byte-identical. They are
 *     additionally tagged `requires_human_production` defensively.
 *   - Flag OFF or unsupported ⇒ returns `false`; caller falls back to
 *     the Step-4 adapter helper / legacy chain unchanged.
 *
 * SCHEDULER BOUNDARY (Phase-3, enforced in code):
 *   Only the flat `toSchedulerRow(task)` projection is stamped onto the
 *   row content — `{ intent_type, asset_type, packaging, asset_payload,
 *   asset_instruction }`. The strategic blueprint / emotional_goal /
 *   hook_strategy / creative_objective / continuity_context /
 *   adaptation_notes are NEVER written into the persisted content. A
 *   defensive scrub removes any such keys if present.
 *
 * PACKAGING PRECEDENCE (unchanged from Step-4): existing non-empty
 * packaging fields on the row still win over planned packaging, so
 * richer downstream/generated copy is never downgraded.
 *
 * Purity: this helper performs no DB / scheduler / queue access of its
 * own; the planning module + engine + adapters are pure (proven by the
 * Step-2..6 suites). It mutates the passed `enriched` object in place,
 * the same contract Step-4's helper has.
 */

import {
  buildCreatorBlueprintCard,
  expandCardToDailyTasks,
  toSchedulerRow,
} from './index';
import type { BuildCreatorCardInput } from './index';

/** Live scheduler-bound formats for Step-7. reel/video deliberately
 *  absent — planning may model them but they must NOT auto-enter
 *  scheduling yet. */
const SCHEDULER_BOUND_ASSET_TYPES = new Set(['image', 'carousel']);

/** Strategic keys that must NEVER reach the persisted scheduler content.
 *  Enforced defensively after stamping. */
const FORBIDDEN_SCHEDULER_KEYS = [
  'blueprint',
  'emotional_goal',
  'hook_strategy',
  'creative_objective',
  'continuity_context',
  'adaptation_notes',
  'visual_direction',
  'platform_strategy',
  'reuse_strategy',
  'cta_strategy',
  'packaging_strategy',
] as const;

export function isCreatorPlanningHierarchyEnabled(): boolean {
  const raw = String(process.env.ENABLE_CREATOR_PLANNING_HIERARCHY ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** { ...planned, ...existingNonEmpty } — existing non-empty wins. */
function mergePackagingPrecedence(
  planned: Record<string, unknown>,
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const keep: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(existing)) {
    const present =
      typeof v === 'string'
        ? v.trim().length > 0
        : Array.isArray(v)
          ? v.length > 0
          : isPlainObject(v)
            ? Object.keys(v).length > 0
            : v !== null && v !== undefined;
    if (present) keep[k] = v;
  }
  return { ...planned, ...keep };
}

export interface ApplyCreatorPlanningFlowParams {
  /** Row content object to stamp in place (the legacy `e`). */
  enriched: Record<string, unknown>;
  /** Resolved creator asset_type for this row. */
  assetType: string | null | undefined;
  /** Normalized platform key for this row. */
  platform: string;
  /** Week index (1-based campaign week) — feeds continuity + ids. */
  weekIndex?: number;
  /** Pure seeds for resolveCreatorContext (same object Step-4 builds). */
  context: {
    topic: string;
    objective?: string;
    contentType: string;
    platforms?: string[];
    campaignTheme?: string;
    creativeObjective?: string;
    audienceIntent?: string;
    coreMessage?: string;
    tone?: string;
    cta?: string;
    distributionMode?: 'shared' | 'unique';
    brandGrounding?: Record<string, unknown>;
    continuityContext?: Record<string, unknown>;
  };
}

/**
 * Returns `true` iff the planning hierarchy handled this row (flag ON +
 * image/carousel). On `true`, `enriched` carries ONLY the scheduler-safe
 * projection. On `false`, `enriched` is untouched and the caller MUST
 * run the Step-4 adapter helper / legacy chain.
 */
export function applyCreatorPlanningFlow(
  params: ApplyCreatorPlanningFlowParams,
): boolean {
  const { enriched, assetType, platform, weekIndex, context } = params;

  if (!isCreatorPlanningHierarchyEnabled()) return false;

  const at = typeof assetType === 'string' ? assetType.trim().toLowerCase() : '';

  // ── Reel/video safety: model-only, never scheduler-bound (yet) ──────
  if (at === 'video' || at === 'reel' || at === 'short') {
    // Defensive tag so any downstream consumer treats it as human
    // production and the existing attachment-required scheduler gate
    // keeps it out of enqueueScheduledPostAt.
    enriched.requires_human_production = true;
    return false;
  }

  if (!SCHEDULER_BOUND_ASSET_TYPES.has(at)) return false;

  const cardInput: BuildCreatorCardInput = {
    topic: context.topic,
    objective: context.objective,
    contentType: context.contentType,
    format: context.contentType,
    platforms: context.platforms ?? [platform],
    campaignTheme: context.campaignTheme,
    creativeObjective: context.creativeObjective,
    audienceIntent: context.audienceIntent,
    coreMessage: context.coreMessage,
    tone: context.tone,
    cta: context.cta,
    // Per-row build is platform-scoped → unique (one platform card).
    distributionMode: 'unique',
    brandGrounding: context.brandGrounding as BuildCreatorCardInput['brandGrounding'],
    continuityContext: context.continuityContext as BuildCreatorCardInput['continuityContext'],
    weekIndex,
  };

  const card = buildCreatorBlueprintCard(cardInput);

  // Card built for a single platform ⇒ exactly one task. Guard anyway.
  const expansion = expandCardToDailyTasks(card);
  const task =
    expansion.tasks.find((t) => t.platform === platform) ??
    expansion.tasks[0];
  if (!task) return false;

  const row = toSchedulerRow(task);

  // ── Packaging precedence: existing non-empty wins ───────────────────
  const existingPackaging = isPlainObject(enriched.packaging)
    ? (enriched.packaging as Record<string, unknown>)
    : {};
  enriched.packaging = mergePackagingPrecedence(
    row.packaging as Record<string, unknown>,
    existingPackaging,
  );

  enriched.intent_type = row.intent_type;
  enriched.asset_type = row.asset_type;
  enriched.asset_payload = row.asset_payload;
  // Existing non-empty asset_instruction object wins (Step-4 parity).
  enriched.asset_instruction =
    isPlainObject(enriched.asset_instruction) &&
    Object.keys(enriched.asset_instruction as Record<string, unknown>).length > 0
      ? enriched.asset_instruction
      : row.asset_instruction;

  // Provenance breadcrumb (audit only — NOT strategic, NOT scheduler
  // semantics). Kept tiny + flat.
  enriched.creator_planning_source = {
    via: 'applyCreatorPlanningFlow',
    card_id: card.card_id,
    task_id: task.task_id,
    reuse_classification: card.reuse_classification,
    adapter_applied: task.adapter_applied,
  };

  // ── Phase-3 boundary enforcement: scrub strategic leakage ───────────
  for (const key of FORBIDDEN_SCHEDULER_KEYS) {
    if (key in enriched) delete (enriched as Record<string, unknown>)[key];
  }

  return true;
}

export default applyCreatorPlanningFlow;
