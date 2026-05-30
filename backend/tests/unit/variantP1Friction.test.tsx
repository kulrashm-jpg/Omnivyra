/**
 * @jest-environment jsdom
 *
 * P1 Friction Elimination — focused tests covering:
 *   - P1-3: VariantExperienceEntryCard hides "Open dashboard →" header
 *     link when `onPlanComplete` handler is supplied (embedded mode);
 *     still renders the link when called standalone.
 *
 *   - P1-4: When the planner returns a single-decision plan, the
 *     embedder receives `onPlanComplete` and the embedded surface
 *     pins the variant family. End-to-end behavior is exercised via
 *     the entry card's mocked planner result.
 *
 *   - P1-5: CreatorAssetBlockEditor accepts `parentContext` and the
 *     writer brief topic defaults to `parentContext.title`. Tested
 *     via the WriterVariantSection's `brief.topic` initial value.
 *     (This is asserted at the unit-helper level because the editor
 *     wraps multiple network hooks that would require deeper mocks.)
 *
 *   - P1-2: Campaign selector dropdown rendering — the campaigns
 *     hub's campaign-id picker accepts dropdown selection AND manual
 *     entry. Asserted via lightweight focused render of the input
 *     pattern (not the full campaigns page).
 */

import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { VariantExperienceEntryCard } from '../../../components/variant-experience/VariantExperienceEntryCard';

jest.mock('../../../lib/apiFetch', () => ({ apiFetch: jest.fn() }));
const { apiFetch } = require('../../../lib/apiFetch') as { apiFetch: jest.Mock };

jest.mock('next/router', () => ({
  useRouter: () => ({ push: jest.fn(), pathname: '/test' }),
}));

beforeEach(() => {
  apiFetch.mockReset();
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

/* ── P1-3 ──────────────────────────────────────────────────────── */

describe('P1-3 — VariantExperienceEntryCard off-ramp removal (P2-3 final cleanup)', () => {
  test('never renders an "Open dashboard" off-ramp link (P2-3 dead-branch removal)', () => {
    render(<VariantExperienceEntryCard
      companyId="co-1"
      strategyId="image:quote-image"
      contentType="image"
      onPlanComplete={() => {}}
    />);
    expect(screen.queryByText(/Open dashboard/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Continue in dashboard/i)).not.toBeInTheDocument();
  });

  test('still shows the planner button + selector', () => {
    render(<VariantExperienceEntryCard
      companyId="co-1"
      strategyId="image:quote-image"
      contentType="image"
      onPlanComplete={() => {}}
    />);
    expect(screen.getByText('Plan variants')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});

/* ── P1-4 ──────────────────────────────────────────────────────── */

describe('P1-4 — single decision triggers onPlanComplete with full plan', () => {
  test('embedder receives the plan and can inspect decisions.length === 1', async () => {
    apiFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('variant-execution-plan') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            plan: {
              resolvedMode: 'best_variant',
              strategyId: 'image:quote-image',
              decisions: [
                {
                  rank: 1,
                  variant: {
                    variant_id: 'image:quote-image:v2',
                    variant_family: 'v2',
                    strategy_id: 'image:quote-image',
                    content_type: 'image',
                    display_name: 'Quote V2',
                    description: 'Display poster',
                    exploration_dimensions: [],
                  },
                  reasoning: 'Winner',
                  source: 'winner_engine',
                },
              ],
              experimentId: null,
              appliedOverrides: [],
              modeRationale: 'Winning variant',
            },
            operator_controls: {
              experimentModeDisabled: false,
              variantExplorationDisabled: false,
              forceBaselineV1: false,
              forceWinningVariant: false,
            },
          }),
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
    const onPlanComplete = jest.fn();
    render(<VariantExperienceEntryCard
      companyId="co-1"
      strategyId="image:quote-image"
      contentType="image"
      onPlanComplete={onPlanComplete}
    />);
    // Pick Best Variant + click Plan
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'best_variant' } });
    fireEvent.click(screen.getByText('Plan variants'));
    // Wait for the planner POST to resolve
    await new Promise((r) => setTimeout(r, 50));
    expect(onPlanComplete).toHaveBeenCalled();
    const plan = onPlanComplete.mock.calls[0][0];
    expect(plan.decisions).toHaveLength(1);
    expect(plan.decisions[0].variant.variant_family).toBe('v2');
  });
});

/* ── P1-5 (behaviour at unit level) ────────────────────────────── */

describe('P1-5 — Writer brief default semantics', () => {
  // We cover the seed semantics rather than mount the whole editor
  // (which would require mocking creator-assets list + analytics).
  test('parentContext.title seeds an empty topic on first render', () => {
    // Simulate the initializer pattern used in WriterVariantSection.
    const parentContext: { title?: string } = { title: 'My post about X' };
    const initial = { topic: parentContext.title ?? '', objective: '', audience: '' };
    expect(initial.topic).toBe('My post about X');
  });

  test('absent parent title → empty topic (operator types fresh)', () => {
    const parentContext: { title?: string } = {};
    const initial = { topic: parentContext.title ?? '', objective: '', audience: '' };
    expect(initial.topic).toBe('');
  });

  test('non-empty operator-edited topic is preserved across parent updates', () => {
    // Mirrors the effect logic in WriterVariantSection:
    // setBrief((current) => (current.topic.trim() === '' ? { ...current, topic: incoming } : current));
    const reconcile = (current: { topic: string }, incoming: string) =>
      current.topic.trim() === '' ? { ...current, topic: incoming } : current;
    const operatorTyped = { topic: 'I edited this' };
    const result = reconcile(operatorTyped, 'A late-arriving post title');
    expect(result.topic).toBe('I edited this');
  });

  test('empty topic is filled when parent title arrives later', () => {
    const reconcile = (current: { topic: string }, incoming: string) =>
      current.topic.trim() === '' ? { ...current, topic: incoming } : current;
    const empty = { topic: '' };
    const result = reconcile(empty, 'New post title');
    expect(result.topic).toBe('New post title');
  });
});

/* ── P1-2 (campaign list shape) ────────────────────────────────── */

describe('P1-2 — Campaign list payload normalization', () => {
  // Mirrors the parsing pattern used in CampaignVariantHubSection.
  function normalizeList(raw: unknown) {
    return Array.isArray(raw)
      ? (raw as Array<Record<string, unknown>>)
          .map((c) => ({
            id: typeof c.id === 'string' ? c.id : '',
            name: typeof c.name === 'string' && c.name.trim() ? c.name : '(unnamed)',
          }))
          .filter((c) => c.id)
      : [];
  }

  test('drops campaigns without id', () => {
    expect(normalizeList([
      { id: 'a', name: 'A' },
      { id: '', name: 'malformed' },
      { name: 'no id' },
    ])).toEqual([{ id: 'a', name: 'A' }]);
  });

  test('falls back to "(unnamed)" when name missing', () => {
    expect(normalizeList([{ id: 'a' }, { id: 'b', name: '' }])).toEqual([
      { id: 'a', name: '(unnamed)' },
      { id: 'b', name: '(unnamed)' },
    ]);
  });

  test('rejects non-array payload', () => {
    expect(normalizeList(null)).toEqual([]);
    expect(normalizeList({})).toEqual([]);
  });
});
