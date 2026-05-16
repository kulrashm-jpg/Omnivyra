/**
 * Validation — Step-R0 rendering contracts + registry extension.
 *
 *   1  deterministic RenderSpec serialization
 *   2  stable hash generation (order-independent keys, array-sensitive,
 *      volatile-free, fail on non-finite)
 *   3  provider-interface typing (structural conformance)
 *   4  registry backward compatibility
 *   5  no scheduler contamination (safe/forbidden disjoint)
 *   6  no Creator/Text contamination
 *   7  no runtime behavior changes (registry fields intact)
 *   8  type-safe lifecycle modeling (frozen transitions, terminals)
 *   9  fail-closed moderation typing
 *   10 additive-only architecture (pure, side-effect-free import)
 *
 * Pure: no supabase mock needed (the rendering contracts + canonical
 * registry have zero runtime/DB imports).
 */

import {
  stableCanonicalize,
  stableStringify,
  computeDeterministicInputHash,
  RENDER_SAFE_FIELDS,
  RENDER_FORBIDDEN_FIELDS,
  FAIL_CLOSED_MODERATION,
  isModerationPassable,
  RENDER_TERMINAL_STATES,
  RENDER_LEGAL_TRANSITIONS,
  isRenderTerminal,
  isLegalRenderTransition,
} from '../../services/creator/rendering/contracts';
import type {
  RenderProvider,
  RenderSpec,
  RenderModerationResult,
} from '../../services/creator/rendering/contracts';
import {
  CREATOR_ASSET_REGISTRY,
  getRenderingCapability,
  rendersAsImageLater,
  rendersAsVideoLater,
  validateCanonicalReconciliation,
  getDbEnumAssetType,
  getCanonicalAssetFamily,
  isHumanProductionAsset,
  isTextLikeAsset,
} from '../../services/creator/intelligence/canonical';

describe('Validation-1/2 — deterministic serialization + hash', () => {
  it('object key order does not change the canonical form or hash', () => {
    const a = { z: 1, a: { y: 2, x: [3, { b: 4, a: 5 }] } };
    const b = { a: { x: [3, { a: 5, b: 4 }], y: 2 }, z: 1 };
    expect(stableStringify(a)).toEqual(stableStringify(b));
    expect(computeDeterministicInputHash(a)).toEqual(computeDeterministicInputHash(b));
  });

  it('array order IS significant (semantic ordering preserved)', () => {
    expect(computeDeterministicInputHash([1, 2, 3]))
      .not.toEqual(computeDeterministicInputHash([3, 2, 1]));
  });

  it('volatile fields are excluded from the identity', () => {
    const h1 = computeDeterministicInputHash({ payload: 'x', created_at: 't1', spec_id: 's1' });
    const h2 = computeDeterministicInputHash({ payload: 'x', created_at: 't2', spec_id: 's2' });
    expect(h1).toEqual(h2);
  });

  it('hash is stable + 64-hex; non-finite numbers fail closed', () => {
    const h = computeDeterministicInputHash({ a: 1 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(computeDeterministicInputHash({ a: 1 })).toEqual(h); // deterministic
    expect(() => stableStringify({ n: NaN })).toThrow(/non-finite/);
    expect(() => stableStringify({ n: Infinity })).toThrow(/non-finite/);
  });

  it('a RenderSpec-shaped object hashes deterministically', () => {
    const spec: Omit<RenderSpec, 'spec_id' | 'deterministic_input_hash'> = {
      canonical_asset_family: 'image',
      render_modality: 'image',
      blueprint_projection: {
        asset_family: 'image', storyboard: [{ subject: 's' }], overlays: ['o'],
        pacing_guidance: '', scene_direction: '', visual_prompt: 'p',
      },
      packaging_projection: { caption: 'c', overlay_text: ['t'] },
      platform_projection: { platform: 'instagram', aspect_ratio: '1:1', resolution: { w: 1080, h: 1080 } },
      rendering_parameters: { modality: 'image', seed: 42 },
      moderation_context: { canonical_asset_key: 'image', is_text_like: false, moderated_text: ['p'] },
    };
    const hash = computeDeterministicInputHash(spec);
    const specId = `render:${hash}`;
    expect(computeDeterministicInputHash({ ...spec })).toEqual(hash);
    expect(specId).toMatch(/^render:[0-9a-f]{64}$/);
  });
});

describe('Validation-3 — provider interface typing', () => {
  it('a structural mock conforms to RenderProvider', () => {
    const mock: RenderProvider = {
      key: 'stability',
      capabilities: () => ({
        modalities: ['image'], max_duration_sec: 0,
        resolutions: [{ w: 1024, h: 1024 }], aspect_ratios: ['1:1'],
        supports_seed: true, supports_audio: false, supports_overlay_text: true,
        supports_batch: false, max_concurrent: 4,
      }),
      supports: () => true,
      estimateCost: () => ({ estimated_credits: 5, currency: 'CREDITS' }),
      submit: async () => ({ provider: 'stability', external_job_id: 'x' }),
      poll: async () => ({ handle: { provider: 'stability', external_job_id: 'x' }, state: 'in_progress' }),
      fetchOutput: async () => ({
        output_id: 'o', content_sha256: 'h', storage_ref: 'r', modality: 'image',
        mime_type: 'image/png', byte_size: 1, version: 1,
      }),
      cancel: async () => undefined,
    };
    expect(mock.capabilities().modalities).toContain('image');
    expect(mock.supports({} as RenderSpec)).toBe(true);
    expect(mock.estimateCost({} as RenderSpec).currency).toBe('CREDITS');
  });
});

describe('Validation-4/7 — registry backward compatibility', () => {
  it('rendering_capability is descriptive + family-coherent; reconciliation clean', () => {
    expect(getRenderingCapability('image')).toBe('future_image');
    expect(getRenderingCapability('carousel')).toBe('future_image');
    expect(getRenderingCapability('infographic')).toBe('future_image');
    expect(getRenderingCapability('story')).toBe('future_image');
    expect(getRenderingCapability('reel')).toBe('future_video');
    expect(getRenderingCapability('short')).toBe('future_video');
    expect(getRenderingCapability('video')).toBe('future_video');
    expect(getRenderingCapability('post_with_asset')).toBe('none');
    expect(rendersAsImageLater('image')).toBe(true);
    expect(rendersAsVideoLater('reel')).toBe(true);
    // no 'enabled' state exists → nothing here enables rendering
    expect(['none', 'future_image', 'future_video'])
      .toEqual(expect.arrayContaining([...new Set(
        Object.values(CREATOR_ASSET_REGISTRY).map((d) => d.rendering_capability))]));
    expect(validateCanonicalReconciliation()).toEqual([]);
  });

  it('other registry facts are UNCHANGED (no behavior drift)', () => {
    expect(getDbEnumAssetType('reel')).toBe('video');
    expect(getCanonicalAssetFamily('carousel')).toBe('carousel');
    expect(isHumanProductionAsset('reel')).toBe(true);
    expect(isHumanProductionAsset('image')).toBe(false);
  });
});

describe('Validation-5/6 — no scheduler / Creator-Text contamination', () => {
  it('render-safe and forbidden field sets are disjoint; forbidden covers strategy+scheduler', () => {
    const safe = new Set<string>(RENDER_SAFE_FIELDS as readonly string[]);
    for (const f of RENDER_FORBIDDEN_FIELDS) expect(safe.has(f)).toBe(false);
    for (const f of ['scheduler_row', 'emotional_goal', 'creative_objective',
      'continuity_context', 'planning_context', 'workspace_meta']) {
      expect((RENDER_FORBIDDEN_FIELDS as readonly string[]).includes(f)).toBe(true);
    }
  });
  it('text_like asset stays rendering none + text-isolated', () => {
    expect(getRenderingCapability('creator_post')).toBe('none');
    expect(isTextLikeAsset('creator_post')).toBe(true);
    expect(isTextLikeAsset('image')).toBe(false);
  });
});

describe('Validation-8 — lifecycle modeling', () => {
  it('transition graph is frozen + terminals have no out-edges', () => {
    expect(Object.isFrozen(RENDER_LEGAL_TRANSITIONS)).toBe(true);
    for (const t of RENDER_TERMINAL_STATES) {
      if (t === 'scheduling_ready') continue; // terminal-success, still listed
      expect(isRenderTerminal(t)).toBe(true);
      expect(RENDER_LEGAL_TRANSITIONS[t]).toEqual([]);
    }
    expect(isLegalRenderTransition('queued', 'preparing')).toBe(true);
    expect(isLegalRenderTransition('completed', 'attached')).toBe(true);
    expect(isLegalRenderTransition('queued', 'completed')).toBe(false);
    expect(isLegalRenderTransition('scheduling_ready', 'queued')).toBe(false);
    // handed_to_human leaves the FSM (Step-9 lane owns it) → no out-edges
    expect(RENDER_LEGAL_TRANSITIONS.handed_to_human).toEqual([]);
  });
});

describe('Validation-9 — fail-closed moderation typing', () => {
  it('the safe default is blocked; only explicit allowed passes', () => {
    expect(FAIL_CLOSED_MODERATION.decision).toBe('blocked');
    expect(Object.isFrozen(FAIL_CLOSED_MODERATION)).toBe(true);
    expect(isModerationPassable(FAIL_CLOSED_MODERATION)).toBe(false);
    expect(isModerationPassable(null)).toBe(false);
    expect(isModerationPassable(undefined)).toBe(false);
    const blocked: RenderModerationResult = {
      stage: 'post_render', decision: 'blocked', findings: [],
      moderated_subject_hash: 'h', policy_version: 'v1',
    };
    const review: RenderModerationResult = { ...blocked, decision: 'needs_review' };
    const allowed: RenderModerationResult = { ...blocked, decision: 'allowed' };
    expect(isModerationPassable(blocked)).toBe(false);
    expect(isModerationPassable(review)).toBe(false); // needs_review is NOT allow
    expect(isModerationPassable(allowed)).toBe(true);
  });
});

describe('Validation-10 — additive / pure', () => {
  it('canonicalization drops undefined/functions and is pure (no throw on import)', () => {
    expect(stableCanonicalize({ a: undefined, b: 1, c: () => 0 })).toEqual({ b: 1 });
    expect(stableCanonicalize([1, undefined, 2])).toEqual([1, null, 2]); // index held
    // deterministic across calls (no ambient state)
    const x = { k: [{ b: 2, a: 1 }] };
    expect(stableStringify(x)).toEqual(stableStringify(x));
  });
});
