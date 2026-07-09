/** MarketPulseTabV2 — thin composition: controller + verbatim JSX. */
/** Part 3/3 of MarketPulseTabV2.tsx — verbatim split (barrel preserved; importers unchanged). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { OpportunityTabProps } from './types';
import { RefreshCw, Radar, ShieldAlert, Sparkles } from 'lucide-react';
import EngineJobStatusPanel from '../../engines/EngineJobStatusPanel';

import { MARKET_PULSE_CATEGORIES, type ContextResponse, type AutomationResponse, SOURCE_STRATEGIES, type MarketPulseFinding, type RunResponse, type HistoryItem, type PendingRunState, type MarketDimension, type AttentionFilter, MARKET_DIMENSIONS, ATTENTION_FILTERS, findingMatchesDimension, findingMatchesAttention, sortBySignalAttention, SignalExplainability } from './MarketPulseTabV2Model';
import { SignificanceBadge, SignalMovement, ExecutiveScanStrip, SinceLastPulseStrip, filterDeltaSummary, DimensionFilters, AttentionFilters, MarketNarrativesSection, type MarketPulseLoadError, OBJECTIVES, toTitle, buildResolvedRegionPreview, buildFocusedCategoryDefaults, buildExpandedCategoryDefaults, wait, FeedSection, ExecutivePanels } from './MarketPulseTabV2Widgets';
import { useMarketPulseTabController } from './MarketPulseTabV2Controller';

export default function MarketPulseTabV2(props: OpportunityTabProps) {
  const f = useMarketPulseTabController(props);
  const {
    actioningFindingId, activeAttentionFilter, activeDimension, activeScanStatusPanel,
    allVisibleRankedFindings, attentionCounts, automationEnabled, automationLoading, cancelLoading, changeDiff,
    companyId, competitorScope, context, creditAcknowledged, customDirection, customRegions, dimensionCounts,
    dimensionRankedFindings, errorMessage, fetchWithAuth, filteredMarketDeltaSummary, findingStateOverrides,
    groupedFindings, hasPrioritizedFeed, history, loadMostRecentRunResult, loadRunResult, loadingContext, mode,
    objective, pendingRun, performFindingAction, regionScope, resolvedRegionPreview, runId, runResult, runScan,
    running, saveAutomation, scanSetupAutoOpened, scanSetupOpen, selectedCategories, setActioningFindingId,
    setActiveAttentionFilter, setActiveDimension, setAutomationEnabled, setAutomationLoading, setCancelLoading,
    setCompetitorScope, setContext, setCreditAcknowledged, setCustomDirection, setCustomRegions,
    setErrorMessage, setFindingStateOverrides, setHistory, setLoadingContext, setMode, setObjective,
    setPendingRun, setRegionScope, setRunId, setRunResult, setRunning, setScanSetupAutoOpened,
    setScanSetupOpen, setSelectedCategories, setSourceStrategy, shownRecordedRef, sourceStrategy, stopScan,
    tieredFindings, toggleCategory, visibleRankedFindings
  } = f;
  if (f.noCompanySelected) {
    return <div className="py-4 text-sm text-gray-500">Select a company to view Market Pulse.</div>;
  }
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Market Pulse</p>
            <h3 className="mt-2 text-2xl font-bold text-gray-900">Monitor the market with company-aware filters</h3>
            <p className="mt-2 text-sm text-gray-600">
              Use company profile context, category selection, and geography scope to surface only the external developments that matter.
            </p>
          </div>
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
            <span className="font-semibold">{context?.profile?.name || 'Company context'}</span>
            <span className="ml-2 text-indigo-700">{context?.profile?.industry || 'Industry pending'}</span>
          </div>
        </div>
      </div>

      {errorMessage && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{errorMessage}</div>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          {/* Phase 1B EXECUTIVE FEED HEADER — renders when run has results.
              Pressure indicators, top changes, dominant categories, risk/opp balance. */}
          {runResult && runResult.findings.length > 0 && (
            <section className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex-1 min-w-[260px]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-700">Decision intelligence</p>
                  {runResult.run.executive_summary ? (
                    <p className="mt-2 text-base font-medium text-gray-900 leading-snug">{runResult.run.executive_summary}</p>
                  ) : runResult.run.strategic_summary ? (
                    <p className="mt-2 text-base font-medium text-gray-900 leading-snug">{runResult.run.strategic_summary}</p>
                  ) : (
                    <p className="mt-2 text-base text-gray-500">No executive summary yet — run a scan or wait for the cron to land one.</p>
                  )}
                </div>
                {runResult.run.market_direction && (
                  <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                    runResult.run.market_direction === 'expanding' ? 'bg-emerald-100 text-emerald-800'
                    : runResult.run.market_direction === 'contracting' ? 'bg-rose-100 text-rose-800'
                    : runResult.run.market_direction === 'mixed' ? 'bg-amber-100 text-amber-800'
                    : 'bg-gray-100 text-gray-700'
                  }`}>
                    {runResult.run.market_direction}
                  </span>
                )}
              </div>

              {/* Pressure bar — visualizes risk vs opportunity balance. */}
              {(typeof runResult.run.opportunity_pressure === 'number' || typeof runResult.run.risk_pressure === 'number') && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                    <span>Risk pressure {Math.round((runResult.run.risk_pressure ?? 0) * 100)}%</span>
                    <span>Opportunity pressure {Math.round((runResult.run.opportunity_pressure ?? 0) * 100)}%</span>
                  </div>
                  <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-gray-100">
                    <div className="bg-rose-400" style={{ width: `${Math.round((runResult.run.risk_pressure ?? 0) * 100)}%` }} />
                    <div className="bg-emerald-400" style={{ width: `${Math.round((runResult.run.opportunity_pressure ?? 0) * 100)}%` }} />
                  </div>
                </div>
              )}

              {/* Top takeaways. */}
              {runResult.run.top_takeaways && runResult.run.top_takeaways.length > 0 && (
                <ul className="mt-4 space-y-1.5 text-sm text-gray-700">
                  {runResult.run.top_takeaways.map((t, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-500" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Strategic shift assessment. */}
              {runResult.run.strategic_shift_assessment && (
                <div className="mt-4 rounded-lg border border-indigo-100 bg-white/80 p-3 text-sm text-gray-700">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600">Shift assessment</span>
                  <p className="mt-1">{runResult.run.strategic_shift_assessment}</p>
                </div>
              )}

              {/* Immediate-attention list — P0s requiring action. */}
              {runResult.run.immediate_attention_items && runResult.run.immediate_attention_items.length > 0 && (
                <div className="mt-4">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-600">Immediate attention</span>
                  <ul className="mt-2 space-y-1.5">
                    {runResult.run.immediate_attention_items.slice(0, 5).map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2 text-sm">
                        <span className="rounded-full bg-rose-200 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">{item.priority_tier}</span>
                        <div className="flex-1">
                          <div className="font-semibold text-gray-900">{item.title}</div>
                          <div className="text-xs text-rose-700">{item.reason}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Change-summary chips — emerging/disappearing categories + escalations. */}
              {runResult.run.change_summary && (
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  {runResult.run.change_summary.escalated_count > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">
                      ↑ {runResult.run.change_summary.escalated_count} escalated
                    </span>
                  )}
                  {runResult.run.change_summary.downgraded_count > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">
                      ↓ {runResult.run.change_summary.downgraded_count} downgraded
                    </span>
                  )}
                  {runResult.run.change_summary.emerging_categories.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-800" title={runResult.run.change_summary.emerging_categories.join(', ')}>
                      + {runResult.run.change_summary.emerging_categories.length} emerging {runResult.run.change_summary.emerging_categories.length === 1 ? 'category' : 'categories'}
                    </span>
                  )}
                  {runResult.run.change_summary.disappearing_categories.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-600" title={runResult.run.change_summary.disappearing_categories.join(', ')}>
                      − {runResult.run.change_summary.disappearing_categories.length} disappearing
                    </span>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Phase 2 EXECUTIVE PANELS — momentum, category acceleration,
              competitor pressure, propagation map, escalation timeline,
              trend persistence. Renders only when at least one panel has data. */}
          {runResult && runResult.findings.length > 0 && (
            <ExecutivePanels run={runResult.run} />
          )}

          {/* Scan Setup — collapsed by default once a run exists; expanded on first visit. */}
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <button
              type="button"
              onClick={() => setScanSetupOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left hover:bg-gray-50"
            >
              <span className="flex items-center gap-2">
                <Radar className="h-4 w-4 text-indigo-600" />
                <span className="text-sm font-semibold text-gray-900">{scanSetupOpen ? 'Adjust scan' : 'Scan setup'}</span>
                {!scanSetupOpen && context && (
                  <span className="text-xs text-gray-500">
                    · {selectedCategories.length} categor{selectedCategories.length === 1 ? 'y' : 'ies'}
                    {' · '}{objective}
                    {' · '}{regionScope === 'custom' ? 'custom regions' : regionScope.replace(/_/g, ' ')}
                  </span>
                )}
              </span>
              <span className="text-xs text-gray-500">{scanSetupOpen ? 'Collapse' : 'Expand'}</span>
            </button>

            {!scanSetupOpen ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={runScan}
                  disabled={running || loadingContext || selectedCategories.length === 0}
                  className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {running ? 'Running scan...' : 'Run Market Pulse'}
                </button>
                {running && runId && (
                  <button
                    type="button"
                    onClick={stopScan}
                    disabled={cancelLoading}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                  >
                    {cancelLoading ? 'Stopping...' : 'Stop scan'}
                  </button>
                )}
                {runResult?.run?.created_at && (
                  <span className="text-xs text-gray-500">Last run: {new Date(runResult.run.created_at).toLocaleString()}</span>
                )}
                {activeScanStatusPanel}
              </div>
            ) : (
              <div className="mt-4">

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-gray-700">Mode</label>
                <select value={mode} onChange={(e) => setMode(e.target.value as 'one_time' | 'automated')} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="one_time">One-time scan</option>
                  <option value="automated">Automated monitoring</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Objective</label>
                <select value={objective} onChange={(e) => setObjective(e.target.value as typeof objective)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  {OBJECTIVES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Region scope</label>
                <select value={regionScope} onChange={(e) => setRegionScope(e.target.value as typeof regionScope)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="profile_markets">Market focus</option>
                  <option value="expansion_markets">Expansion markets</option>
                  <option value="all_defaults">All defaults</option>
                  <option value="custom">Custom regions</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Competitor scope</label>
                <select value={competitorScope} onChange={(e) => setCompetitorScope(e.target.value as typeof competitorScope)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="profile_only">Profile competitors</option>
                  <option value="auto_discover">Auto-discover</option>
                  <option value="combined">Combine both</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Research mode</label>
                <select value={sourceStrategy} onChange={(e) => setSourceStrategy(e.target.value as typeof sourceStrategy)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  {SOURCE_STRATEGIES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-gray-700">Custom regions</label>
                <input value={customRegions} onChange={(e) => setCustomRegions(e.target.value)} disabled={regionScope !== 'custom'} placeholder="Comma-separated: US, Canada, UK" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100" />
                <p className="mt-2 text-xs text-gray-500">
                  Active regions: {resolvedRegionPreview.length ? resolvedRegionPreview.join(', ') : 'Global fallback'}
                </p>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-gray-700">Custom direction</label>
                <textarea value={customDirection} onChange={(e) => setCustomDirection(e.target.value)} rows={3} placeholder="Example: Track North America expansion, visa friction, and partnership signals for IT services." className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
            </div>

            <div className="mt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-sm font-medium text-gray-700">Signal categories</label>
                <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                  <button
                    type="button"
                    onClick={() => setSelectedCategories(buildFocusedCategoryDefaults(context))}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                      selectedCategories.length === 1 && selectedCategories[0] === buildFocusedCategoryDefaults(context)[0]
                        ? 'bg-white text-indigo-700 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    Focused
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedCategories(buildExpandedCategoryDefaults(context))}
                    className="rounded-md px-2.5 py-1 text-xs font-semibold text-gray-600 transition hover:text-gray-900"
                  >
                    Expanded
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedCategories(MARKET_PULSE_CATEGORIES)}
                    className="rounded-md px-2.5 py-1 text-xs font-semibold text-gray-600 transition hover:text-gray-900"
                  >
                    All
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {MARKET_PULSE_CATEGORIES.map((category) => {
                  const active = selectedCategories.includes(category);
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => toggleCategory(category)}
                      className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                        active ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {toTitle(category)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={runScan}
                disabled={running || loadingContext || selectedCategories.length === 0}
                className="inline-flex min-h-[56px] items-center gap-3 rounded-2xl bg-gray-900 px-7 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-50"
              >
                <Sparkles className="h-5 w-5" />
                {running ? 'Running scan...' : 'Run Market Pulse'}
              </button>
              {running && runId && (
                <button
                  type="button"
                  onClick={stopScan}
                  disabled={cancelLoading}
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                >
                  {cancelLoading ? 'Stopping...' : 'Stop scan'}
                </button>
              )}
              {runResult?.run?.created_at && (
                <span className="text-sm text-gray-500">Last run: {new Date(runResult.run.created_at).toLocaleString()}</span>
              )}
              {activeScanStatusPanel}
            </div>
            {context && (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Market Focus</div>
                  <div className="mt-1">{context.marketPulseProfile.effective_market_focus?.join(', ') || 'Not set'}</div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Domain Role</div>
                  <div className="mt-1">{context.marketPulseProfile.domain_role || context.marketPulseProfile.provider_type || 'Not set'}</div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Policy Sensitivity</div>
                  <div className="mt-1">{context.marketPulseProfile.regulatory_policy_sensitivity?.join(', ') || 'Not set'}</div>
                </div>
              </div>
            )}
              </div>
            )}
          </section>

          {runResult && runResult.findings.length > 0 && (
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <DimensionFilters
                activeDimension={activeDimension}
                counts={dimensionCounts}
                onChange={setActiveDimension}
              />
              <AttentionFilters
                activeFilter={activeAttentionFilter}
                counts={attentionCounts}
                onChange={setActiveAttentionFilter}
              />
            </div>
          )}

          {runResult && dimensionRankedFindings.length > 0 && (
            <ExecutiveScanStrip findings={dimensionRankedFindings} />
          )}

          {runResult && (
            <SinceLastPulseStrip delta={filteredMarketDeltaSummary} />
          )}

          {runResult && visibleRankedFindings.length > 1 && (
            <MarketNarrativesSection findings={visibleRankedFindings} />
          )}

          {runResult && runResult.findings.length > 0 && visibleRankedFindings.length === 0 && (
            <section className="rounded-2xl border border-dashed border-slate-200 bg-white p-5 text-sm text-slate-500">
              No Market Pulse findings match these filters yet.
            </section>
          )}

          {/* Phase 1B FEED — tier-grouped, action-rail-equipped finding cards.
              Replaces the four impact-grouped lists in the legacy Results section
              when at least one finding has a priority_tier (i.e. post-1A run). */}
          {runResult && runResult.findings.length > 0 && hasPrioritizedFeed && (
            <FeedSection
              tieredFindings={tieredFindings}
              actioningFindingId={actioningFindingId}
              findingStateOverrides={findingStateOverrides}
              performFindingAction={performFindingAction}
            />
          )}

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-indigo-600" />
              <h4 className="text-sm font-semibold text-gray-900">
                {hasPrioritizedFeed ? 'Run summary' : 'Results'}
              </h4>
            </div>

            {!runResult && pendingRun && (
              <div className="mb-4">
                <EngineJobStatusPanel
                  status={String(pendingRun.status).toUpperCase()}
                  progressStage={pendingRun.progress_stage}
                  createdAt={pendingRun.created_at}
                  durationHint="Typically 1-5 min depending on regions and research mode"
                />
              </div>
            )}

            {runResult?.run?.status && ['pending', 'running', 'completed', 'completed_with_warnings', 'failed'].includes(String(runResult.run.status).toLowerCase()) && (
              <div className="mb-4">
                <EngineJobStatusPanel
                  status={String(runResult.run.status).toUpperCase()}
                  progressStage={runResult.run.progress_stage}
                  confidenceIndex={runResult.run.confidence_index}
                  error={runResult.run.legacy_error}
                  createdAt={runResult.run.created_at}
                  durationHint="Typically 1-5 min depending on regions and research mode"
                />
              </div>
            )}

            {!runResult && <div className="text-sm text-gray-500">Run a scan to see structured Market Pulse findings here.</div>}

            {runResult && (
              <div className="space-y-6">
                {/* Phase 1A: executive summary chip — surfaces strategic_summary
                    that the legacy consolidator already produced but V2 sync
                    was dropping on the floor. */}
                {runResult.run.strategic_summary && (
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-700">Executive summary</div>
                    <p className="mt-2 text-sm text-indigo-900">{runResult.run.strategic_summary}</p>
                  </div>
                )}

                {/* Phase 1A: "What changed since last run" diff strip — combines
                    change_status counts (new/updated/unchanged/resolved) with
                    priority-tier counts (P0/P1/P2). */}
                {runResult.findings.length > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">What changed</span>
                      {changeDiff.new > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                          {changeDiff.new} new
                        </span>
                      )}
                      {changeDiff.updated > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          {changeDiff.updated} updated
                        </span>
                      )}
                      {changeDiff.resolved > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          {changeDiff.resolved} resolved
                        </span>
                      )}
                      {changeDiff.unchanged > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                          {changeDiff.unchanged} unchanged
                        </span>
                      )}
                      <span className="ml-2 inline-flex items-center gap-2 text-xs text-gray-500">
                        <span className="text-gray-400">·</span>
                        <span className="font-medium text-rose-700">{changeDiff.p0} P0</span>
                        <span className="font-medium text-amber-700">{changeDiff.p1} P1</span>
                        <span className="font-medium text-gray-500">{changeDiff.p2} P2</span>
                      </span>
                    </div>
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Status</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{toTitle(runResult.run.status)}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Findings</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{runResult.findings.length}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">New / Updated</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{groupedFindings.top.length}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Risks</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{groupedFindings.risks.length}</div>
                  </div>
                </div>

                {/* Phase 1A: surface risk_alerts the consolidator emitted. */}
                {(runResult.run.risk_alerts ?? []).length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Risk alerts</div>
                    <ul className="mt-2 space-y-1 text-sm text-amber-900">
                      {(runResult.run.risk_alerts ?? []).slice(0, 5).map((alert, idx) => (
                        <li key={idx}>• {alert}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {!hasPrioritizedFeed && [
                  { title: 'Top Strategic Findings', items: groupedFindings.top },
                  { title: 'Risk Signals', items: groupedFindings.risks },
                  { title: 'Watch List', items: groupedFindings.watch },
                  { title: 'Opportunity Signals', items: groupedFindings.opportunities },
                ].map((section) => (
                  <div key={section.title}>
                    <h5 className="mb-3 text-sm font-semibold text-gray-900">{section.title}</h5>
                    {section.items.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">No items in this section yet.</div>
                    ) : (
                      <div className="space-y-3">
                        {section.items.map((item) => {
                          // Phase 1A: priority-tier ring + colored chip; falls back
                          // to neutral gray when priority_tier is null (legacy rows).
                          const tierRing = item.priority_tier === 'P0'
                            ? 'border-rose-300 ring-1 ring-rose-200'
                            : item.priority_tier === 'P1'
                              ? 'border-amber-200'
                              : 'border-gray-200';
                          const tierBadge = item.priority_tier === 'P0'
                            ? 'bg-rose-100 text-rose-800'
                            : item.priority_tier === 'P1'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-gray-100 text-gray-700';
                          const changeBadge = item.change_status === 'new'
                            ? 'bg-blue-100 text-blue-800'
                            : item.change_status === 'updated'
                              ? 'bg-amber-100 text-amber-800'
                              : item.change_status === 'resolved'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-gray-100 text-gray-600';
                          const confidenceColor = item.confidence_score >= 75
                            ? 'text-emerald-700'
                            : item.confidence_score >= 50
                              ? 'text-amber-700'
                              : 'text-gray-500';
                          return (
                            <div key={item.id} className={`rounded-xl border p-4 ${tierRing}`}>
                              <div className="flex flex-wrap items-center gap-2">
                                {item.priority_tier && (
                                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide ${tierBadge}`}>
                                    {item.priority_tier}
                                  </span>
                                )}
                                <span className="text-sm font-semibold text-gray-900">{item.title}</span>
                                <SignificanceBadge finding={item} />
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{toTitle(item.category)}</span>
                                <span className={`rounded-full px-2 py-0.5 text-xs ${changeBadge}`}>{toTitle(item.change_status)}</span>
                              </div>
                              <SignalMovement finding={item} />
                              <p className="mt-2 text-sm text-gray-600">{item.summary}</p>
                              <p className="mt-2 text-sm text-gray-800"><strong>Why it matters:</strong> {item.why_it_matters}</p>
                              <p className="mt-1 text-sm text-gray-800"><strong>Recommended action:</strong> {item.recommended_action}</p>
                              <SignalExplainability finding={item} />
                              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                                <span className={`font-semibold ${confidenceColor}`}>
                                  Confidence {Math.round(item.confidence_score)}
                                </span>
                                <span className="text-gray-500">·</span>
                                <span className="font-semibold text-gray-700">Relevance {Math.round(item.relevance_score)}</span>
                                {typeof item.company_alignment_score === 'number' && (
                                  <>
                                    <span className="text-gray-500">·</span>
                                    <span className="font-semibold text-indigo-700">
                                      Alignment {Math.round((item.company_alignment_score ?? 0) * 100)}
                                    </span>
                                  </>
                                )}
                                <span className="text-gray-500">·</span>
                                <span className="text-gray-500">Regions: {item.regions?.length ? item.regions.join(', ') : 'Global'}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h4 className="text-sm font-semibold text-gray-900">Recent runs</h4>
            <div className="mt-4 space-y-3">
              {history.length === 0 ? (
                <div className="text-sm text-gray-500">No Market Pulse history yet.</div>
              ) : (
                history.map((item) => (
                  <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{toTitle(item.status)}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600">{toTitle(item.objective)}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600">{item.mode === 'automated' ? 'Automated' : 'One-time'}</span>
                    </div>
                    <div className="mt-2 text-xs text-gray-500">
                      {new Date(item.created_at).toLocaleString()} · Credits: {item.credits_consumed ?? 0}
                    </div>
                    <div className="mt-2 text-sm text-gray-600">
                      {(item.categories || []).map(toTitle).join(', ') || 'No categories'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              <h4 className="text-sm font-semibold text-gray-900">Automation</h4>
            </div>
            <p className="text-sm text-gray-600">
              When enabled, the Market Pulse cron runs once per UTC day (~04:30) for your company using the settings saved here. Each successful automated scan consumes credits.
            </p>
            <label className="mt-4 flex items-start gap-3 text-sm text-gray-700">
              <input type="checkbox" checked={automationEnabled} onChange={(e) => setAutomationEnabled(e.target.checked)} className="mt-1" />
              <span>Enable daily Market Pulse monitoring</span>
            </label>
            <label className="mt-3 flex items-start gap-3 text-sm text-gray-700">
              <input type="checkbox" checked={creditAcknowledged} onChange={(e) => setCreditAcknowledged(e.target.checked)} className="mt-1" />
              <span>I understand automated scans will consume credits on each completed run.</span>
            </label>
            <button type="button" onClick={saveAutomation} disabled={automationLoading || (automationEnabled && !creditAcknowledged)} className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50">
              {automationLoading ? 'Saving...' : 'Save automation'}
            </button>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h4 className="text-sm font-semibold text-gray-900">Profile-backed defaults</h4>
            <div className="mt-3 space-y-2 text-sm text-gray-600">
              <div><strong>Market focus:</strong> {context?.marketPulseProfile.effective_market_focus?.join(', ') || 'Not set'}</div>
              <div><strong>Domain role:</strong> {context?.marketPulseProfile.domain_role || context?.marketPulseProfile.provider_type || 'Not set'}</div>
              <div><strong>Solution domains:</strong> {context?.marketPulseProfile.solution_domains?.join(', ') || 'Not set'}</div>
              <div><strong>Policy sensitivity:</strong> {context?.marketPulseProfile.regulatory_policy_sensitivity?.join(', ') || 'Not set'}</div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

