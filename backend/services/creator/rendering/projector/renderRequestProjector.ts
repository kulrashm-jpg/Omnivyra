/**
 * Creator Rendering — Step-R2 pure RenderRequestProjector.
 * ──────────────────────────────────────────────────────────────────────────
 *   CreatorWorkspaceTask  ──projectRenderRequest──►  RenderSpec
 *
 * The single, most safety-critical rendering boundary. It reads ONLY
 * the render-safe surface (production_context + packaging caption +
 * platform), derives canonical asset/modality from the Step-13 registry,
 * sanitizes (deep forbidden-scan, fail-closed), computes the Step-R0
 * deterministic hash, and returns a DEEP-FROZEN, validated RenderSpec.
 *
 * PURE: no DB, no network, no queue, no provider, no clock, no RNG, no
 * mutation of the input. Identical (task, options) → byte-identical
 * RenderSpec. Additive: nothing in pages/ or backend/queue/ imports it.
 */

import {
  getCreatorAsset,
} from '../../intelligence/canonical';
import { computeDeterministicInputHash } from '../contracts';
// THE feature gate for reference-conditioned generation. Behaviour-identical to
// the inline comparison this replaces; routed through the one function so the
// gate has a single definition rather than four copies that can drift.
import { creatorImageReferenceModeEnabled } from '../../creatorMultimodalReferences';
import type { RenderSpec, RenderModality } from '../contracts';
import {
  sanitizeRenderProjection,
  deepFreeze,
  RenderProjectionError,
} from './renderProjectionSanitizer';
import {
  assertRenderableAsset,
  validateRenderProjection,
} from './renderProjectionValidators';

export interface ProjectRenderOptions {
  /** REQUIRED — which platform variant to project. */
  platform: string;
  aspectRatio?: string;
  resolution?: { w: number; h: number };
  /** Deterministic seed only (never a clock/RNG). */
  seed?: number;
  durationSec?: number;
  qualityTier?: 'draft' | 'standard' | 'high';
  variantCount?: number;
}

/** Pure platform default aspect/resolution table (deterministic). The
 *  scheduler timing / queue / campaign-execution metadata is NEVER
 *  consulted — only render geometry. */
const PLATFORM_GEOMETRY: Record<string, Record<RenderModality, { aspect: string; w: number; h: number }>> = {
  instagram: { image: { aspect: '1:1', w: 1080, h: 1080 }, video: { aspect: '9:16', w: 1080, h: 1920 } },
  facebook:  { image: { aspect: '1:1', w: 1080, h: 1080 }, video: { aspect: '9:16', w: 1080, h: 1920 } },
  linkedin:  { image: { aspect: '1.91:1', w: 1200, h: 627 }, video: { aspect: '16:9', w: 1920, h: 1080 } },
  x:         { image: { aspect: '16:9', w: 1200, h: 675 }, video: { aspect: '16:9', w: 1280, h: 720 } },
  tiktok:    { image: { aspect: '9:16', w: 1080, h: 1920 }, video: { aspect: '9:16', w: 1080, h: 1920 } },
  youtube:   { image: { aspect: '16:9', w: 1280, h: 720 }, video: { aspect: '9:16', w: 1080, h: 1920 } },
};
const DEFAULT_GEOMETRY: Record<RenderModality, { aspect: string; w: number; h: number }> = {
  image: { aspect: '1:1', w: 1080, h: 1080 },
  video: { aspect: '9:16', w: 1080, h: 1920 },
};

function asObj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>) : {};
}
function asStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') as string[] : [];
}

/**
 * Project a workspace task into an immutable RenderSpec for one
 * platform. `workspaceTask` is intentionally typed loosely (decoupling
 * R2 from the workspace module) and treated as untrusted — every field
 * is defensively narrowed and the result is sanitized + validated.
 */
export function projectRenderRequest(
  workspaceTask: unknown,
  options: ProjectRenderOptions,
): RenderSpec {
  const task = asObj(workspaceTask);
  const platform = asStr(options?.platform).trim().toLowerCase();
  if (!platform) {
    throw new RenderProjectionError('MISSING_RENDER_SAFE_FIELD', 'options.platform is required');
  }

  // ── Phase 3: canonical asset + modality, fail-closed ────────────────
  const production = asObj(task.production_context);
  const assetInput = task.asset_family ?? production.asset_family;
  const def = getCreatorAsset(assetInput);
  if (!def) {
    throw new RenderProjectionError('UNSUPPORTED_ASSET', `unsupported asset "${String(assetInput)}"`);
  }
  const { canonical_asset_family, render_modality } = assertRenderableAsset(def.canonical_key);

  // ── Phase 6: render-safe geometry (no scheduler/queue/campaign data) ─
  const geo = (PLATFORM_GEOMETRY[platform] ?? DEFAULT_GEOMETRY)[render_modality];
  const aspect_ratio = asStr(options.aspectRatio).trim() || geo.aspect;
  const resolution = options.resolution
    && Number.isFinite(options.resolution.w) && Number.isFinite(options.resolution.h)
    ? { w: Math.trunc(options.resolution.w), h: Math.trunc(options.resolution.h) }
    : { w: geo.w, h: geo.h };

  // ── Render-safe extraction (production_context + caption ONLY) ───────
  const storyboardRaw = Array.isArray(production.storyboard) ? production.storyboard : [];
  const storyboard = storyboardRaw.map((s) => asObj(s));
  const overlays = asStrArr(production.overlays);
  const pacing_guidance = asStr(production.pacing_guidance);
  const scene_direction = asStr(production.scene_direction);
  // visual_prompt: production direction only (already strategy-stripped
  // upstream — production_context is the render-safe surface).
  const firstSceneVisual =
    asStr(storyboard[0]?.visual)
    || asStr(storyboard[0]?.visual_direction)
    || asStr(storyboard[0]?.subject)
    || asStr(storyboard[0]?.style);
  const visual_prompt = (firstSceneVisual || scene_direction || '').trim();

  const caption = asStr(asObj(task.packaging_context).caption);

  // ── Phase 7: moderation context from prompt-surface text ONLY ───────
  const moderated_text = [caption, visual_prompt, scene_direction, ...overlays]
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

  // Assemble the CONTENT projection (everything the hash covers). No
  // spec_id / hash here — those are derived, not hashed.
  const contentProjection = {
    canonical_asset_family,
    render_modality,
    blueprint_projection: {
      asset_family: canonical_asset_family,
      storyboard,
      overlays,
      pacing_guidance,
      scene_direction,
      visual_prompt,
      // Style reference (img2img) — included ONLY when the render-layer flag is on,
      // the family is image, and production supplied a reference URL. Absent by
      // default so the deterministic hash + output stay byte-identical.
      ...(creatorImageReferenceModeEnabled()
        && canonical_asset_family === 'image'
        && typeof production.reference_image_url === 'string'
        && (production.reference_image_url as string).trim()
        ? { reference_image_url: (production.reference_image_url as string).trim() }
        : {}),
    },
    packaging_projection: {
      caption,
      overlay_text: overlays,
    },
    platform_projection: {
      platform,
      aspect_ratio,
      resolution,
    },
    rendering_parameters: {
      modality: render_modality,
      ...(Number.isFinite(options.seed) ? { seed: Math.trunc(options.seed as number) } : {}),
      ...(Number.isFinite(options.durationSec) ? { duration_sec: options.durationSec } : {}),
      ...(options.qualityTier ? { quality_tier: options.qualityTier } : {}),
      ...(Number.isFinite(options.variantCount) ? { variant_count: options.variantCount } : {}),
    },
    moderation_context: {
      canonical_asset_key: def.canonical_key,
      is_text_like: false, // asserted renderable above (text-like throws)
      moderated_text,
    },
  };

  // Fail-closed sanitize (forbidden-scan + JSON/deterministic + freeze).
  const safe = sanitizeRenderProjection(contentProjection);

  // ── Phase 5: deterministic hash → spec_id (no volatile fields) ──────
  const deterministic_input_hash = computeDeterministicInputHash(safe);
  const spec_id = `render:${deterministic_input_hash}`;

  // ── Phase 4: immutable spec ─────────────────────────────────────────
  const spec = deepFreeze({
    spec_id,
    ...safe,
    deterministic_input_hash,
  }) as unknown as RenderSpec;

  // Final fail-closed gate.
  return validateRenderProjection(spec);
}
