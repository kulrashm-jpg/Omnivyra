/**
 * Image Blueprint Adapter — Step 3 (isolated, runtime-inert)
 * ──────────────────────────────────────────────────────────────────────────
 * Pure transform:  CreatorContext  →  ImageBlueprint
 *
 * REUSE, not reimplementation. Every creative ingredient is read off the
 * already-normalized `CreatorContext` the Step-2 engine produced:
 *   - visual prompt        ← ctx.visual_direction.image_prompt
 *   - first-frame hook     ← ctx.hook_strategy.visual
 *   - emotional framing    ← ctx.emotional_goal
 *   - per-platform notes   ← ctx.platform_strategy
 *   - marketing package    ← ctx.packaging  (copied VERBATIM)
 *
 * Purity contract (enforced by review + the adapter unit tests):
 *   - No DB / scheduler / queue / rendering / orchestration.
 *   - No mutation of `ctx` (every field is read; `packaging` is cloned,
 *     not aliased, so a downstream mutate can't reach back into ctx).
 *   - Deterministic: identical (ctx, opts) → byte-identical blueprint.
 *     No Date.now(), no Math.random(), no UUIDs — the blueprint_id is a
 *     stable slug of the inputs.
 *
 * Runtime-inert: nothing in pages/ or backend/queue/ imports this. No
 * cutover. This adapter has ZERO non-type imports, so importing it pulls
 * in no runtime graph at all.
 */

import type { CreatorContext } from '../types';
import type { ImageBlueprint } from '../blueprintTypes';
import type { CreatorBlueprintAdapter, AdapterBuildOptions } from '../adapterTypes';
import type { CreatorPackaging } from '../packagingTypes';

/** Deterministic, side-effect-free slug. Stable across runs/process. */
function slug(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'untitled';
}

/** Stable blueprint id from the inputs only (no clock, no randomness). */
function deterministicId(ctx: CreatorContext, opts?: AdapterBuildOptions): string {
  const scope = opts?.platform ? slug(opts.platform) : 'shared';
  const wk = Number.isFinite(opts?.weekIndex) ? Number(opts!.weekIndex) : 0;
  const seed = Number.isFinite(opts?.variationSeed) ? Number(opts!.variationSeed) : 0;
  return `image:${slug(ctx.campaign_theme)}:${scope}:w${wk}:v${seed}`;
}

/**
 * In shared mode every platform shares one creative core, so all of
 * `ctx.platform_strategy` is surfaced as adaptation notes. In unique
 * mode (`opts.platform` set, one adapter call per platform) only that
 * platform's note is carried — the rest belong to sibling blueprints.
 */
function adaptationNotes(
  ctx: CreatorContext,
  opts?: AdapterBuildOptions,
): Record<string, string> {
  const all = ctx.platform_strategy ?? {};
  if (opts?.platform) {
    const key = String(opts.platform).toLowerCase();
    return key in all ? { [key]: all[key]! } : {};
  }
  return { ...all };
}

export const imageBlueprintAdapter: CreatorBlueprintAdapter<ImageBlueprint> = {
  assetFamily: 'image',

  /** 'image' and its governance aliases (graphic/visual/photo) normalize
   *  to 'image' upstream; this adapter only claims the exact family. */
  supports(format: string): boolean {
    return String(format ?? '').trim().toLowerCase() === 'image';
  },

  build(ctx: CreatorContext, opts?: AdapterBuildOptions): ImageBlueprint {
    // packaging is copied (not aliased) so the blueprint satisfies the
    // DB constraint identically to every other content type, and a
    // downstream mutation cannot reach back into the shared ctx.
    const packaging: CreatorPackaging = { ...ctx.packaging };

    const visualDescriptor = {
      subject: ctx.campaign_theme,
      style: ctx.visual_direction.image_prompt,
      composition: ctx.hook_strategy.visual,
      mood: ctx.emotional_goal.tone,
      // Emotional framing carried so a human (or future render engine)
      // composes toward the promised outcome, away from the pain point.
      narrative_arc: `${ctx.emotional_goal.pain_point} → ${ctx.emotional_goal.outcome_promise}`,
    };

    return {
      blueprint_id: deterministicId(ctx, opts),
      blueprint_version: 1,
      asset_family: 'image',
      render_ready: false,

      packaging,

      // DB constraint (image): asset_payload.visual_descriptor must be
      // an object. It is.
      asset_payload: {
        visual_descriptor: visualDescriptor,
      },

      asset_instruction: {
        creative_objective: ctx.creative_objective,
        core_message: ctx.core_message,
        audience_intent: ctx.audience_intent,
        emotional_goal: ctx.emotional_goal,
        image_prompt: ctx.visual_direction.image_prompt,
        production_note:
          'Single still. Lead the eye with the visual hook; no text overlay unless overlay_copy is used.',
      },

      platform_adaptation_notes: adaptationNotes(ctx, opts),

      overlay_copy: packaging.caption,
      composition_notes: ctx.hook_strategy.visual,
    };
  },
};

export default imageBlueprintAdapter;
