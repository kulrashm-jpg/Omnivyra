/**
 * @jest-environment jsdom
 *
 * Direct API Adaptation Parity — focused tests covering:
 *
 *   - single-asset path  → one variant key, primary + secondary
 *     adaptations recorded
 *   - top_3 / experiment path → N variant keys, each with primary +
 *     secondary adaptations
 *   - partial-failure safety: one secondary adapt fails → other
 *     decisions still produce results; failing entry has ok=false +
 *     error captured
 *   - attribution preservation: each adapted output keeps the
 *     variant_id / variant_family / strategy_id on
 *     media_bundle.metadata.applied_variant
 *   - primary platform is marked ok WITHOUT invoking the engine
 *     (the orchestrator already adapted+rendered it)
 */

import '@testing-library/jest-dom';
import { runDirectApiSecondaryAdaptation } from '../../services/creator/directApiAdaptationRunner';
import type { CanonicalCreatorOutput } from '../../services/executionEngines/types';

const STRATEGY = 'image:quote-image';

function buildOutput(variantFamily: 'v1' | 'v2' | 'v3'): CanonicalCreatorOutput {
  return {
    intent_type: 'creator',
    asset_type: 'image',
    asset_instruction: { blueprint: {} } as any,
    asset_payload: {
      asset_kind: 'image',
      media_bundle: {
        metadata: {
          applied_variant: {
            strategy_id: STRATEGY,
            variant_id: `${STRATEGY}:${variantFamily}`,
            variant_family: variantFamily,
          },
          variant_id: `${STRATEGY}:${variantFamily}`,
          variant_family: variantFamily,
        },
      },
    } as any,
    packaging: {
      caption: `caption-${variantFamily}`,
      hashtags: [],
      cta: '',
      platform_variants: {
        linkedin: { caption: `linkedin-${variantFamily}`, hashtags: [] } as any,
      },
    } as any,
    metadata: {} as any,
  };
}

function buildAdaptedOutput(source: CanonicalCreatorOutput, platform: string): CanonicalCreatorOutput {
  // The engine clones the output for the platform; preserve the
  // applied_variant envelope so attribution flows through (matches
  // the real adapter's behavior — adaptForPlatform doesn't strip
  // media_bundle.metadata).
  return {
    ...source,
    packaging: {
      ...source.packaging,
      platform_variants: {
        ...source.packaging.platform_variants,
        [platform]: { caption: `${platform}-${(source.asset_payload as any).media_bundle.metadata.variant_family}`, hashtags: [] } as any,
      },
    },
  };
}

/* ── Single asset ──────────────────────────────────────────────── */

describe('single asset path', () => {
  test('records primary + secondary adaptation status', async () => {
    const output = buildOutput('v1');
    const engine = {
      adaptForPlatform: jest.fn(async (o: CanonicalCreatorOutput, platform: string) =>
        buildAdaptedOutput(o, platform),
      ),
    };
    const result = await runDirectApiSecondaryAdaptation({
      engine,
      successfulOutputs: [{ variantKey: `${STRATEGY}:v1`, output }],
      primaryPlatform: 'linkedin',
      secondaryPlatforms: ['twitter', 'facebook'],
    });
    const variantEntry = result[`${STRATEGY}:v1`];
    expect(Object.keys(variantEntry).sort()).toEqual(['facebook', 'linkedin', 'twitter']);
    expect(variantEntry.linkedin.ok).toBe(true);
    expect(variantEntry.twitter.ok).toBe(true);
    expect(variantEntry.facebook.ok).toBe(true);
    // Primary platform must NOT trigger an engine call.
    expect(engine.adaptForPlatform).toHaveBeenCalledTimes(2);
    expect(engine.adaptForPlatform).toHaveBeenCalledWith(output, 'twitter');
    expect(engine.adaptForPlatform).toHaveBeenCalledWith(output, 'facebook');
  });

  test('handles no secondary platforms (primary only)', async () => {
    const engine = { adaptForPlatform: jest.fn() };
    const result = await runDirectApiSecondaryAdaptation({
      engine,
      successfulOutputs: [{ variantKey: 'primary', output: buildOutput('v1') }],
      primaryPlatform: 'linkedin',
      secondaryPlatforms: [],
    });
    expect(Object.keys(result.primary)).toEqual(['linkedin']);
    expect(result.primary.linkedin.ok).toBe(true);
    expect(engine.adaptForPlatform).not.toHaveBeenCalled();
  });
});

/* ── Top 3 / Experiment fan-out ────────────────────────────────── */

describe('fan-out path (top_3_variants / experiment)', () => {
  test('iterates over all variants × all secondary platforms', async () => {
    const outputs = (['v1', 'v2', 'v3'] as const).map((f) => ({
      variantKey: `${STRATEGY}:${f}`,
      output: buildOutput(f),
    }));
    const engine = {
      adaptForPlatform: jest.fn(async (o: CanonicalCreatorOutput, platform: string) =>
        buildAdaptedOutput(o, platform),
      ),
    };
    const result = await runDirectApiSecondaryAdaptation({
      engine,
      successfulOutputs: outputs,
      primaryPlatform: 'linkedin',
      secondaryPlatforms: ['twitter', 'facebook'],
    });
    expect(Object.keys(result)).toHaveLength(3);
    for (const f of ['v1', 'v2', 'v3'] as const) {
      const entry = result[`${STRATEGY}:${f}`];
      expect(entry.linkedin.ok).toBe(true);
      expect(entry.twitter.ok).toBe(true);
      expect(entry.facebook.ok).toBe(true);
    }
    // 3 variants × 2 secondary platforms = 6 engine calls.
    expect(engine.adaptForPlatform).toHaveBeenCalledTimes(6);
  });
});

/* ── Partial failure safety ────────────────────────────────────── */

describe('partial failure safety', () => {
  test('a single adapt failure does NOT abort the loop', async () => {
    const outputs = (['v1', 'v2', 'v3'] as const).map((f) => ({
      variantKey: `${STRATEGY}:${f}`,
      output: buildOutput(f),
    }));
    const engine = {
      adaptForPlatform: jest.fn(async (o: CanonicalCreatorOutput, platform: string) => {
        const family = (o.asset_payload as any).media_bundle.metadata.variant_family;
        if (family === 'v2' && platform === 'twitter') {
          throw new Error('simulated twitter adapt failure');
        }
        return buildAdaptedOutput(o, platform);
      }),
    };
    const failures: Array<{ variantKey: string; platform: string; message: string }> = [];
    const result = await runDirectApiSecondaryAdaptation({
      engine,
      successfulOutputs: outputs,
      primaryPlatform: 'linkedin',
      secondaryPlatforms: ['twitter', 'facebook'],
      onFailure: (info) => failures.push(info),
    });
    // The failure landed on v2/twitter; everything else is OK.
    expect(result[`${STRATEGY}:v2`].twitter.ok).toBe(false);
    expect(result[`${STRATEGY}:v2`].twitter.error).toMatch(/simulated twitter/);
    expect(result[`${STRATEGY}:v2`].facebook.ok).toBe(true);
    expect(result[`${STRATEGY}:v1`].twitter.ok).toBe(true);
    expect(result[`${STRATEGY}:v3`].twitter.ok).toBe(true);
    // All other (asset, platform) pairs still attempted.
    expect(engine.adaptForPlatform).toHaveBeenCalledTimes(6);
    // The onFailure callback fired exactly once for the failed pair.
    expect(failures).toHaveLength(1);
    expect(failures[0]).toEqual({
      variantKey: `${STRATEGY}:v2`,
      platform: 'twitter',
      message: 'simulated twitter adapt failure',
    });
  });

  test('does not throw when ALL adaptations fail', async () => {
    const engine = {
      adaptForPlatform: jest.fn(async () => {
        throw new Error('engine offline');
      }),
    };
    const result = await runDirectApiSecondaryAdaptation({
      engine,
      successfulOutputs: [{ variantKey: 'primary', output: buildOutput('v1') }],
      primaryPlatform: 'linkedin',
      secondaryPlatforms: ['twitter', 'facebook'],
    });
    expect(result.primary.linkedin.ok).toBe(true);
    expect(result.primary.twitter.ok).toBe(false);
    expect(result.primary.facebook.ok).toBe(false);
  });
});

/* ── Attribution preservation ──────────────────────────────────── */

describe('attribution preservation', () => {
  test('the engine receives the source output with applied_variant intact', async () => {
    const output = buildOutput('v2');
    let captured: CanonicalCreatorOutput | null = null;
    const engine = {
      adaptForPlatform: jest.fn(async (o: CanonicalCreatorOutput, platform: string) => {
        captured = o;
        return buildAdaptedOutput(o, platform);
      }),
    };
    await runDirectApiSecondaryAdaptation({
      engine,
      successfulOutputs: [{ variantKey: `${STRATEGY}:v2`, output }],
      primaryPlatform: 'linkedin',
      secondaryPlatforms: ['twitter'],
    });
    expect(captured).not.toBeNull();
    const meta = (captured!.asset_payload as any).media_bundle.metadata;
    expect(meta.applied_variant.strategy_id).toBe(STRATEGY);
    expect(meta.applied_variant.variant_id).toBe(`${STRATEGY}:v2`);
    expect(meta.applied_variant.variant_family).toBe('v2');
  });
});
