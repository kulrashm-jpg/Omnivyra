/**
 * Shared Creator Media — Phase-3/5/7/9 inheritance + reuse (PURE).
 * ──────────────────────────────────────────────────────────────────────────
 * ONE shared media asset → propagated across all COMPATIBLE platform
 * variants of the SAME content core, unless the user disables/replaces
 * it. Platform-native TEXT is never read or touched here.
 *
 * PURE: no DB, no scheduler, no network, no clock. The scheduler NEVER
 * calls anything in this module — it only receives the already-finalized
 * flat media map (Phase-9).
 */

import { computeDeterministicInputHash } from '../rendering/contracts';
import {
  isPlatformAssetCompatible,
  type CompatibilityPolicy,
} from './sharedAssetCompatibility';
import { normalizeAssetPlatformKey } from '../intelligence/canonical';

export type InheritanceOverridePolicy = 'inherit_all' | 'manual' | 'locked';
export type PlatformOverrideKind = 'inherited' | 'disabled' | 'replaced';

export type MediaResolutionSource =
  | 'inherited'
  | 'overridden_replaced'
  | 'overridden_disabled'
  | 'not_inherited'      // manual policy, no explicit opt-in
  | 'incompatible';

export interface PlatformMediaResolution {
  platform: string;
  source: MediaResolutionSource;
  /** The effective asset id for this platform (null = no media). */
  asset_id: string | null;
  reason?: string;
}

export interface ResolveInheritanceInput {
  assetType: unknown;
  /** The shared content-core asset id. */
  sharedAssetId: string;
  targetPlatforms: ReadonlyArray<string>;
  overridePolicy?: InheritanceOverridePolicy;
  compatibilityPolicy?: CompatibilityPolicy;
  /** Per-platform explicit deviations (absence ⇒ default behaviour). */
  overrides?: Record<string, { kind: PlatformOverrideKind; asset_id?: string }>;
}

export interface ResolveInheritanceResult {
  resolutions: PlatformMediaResolution[];
  /** Convenience: platforms that end up using the SHARED asset. */
  inherited_platforms: string[];
  /** Default UX checkbox state ("use across supported platforms"). */
  is_default_selected: boolean;
}

/**
 * PHASE-3/5 resolution. Deterministic, order-stable. `locked` ⇒ shared
 * everywhere, overrides ignored. `manual` ⇒ only platforms with an
 * explicit `inherited` (or `replaced`) override get media. `inherit_all`
 * (default) ⇒ every compatible platform inherits unless disabled/
 * replaced.
 */
export function resolveSharedMediaInheritance(
  input: ResolveInheritanceInput,
): ResolveInheritanceResult {
  const policy = input.overridePolicy ?? 'inherit_all';
  const compat = input.compatibilityPolicy ?? 'registry';
  const overrides = input.overrides ?? {};

  const platforms = Array.from(
    new Set(input.targetPlatforms.map((p) => normalizeAssetPlatformKey(p))),
  ).sort();

  const resolutions: PlatformMediaResolution[] = platforms.map((platform) => {
    const c = isPlatformAssetCompatible(platform, input.assetType, compat);
    if (!c.compatible) {
      return { platform, source: 'incompatible', asset_id: null, reason: c.reason ?? 'incompatible' };
    }
    const ov = overrides[platform];

    if (policy === 'locked') {
      return { platform, source: 'inherited', asset_id: input.sharedAssetId };
    }

    if (ov) {
      if (ov.kind === 'disabled') {
        return { platform, source: 'overridden_disabled', asset_id: null };
      }
      if (ov.kind === 'replaced') {
        return {
          platform,
          source: 'overridden_replaced',
          asset_id: ov.asset_id ?? null,
          reason: ov.asset_id ? undefined : 'replaced_without_asset',
        };
      }
      // ov.kind === 'inherited' — explicit opt-in (matters for `manual`)
      return { platform, source: 'inherited', asset_id: input.sharedAssetId };
    }

    if (policy === 'manual') {
      return { platform, source: 'not_inherited', asset_id: null };
    }
    // inherit_all default
    return { platform, source: 'inherited', asset_id: input.sharedAssetId };
  });

  const inherited = resolutions
    .filter((r) => r.source === 'inherited')
    .map((r) => r.platform);

  return {
    resolutions,
    inherited_platforms: inherited,
    is_default_selected: policy !== 'manual',
  };
}

/* ── PHASE-7 render-reuse policy ────────────────────────────────────────── */

export interface RenderReuseCore {
  visual_prompt: string;
  storyboard: ReadonlyArray<Record<string, unknown>>;
  pacing_guidance: string;
  aspect_ratio: string;
  /** Localized variants are NOT reusable across locales. */
  locale?: string;
}

export type NewRenderReason =
  | 'visual_differs'
  | 'storyboard_differs'
  | 'pacing_differs'
  | 'aspect_incompatible'
  | 'localization_differs';

/**
 * The render-reuse identity key. Same key ⇒ the SAME rendered media may
 * be reused (no new render job). Differing visual / storyboard / pacing
 * / aspect / locale ⇒ different key ⇒ a NEW render is required. The
 * SCHEDULER never computes this — it is a pure planning decision.
 */
export function computeRenderReuseKey(core: RenderReuseCore): string {
  return computeDeterministicInputHash({
    visual_prompt: core.visual_prompt ?? '',
    storyboard: core.storyboard ?? [],
    pacing_guidance: core.pacing_guidance ?? '',
    aspect_ratio: core.aspect_ratio ?? '',
    locale: core.locale ?? 'default',
  });
}

export function shouldReuseRender(a: RenderReuseCore, b: RenderReuseCore): boolean {
  return computeRenderReuseKey(a) === computeRenderReuseKey(b);
}

/** Explain WHY a new render is needed (diagnostics / UX), pure. */
export function newRenderReasons(
  a: RenderReuseCore,
  b: RenderReuseCore,
): NewRenderReason[] {
  const reasons: NewRenderReason[] = [];
  if ((a.visual_prompt ?? '') !== (b.visual_prompt ?? '')) reasons.push('visual_differs');
  if (JSON.stringify(a.storyboard ?? []) !== JSON.stringify(b.storyboard ?? [])) reasons.push('storyboard_differs');
  if ((a.pacing_guidance ?? '') !== (b.pacing_guidance ?? '')) reasons.push('pacing_differs');
  if ((a.aspect_ratio ?? '') !== (b.aspect_ratio ?? '')) reasons.push('aspect_incompatible');
  if ((a.locale ?? 'default') !== (b.locale ?? 'default')) reasons.push('localization_differs');
  return reasons;
}

/* ── PHASE-9 scheduler-safe finalization ───────────────────────────────── */

export interface FinalizedPlatformMedia {
  platform: string;
  /** Resolved URL (or null when disabled/incompatible/no-asset). */
  media_url: string | null;
  media_source: MediaResolutionSource;
}

/**
 * Flatten resolutions into the ONLY shape the scheduler may receive: a
 * per-platform `media_url`. NO inheritance/override/reuse logic crosses
 * this boundary — the scheduler is delivery-only. `resolveUrl` is a
 * pure caller-supplied map (asset_id → url); the scheduler never decides
 * anything.
 */
export function finalizeSchedulerMedia(
  resolutions: ReadonlyArray<PlatformMediaResolution>,
  resolveUrl: (assetId: string) => string | null,
): FinalizedPlatformMedia[] {
  return resolutions.map((r) => ({
    platform: r.platform,
    media_url: r.asset_id ? resolveUrl(r.asset_id) : null,
    media_source: r.source,
  }));
}
