/**
 * @jest-environment jsdom
 *
 * Variant Experience UI — focused tests covering:
 *   - VariantModeSelector option mapping (UI option ↔ backend payload)
 *   - VariantPreviewGrid rendering of decisions (empty + 1 + 3 entries)
 *   - VariantWinnerCard rendering (winner + insufficient_data states)
 *   - OperatorControlsPanel toggle precedence (Force Baseline V1 dims
 *     Force Winning Variant)
 *   - useVariantPlanner happy path + error path against a stubbed
 *     `fetch`
 *
 * Component coverage is deliberately scoped to the load-bearing
 * pieces — full snapshot trees would be brittle and hide intent.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  ExperimentResultsPanel,
  OperatorControlsPanel,
  VariantModeSelector,
  VariantPreviewGrid,
  VariantWinnerCard,
  type VariantSelectionDecision,
  type VariantWinner,
} from '../../../components/variant-experience';
import {
  VARIANT_MODE_OPTIONS,
  normalizeVariantModeOption,
  uiOptionToExecutionPayload,
} from '../../../components/variant-experience/VariantModeSelector';
import { useVariantPlanner } from '../../../components/variant-experience/useVariantApi';
import { act, renderHook } from '@testing-library/react';

/* ── apiFetch stub ───────────────────────────────────────────────── */

jest.mock('../../../lib/apiFetch', () => ({
  apiFetch: jest.fn(),
}));
const { apiFetch } = require('../../../lib/apiFetch') as { apiFetch: jest.Mock };

beforeEach(() => {
  apiFetch.mockReset();
});

/* ── Mode-mapper round-trip ──────────────────────────────────────── */

describe('VariantModeSelector — option mapping', () => {
  test('exposes 6 UI options after V1 consolidation (P2-4)', () => {
    expect(VARIANT_MODE_OPTIONS).toHaveLength(6);
    expect(VARIANT_MODE_OPTIONS.map((o) => o.value)).toEqual([
      'v1', 'best_variant', 'v2', 'v3', 'top_3_variants', 'experiment',
    ]);
  });

  test('uiOptionToExecutionPayload — backend payload for each option', () => {
    expect(uiOptionToExecutionPayload('best_variant')).toEqual({ mode: 'best_variant', variantFamily: null });
    expect(uiOptionToExecutionPayload('v1')).toEqual({ mode: 'single_variant', variantFamily: 'v1' });
    expect(uiOptionToExecutionPayload('v2')).toEqual({ mode: 'single_variant', variantFamily: 'v2' });
    expect(uiOptionToExecutionPayload('v3')).toEqual({ mode: 'single_variant', variantFamily: 'v3' });
    expect(uiOptionToExecutionPayload('top_3_variants')).toEqual({ mode: 'top_3_variants', variantFamily: null });
    expect(uiOptionToExecutionPayload('experiment')).toEqual({ mode: 'experiment', variantFamily: null });
  });

  test('normalizeVariantModeOption — legacy "default" translates to "v1"', () => {
    expect(normalizeVariantModeOption('default')).toBe('v1');
    expect(normalizeVariantModeOption('v2')).toBe('v2');
    expect(normalizeVariantModeOption('best_variant')).toBe('best_variant');
    expect(normalizeVariantModeOption('garbage')).toBe('v1');
    expect(normalizeVariantModeOption(null)).toBe('v1');
  });
});

/* ── VariantModeSelector rendering ──────────────────────────────── */

describe('VariantModeSelector — rendering', () => {
  test('renders all 6 options when no operator overrides (P2-4 consolidation)', () => {
    const onChange = jest.fn();
    render(<VariantModeSelector value="v1" onChange={onChange} />);
    const select = screen.getByRole('combobox');
    expect(select.querySelectorAll('option')).toHaveLength(6);
  });

  test('hides experiment option when experimentDisabled', () => {
    const onChange = jest.fn();
    render(<VariantModeSelector value="v1" onChange={onChange} experimentDisabled />);
    const optionValues = Array.from(screen.getByRole('combobox').querySelectorAll('option')).map((el) => el.getAttribute('value'));
    expect(optionValues).not.toContain('experiment');
    expect(optionValues).toHaveLength(5);
  });

  test('collapses to single option when explorationDisabled', () => {
    const onChange = jest.fn();
    render(<VariantModeSelector value="v1" onChange={onChange} explorationDisabled />);
    const optionValues = Array.from(screen.getByRole('combobox').querySelectorAll('option')).map((el) => el.getAttribute('value'));
    expect(optionValues).toEqual(['v1']);
  });

  test('fires onChange when the user picks an option', () => {
    const onChange = jest.fn();
    render(<VariantModeSelector value="v1" onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'top_3_variants' } });
    expect(onChange).toHaveBeenCalledWith('top_3_variants');
  });

  test('shows operator override notice when explorationDisabled', () => {
    render(<VariantModeSelector value="v1" onChange={() => {}} explorationDisabled />);
    expect(screen.getByText(/Variant exploration is currently disabled/i)).toBeInTheDocument();
  });
});

/* ── VariantPreviewGrid ─────────────────────────────────────────── */

const variantDef = (family: 'v1' | 'v2' | 'v3') => ({
  variant_id: `image:quote-image:${family}`,
  variant_family: family,
  strategy_id: 'image:quote-image',
  content_type: 'image' as const,
  display_name: `Quote — ${family.toUpperCase()}`,
  description: `Quote variant ${family}.`,
  exploration_dimensions: ['typography'],
});

describe('VariantPreviewGrid', () => {
  test('renders empty state when no decisions', () => {
    render(<VariantPreviewGrid decisions={[]} />);
    expect(screen.getByText(/No variants planned yet/i)).toBeInTheDocument();
  });

  test('renders a single decision', () => {
    const decisions: VariantSelectionDecision[] = [{
      rank: 1,
      variant: variantDef('v1'),
      reasoning: 'Baseline.',
      source: 'baseline_fallback',
    }];
    render(<VariantPreviewGrid decisions={decisions} />);
    expect(screen.getByText('Quote — V1')).toBeInTheDocument();
    // Source badge "Baseline" (uppercase) + description "Baseline." both exist;
    // match the description specifically.
    expect(screen.getByText('Baseline.')).toBeInTheDocument();
    expect(screen.getByText(/Why this variant\?/i)).toBeInTheDocument();
  });

  test('renders three decisions side-by-side with rank labels', () => {
    const decisions: VariantSelectionDecision[] = [
      { rank: 1, variant: variantDef('v1'), reasoning: 'Baseline.', source: 'experiment_fan_out' },
      { rank: 2, variant: variantDef('v2'), reasoning: 'Amplified.', source: 'experiment_fan_out' },
      { rank: 3, variant: variantDef('v3'), reasoning: 'Alternate.', source: 'experiment_fan_out' },
    ];
    render(<VariantPreviewGrid decisions={decisions} />);
    expect(screen.getByText(/Rank 1 · V1/)).toBeInTheDocument();
    expect(screen.getByText(/Rank 2 · V2/)).toBeInTheDocument();
    expect(screen.getByText(/Rank 3 · V3/)).toBeInTheDocument();
  });

  test('shows source badge per decision', () => {
    const decisions: VariantSelectionDecision[] = [
      { rank: 1, variant: variantDef('v1'), reasoning: 'Winner', source: 'winner_engine' },
    ];
    render(<VariantPreviewGrid decisions={decisions} />);
    expect(screen.getByText('Recommended')).toBeInTheDocument();
  });
});

/* ── VariantWinnerCard ──────────────────────────────────────────── */

describe('VariantWinnerCard', () => {
  test('renders insufficient-data state with the engine reason', () => {
    const winner: VariantWinner = {
      strategy_id: 'image:quote-image',
      strategy_family: 'quote',
      content_type: 'image',
      winner: null,
      runner_up: null,
      metric: 'engagementRate',
      delta: null,
      confidence: 'low',
      sampleSize: 12,
      insufficientData: true,
      insufficientReason: 'combined sample (12) below the 60-sample floor',
    };
    render(<VariantWinnerCard winner={winner} />);
    expect(screen.getByText(/No declared winner yet/i)).toBeInTheDocument();
    expect(screen.getByText(/combined sample/i)).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  test('renders declared winner with rates + delta + confidence', () => {
    const winner: VariantWinner = {
      strategy_id: 'carousel:story-carousel',
      strategy_family: 'story',
      content_type: 'carousel',
      winner: { variant_id: 'carousel:story-carousel:v2', variant_family: 'v2', metrics: { engagementRate: 0.18 } },
      runner_up: { variant_id: 'carousel:story-carousel:v3', variant_family: 'v3', metrics: { engagementRate: 0.10 } },
      metric: 'engagementRate',
      delta: 0.8,
      confidence: 'high',
      sampleSize: 540,
      insufficientData: false,
      insufficientReason: null,
    };
    render(<VariantWinnerCard winner={winner} />);
    expect(screen.getByText(/Current leader: V2/i)).toBeInTheDocument();
    expect(screen.getByText('high confidence')).toBeInTheDocument();
    expect(screen.getByText('18.0%')).toBeInTheDocument();
    expect(screen.getByText('10.0%')).toBeInTheDocument();
    expect(screen.getByText('+80.0%')).toBeInTheDocument();
    expect(screen.getByText('540')).toBeInTheDocument();
  });
});

/* ── OperatorControlsPanel ──────────────────────────────────────── */

describe('OperatorControlsPanel', () => {
  test('renders the 4 switches', () => {
    const onChange = jest.fn();
    render(<OperatorControlsPanel
      controls={{
        experimentModeDisabled: false,
        variantExplorationDisabled: false,
        forceBaselineV1: false,
        forceWinningVariant: false,
      }}
      onChange={onChange}
    />);
    expect(screen.getByText('Disable Experiment Mode')).toBeInTheDocument();
    expect(screen.getByText('Disable Variant Exploration')).toBeInTheDocument();
    expect(screen.getByText('Force Baseline V1')).toBeInTheDocument();
    expect(screen.getByText('Force Winning Variant')).toBeInTheDocument();
  });

  test('dims Force Winning Variant when Force Baseline V1 is on', () => {
    render(<OperatorControlsPanel
      controls={{
        experimentModeDisabled: false,
        variantExplorationDisabled: false,
        forceBaselineV1: true,
        forceWinningVariant: false,
      }}
      onChange={() => {}}
    />);
    expect(screen.getByText(/Currently overridden by Force Baseline V1/i)).toBeInTheDocument();
  });

  test('calls onChange with a partial patch when a switch is toggled', () => {
    const onChange = jest.fn();
    render(<OperatorControlsPanel
      controls={{
        experimentModeDisabled: false,
        variantExplorationDisabled: false,
        forceBaselineV1: false,
        forceWinningVariant: false,
      }}
      onChange={onChange}
    />);
    const switches = screen.getAllByRole('button');
    fireEvent.click(switches[0]);
    expect(onChange).toHaveBeenCalledWith({ experimentModeDisabled: true });
  });
});

/* ── ExperimentResultsPanel ─────────────────────────────────────── */

describe('ExperimentResultsPanel', () => {
  test('shows empty active + completed states', () => {
    render(<ExperimentResultsPanel active={[]} completed={[]} />);
    expect(screen.getByText(/No active experiments/i)).toBeInTheDocument();
    expect(screen.getByText(/No completed experiments yet/i)).toBeInTheDocument();
  });

  test('lists active experiments with assets + a complete button', () => {
    const onComplete = jest.fn();
    render(<ExperimentResultsPanel
      active={[{
        experiment_id: 'exp_abc',
        company_id: 'c',
        campaign_id: null,
        strategy_id: 'image:quote-image',
        mode: 'experiment',
        assets: [
          { variant_id: 'image:quote-image:v1', variant_family: 'v1', asset_id: null, scheduled_post_id: null, state: 'generated' },
          { variant_id: 'image:quote-image:v2', variant_family: 'v2', asset_id: null, scheduled_post_id: null, state: 'published' },
        ],
        state: 'generated',
        correlation_id: null,
        createdAt: '2026-05-29T00:00:00Z',
        updatedAt: '2026-05-29T01:00:00Z',
      }]}
      completed={[]}
      onComplete={onComplete}
    />);
    expect(screen.getByText(/exp_abc · image:quote-image/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Mark complete'));
    expect(onComplete).toHaveBeenCalledWith('exp_abc');
  });
});

/* ── useVariantPlanner ──────────────────────────────────────────── */

describe('useVariantPlanner', () => {
  test('plan() resolves with success payload + sets result/operator controls', async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        plan: {
          resolvedMode: 'top_3_variants',
          strategyId: 'image:quote-image',
          decisions: [
            { rank: 1, variant: variantDef('v1'), reasoning: 'a', source: 'experiment_fan_out' },
            { rank: 2, variant: variantDef('v2'), reasoning: 'b', source: 'experiment_fan_out' },
            { rank: 3, variant: variantDef('v3'), reasoning: 'c', source: 'experiment_fan_out' },
          ],
          experimentId: null,
          appliedOverrides: [],
          modeRationale: 'fan out',
        },
        operator_controls: {
          experimentModeDisabled: false,
          variantExplorationDisabled: false,
          forceBaselineV1: false,
          forceWinningVariant: false,
        },
      }),
    });
    const { result } = renderHook(() => useVariantPlanner());
    let planResult;
    await act(async () => {
      planResult = await result.current.plan({
        companyId: 'co-1',
        strategyId: 'image:quote-image',
        mode: 'top_3_variants',
      });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(planResult).not.toBeNull();
    expect(result.current.result?.decisions).toHaveLength(3);
    expect(result.current.error).toBeNull();
    expect(result.current.operatorControls).not.toBeNull();
  });

  test('plan() surfaces API error', async () => {
    apiFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ success: false, error: 'invalid mode' }),
    });
    const { result } = renderHook(() => useVariantPlanner());
    await act(async () => {
      await result.current.plan({
        companyId: 'co-1',
        strategyId: 'image:quote-image',
        mode: 'experiment',
      });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('invalid mode');
    expect(result.current.result).toBeNull();
  });

  test('plan() rejects requests missing companyId / strategyId without calling apiFetch', async () => {
    const { result } = renderHook(() => useVariantPlanner());
    await act(async () => {
      await result.current.plan({ companyId: '', strategyId: '', mode: 'single_variant' });
    });
    expect(apiFetch).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/required/);
  });

  test('reset() clears state', async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        plan: {
          resolvedMode: 'single_variant',
          strategyId: 'image:quote-image',
          decisions: [{ rank: 1, variant: variantDef('v1'), reasoning: 'a', source: 'baseline_fallback' }],
          experimentId: null,
          appliedOverrides: [],
          modeRationale: 'baseline',
        },
        operator_controls: {
          experimentModeDisabled: false,
          variantExplorationDisabled: false,
          forceBaselineV1: false,
          forceWinningVariant: false,
        },
      }),
    });
    const { result } = renderHook(() => useVariantPlanner());
    await act(async () => {
      await result.current.plan({ companyId: 'co-1', strategyId: 'image:quote-image', mode: 'single_variant' });
    });
    expect(result.current.result).not.toBeNull();
    act(() => result.current.reset());
    expect(result.current.result).toBeNull();
    expect(result.current.operatorControls).toBeNull();
  });
});
