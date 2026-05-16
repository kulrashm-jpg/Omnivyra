/**
 * Creator Architecture — Shared Packaging Contracts
 * ──────────────────────────────────────────────────────────────────────────
 * TYPES ONLY. No runtime, no imports of runtime modules, no logic.
 *
 * `CreatorPackaging` is the single canonical marketing-copy contract every
 * creator content type ships with. Its shape is dictated by the DEPLOYED
 * database constraint `daily_content_plans_creator_payload_check`
 * (see migration 20260422_creator_execution_reliability.sql, later
 * tightened): a creator-intent row's `content` JSON MUST contain a
 * `packaging` object with exactly these keys, with `hashtags` and
 * `keywords` typed as arrays. Keeping this contract authoritative here
 * means the future intelligence engine + adapters cannot accidentally
 * emit a payload the DB rejects.
 *
 * Nothing in this file changes behavior — it formalizes the shape the
 * pipeline already hand-rolls inline in
 * `pages/api/campaigns/generate-weekly-structure.ts`.
 */

/**
 * Canonical marketing package attached to every creator asset.
 *
 * Field-by-field mirror of what the DB constraint validates:
 *   - caption           : string (may be empty pre-generation)
 *   - hashtags           : string[] (constraint enforces jsonb array)
 *   - meta_description   : string
 *   - keywords           : string[] (constraint enforces jsonb array)
 *   - cta                : string
 *
 * Implementations MAY carry additional non-marketing keys; consumers
 * MUST treat unknown keys as opaque pass-through (the pipeline already
 * spreads `...existingPackaging` to preserve extras).
 */
export interface CreatorPackaging {
  caption: string;
  hashtags: string[];
  meta_description: string;
  keywords: string[];
  cta: string;
  /** Opaque pass-through for values produced by later stages
   *  (creator-asset-generation) — never narrowed by this contract. */
  [extra: string]: unknown;
}

/**
 * Per-platform packaging override. Used only when
 * `cross_platform_sharing` is OFF (unique content per platform).
 *
 * Override precedence (lowest → highest), per the architecture's
 * shared-vs-unique model:
 *   1. CreatorContext core packaging (engine default)
 *   2. adapter assetFamily defaults
 *   3. platform variant rules (caption length / hashtag caps)
 *   4. explicit user override (future workspace edit)
 *
 * Only these keys are overridable. `topic`, `emotional_tone`, and
 * `audience_intent` are deliberately NOT here — overriding them would
 * break campaign coherence (architecture guardrail).
 */
export interface CreatorPackagingOverride {
  caption?: string;
  hashtags?: string[];
  meta_description?: string;
  keywords?: string[];
  cta?: string;
  overlay_text?: string;
}

/**
 * Shared-vs-unique distribution contract. Mirrors the existing
 * `cross_platform_sharing` execution-config semantics + the
 * `repurpose_index` / `repurpose_total` columns the scheduler already
 * uses — declared here so future code reasons about it through one type
 * instead of re-deriving it from raw config.
 */
export type CreatorDistributionMode = 'shared' | 'unique';

export interface CreatorSharedCoreContract {
  mode: CreatorDistributionMode;
  /**
   * When `mode === 'shared'`: one creative core fans out to N platforms;
   * `platform_overrides` is empty and `platform_adaptation_notes`
   * (on the blueprint) annotates differences.
   *
   * When `mode === 'unique'`: each platform gets its own blueprint that
   * inherits the core then applies its `platform_overrides` entry.
   */
  platform_overrides: Record<string, CreatorPackagingOverride>;
}
