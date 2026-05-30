/**
 * @jest-environment jsdom
 *
 * Final variant workflow activation — focused tests covering:
 *   - Campaign variant config serializer + accessors
 *   - useCampaignVariantConfig hook (load + save round-trip)
 *   - CampaignVariantConfigPanel (load → edit → save)
 *   - Writer variant store helpers (applyFanOutToBlock, selectVariantOnBlock,
 *     clearVariantsOnBlock, annotateVariantsWithMetrics)
 *   - End-to-end campaign create → save → reload assertion
 *
 * Component coverage is scoped to the load-bearing wiring. The
 * embedded Writer + campaign hub surfaces themselves are exercised
 * indirectly through the helpers + hooks.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  applyVariantConfigToExecutionConfig,
  buildExecutionConfigPatch,
  CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY,
  readVariantConfigFromAnyCampaignShape,
  readVariantConfigFromExecutionConfig,
} from '../../../lib/variants/campaignVariantConfig';
import {
  CampaignVariantConfigPanel,
} from '../../../components/variant-experience/CampaignVariantConfigPanel';
import {
  annotateVariantsWithMetrics,
  applyFanOutToBlock,
  blockHasVariants,
  buildVariantEntryFromOutcome,
  clearVariantsOnBlock,
  selectVariantOnBlock,
} from '../../../lib/variants/writerVariantStore';
import type { CreatorAssetBlock } from '../../../lib/blog/blockTypes';
import type { FanOutResult } from '../../../lib/variants/fanOutRunner';
import type { VariantWinner } from '../../../components/variant-experience/useVariantApi';

/* ── apiFetch stub ───────────────────────────────────────────── */

jest.mock('../../../lib/apiFetch', () => ({ apiFetch: jest.fn() }));
const { apiFetch } = require('../../../lib/apiFetch') as { apiFetch: jest.Mock };

beforeEach(() => apiFetch.mockReset());

/* ── Campaign config serializer ──────────────────────────────── */

describe('Campaign variant config — serializer', () => {
  test('applyVariantConfigToExecutionConfig — embeds under canonical key', () => {
    const ec = applyVariantConfigToExecutionConfig(
      { tentative_start: '2026-06-01' },
      { strategy_id: 'image:quote-image', variant_mode: 'top_3_variants' },
    );
    expect(ec.tentative_start).toBe('2026-06-01');
    expect(ec[CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY]).toEqual({
      strategy_id: 'image:quote-image',
      variant_mode: 'top_3_variants',
    });
  });

  test('applyVariantConfigToExecutionConfig — null config strips the key', () => {
    const ec = applyVariantConfigToExecutionConfig(
      {
        tentative_start: '2026-06-01',
        [CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY]: { strategy_id: 'a', variant_mode: 'v1' },
      },
      null,
    );
    expect(ec.tentative_start).toBe('2026-06-01');
    expect(ec[CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY]).toBeUndefined();
  });

  test('applyVariantConfigToExecutionConfig — replaces existing variant config', () => {
    const ec = applyVariantConfigToExecutionConfig(
      { [CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY]: { strategy_id: 'image:quote-image', variant_mode: 'v2' } },
      { strategy_id: 'carousel:story-carousel', variant_mode: 'best_variant' },
    );
    expect(ec[CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY]).toEqual({
      strategy_id: 'carousel:story-carousel',
      variant_mode: 'best_variant',
    });
  });

  test('readVariantConfigFromExecutionConfig — null on absent / malformed', () => {
    expect(readVariantConfigFromExecutionConfig(null)).toBeNull();
    expect(readVariantConfigFromExecutionConfig({})).toBeNull();
    expect(readVariantConfigFromExecutionConfig({
      [CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY]: { strategy_id: 'a' }, // missing mode
    })).toBeNull();
    expect(readVariantConfigFromExecutionConfig({
      [CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY]: { strategy_id: 'a', variant_mode: 'gibberish' },
    })).toBeNull();
  });

  test('readVariantConfigFromAnyCampaignShape — handles campaign_snapshot wrapper', () => {
    const campaign = {
      id: 'camp-1',
      campaign_snapshot: {
        execution_config: {
          [CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY]: {
            strategy_id: 'image:quote-image',
            variant_mode: 'experiment',
          },
        },
      },
    };
    const config = readVariantConfigFromAnyCampaignShape(campaign);
    expect(config?.strategy_id).toBe('image:quote-image');
    expect(config?.variant_mode).toBe('experiment');
  });

  test('readVariantConfigFromAnyCampaignShape — handles prefilled_planning shape', () => {
    const wrapper = {
      prefilled_planning: {
        execution_config: {
          [CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY]: {
            strategy_id: 'infographic:comparison',
            variant_mode: 'top_3_variants',
          },
        },
      },
    };
    const config = readVariantConfigFromAnyCampaignShape(wrapper);
    expect(config?.strategy_id).toBe('infographic:comparison');
  });

  test('buildExecutionConfigPatch — produces patch slice', () => {
    expect(buildExecutionConfigPatch({ strategy_id: 'image:quote-image', variant_mode: 'best_variant' }))
      .toEqual({
        [CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY]: {
          strategy_id: 'image:quote-image',
          variant_mode: 'best_variant',
        },
      });
    expect(buildExecutionConfigPatch(null)).toEqual({});
  });
});

/* ── End-to-end round-trip (serializer-level) ─────────────────── */

describe('Campaign config — end-to-end serializer round-trip', () => {
  test('write → read recovers the same persisted config', () => {
    const original = { strategy_id: 'carousel:story-carousel', variant_mode: 'experiment' } as const;
    const ec = applyVariantConfigToExecutionConfig({}, original);
    const recovered = readVariantConfigFromExecutionConfig(ec);
    expect(recovered).toEqual(original);
  });

  test('write → wrap in campaign snapshot → read recovers config', () => {
    const original = { strategy_id: 'image:promotional-image', variant_mode: 'v2' } as const;
    const ec = applyVariantConfigToExecutionConfig({}, original);
    const campaignFromApi = {
      id: 'c-1',
      campaign_snapshot: { execution_config: ec },
    };
    const recovered = readVariantConfigFromAnyCampaignShape(campaignFromApi);
    expect(recovered).toEqual(original);
  });
});

/* ── CampaignVariantConfigPanel ───────────────────────────────── */

describe('CampaignVariantConfigPanel', () => {
  test('loads persisted config and pre-populates the field', async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/api/campaigns')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'c-1',
            campaign_snapshot: {
              execution_config: {
                [CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY]: {
                  strategy_id: 'image:quote-image',
                  variant_mode: 'top_3_variants',
                },
              },
            },
          }),
        } as any);
      }
      // variant-operator-controls
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          controls: { experimentModeDisabled: false, variantExplorationDisabled: false, forceBaselineV1: false, forceWinningVariant: false },
          defaults: { experimentModeDisabled: false, variantExplorationDisabled: false, forceBaselineV1: false, forceWinningVariant: false },
        }),
      } as any);
    });
    render(<CampaignVariantConfigPanel
      companyId="co-1"
      campaignId="c-1"
      defaultStrategyId="image:educational-image"
    />);
    await waitFor(() => expect(screen.getByText('image:quote-image')).toBeInTheDocument(), { timeout: 3000 });
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('top_3_variants');
  });

  test('fires POST when operator clicks Save', async () => {
    apiFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/campaigns') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'c-1', name: 'My campaign',
            campaign_snapshot: {
              execution_config: {
                [CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY]: {
                  strategy_id: 'image:educational-image',
                  variant_mode: 'best_variant',
                },
              },
            },
          }),
        } as any);
      }
      if (url.startsWith('/api/campaigns')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ id: 'c-1', name: 'My campaign', campaign_snapshot: {} }),
        } as any);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          controls: { experimentModeDisabled: false, variantExplorationDisabled: false, forceBaselineV1: false, forceWinningVariant: false },
          defaults: { experimentModeDisabled: false, variantExplorationDisabled: false, forceBaselineV1: false, forceWinningVariant: false },
        }),
      } as any);
    });
    render(<CampaignVariantConfigPanel
      companyId="co-1"
      campaignId="c-1"
      defaultStrategyId="image:educational-image"
    />);
    await waitFor(() => expect(screen.getByText('image:educational-image')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'best_variant' } });
    fireEvent.click(screen.getByText('Save variant config'));
    await waitFor(() => expect(screen.getByText(/Saved\./i)).toBeInTheDocument(), { timeout: 3000 });
    const postCall = apiFetch.mock.calls.find((c: any) => c[0] === '/api/campaigns' && c[1]?.method === 'POST');
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall[1].body);
    expect(body.id).toBe('c-1');
    expect(body.execution_config[CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY]).toEqual({
      strategy_id: 'image:educational-image',
      variant_mode: 'best_variant',
    });
  });
});

/* ── Writer variant store ─────────────────────────────────────── */

const baseBlock: CreatorAssetBlock = {
  id: 'blk-1',
  type: 'creator_asset',
  creatorType: 'supporting_image',
};

function makeOutcome(family: 'v1' | 'v2' | 'v3', url: string, ok = true) {
  return {
    decision: {
      rank: 1,
      variant: {
        variant_id: `image:quote-image:${family}`,
        variant_family: family,
        strategy_id: 'image:quote-image',
        content_type: 'image' as const,
        display_name: `Quote ${family.toUpperCase()}`,
        description: 'desc',
        exploration_dimensions: [],
      },
      reasoning: 'r',
      source: 'experiment_fan_out' as const,
    },
    ok,
    status: ok ? 200 : 500,
    responseJson: ok ? { output: { asset_payload: { media_bundle: { url, files: [url] }, id: `asset-${family}` }, packaging: { caption: `Caption ${family}` } } } : { error: 'fail' },
    error: ok ? undefined : 'fail',
  };
}

describe('writerVariantStore', () => {
  test('buildVariantEntryFromOutcome extracts asset url, files, caption, asset id', () => {
    const entry = buildVariantEntryFromOutcome({
      variantId: 'image:quote-image:v2',
      variantFamily: 'v2',
      ok: true,
      responseJson: {
        output: {
          asset_payload: {
            id: 'asset-stub',
            media_bundle: { url: 'https://example.com/v2.png', files: ['https://example.com/v2.png'] },
          },
          packaging: { caption: 'V2 caption' },
        },
      },
    });
    expect(entry.url).toBe('https://example.com/v2.png');
    expect(entry.files).toEqual(['https://example.com/v2.png']);
    expect(entry.caption).toBe('V2 caption');
    expect(entry.asset_id).toBe('asset-stub');
    expect(entry.state).toBe('generated');
  });

  test('buildVariantEntryFromOutcome marks failed outcomes', () => {
    const entry = buildVariantEntryFromOutcome({
      variantId: 'v', variantFamily: 'v1', ok: false, responseJson: { error: 'x' },
    });
    expect(entry.state).toBe('failed');
  });

  test('applyFanOutToBlock — attaches variants and picks first successful as primary', () => {
    const result: FanOutResult = {
      outcomes: [
        makeOutcome('v1', 'https://example.com/v1.png'),
        makeOutcome('v2', 'https://example.com/v2.png'),
        makeOutcome('v3', 'https://example.com/v3.png'),
      ],
      successCount: 3,
      failureCount: 0,
    };
    const updated = applyFanOutToBlock(baseBlock, result);
    expect(updated.variants).toHaveLength(3);
    expect(updated.selectedVariantId).toBe('image:quote-image:v1');
    expect(updated.url).toBe('https://example.com/v1.png');
    expect(updated.assetId).toBe('asset-v1');
    expect((updated.metadata as any)?.applied_variant.variant_family).toBe('v1');
  });

  test('applyFanOutToBlock — preserves prior selection when still present', () => {
    const previousSelected = applyFanOutToBlock(baseBlock, {
      outcomes: [makeOutcome('v1', 'https://example.com/v1.png')],
      successCount: 1, failureCount: 0,
    });
    const reSelected = selectVariantOnBlock(previousSelected, 'image:quote-image:v1');
    const result: FanOutResult = {
      outcomes: [makeOutcome('v1', 'https://example.com/v1.png'), makeOutcome('v2', 'https://example.com/v2.png')],
      successCount: 2, failureCount: 0,
    };
    const updated = applyFanOutToBlock(reSelected, result);
    expect(updated.selectedVariantId).toBe('image:quote-image:v1');
  });

  test('applyFanOutToBlock — empty outcomes leaves block unchanged', () => {
    const updated = applyFanOutToBlock(baseBlock, { outcomes: [], successCount: 0, failureCount: 0 });
    expect(updated).toEqual(baseBlock);
  });

  test('applyFanOutToBlock — falls back when all outcomes failed', () => {
    const failed = applyFanOutToBlock(baseBlock, {
      outcomes: [makeOutcome('v1', 'https://example.com/v1.png', false)],
      successCount: 0, failureCount: 1,
    });
    expect(failed.variants).toHaveLength(1);
    expect(failed.selectedVariantId).toBeUndefined();
  });

  test('selectVariantOnBlock — mirrors fields onto block top-level', () => {
    const block: CreatorAssetBlock = {
      ...baseBlock,
      variants: [
        { variant_id: 'image:quote-image:v1', variant_family: 'v1', asset_id: 'a-1', url: 'u-1', files: ['u-1'], state: 'generated' },
        { variant_id: 'image:quote-image:v2', variant_family: 'v2', asset_id: 'a-2', url: 'u-2', state: 'generated' },
      ],
    };
    const selected = selectVariantOnBlock(block, 'image:quote-image:v2');
    expect(selected.selectedVariantId).toBe('image:quote-image:v2');
    expect(selected.assetId).toBe('a-2');
    expect(selected.url).toBe('u-2');
  });

  test('selectVariantOnBlock — unknown id no-ops', () => {
    const block: CreatorAssetBlock = { ...baseBlock, variants: [] };
    expect(selectVariantOnBlock(block, 'unknown')).toBe(block);
  });

  test('clearVariantsOnBlock — strips variants[] + selectedVariantId + applied_variant metadata', () => {
    const block: CreatorAssetBlock = {
      ...baseBlock,
      variants: [{ variant_id: 'image:quote-image:v1', variant_family: 'v1', asset_id: 'a', state: 'generated' }],
      selectedVariantId: 'image:quote-image:v1',
      metadata: { foo: 'bar', applied_variant: { variant_id: 'x' } },
    };
    const cleared = clearVariantsOnBlock(block);
    expect(cleared.variants).toBeUndefined();
    expect(cleared.selectedVariantId).toBeUndefined();
    expect((cleared.metadata as any)?.applied_variant).toBeUndefined();
    expect((cleared.metadata as any)?.foo).toBe('bar');
  });

  test('clearVariantsOnBlock — block without variants returns unchanged', () => {
    expect(clearVariantsOnBlock(baseBlock)).toBe(baseBlock);
  });

  test('annotateVariantsWithMetrics — copies winner + runner-up metrics onto entries', () => {
    const variants = [
      { variant_id: 'image:quote-image:v1', variant_family: 'v1' as const, asset_id: 'a', state: 'generated' as const },
      { variant_id: 'image:quote-image:v2', variant_family: 'v2' as const, asset_id: 'a', state: 'generated' as const },
    ];
    const winner: VariantWinner = {
      strategy_id: 'image:quote-image',
      strategy_family: 'quote',
      content_type: 'image',
      winner: { variant_id: 'image:quote-image:v2', variant_family: 'v2', metrics: { engagementRate: 0.2, saveRate: 0.05, shareRate: 0.02, sampleSize: 100 } },
      runner_up: { variant_id: 'image:quote-image:v1', variant_family: 'v1', metrics: { engagementRate: 0.1, saveRate: 0.02, shareRate: 0.01, sampleSize: 80 } },
      metric: 'engagementRate', delta: 1.0, confidence: 'high', sampleSize: 180, insufficientData: false, insufficientReason: null,
    };
    const annotated = annotateVariantsWithMetrics(variants, winner);
    expect(annotated.find((v) => v.variant_id === 'image:quote-image:v2')?.metrics?.engagementRate).toBeCloseTo(0.2);
    expect(annotated.find((v) => v.variant_id === 'image:quote-image:v1')?.metrics?.engagementRate).toBeCloseTo(0.1);
  });

  test('blockHasVariants — true only when variants[] is non-empty', () => {
    expect(blockHasVariants(baseBlock)).toBe(false);
    expect(blockHasVariants({ ...baseBlock, variants: [] })).toBe(false);
    expect(blockHasVariants({
      ...baseBlock,
      variants: [{ variant_id: 'x', variant_family: 'v1', asset_id: 'a', state: 'generated' }],
    })).toBe(true);
  });
});

/* ── End-to-end Writer flow ────────────────────────────────────── */

describe('Writer multi-asset round-trip', () => {
  test('fan-out → select alternative → clear restores baseline block', () => {
    let block: CreatorAssetBlock = { ...baseBlock };
    block = applyFanOutToBlock(block, {
      outcomes: [
        makeOutcome('v1', 'https://example.com/v1.png'),
        makeOutcome('v2', 'https://example.com/v2.png'),
        makeOutcome('v3', 'https://example.com/v3.png'),
      ],
      successCount: 3, failureCount: 0,
    });
    expect(blockHasVariants(block)).toBe(true);
    expect(block.selectedVariantId).toBe('image:quote-image:v1');
    block = selectVariantOnBlock(block, 'image:quote-image:v3');
    expect(block.selectedVariantId).toBe('image:quote-image:v3');
    expect(block.url).toBe('https://example.com/v3.png');
    block = clearVariantsOnBlock(block);
    expect(blockHasVariants(block)).toBe(false);
    expect(block.selectedVariantId).toBeUndefined();
  });
});
