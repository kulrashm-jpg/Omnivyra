/**
 * @jest-environment jsdom
 *
 * Variant Experience Embedding — focused tests covering:
 *   - Creator → Variant strategy id mapping (lib/variants/creatorStrategyMapping)
 *   - Variant query string round-trip
 *   - Profile adapter (lib/variants/profileAdapter)
 *   - Fan-out runner (lib/variants/fanOutRunner) — payload merge + outcome
 *   - CampaignVariantModeField — campaignConfigToPlannerInput mapping
 *
 * Component tests focus on the load-bearing wiring (mapping, payload
 * merge, persisted-config shape). Embedding surfaces themselves are
 * exercised indirectly through their helpers — the Creator + Writer
 * embeddings render under jsdom but route into existing massive
 * pages that aren't viable to mount in tests.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  decodeVariantQuery,
  encodeVariantQuery,
  resolveCreatorStrategyId,
} from '../../../lib/variants/creatorStrategyMapping';
import {
  buildComparisonRow,
  buildComparisonRowsForStrategy,
  extractRenderStrategyEnvelopeFromMetadata,
} from '../../../lib/variants/profileAdapter';
import {
  buildVariantAwarePayload,
  runVariantFanOut,
} from '../../../lib/variants/fanOutRunner';
import {
  CampaignVariantModeField,
  campaignConfigToPlannerInput,
} from '../../../components/variant-experience/CampaignVariantModeField';
import type {
  VariantDefinition,
  VariantExecutionResult,
} from '../../../components/variant-experience/useVariantApi';

/* ── apiFetch stub for fan-out + operator controls ─────────────── */

jest.mock('../../../lib/apiFetch', () => ({ apiFetch: jest.fn() }));
const { apiFetch } = require('../../../lib/apiFetch') as { apiFetch: jest.Mock };

beforeEach(() => apiFetch.mockReset());

/* ── Creator strategy id mapping ───────────────────────────────── */

describe('resolveCreatorStrategyId', () => {
  test('image purpose → image:<purpose>-image', () => {
    expect(resolveCreatorStrategyId('image', 'promotional')).toBe('image:promotional-image');
    expect(resolveCreatorStrategyId('image', 'educational')).toBe('image:educational-image');
    expect(resolveCreatorStrategyId('image', 'quote')).toBe('image:quote-image');
    expect(resolveCreatorStrategyId('image', 'product-showcase')).toBe('image:product-showcase-image');
    expect(resolveCreatorStrategyId('image', 'brand-focus')).toBe('image:brand-focus-image');
  });

  test('carousel purpose → carousel:<purpose>-carousel', () => {
    expect(resolveCreatorStrategyId('carousel', 'educational')).toBe('carousel:educational-carousel');
    expect(resolveCreatorStrategyId('carousel', 'story')).toBe('carousel:story-carousel');
    expect(resolveCreatorStrategyId('carousel', 'framework')).toBe('carousel:framework-carousel');
    expect(resolveCreatorStrategyId('carousel', 'presentation')).toBe('carousel:presentation-carousel');
    expect(resolveCreatorStrategyId('carousel', 'product-showcase')).toBe('carousel:product-showcase-carousel');
  });

  test('infographic purpose → infographic:<purpose> (bare key)', () => {
    expect(resolveCreatorStrategyId('infographic', 'stats')).toBe('infographic:stats');
    expect(resolveCreatorStrategyId('infographic', 'comparison')).toBe('infographic:comparison');
    expect(resolveCreatorStrategyId('infographic', 'timeline')).toBe('infographic:timeline');
    expect(resolveCreatorStrategyId('infographic', 'process')).toBe('infographic:process');
    expect(resolveCreatorStrategyId('infographic', 'framework')).toBe('infographic:framework');
    expect(resolveCreatorStrategyId('infographic', 'roadmap')).toBe('infographic:roadmap');
  });

  test('unknown subtype returns null (regression-safe)', () => {
    expect(resolveCreatorStrategyId('image', 'unknown')).toBeNull();
    expect(resolveCreatorStrategyId('image', '')).toBeNull();
    expect(resolveCreatorStrategyId('image', null)).toBeNull();
  });

  test('unknown type returns null', () => {
    expect(resolveCreatorStrategyId('video' as any, 'promotional')).toBeNull();
    expect(resolveCreatorStrategyId(null, 'promotional')).toBeNull();
  });

  test('slugs input — case-insensitive + whitespace normalized', () => {
    expect(resolveCreatorStrategyId('Image', 'Promotional')).toBe('image:promotional-image');
    expect(resolveCreatorStrategyId('image', '  product showcase  ')).toBe('image:product-showcase-image');
  });
});

describe('encodeVariantQuery + decodeVariantQuery', () => {
  test('round-trip preserves variant family + variant id', () => {
    const encoded = encodeVariantQuery({ variantFamily: 'v2', variantMode: 'top_3_variants' });
    expect(encoded).toEqual({ variant_family: 'v2', variant_mode: 'top_3_variants' });
    const decoded = decodeVariantQuery({ variant_family: 'v2', variant_mode: 'top_3_variants' });
    expect(decoded.variantFamily).toBe('v2');
    expect(decoded.variantMode).toBe('top_3_variants');
  });

  test('decodes only valid values', () => {
    const decoded = decodeVariantQuery({ variant_family: 'v9', variant_mode: 'gibberish' });
    expect(decoded.variantFamily).toBeNull();
    expect(decoded.variantMode).toBeNull();
  });

  test('decodes from array query values (Next.js shape)', () => {
    const decoded = decodeVariantQuery({ variant_family: ['v3'] });
    expect(decoded.variantFamily).toBe('v3');
  });

  test('encodes only set fields', () => {
    expect(encodeVariantQuery({})).toEqual({});
    expect(encodeVariantQuery({ variantFamily: null })).toEqual({});
  });
});

/* ── Profile adapter ───────────────────────────────────────────── */

const sampleVariant: VariantDefinition = {
  variant_id: 'image:quote-image:v2',
  variant_family: 'v2',
  strategy_id: 'image:quote-image',
  content_type: 'image',
  display_name: 'Quote — Display Typeface',
  description: 'Display poster aesthetic.',
  exploration_dimensions: ['typography', 'headline_emphasis'],
};

describe('Profile adapter', () => {
  test('buildComparisonRow — populates profiles from envelope', () => {
    const row = buildComparisonRow(sampleVariant, {
      renderStrategyEnvelope: {
        id: 'image:quote-image',
        typography_profile: 'oversized statement',
        branding_profile: 'brand de-emphasized',
        density_profile: 'spacious',
        cta_profile: 'absent',
      },
    });
    expect(row.profiles?.typography).toBe('oversized statement');
    expect(row.profiles?.branding).toBe('brand de-emphasized');
    expect(row.profiles?.density).toBe('spacious');
    expect(row.profiles?.cta).toBe('absent');
    expect(row.metrics).toBeNull();
  });

  test('buildComparisonRow — profile fields are undefined when envelope missing', () => {
    const row = buildComparisonRow(sampleVariant, {});
    expect(row.profiles?.typography).toBeUndefined();
  });

  test('buildComparisonRowsForStrategy — empty when analytics is null', () => {
    expect(buildComparisonRowsForStrategy({ strategyId: 'image:quote-image', analytics: null })).toEqual([]);
  });

  test('buildComparisonRowsForStrategy — joins catalog + leaderboard', () => {
    const analytics: any = {
      variants: {
        catalog: [sampleVariant, { ...sampleVariant, variant_id: 'image:quote-image:v1', variant_family: 'v1', display_name: 'Quote — Editorial' }],
        leaderboards: [{
          strategy_id: 'image:quote-image',
          leaderboard: [
            { variant_id: 'image:quote-image:v2', metrics: { engagementRate: 0.22, saveRate: 0.1, shareRate: 0.05, sampleSize: 120 } },
          ],
        }],
      },
      explainability: [{
        strategy_id: 'image:quote-image',
        typography_profile: 'oversized statement',
        branding_profile: 'brand de-emphasized',
        density_profile: 'spacious',
        cta_profile: 'absent',
      }],
    };
    const rows = buildComparisonRowsForStrategy({ strategyId: 'image:quote-image', analytics });
    expect(rows).toHaveLength(2);
    const v2 = rows.find((r) => r.variant.variant_family === 'v2');
    expect(v2?.metrics?.engagementRate).toBeCloseTo(0.22, 4);
    expect(v2?.metrics?.sampleSize).toBe(120);
    const v1 = rows.find((r) => r.variant.variant_family === 'v1');
    expect(v1?.metrics).toBeNull(); // no leaderboard row
    expect(v1?.profiles?.typography).toBe('oversized statement');
  });

  test('extractRenderStrategyEnvelopeFromMetadata — reads applied_render_strategy', () => {
    const envelope = extractRenderStrategyEnvelopeFromMetadata({
      applied_render_strategy: {
        id: 'image:quote-image',
        typography_profile: 'oversized',
        branding_profile: 'quiet',
        density_profile: 'spacious',
        cta_profile: 'absent',
      },
    });
    expect(envelope?.id).toBe('image:quote-image');
    expect(envelope?.typography_profile).toBe('oversized');
    expect(envelope?.cta_profile).toBe('absent');
  });

  test('extractRenderStrategyEnvelopeFromMetadata — null when missing', () => {
    expect(extractRenderStrategyEnvelopeFromMetadata(null)).toBeNull();
    expect(extractRenderStrategyEnvelopeFromMetadata({})).toBeNull();
  });

  // P3-6 — extractAppliedVariantFromMetadata was removed (no
  // production caller). Coverage for `applied_variant` extraction is
  // implicit via the renderer-side metadata bundle code path.
});

/* ── Fan-out runner ────────────────────────────────────────────── */

describe('Fan-out runner', () => {
  test('buildVariantAwarePayload — merges variant fields onto creator_card', () => {
    const base = {
      company_id: 'co-1',
      creator_card: { objective: 'engage', tone: 'professional' },
    };
    const decision = {
      rank: 1,
      variant: sampleVariant,
      reasoning: 'r',
      source: 'experiment_fan_out' as const,
    };
    const merged = buildVariantAwarePayload(base, decision, { experimentId: 'exp_abc' });
    expect(merged.company_id).toBe('co-1');
    expect((merged.creator_card as any).objective).toBe('engage');
    expect((merged.creator_card as any).variant_id).toBe('image:quote-image:v2');
    expect((merged.creator_card as any).variant_family).toBe('v2');
    expect((merged.creator_card as any).strategy_analytics.variant_id).toBe('image:quote-image:v2');
    expect((merged.creator_card as any).variant_experiment_id).toBe('exp_abc');
  });

  test('buildVariantAwarePayload — preserves existing creator_card when present', () => {
    const base = { foo: 'bar', creator_card: { existing: 'value' } };
    const decision = { rank: 1, variant: sampleVariant, reasoning: 'r', source: 'caller_pinned' as const };
    const merged = buildVariantAwarePayload(base, decision);
    expect((merged.creator_card as any).existing).toBe('value');
    expect((merged.creator_card as any).variant_id).toBe('image:quote-image:v2');
  });

  test('runVariantFanOut — runs one request per decision and returns ok outcomes', async () => {
    apiFetch.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ asset_id: 'asset-stub' }),
    }));
    const plan: VariantExecutionResult = {
      resolvedMode: 'top_3_variants',
      strategyId: 'image:quote-image',
      decisions: [
        { rank: 1, variant: { ...sampleVariant, variant_family: 'v1', variant_id: 'image:quote-image:v1', display_name: 'V1' }, reasoning: 'r', source: 'experiment_fan_out' },
        { rank: 2, variant: { ...sampleVariant, variant_family: 'v2', variant_id: 'image:quote-image:v2', display_name: 'V2' }, reasoning: 'r', source: 'experiment_fan_out' },
        { rank: 3, variant: { ...sampleVariant, variant_family: 'v3', variant_id: 'image:quote-image:v3', display_name: 'V3' }, reasoning: 'r', source: 'experiment_fan_out' },
      ],
      experimentId: null,
      appliedOverrides: [],
      modeRationale: 'fan out',
    };
    const result = await runVariantFanOut({
      companyId: 'co-1',
      plan,
      request: { basePayload: { company_id: 'co-1', creator_card: {} } },
    });
    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(0);
    expect(apiFetch).toHaveBeenCalledTimes(3);
  });

  test('runVariantFanOut — partial failure surfaces in outcomes', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ asset_id: 'a-1' }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ asset_id: 'a-3' }) });
    const plan: VariantExecutionResult = {
      resolvedMode: 'top_3_variants',
      strategyId: 'image:quote-image',
      decisions: [
        { rank: 1, variant: { ...sampleVariant, variant_id: 'image:quote-image:v1', variant_family: 'v1' }, reasoning: 'r', source: 'experiment_fan_out' },
        { rank: 2, variant: { ...sampleVariant, variant_id: 'image:quote-image:v2', variant_family: 'v2' }, reasoning: 'r', source: 'experiment_fan_out' },
        { rank: 3, variant: { ...sampleVariant, variant_id: 'image:quote-image:v3', variant_family: 'v3' }, reasoning: 'r', source: 'experiment_fan_out' },
      ],
      experimentId: null,
      appliedOverrides: [],
      modeRationale: 'fan out',
    };
    const result = await runVariantFanOut({
      companyId: 'co-1',
      plan,
      request: { basePayload: { company_id: 'co-1' } },
    });
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(1);
    const failure = result.outcomes.find((o) => !o.ok);
    expect(failure?.error).toBe('boom');
  });

  test('runVariantFanOut — experiment-mode transitions assets via tracker POST', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url.includes('variant-experiment')) {
        return { ok: true, status: 200, json: async () => ({ success: true, experiment: {} }) };
      }
      return { ok: true, status: 200, json: async () => ({ asset_id: 'a' }) };
    });
    const plan: VariantExecutionResult = {
      resolvedMode: 'experiment',
      strategyId: 'image:quote-image',
      decisions: [
        { rank: 1, variant: { ...sampleVariant, variant_id: 'image:quote-image:v1', variant_family: 'v1' }, reasoning: 'r', source: 'experiment_fan_out' },
      ],
      experimentId: 'exp_test',
      appliedOverrides: [],
      modeRationale: 'experiment',
    };
    await runVariantFanOut({
      companyId: 'co-1', plan,
      request: { basePayload: { company_id: 'co-1' } },
    });
    const trackerCalls = apiFetch.mock.calls.filter((c) => String(c[0]).includes('variant-experiment'));
    expect(trackerCalls.length).toBeGreaterThan(0);
    const trackerBody = JSON.parse(trackerCalls[0][1].body);
    // P2-6 — runner now batches transitions into a single POST.
    expect(trackerBody.action).toBe('transition_batch');
    expect(Array.isArray(trackerBody.transitions)).toBe(true);
    expect(trackerBody.transitions).toHaveLength(1);
    expect(trackerBody.transitions[0].experiment_id).toBe('exp_test');
    expect(trackerBody.transitions[0].state).toBe('generated');
  });

  test('runVariantFanOut — captures network failures into outcome.error', async () => {
    apiFetch.mockRejectedValueOnce(new Error('Network unreachable'));
    const plan: VariantExecutionResult = {
      resolvedMode: 'top_3_variants',
      strategyId: 'image:quote-image',
      decisions: [
        { rank: 1, variant: sampleVariant, reasoning: 'r', source: 'experiment_fan_out' },
      ],
      experimentId: null,
      appliedOverrides: [],
      modeRationale: 'fan out',
    };
    const result = await runVariantFanOut({
      companyId: 'co-1', plan,
      request: { basePayload: { company_id: 'co-1' } },
    });
    expect(result.successCount).toBe(0);
    expect(result.outcomes[0].error).toBe('Network unreachable');
  });
});

/* ── Campaign Variant Mode Field ──────────────────────────────── */

describe('campaignConfigToPlannerInput', () => {
  test('legacy "default" and "v1" both → single_variant + v1 (P2-4 compat)', () => {
    expect(campaignConfigToPlannerInput({ strategy_id: 'image:quote-image', variant_mode: 'default' as any }))
      .toEqual({ strategyId: 'image:quote-image', mode: 'single_variant', variantFamily: 'v1' });
    expect(campaignConfigToPlannerInput({ strategy_id: 'image:quote-image', variant_mode: 'v1' }))
      .toEqual({ strategyId: 'image:quote-image', mode: 'single_variant', variantFamily: 'v1' });
  });

  test('v2 and v3 → single_variant + family', () => {
    expect(campaignConfigToPlannerInput({ strategy_id: 'a', variant_mode: 'v2' }).variantFamily).toBe('v2');
    expect(campaignConfigToPlannerInput({ strategy_id: 'a', variant_mode: 'v3' }).variantFamily).toBe('v3');
  });

  test('best_variant / top_3_variants / experiment pass through with null family', () => {
    expect(campaignConfigToPlannerInput({ strategy_id: 'a', variant_mode: 'best_variant' }).mode).toBe('best_variant');
    expect(campaignConfigToPlannerInput({ strategy_id: 'a', variant_mode: 'top_3_variants' }).mode).toBe('top_3_variants');
    expect(campaignConfigToPlannerInput({ strategy_id: 'a', variant_mode: 'experiment' }).mode).toBe('experiment');
  });
});

describe('CampaignVariantModeField rendering', () => {
  beforeEach(() => {
    // Operator-controls hook call inside the field — return defaults.
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        controls: {
          experimentModeDisabled: false,
          variantExplorationDisabled: false,
          forceBaselineV1: false,
          forceWinningVariant: false,
        },
        defaults: {
          experimentModeDisabled: false,
          variantExplorationDisabled: false,
          forceBaselineV1: false,
          forceWinningVariant: false,
        },
      }),
    });
  });

  test('renders strategy id + initial mode + fires onChange', () => {
    const onChange = jest.fn();
    render(<CampaignVariantModeField
      companyId="co-1"
      strategyId="image:quote-image"
      value="default"
      onChange={onChange}
    />);
    expect(screen.getByText('image:quote-image')).toBeInTheDocument();
    expect(screen.getByText(/Campaign variant mode/i)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'best_variant' } });
    expect(onChange).toHaveBeenCalledWith({
      strategy_id: 'image:quote-image',
      variant_mode: 'best_variant',
    });
  });
});
