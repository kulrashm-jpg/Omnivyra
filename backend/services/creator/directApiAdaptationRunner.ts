/**
 * Direct API Adaptation Runner (Direct API Adaptation Parity).
 *
 * Shared per-asset secondary-platform adaptation loop. Mirrors the
 * pattern already used by the queue worker (creatorContentProcessor.ts)
 * so the Direct API exposes the same adaptation contract:
 *
 *   - reuses createCreatorExecutionEngine() / engine.adaptForPlatform
 *   - sequential per-(asset, platform) iteration
 *   - best-effort: a single adaptation failure does NOT abort the loop
 *   - attribution flows through unchanged — each asset's
 *     media_bundle.metadata.applied_variant envelope is preserved by
 *     the adapter
 *   - does NOT touch billing (no separate charge), governance
 *     (orchestrator already fired), analytics (no recorder calls)
 *
 * Exposed as a thin helper so the Direct API endpoint can call it
 * post-generation and unit tests can exercise the loop without
 * wiring the full HTTP handler.
 */

import type { CanonicalCreatorOutput } from '../executionEngines/types';

export type AdaptationStatus = {
  ok: boolean;
  asset_payload?: Record<string, unknown>;
  packaging?: Record<string, unknown>;
  asset_type?: string;
  error?: string;
};

export type PerAssetAdaptations = Record<string, Record<string, AdaptationStatus>>;

/**
 * Engine surface this runner depends on. Matches the contract
 * exposed by `createCreatorExecutionEngine()`.
 */
export type AdaptationEngine = {
  adaptForPlatform(output: CanonicalCreatorOutput, platform: string): Promise<CanonicalCreatorOutput>;
};

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Runs the adaptation loop over the provided outputs + secondary
 * platforms. The PRIMARY platform is always marked OK without
 * re-invoking the engine (it was already adapted+rendered by the
 * orchestrator). Secondary platforms run sequentially with try/catch.
 *
 * Returns the per-asset / per-platform adaptation map. Never throws.
 */
export async function runDirectApiSecondaryAdaptation(input: {
  engine: AdaptationEngine;
  successfulOutputs: ReadonlyArray<{ variantKey: string; output: CanonicalCreatorOutput }>;
  primaryPlatform: string;
  secondaryPlatforms: ReadonlyArray<string>;
  /** Optional logger; defaults to console.warn. Best-effort. */
  onFailure?: (info: { variantKey: string; platform: string; message: string }) => void;
}): Promise<PerAssetAdaptations> {
  const { engine, successfulOutputs, primaryPlatform, secondaryPlatforms } = input;
  const out: PerAssetAdaptations = {};

  for (const { variantKey, output } of successfulOutputs) {
    out[variantKey] = out[variantKey] ?? {};
    // Primary platform — already adapted + rendered by the orchestrator.
    out[variantKey][primaryPlatform] = {
      ok: true,
      asset_payload: safeObject((output.asset_payload as Record<string, unknown>).platform_payload) || output.asset_payload as Record<string, unknown>,
      packaging: output.packaging.platform_variants[primaryPlatform] ?? {
        caption: output.packaging.caption,
        hashtags: output.packaging.hashtags,
      },
      asset_type: output.asset_type,
    };
    for (const platform of secondaryPlatforms) {
      try {
        const adapted = await engine.adaptForPlatform(output, platform);
        out[variantKey][platform] = {
          ok: true,
          asset_payload: safeObject((adapted.asset_payload as Record<string, unknown>).platform_payload) || adapted.asset_payload as Record<string, unknown>,
          packaging: adapted.packaging.platform_variants[platform] ?? {
            caption: adapted.packaging.caption,
            hashtags: adapted.packaging.hashtags,
          },
          asset_type: adapted.asset_type,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        out[variantKey][platform] = { ok: false, error: message };
        if (input.onFailure) {
          input.onFailure({ variantKey, platform, message });
        } else {
          console.warn('[direct-api-adapt][secondary-adapt-failed]', {
            variant_id: variantKey,
            platform,
            message,
          });
        }
      }
    }
  }

  return out;
}
