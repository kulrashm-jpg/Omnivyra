/**
 * Variant Experience page.
 *
 * Single hub that surfaces the variant execution stack — selector,
 * preview grid, winner display, comparison view, experiment dashboard,
 * operator controls — to operators across Creator / Writer / Campaign
 * surfaces. Built on the existing backend APIs; introduces no new
 * persistence + no new backend behavior.
 *
 * Pages that already host creator workflows (creator-content,
 * thread editor, campaign config) can link into this hub via the
 * "Manage variants" entry-point CTA the corresponding integration
 * adds.
 */

import React, { useMemo, useState } from 'react';
import { useCompanyContext } from '../../components/CompanyContext';
import {
  ExperimentResultsPanel,
  OperatorControlsPanel,
  VariantComparisonView,
  type VariantComparisonRow,
  VariantModeSelector,
  uiOptionToExecutionPayload,
  type VariantModeOption,
  VariantPreviewGrid,
  VariantWinnerCard,
} from '../../components/variant-experience';
import {
  useOperatorControls,
  useStrategyAnalytics,
  useVariantExperiments,
  useVariantPlanner,
} from '../../components/variant-experience/useVariantApi';
import { buildComparisonRowsForStrategy } from '../../lib/variants/profileAdapter';

const WINDOW_OPTIONS = ['7d', '30d', '90d', 'all_time'] as const;
type WindowOption = (typeof WINDOW_OPTIONS)[number];

const VariantExperiencePage: React.FC = () => {
  const { selectedCompanyId, isAuthenticated, authChecked } = useCompanyContext();
  const companyId = selectedCompanyId ?? '';

  const [variantMode, setVariantMode] = useState<VariantModeOption>('v1');
  const [strategyId, setStrategyId] = useState<string>('');
  const [windowSel, setWindowSel] = useState<WindowOption>('30d');

  const planner = useVariantPlanner();
  const analytics = useStrategyAnalytics({ companyId, window: windowSel });
  const operatorControls = useOperatorControls(companyId);
  const experiments = useVariantExperiments({ companyId });

  const liveControls = operatorControls.controls;

  // First-load strategy default — the dashboard exposes the catalog
  // of declared strategy ids; pick the first available image strategy
  // so the page is functional without operator input.
  const defaultStrategyId = useMemo(() => {
    if (strategyId) return strategyId;
    const first = analytics.data?.dimensions?.[0]?.strategy_id;
    return first ?? 'image:educational-image';
  }, [analytics.data, strategyId]);

  const handlePlan = async () => {
    const payload = uiOptionToExecutionPayload(variantMode);
    await planner.plan({
      companyId,
      strategyId: defaultStrategyId,
      mode: payload.mode,
      variantFamily: payload.variantFamily,
      window: windowSel,
      contentType: undefined,
    });
    experiments.refetch();
  };

  const handleOperatorChange = async (patch: Parameters<typeof operatorControls.update>[0]) => {
    await operatorControls.update(patch);
    analytics.refetch();
    planner.reset();
  };

  const handleComplete = async (experimentId: string) => {
    await experiments.complete(experimentId);
    experiments.refetch();
    analytics.refetch();
  };

  // Variant comparison rows for the currently selected strategy.
  // Uses the centralized profile adapter so render-profile strings
  // (typography / branding / density / cta) populate from the
  // analytics explainability envelope (PHASE 9).
  const comparisonRows: VariantComparisonRow[] = useMemo(
    () => buildComparisonRowsForStrategy({ strategyId: defaultStrategyId, analytics: analytics.data }),
    [analytics.data, defaultStrategyId],
  );

  if (!authChecked) {
    return <PageShell><p className="text-sm text-gray-500">Checking authentication…</p></PageShell>;
  }
  if (!isAuthenticated) {
    return <PageShell><p className="text-sm text-rose-700">Sign in to view variant experience.</p></PageShell>;
  }
  if (!companyId) {
    return <PageShell><p className="text-sm text-amber-700">Select a company to continue.</p></PageShell>;
  }

  return (
    <PageShell>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Variant experience</h1>
        <p className="mt-1 text-sm text-gray-600">
          Plan, generate, observe, and govern Creator + Writer + Campaign variants.
        </p>
      </header>

      {/* Plan + preview */}
      <section className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Plan a variant run</h3>
            <p className="mt-1 text-xs text-gray-500">
              Posts to <code className="rounded bg-gray-100 px-1 py-0.5 text-[11px]">/api/creator-intelligence/variant-execution-plan</code>.
            </p>
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Strategy</span>
                <select
                  value={defaultStrategyId}
                  onChange={(e) => setStrategyId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {(analytics.data?.dimensions ?? []).map((dim) => (
                    <option key={dim.strategy_id} value={dim.strategy_id}>
                      {dim.strategy_id}
                    </option>
                  ))}
                </select>
              </label>
              <VariantModeSelector
                value={variantMode}
                onChange={setVariantMode}
                experimentDisabled={liveControls?.experimentModeDisabled ?? false}
                explorationDisabled={liveControls?.variantExplorationDisabled ?? false}
              />
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Performance window</span>
                <select
                  value={windowSel}
                  onChange={(e) => setWindowSel(e.target.value as WindowOption)}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {WINDOW_OPTIONS.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </label>
              <button
                type="button"
                onClick={handlePlan}
                disabled={planner.loading}
                className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {planner.loading ? 'Planning…' : 'Generate plan'}
              </button>
            </div>
            {planner.error ? (
              <p className="mt-2 text-xs text-rose-700">{planner.error}</p>
            ) : null}
          </div>
        </aside>

        <div className="space-y-6">
          {planner.result ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    Planned variants ({planner.result.decisions.length})
                  </h2>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Resolved mode: <span className="font-semibold text-gray-700">{planner.result.resolvedMode}</span>
                    {planner.result.experimentId ? (
                      <> · Experiment <span className="font-semibold text-gray-700">{planner.result.experimentId}</span></>
                    ) : null}
                  </p>
                </div>
                {planner.result.appliedOverrides.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {planner.result.appliedOverrides.map((override) => (
                      <span key={override} className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200">
                        {override.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                ) : null}
              </header>
              <p className="mb-3 text-xs italic text-gray-500">{planner.result.modeRationale}</p>
              <VariantPreviewGrid decisions={planner.result.decisions} />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
              Select a strategy + mode and click Generate plan to preview variants.
            </div>
          )}

          <VariantComparisonView strategyId={defaultStrategyId} rows={comparisonRows} />
        </div>
      </section>

      {/* Winners */}
      <section className="mt-8">
        <header className="mb-3">
          <h2 className="text-base font-semibold text-gray-900">Winner recommendations</h2>
          <p className="text-xs text-gray-500">
            {analytics.data?.execution.summary.strategies_with_declared_winner ?? 0} of {analytics.data?.dimensions.length ?? 0} strategies have a declared winner in the {windowSel} window.
          </p>
        </header>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(analytics.data?.execution.winner_recommendations ?? []).slice(0, 9).map((winner) => (
            <VariantWinnerCard key={winner.strategy_id} winner={winner} />
          ))}
          {(analytics.data?.variants.winners ?? [])
            .filter((w) => w.insufficientData)
            .slice(0, 3)
            .map((winner) => (
              <VariantWinnerCard key={winner.strategy_id} winner={winner} />
            ))}
        </div>
      </section>

      {/* Experiments + operator controls */}
      <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ExperimentResultsPanel
          active={experiments.experiments.filter((e) => e.state !== 'completed')}
          completed={experiments.experiments.filter((e) => e.state === 'completed')}
          onComplete={handleComplete}
        />
        {liveControls ? (
          <OperatorControlsPanel controls={liveControls} onChange={handleOperatorChange} disabled={operatorControls.loading} />
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500">
            Loading operator controls…
          </div>
        )}
      </section>
    </PageShell>
  );
};

const PageShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <main className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 px-6 py-8 sm:px-10">
    <div className="mx-auto max-w-7xl">{children}</div>
  </main>
);

export default VariantExperiencePage;
