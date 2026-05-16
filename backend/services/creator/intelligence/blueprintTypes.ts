/**
 * Creator Architecture — Content Blueprint Contracts
 * ──────────────────────────────────────────────────────────────────────────
 * TYPES ONLY. No runtime, no logic, no rendering.
 *
 * A `ContentBlueprint` is what an adapter produces from a
 * `CreatorContext`. It is the production package a human creator OR a
 * FUTURE render engine executes from. There is NO rendering logic here
 * and none implied — `render_ready` is always `false` until a render
 * pipeline exists (Phase 7 readiness envelope).
 *
 * The base blueprint's `asset_payload` shape is the exact thing the
 * deployed `daily_content_plans_creator_payload_check` DB function
 * validates per asset_type:
 *   image            → asset_payload.visual_descriptor (object)
 *   carousel          → asset_payload.slides (array)
 *   video             → asset_payload.scenes (array)
 *   post_with_asset   → asset_payload.caption_blueprint (object)
 * Each specialized blueprint below pins its own `asset_payload` so the
 * future adapter literally cannot emit a constraint-violating shape.
 */

import type { CreatorAssetFamily } from './types';
import type { CreatorPackaging } from './packagingTypes';

/** Per-platform adaptation guidance (NOT overrides — overrides live in
 *  CreatorPackagingOverride). Keyed by normalized platform key. */
export type PlatformAdaptationNotes = Record<string, string>;

/**
 * Phase 7 readiness envelope. Present on EVERY blueprint. A future
 * render pipeline filters on `render_ready === true && blueprint_version
 * >= N`. Until then everything is human-executed and `render_ready`
 * stays false — zero behavior change today.
 */
export interface BlueprintBase {
  blueprint_id: string;
  blueprint_version: 1;
  asset_family: CreatorAssetFamily;
  /** Always false until an AI render pipeline exists. */
  render_ready: false;

  /** Marketing copy — copied verbatim from CreatorContext.packaging so
   *  the persisted row satisfies the DB constraint identically across
   *  all content types. */
  packaging: CreatorPackaging;

  /** Asset-family-specific payload. Narrowed by each subtype below to
   *  the exact shape the DB constraint requires. */
  asset_payload: Record<string, unknown>;

  /** Free-form production notes object. Constraint only checks it's an
   *  object; structure is adapter-defined. */
  asset_instruction: Record<string, unknown>;

  platform_adaptation_notes: PlatformAdaptationNotes;
}

/* ── Reel / Video ──────────────────────────────────────────────────────────
 * Production-intelligence guidance ONLY. A scene is intentionally shaped
 * so a human creator/editor reads it as a shot brief AND a FUTURE render
 * engine can consume it as a timeline node — same structure, two
 * consumers. NO motion / synthesis / codec / ffmpeg fields: this is a
 * creative brief, not a render manifest. `duration_guidance` is advisory
 * copy ("0–3s"), never a hard cut. Reshape of today's
 * `buildCreativeGuidance` + `deriveSceneDirection` output. */
export interface ReelScene {
  scene_index: number;
  /** Advisory timing window, human-readable (e.g. "0–3s"). */
  duration_guidance: string;
  /** What this beat must accomplish narratively. */
  scene_objective: string;
  /** What is on screen / how it is shot. */
  visual_direction: string;
  /** The line delivered (voiceover or to-camera) for this beat. */
  talking_point: string;
  /** On-screen text overlay for the beat ('' when none). */
  overlay_text: string;
  /** "hard cut" | "swipe" | "match cut" | "whip pan" | "j-cut" | … */
  transition_style: string;
  /** Beat-level pacing note (cut frequency / energy). */
  pacing_note: string;
}

export interface ReelBlueprint extends BlueprintBase {
  asset_family: 'video';
  asset_payload: {
    /** DB constraint: video requires asset_payload.scenes (array). */
    scenes: ReelScene[];
  };
  hook: string;                     // first 0–3s line/visual
  opening_shot: string;             // the literal first frame
  scene_sequence: ReelScene[];      // mirror of asset_payload.scenes for
                                    // workspace consumption ergonomics
  talking_points: string[];         // flat list across all scenes
  overlays: string[];               // flat list of overlay copy
  transitions: string[];            // flat list of transition styles
  pacing_guidance: string;          // whole-video pacing strategy
  thumbnail_concept: string;        // cover-frame / thumbnail brief
  emotional_arc: string;            // pain → tension → outcome journey
  creator_notes: string[];          // production checklist for the human
}

/* ── Image ─────────────────────────────────────────────────────────────── */
export interface ImageBlueprint extends BlueprintBase {
  asset_family: 'image';
  asset_payload: {
    /** DB constraint: image requires asset_payload.visual_descriptor
     *  (object). */
    visual_descriptor: {
      subject?: string;
      style?: string;
      composition?: string;
      [k: string]: unknown;
    };
  };
  overlay_copy: string;
  composition_notes: string;
}

/* ── Carousel ──────────────────────────────────────────────────────────── */
export interface CarouselSlide {
  index: number;
  role: 'hook' | 'insight' | 'proof' | 'cta' | string;
  headline: string;
  body: string;
  visual_note?: string;
}

export interface CarouselBlueprint extends BlueprintBase {
  asset_family: 'carousel';
  asset_payload: {
    /** DB constraint: carousel requires asset_payload.slides (array). */
    slides: CarouselSlide[];
  };
  slide_objectives: string[];
  sequencing_strategy: string;
}

/* ── Infographic (image-family payload) ────────────────────────────────── */
export interface InfographicBlueprint extends BlueprintBase {
  asset_family: 'image';
  asset_payload: {
    visual_descriptor: {
      subject?: string;
      style?: string;
      [k: string]: unknown;
    };
    data_blocks: Array<{ label: string; value: string; emphasis?: boolean }>;
  };
  composition_notes: string;
}

/* ── Story (24h ephemeral, image-family payload) ───────────────────────── */
export interface StoryFrame {
  index: number;
  visual: string;
  sticker_cta?: string;
  overlay_text?: string;
}

export interface StoryBlueprint extends BlueprintBase {
  asset_family: 'image';
  asset_payload: {
    visual_descriptor: { subject?: string; [k: string]: unknown };
    frames: StoryFrame[];
  };
  ephemeral_framing: string;
}

/* ── Creator Post (text + attached asset) ──────────────────────────────── */
export interface CreatorPostBlueprint extends BlueprintBase {
  asset_family: 'post_with_asset';
  asset_payload: {
    /** DB constraint: post_with_asset requires
     *  asset_payload.caption_blueprint (object). */
    caption_blueprint: {
      hook: string;
      body: string;
      cta: string;
      [k: string]: unknown;
    };
    attached_asset_ref?: string | null;
  };
}

/** Discriminated union of every concrete blueprint. Discriminate on
 *  `asset_family` + structural keys (image-family has 3 variants:
 *  Image / Infographic / Story — disambiguate via presence of
 *  `data_blocks` / `frames`). */
export type ContentBlueprint =
  | ReelBlueprint
  | ImageBlueprint
  | CarouselBlueprint
  | InfographicBlueprint
  | StoryBlueprint
  | CreatorPostBlueprint;
