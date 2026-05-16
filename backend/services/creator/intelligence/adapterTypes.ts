/**
 * Creator Architecture — Blueprint Adapter Contract
 * ──────────────────────────────────────────────────────────────────────────
 * TYPES ONLY. No runtime, no logic, no registry instance, no orchestration.
 *
 * A `CreatorBlueprintAdapter` is a PURE transform:
 *     (CreatorContext, AdapterBuildOptions) → TBlueprint
 *
 * Purity contract (documented; enforced by review + future unit tests):
 *   - No DB writes / reads.
 *   - No scheduler awareness.
 *   - No rendering.
 *   - No orchestration / side-effects.
 *   - Deterministic: same inputs → same blueprint.
 *
 * The future `creatorAdapterRegistry` will map a normalized creator
 * format (via the existing `normalizeCreatorFormat` in
 * lib/shared/creatorGovernanceRegistry.ts) to one adapter. That registry
 * is intentionally NOT defined here — this commit is contracts only.
 */

import type { CreatorContext, CreatorAssetFamily } from './types';
import type { ContentBlueprint } from './blueprintTypes';

/**
 * Per-invocation options. The adapter is still pure — these are inputs,
 * not state. `platform` is set only in unique-distribution mode (one
 * adapter call per platform); in shared mode it is undefined and the
 * adapter annotates `platform_adaptation_notes` instead.
 */
export interface AdapterBuildOptions {
  platform?: string;
  weekIndex?: number;
  /** Stable seed for any deterministic variation the adapter applies,
   *  so re-runs reproduce identical blueprints (idempotency-friendly). */
  variationSeed?: number;
}

/**
 * Generic adapter contract. `TBlueprint` is the concrete blueprint the
 * adapter emits (e.g. `ReelBlueprint`), all of which extend
 * `ContentBlueprint`.
 */
export interface CreatorBlueprintAdapter<
  TBlueprint extends ContentBlueprint = ContentBlueprint
> {
  /** Which asset family this adapter produces. Must equal the
   *  `asset_family` on every blueprint it returns. */
  readonly assetFamily: CreatorAssetFamily;

  /**
   * Whether this adapter handles the given creator format string. The
   * future implementation delegates to the governance registry's
   * `normalizeCreatorFormat`; the CONTRACT only promises a pure boolean.
   */
  supports(format: string): boolean;

  /**
   * Pure transform. MUST:
   *   - copy `ctx.packaging` verbatim onto the blueprint (DB-constraint
   *     parity across content types)
   *   - emit `asset_payload` in the exact shape the DB constraint
   *     requires for `assetFamily`
   *   - set `render_ready: false` and `blueprint_version: 1`
   */
  build(ctx: CreatorContext, opts?: AdapterBuildOptions): TBlueprint;
}

/**
 * Shape of the future adapter registry (declared as a contract so
 * callers can be typed before the instance exists). NOT instantiated
 * in this commit.
 */
export interface CreatorAdapterRegistry {
  get(format: string): CreatorBlueprintAdapter | undefined;
  register(adapter: CreatorBlueprintAdapter): void;
  /** All registered adapters — for diagnostics / coverage tests. */
  list(): ReadonlyArray<CreatorBlueprintAdapter>;
}
