/**
 * Creator Rendering — Step-R2 fail-closed projection validators (PURE).
 * ──────────────────────────────────────────────────────────────────────────
 * `validateRenderProjection` is the last gate before a RenderSpec is
 * accepted. It throws RenderProjectionError on ANY of: forbidden
 * leakage, unsupported / text-like / non-renderable asset, malformed
 * scene structures, missing render-safe fields, unsafe serialization,
 * non-deterministic structures. Absence of a positive proof = reject.
 */

import {
  getCreatorAsset,
  getRenderingCapability,
  isTextLikeAsset,
} from '../../intelligence/canonical';
import { RENDER_FORBIDDEN_FIELDS } from '../contracts';
import type { RenderSpec } from '../contracts';
import { RenderProjectionError } from './renderProjectionSanitizer';

export { RenderProjectionError };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * PHASE-3 canonical enforcement. Resolves + validates the asset is
 * renderable, returning the resolved render modality. Fail-closed:
 * unknown / text-like / rendering_capability 'none' → throw.
 */
export function assertRenderableAsset(assetInput: unknown): {
  canonical_asset_family: RenderSpec['canonical_asset_family'];
  render_modality: RenderSpec['render_modality'];
} {
  const def = getCreatorAsset(assetInput);
  if (!def) {
    throw new RenderProjectionError(
      'UNSUPPORTED_ASSET', `no canonical asset for "${String(assetInput)}"`,
    );
  }
  if (isTextLikeAsset(def.canonical_key)) {
    throw new RenderProjectionError(
      'TEXT_LIKE_NOT_RENDERABLE',
      `text-like asset "${def.canonical_key}" cannot be rendered`,
    );
  }
  const cap = getRenderingCapability(def.canonical_key);
  if (cap === 'none' || cap == null) {
    throw new RenderProjectionError(
      'RENDER_CAPABILITY_NONE',
      `asset "${def.canonical_key}" has rendering_capability=none`,
    );
  }
  return {
    canonical_asset_family: def.canonical_asset_family,
    render_modality: cap === 'future_video' ? 'video' : 'image',
  };
}

/** Recursive forbidden-key scan (independent of the sanitizer so the
 *  final spec is double-checked even if assembled elsewhere later). */
function assertNoForbidden(v: unknown, path = '$'): void {
  const forbidden = new Set<string>(RENDER_FORBIDDEN_FIELDS as readonly string[]);
  if (Array.isArray(v)) {
    v.forEach((e, i) => assertNoForbidden(e, `${path}[${i}]`));
  } else if (isPlainObject(v)) {
    for (const k of Object.keys(v)) {
      if (forbidden.has(k)) {
        throw new RenderProjectionError(
          'FORBIDDEN_LEAKAGE', `forbidden key "${k}" in final RenderSpec at ${path}`, `${path}.${k}`,
        );
      }
      assertNoForbidden(v[k], `${path}.${k}`);
    }
  }
}

function assertStringArray(v: unknown, label: string): void {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw new RenderProjectionError('MALFORMED_PROJECTION', `${label} must be string[]`);
  }
}

/**
 * PHASE-8 full fail-closed validation of an assembled RenderSpec.
 * Returns the spec untouched on success; throws otherwise.
 */
export function validateRenderProjection(spec: unknown): RenderSpec {
  if (!isPlainObject(spec)) {
    throw new RenderProjectionError('MALFORMED_PROJECTION', 'RenderSpec must be an object');
  }
  const s = spec as Record<string, unknown>;

  // Required render-safe fields present.
  for (const k of [
    'spec_id', 'canonical_asset_family', 'render_modality',
    'blueprint_projection', 'packaging_projection', 'platform_projection',
    'rendering_parameters', 'moderation_context', 'deterministic_input_hash',
  ]) {
    if (!(k in s)) {
      throw new RenderProjectionError('MISSING_RENDER_SAFE_FIELD', `missing "${k}"`);
    }
  }

  // Canonical asset + modality coherence (re-derived, not trusted).
  const { canonical_asset_family, render_modality } = assertRenderableAsset(
    (s.moderation_context as Record<string, unknown>)?.canonical_asset_key,
  );
  if (s.canonical_asset_family !== canonical_asset_family) {
    throw new RenderProjectionError(
      'ASSET_INCOHERENT',
      `canonical_asset_family ${String(s.canonical_asset_family)} != ${canonical_asset_family}`,
    );
  }
  if (s.render_modality !== render_modality) {
    throw new RenderProjectionError(
      'MODALITY_INCOHERENT',
      `render_modality ${String(s.render_modality)} != ${render_modality}`,
    );
  }

  // Scene/structure shape.
  const bp = s.blueprint_projection as Record<string, unknown>;
  if (!isPlainObject(bp)) {
    throw new RenderProjectionError('MALFORMED_PROJECTION', 'blueprint_projection must be object');
  }
  if (!Array.isArray(bp.storyboard) || bp.storyboard.some((x) => !isPlainObject(x))) {
    throw new RenderProjectionError(
      'MALFORMED_SCENE', 'blueprint_projection.storyboard must be object[]',
    );
  }
  assertStringArray(bp.overlays, 'blueprint_projection.overlays');
  if (typeof bp.visual_prompt !== 'string') {
    throw new RenderProjectionError('MALFORMED_PROJECTION', 'visual_prompt must be string');
  }

  const pk = s.packaging_projection as Record<string, unknown>;
  if (!isPlainObject(pk) || typeof pk.caption !== 'string') {
    throw new RenderProjectionError('MALFORMED_PROJECTION', 'packaging_projection.caption must be string');
  }
  assertStringArray(pk.overlay_text, 'packaging_projection.overlay_text');

  const pf = s.platform_projection as Record<string, unknown>;
  if (!isPlainObject(pf) || typeof pf.platform !== 'string' || typeof pf.aspect_ratio !== 'string'
      || !isPlainObject(pf.resolution)
      || typeof (pf.resolution as any).w !== 'number'
      || typeof (pf.resolution as any).h !== 'number') {
    throw new RenderProjectionError('MALFORMED_PROJECTION', 'platform_projection malformed');
  }

  const mc = s.moderation_context as Record<string, unknown>;
  if (!isPlainObject(mc) || typeof mc.is_text_like !== 'boolean'
      || !Array.isArray(mc.moderated_text)) {
    throw new RenderProjectionError('MALFORMED_PROJECTION', 'moderation_context malformed');
  }
  if (mc.is_text_like === true) {
    throw new RenderProjectionError('TEXT_LIKE_NOT_RENDERABLE', 'moderation_context.is_text_like');
  }

  // Hash / id coherence (deterministic identity).
  if (typeof s.deterministic_input_hash !== 'string'
      || !/^[0-9a-f]{64}$/.test(s.deterministic_input_hash as string)) {
    throw new RenderProjectionError('BAD_HASH', 'deterministic_input_hash must be sha256 hex');
  }
  if (s.spec_id !== `render:${s.deterministic_input_hash}`) {
    throw new RenderProjectionError('BAD_SPEC_ID', 'spec_id must be render:<hash>');
  }

  // Defense-in-depth: no forbidden key anywhere in the final structure.
  assertNoForbidden(s);

  return spec as unknown as RenderSpec;
}
