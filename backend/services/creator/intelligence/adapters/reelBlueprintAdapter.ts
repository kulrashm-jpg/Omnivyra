/**
 * Reel / Video Blueprint Adapter — Step 5 (isolated, NO rendering)
 * ──────────────────────────────────────────────────────────────────────────
 * Pure transform:  CreatorContext  →  ReelBlueprint
 *
 * This is PRODUCTION-INTELLIGENCE only. It emits a creative brief a
 * human creator / agency / editor can shoot from today, and that a
 * FUTURE render pipeline could consume later. It contains NO rendering,
 * motion synthesis, codec, ffmpeg, or media-generation logic and none is
 * implied — `render_ready` stays `false` (Phase-7 envelope).
 *
 * REUSE, not reimplementation. Every strategic ingredient is read off
 * the already-normalized CreatorContext the Step-2 engine produced
 * (which itself called the derive* primitives):
 *   - hook              ← ctx.hook_strategy.verbal   (deriveTextHook)
 *   - opening shot      ← ctx.hook_strategy.visual    (deriveVisualHook)
 *   - video framing     ← ctx.visual_direction.video_prompt    (deriveVideoPrompt)
 *   - scene scaffold    ← ctx.visual_direction.scene_direction  (deriveSceneDirection)
 *   - emotional arc     ← ctx.emotional_goal
 *   - repurpose angles  ← ctx.reuse_strategy.repurpose_angles
 *   - per-platform      ← ctx.platform_strategy
 *   - marketing package ← ctx.packaging  (copied VERBATIM)
 * No strategic logic is duplicated here — only sequenced + platform-tuned.
 *
 * Purity contract (enforced by review + the adapter unit tests):
 *   - No DB / scheduler / queue / rendering / orchestration / mutation.
 *   - Deterministic: identical (ctx, opts) → byte-identical blueprint.
 *     No Date.now(), no Math.random(), no UUIDs.
 *
 * Runtime-inert: nothing in pages/ or backend/queue/ imports this. NOT
 * wired into generate-weekly-structure or scheduling (Step 5 is adapter
 * creation only — no runtime cutover).
 */

import type { CreatorContext } from '../types';
import type { ReelBlueprint, ReelScene } from '../blueprintTypes';
import type { CreatorBlueprintAdapter, AdapterBuildOptions } from '../adapterTypes';
import type { CreatorPackaging } from '../packagingTypes';

function slug(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'untitled';
}

function deterministicId(ctx: CreatorContext, opts?: AdapterBuildOptions): string {
  const scope = opts?.platform ? slug(opts.platform) : 'shared';
  const wk = Number.isFinite(opts?.weekIndex) ? Number(opts!.weekIndex) : 0;
  const seed = Number.isFinite(opts?.variationSeed) ? Number(opts!.variationSeed) : 0;
  return `reel:${slug(ctx.campaign_theme)}:${scope}:w${wk}:v${seed}`;
}

/* ── Platform reel-craft tuning ─────────────────────────────────────────────
 * Differentiated guidance per destination. Keyed by substring of the
 * NORMALIZED platform key so 'instagram' / 'instagram_reels' /
 * 'youtube_shorts' etc. all resolve. `cut` feeds beat-level pacing_note;
 * `note` becomes the platform_adaptation_notes entry (layered on top of
 * the strategic ctx.platform_strategy guidance). */
interface ReelPlatformProfile {
  cut: string;
  hook_style: string;
  note: string;
}
const PLATFORM_PROFILES: Array<{ match: string; profile: ReelPlatformProfile }> = [
  {
    match: 'tiktok',
    profile: {
      cut: 'rapid cuts every 1–2s, conversational energy',
      hook_style: 'pattern-interrupt in the first 0.5s — say the surprising thing immediately',
      note: 'TikTok: ride trend velocity, conversational pacing, pattern-interrupt hook. Native captions, no polished intro — start mid-thought.',
    },
  },
  {
    match: 'youtube',
    profile: {
      cut: 'tighter mid, deliberate payoff beat, end on a loop back to the hook',
      hook_style: 'tease the payoff up front so the viewer stays for the resolution',
      note: 'YouTube Shorts: build a retention loop, time the payoff for replayability, last frame should invite a re-watch.',
    },
  },
  {
    match: 'instagram',
    profile: {
      cut: 'fast cuts every 2–3s, visual-first, motion in every beat',
      hook_style: 'visual hook first, text overlay second',
      note: 'Instagram Reels: visual-first, fast cuts, CTA as an on-screen overlay (not just spoken). Trend audio optional, captions burned in.',
    },
  },
  {
    match: 'linkedin',
    profile: {
      cut: 'measured, educational pacing — let insights breathe (3–5s holds)',
      hook_style: 'insight-first: open with the contrarian point of view, not a gimmick',
      note: 'LinkedIn Video: authority framing, educational pacing, insight-first opening. Talking-head credibility over fast editing.',
    },
  },
  {
    match: 'facebook',
    profile: {
      cut: 'moderate cuts, clear staging for broad audiences',
      hook_style: 'plain-spoken hook, accessible language, no insider jargon',
      note: 'Facebook Reels: broader accessibility, community framing — speak to a wide audience, lead with relatability.',
    },
  },
];
const DEFAULT_PROFILE: ReelPlatformProfile = {
  cut: 'fast cuts every 2–4s, confident energy',
  hook_style: 'lead with the strongest line in the first 3s',
  note: 'General short-form: hook in 3s, one idea per beat, single CTA, captions always on.',
};

function profileFor(platformKey: string): ReelPlatformProfile {
  const k = platformKey.toLowerCase();
  for (const { match, profile } of PLATFORM_PROFILES) {
    if (k.includes(match)) return profile;
  }
  return DEFAULT_PROFILE;
}

/** In shared mode every platform shares one creative core, so all of
 *  ctx.platform_strategy is surfaced (each layered with its reel-craft
 *  note). In unique mode only the targeted platform is carried. */
function adaptationNotes(
  ctx: CreatorContext,
  opts?: AdapterBuildOptions,
): Record<string, string> {
  const strat = ctx.platform_strategy ?? {};
  const keys = opts?.platform
    ? [String(opts.platform).toLowerCase()]
    : Object.keys(strat);
  const out: Record<string, string> = {};
  for (const key of keys) {
    const strategic = strat[key] ?? '';
    const craft = profileFor(key).note;
    out[key] = strategic ? `${strategic} — ${craft}` : craft;
  }
  return out;
}

/* ── Scene sequencing ──────────────────────────────────────────────────────
 * Canonical short-form arc (mirrors deriveSceneDirection's video branch):
 *   1. Hook (0–3s)          — pattern interrupt
 *   2. Problem (3–10s)      — name the pain, raise tension
 *   3. Framework (10–25s)   — the core value, 3 rapid beats
 *   4. Proof (25–35s)       — result / before-after / credibility
 *   5. Payoff + CTA (35–end)— resolve and ask
 * Deterministic: same ctx → same scenes. Platform profile only tunes the
 * pacing_note + hook delivery, never the count/order (shared core). */
function buildScenes(
  ctx: CreatorContext,
  profile: ReelPlatformProfile,
): ReelScene[] {
  const hook = ctx.hook_strategy.verbal;
  const openingVisual = ctx.hook_strategy.visual;
  const pain = ctx.emotional_goal.pain_point;
  const outcome = ctx.emotional_goal.outcome_promise;
  const cta = ctx.packaging.cta;
  const angles = Array.isArray(ctx.reuse_strategy?.repurpose_angles)
    ? ctx.reuse_strategy.repurpose_angles
    : [];
  const frameworkAngle = angles[0] || ctx.core_message;

  return [
    {
      scene_index: 0,
      duration_guidance: '0–3s',
      scene_objective: 'Pattern interrupt — stop the scroll, earn the next 3 seconds',
      visual_direction: openingVisual,
      talking_point: hook,
      overlay_text: hook,
      transition_style: 'hard cut',
      pacing_note: profile.hook_style,
    },
    {
      scene_index: 1,
      duration_guidance: '3–10s',
      scene_objective: 'Name the pain and raise the tension',
      visual_direction: `Cut to the problem made concrete: ${pain}`,
      talking_point: `Here's what's actually going wrong: ${pain}`,
      overlay_text: 'The real problem',
      transition_style: 'whip pan',
      pacing_note: profile.cut,
    },
    {
      scene_index: 2,
      duration_guidance: '10–25s',
      scene_objective: 'Deliver the core value — the framework, in rapid beats',
      visual_direction: `On-screen text reinforces each beat while you explain: ${frameworkAngle}`,
      talking_point: ctx.core_message,
      overlay_text: '3 things that change this',
      transition_style: 'match cut',
      pacing_note: `${profile.cut}; one idea per beat, screen text mirrors the spoken point`,
    },
    {
      scene_index: 3,
      duration_guidance: '25–35s',
      scene_objective: 'Prove it — show the result / before-after / credibility',
      visual_direction: `Show evidence of the outcome: ${outcome}`,
      talking_point: `This is what it looks like when it works: ${outcome}`,
      overlay_text: 'Proof',
      transition_style: 'j-cut',
      pacing_note: 'Hold slightly longer here — let the proof land before the ask',
    },
    {
      scene_index: 4,
      duration_guidance: '35s–end',
      scene_objective: 'Resolve the arc and make the single ask',
      visual_direction: 'Creator direct to camera or bold end-card with the CTA',
      talking_point: cta,
      overlay_text: cta,
      transition_style: 'end card',
      pacing_note: 'Loop the energy back to the hook for replayability; one CTA only',
    },
  ];
}

export const reelBlueprintAdapter: CreatorBlueprintAdapter<ReelBlueprint> = {
  assetFamily: 'video',

  /** Claims the short-form video family. Governance normalizes
   *  reels→reel, shorts/youtube_short(s)/tiktok→short upstream; this
   *  adapter answers reel / video / short. */
  supports(format: string): boolean {
    const f = String(format ?? '').trim().toLowerCase();
    return f === 'reel' || f === 'video' || f === 'short';
  },

  build(ctx: CreatorContext, opts?: AdapterBuildOptions): ReelBlueprint {
    // packaging copied (not aliased) so the row satisfies the DB
    // constraint identically to image/carousel, and a downstream
    // mutation cannot reach back into the shared ctx.
    const packaging: CreatorPackaging = { ...ctx.packaging };

    const profile = opts?.platform
      ? profileFor(String(opts.platform).toLowerCase())
      : DEFAULT_PROFILE;

    const scenes = buildScenes(ctx, profile);

    const emotionalArc =
      `Open in the viewer's pain ("${ctx.emotional_goal.pain_point}"), ` +
      `escalate the tension through the framework, ` +
      `resolve into the promised outcome ("${ctx.emotional_goal.outcome_promise}"). ` +
      `Tone throughout: ${ctx.emotional_goal.tone}.`;

    const creatorNotes = [
      'Captions / burned-in subtitles always on (most plays are muted).',
      `Shoot vertical 9:16 unless the destination is landscape-first. Framing ref: ${ctx.visual_direction.video_prompt}`,
      'Record hook and CTA twice — pick the higher-energy take in the edit.',
      'Keep one idea per beat; if a scene needs two ideas, split it.',
      opts?.platform
        ? `Tuned for ${String(opts.platform)}: ${profile.note}`
        : 'Shared creative core — re-tune pacing per platform using platform_adaptation_notes before publishing.',
    ];

    return {
      blueprint_id: deterministicId(ctx, opts),
      blueprint_version: 1,
      asset_family: 'video',
      render_ready: false,

      packaging,

      // DB constraint (video): asset_payload.scenes must be an array.
      asset_payload: {
        scenes,
      },

      asset_instruction: {
        creative_objective: ctx.creative_objective,
        core_message: ctx.core_message,
        audience_intent: ctx.audience_intent,
        emotional_goal: ctx.emotional_goal,
        video_prompt: ctx.visual_direction.video_prompt,
        scene_direction: ctx.visual_direction.scene_direction,
        production_note:
          'Human-shot or external-edit creative brief. This is production intelligence, not a render manifest — by design it carries no motion-synthesis, encoding, or pipeline fields.',
      },

      platform_adaptation_notes: adaptationNotes(ctx, opts),

      hook: ctx.hook_strategy.verbal,
      opening_shot: ctx.hook_strategy.visual,
      scene_sequence: scenes,
      talking_points: scenes.map((s) => s.talking_point),
      overlays: scenes.map((s) => s.overlay_text).filter((t) => t.length > 0),
      transitions: scenes.map((s) => s.transition_style),
      pacing_guidance:
        `${profile.cut}. Hook must land in 3s; sustain one idea per beat; ` +
        `single CTA at the end; loop energy back to the open for replays.`,
      thumbnail_concept:
        `Cover frame: the hook line "${ctx.hook_strategy.verbal}" as bold ` +
        `large text over the opening visual (${ctx.hook_strategy.visual}). ` +
        `High contrast, face or motion if possible, zero clutter.`,
      emotional_arc: emotionalArc,
      creator_notes: creatorNotes,
    };
  },
};

export default reelBlueprintAdapter;
