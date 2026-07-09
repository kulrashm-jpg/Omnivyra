/** ExecutiveMarketPulseExperience — thin composition: controller + verbatim JSX. */
import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  History,
  Eye,
  Flag,
  GitBranch,
  MessageSquare,
  Radio,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  UserCheck,
} from 'lucide-react';
import { useExecutiveMarketPulseController, VIEWS, WATCHLIST_TYPES, LIFECYCLE_STEPS, asArray, score, label, DigestCard, LifecycleRail, MetricBar, SkeletonBlock, TooltipText, PersonPill } from './ExecutiveMarketPulseController';

export default function ExecutiveMarketPulseExperience(props: Parameters<typeof useExecutiveMarketPulseController>[0]) {
  const f = useExecutiveMarketPulseController(props);
  const {
    companyId, fetchWithAuth, routeMode, externalSection,
    SectionToggle, acknowledgeSelected, activeView, addComment, annotation, attentionManagement, benchmarkingCohorts,
    benchmarkingReadiness, busyAction, collaboration, comment, comparative, createInvestigation, criticalCount, decision,
    degradedContext, departmentFilter, digestItems, escalationEvents, expandedSections, governanceSafety, groupedThemes,
    heldEscalations, historicalTimeline, intentFilter, lifecycleFilter, loadContext, loadError, loading, operationalHealth,
    opportunities, overview, overviewPayload, payload, people, peopleSearch, personById, postCollaboration, refinedDigest,
    resilience, saveAnnotation, saveDecision, saveWatchlist, selectedAnnotations, selectedAssignmentHistory, selectedComments,
    selectedDecisions, selectedId, selectedItem, selectedRef, selectedThreads, setActiveView, setAnnotation, setBusyAction,
    setComment, setDecision, setDepartmentFilter, setExpandedSections, setIntentFilter, setLifecycleFilter, setLoadError, setLoading,
    setPayload, setPeople, setPeopleSearch, setSelectedId, setSeverityFilter, setThreadForm, setWatchlistForm, severityFilter,
    stabilizingCount, threadForm, unresolvedCritical, updateThreadStatus, watchlistForm, worseningCount
  } = f;
  return (
    <div className="space-y-5">
      {routeMode && (
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-4">
            <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="all">All severity</option>
              <option value="critical">Critical</option>
              <option value="elevated">Elevated</option>
              <option value="low">Low</option>
            </select>
            <select value={lifecycleFilter} onChange={(event) => setLifecycleFilter(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="all">All lifecycle</option>
              {LIFECYCLE_STEPS.map((step) => <option key={step} value={step}>{label(step)}</option>)}
            </select>
            <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="all">All departments</option>
              <option value="compliance">Compliance</option>
              <option value="workforce">Workforce</option>
              <option value="technology">Technology</option>
              <option value="operations">Operations</option>
              <option value="revenue">Revenue</option>
            </select>
            <select value={intentFilter} onChange={(event) => setIntentFilter(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="all">Strategic + operational</option>
              <option value="strategic">Strategic only</option>
              <option value="operational">Operational only</option>
            </select>
          </div>
          {loadError && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              MarketPulse loaded a protected fallback state: {loadError}
            </div>
          )}
        </section>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-600">
              <Radio className="h-4 w-4" />
              Executive MarketPulse
            </div>
            <h2 className="mt-2 text-2xl font-bold text-gray-950">Business exposure intelligence</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
              Material pressures, digest items, lifecycle state, and team investigation context are grouped for executive review.
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadContext()}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              onClick={() => setActiveView(view.id)}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                activeView === view.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {view.label}
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <AlertTriangle className="h-4 w-4" />
              Critical
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-950">{criticalCount}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Flag className="h-4 w-4" />
              Worsening
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-950">{worseningCount}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <CheckCircle2 className="h-4 w-4" />
              Stabilizing
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-950">{stabilizingCount}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Bell className="h-4 w-4" />
              Attention Held
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-950">{heldEscalations}</p>
          </div>
        </div>

        {routeMode && (
          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-gray-950">Operational health</p>
                <TooltipText text="Summarizes synthesis, retrieval, validation, and timeline pressure. It is operational telemetry, not business forecasting." />
              </div>
              <p className="mt-2 text-lg font-bold text-gray-950">{label(operationalHealth?.health_status ?? 'unknown')}</p>
              <p className="mt-1 text-xs leading-5 text-gray-500">{operationalHealth?.summary || 'Health summary will appear after production synthesis runs.'}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm font-semibold text-gray-950">Resilience guards</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
                <span className="rounded border border-gray-200 bg-gray-50 px-2 py-1">Timeout {resilience?.synthesis_timeout_ms ?? 9000}ms</span>
                <span className="rounded border border-gray-200 bg-gray-50 px-2 py-1">Partial load {resilience?.partial_load_resilience ? 'on' : 'ready'}</span>
                <span className="rounded border border-gray-200 bg-gray-50 px-2 py-1">Payload {label(resilience?.payload_pressure ?? 'normal')}</span>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm font-semibold text-gray-950">Attention controls</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded border border-gray-100 bg-gray-50 p-2">
                  <p className="font-semibold text-gray-950">{attentionManagement?.repeated_timeline_events_collapsed ?? 0}</p>
                  <p className="text-gray-500">collapsed</p>
                </div>
                <div className="rounded border border-gray-100 bg-gray-50 p-2">
                  <p className="font-semibold text-gray-950">{attentionManagement?.held_escalations ?? heldEscalations}</p>
                  <p className="text-gray-500">held</p>
                </div>
                <div className="rounded border border-gray-100 bg-gray-50 p-2">
                  <p className="font-semibold text-gray-950">{attentionManagement?.low_confidence_items_suppressed ?? 0}</p>
                  <p className="text-gray-500">quieted</p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-950">What changed materially</p>
            <TooltipText text="This compares the current executive digest with the latest stored comparative snapshot. It is descriptive, not predictive." />
          </div>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            {comparative?.material_change_summary || overviewPayload.summary || (loading ? 'Loading executive digest...' : 'No material MarketPulse executive digest is available yet.')}
          </p>
          {comparative && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-600">
              <span className="rounded border border-gray-200 bg-white px-2 py-1">{label(comparative.change_direction)}</span>
              <span className="rounded border border-gray-200 bg-white px-2 py-1">Severity delta {Number(comparative.severity_delta ?? 0)}</span>
              <span className="rounded border border-gray-200 bg-white px-2 py-1">{comparative.evidence_count ?? 0} evidence points</span>
            </div>
          )}
        </div>

        {groupedThemes.length > 0 && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-gray-950">Grouped executive themes</p>
              <span className="text-xs text-gray-500">{groupedThemes.length} themes</span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {groupedThemes.slice(0, 4).map((theme: any) => (
                <div key={theme.theme} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <p className="text-xs font-semibold text-gray-500">{label(theme.theme)}</p>
                  <p className="mt-1 text-sm font-medium text-gray-950">{theme.count} items</p>
                  <p className="mt-1 text-xs text-gray-500">Max severity {theme.max_severity} / confidence {theme.average_confidence}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {routeMode && (
          <div className="mt-4 grid gap-3 lg:grid-cols-4">
            {[
              ['Why now?', refinedDigest.why_now],
              ['What changed?', refinedDigest.what_changed],
              ['What stabilized?', refinedDigest.what_stabilized],
              ['Requires attention', refinedDigest.what_requires_attention],
            ].map(([title, values]: any) => (
              <div key={title} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">{title}</p>
                <div className="mt-2 space-y-2">
                  {asArray(values).slice(0, 2).map((value, index) => (
                    <p key={`${title}-${index}`} className="text-sm leading-5 text-gray-800">{String(value)}</p>
                  ))}
                  {asArray(values).length === 0 && <p className="text-sm text-gray-500">No material item.</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {routeMode && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-950">Benchmarking readiness</p>
              <TooltipText text="Prepared baseline metadata for future peer, industry, and sector comparisons. Full benchmarking is not enabled in this phase." />
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-4">
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Readiness</p>
                <p className="mt-1 text-sm font-semibold text-gray-950">{label(benchmarkingReadiness?.status)}</p>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Peer relative</p>
                <p className="mt-1 text-sm font-semibold text-gray-950">{benchmarkingReadiness?.peer_relative?.implemented ? 'Enabled' : 'Schema ready'}</p>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Industry relative</p>
                <p className="mt-1 text-sm font-semibold text-gray-950">{benchmarkingReadiness?.industry_relative?.implemented ? 'Enabled' : 'Schema ready'}</p>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Historical self</p>
                <p className="mt-1 text-sm font-semibold text-gray-950">{benchmarkingReadiness?.historical_self_baseline?.implemented ? 'Ready' : 'Pending'}</p>
              </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {benchmarkingCohorts.slice(0, 3).map((cohort: any) => (
                <div key={cohort.id ?? `${cohort.cohort_type}-${cohort.cohort_label}`} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <p className="text-xs font-semibold text-gray-500">{label(cohort.cohort_type)}</p>
                  <p className="mt-1 truncate text-sm font-semibold text-gray-950">{cohort.cohort_label}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Sample {cohort.sample_size ?? 0} / Confidence {score(cohort.confidence)}
                  </p>
                </div>
              ))}
              {benchmarkingCohorts.length === 0 && (
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-gray-500 md:col-span-3">
                  Benchmark cohorts will appear after readiness synthesis has enough internal MarketPulse dimensions.
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.65fr)]">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-950">Prioritized digest</h3>
            <span className="text-sm text-gray-500">{digestItems.length} items</span>
          </div>
          {loading && digestItems.length === 0 ? (
            <div className="grid gap-3">
              <SkeletonBlock className="h-36" />
              <SkeletonBlock className="h-36" />
              <SkeletonBlock className="h-36" />
            </div>
          ) : digestItems.length > 0 ? (
            <div className="grid gap-3">
              {digestItems.slice(0, 10).map((item) => (
                <DigestCard
                  key={item.id}
                  item={item}
                  active={selectedItem?.id === item.id}
                  onSelect={() => setSelectedId(item.id)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white p-5 text-sm text-gray-500">
              {loading ? 'Loading digest items...' : 'No digest items for this view yet.'}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-950">Selected intelligence</p>
                <p className="mt-1 text-sm leading-6 text-gray-600">{selectedItem?.summary || 'Select a digest item.'}</p>
              </div>
              <Eye className="h-5 w-5 text-gray-400" />
            </div>
            {selectedItem && (
              <div className="mt-4 space-y-3">
                <MetricBar labelText="Severity" value={score(selectedItem.severity)} />
                <MetricBar labelText="Confidence" value={score(selectedItem.confidence)} />
                <LifecycleRail state={selectedItem.lifecycle_state} />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => acknowledgeSelected('reviewed')}
                    disabled={Boolean(busyAction)}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Acknowledge
                  </button>
                  <button
                    type="button"
                    onClick={() => acknowledgeSelected('monitoring')}
                    disabled={Boolean(busyAction)}
                    className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                  >
                    Monitor
                  </button>
                  <button
                    type="button"
                    onClick={() => acknowledgeSelected('resolved')}
                    disabled={Boolean(busyAction)}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    Resolve
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <SectionToggle id="drilldown" title="Traceable drill-down" icon={GitBranch} />
            {expandedSections.drilldown && (
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="grid gap-3">
                  {['originating_signals', 'trends', 'pressures', 'impacts'].map((key) => (
                    <div key={key} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <p className="text-xs font-semibold text-gray-500">{label(key)}</p>
                      <p className="mt-1 text-sm text-gray-900">
                        {asArray(selectedItem?.drilldown_payload?.[key]).length || 0} linked
                      </p>
                    </div>
                  ))}
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <p className="text-xs font-semibold text-gray-500">Causal chain</p>
                    <div className="mt-2 space-y-2">
                      {asArray(selectedItem?.drilldown_payload?.causal_chain).slice(0, 5).map((step, index) => (
                        <div key={`${step}-${index}`} className="flex items-center gap-2 text-sm text-gray-700">
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-gray-900 text-xs text-white">{index + 1}</span>
                          <span>{String(step)}</span>
                        </div>
                      ))}
                      {asArray(selectedItem?.drilldown_payload?.causal_chain).length === 0 && (
                        <p className="text-sm text-gray-500">No causal chain attached.</p>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <p className="text-xs font-semibold text-gray-500">Contradictory evidence</p>
                      <p className="mt-1 text-sm text-gray-900">
                        {asArray(selectedItem?.drilldown_payload?.contradictory_evidence).length} items
                      </p>
                    </div>
                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <p className="text-xs font-semibold text-gray-500">Uncertainty factors</p>
                      <p className="mt-1 text-sm text-gray-900">
                        {asArray(selectedItem?.drilldown_payload?.uncertainty_factors).length} factors
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <SectionToggle id="investigation" title="Investigation workspace" icon={ClipboardList} />
            {expandedSections.investigation && (
              <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
                <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
                  <input
                    value={threadForm.title}
                    onChange={(event) => setThreadForm((current) => ({ ...current, title: event.target.value }))}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    placeholder="Investigation title"
                  />
                  <select
                    value={threadForm.priority}
                    onChange={(event) => setThreadForm((current) => ({ ...current, priority: event.target.value }))}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <input
                  value={peopleSearch}
                  onChange={(event) => setPeopleSearch(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder="Search owner by email, role, or department"
                />
                <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
                  <select
                    value={threadForm.assignedTo}
                    onChange={(event) => {
                      const person = people.find((candidate) => candidate.id === event.target.value);
                      setThreadForm((current) => ({
                        ...current,
                        assignedTo: event.target.value,
                        assignedDepartment: person?.department ?? current.assignedDepartment,
                      }));
                    }}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">Unassigned owner</option>
                    {people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {(person.display_name || person.label)} - {label(person.department)} - {person.active_investigation_count ?? 0} active
                      </option>
                    ))}
                  </select>
                  <select
                    value={threadForm.assignedDepartment}
                    onChange={(event) => setThreadForm((current) => ({ ...current, assignedDepartment: event.target.value }))}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">No department</option>
                    <option value="leadership">Leadership</option>
                    <option value="legal_compliance">Legal/Compliance</option>
                    <option value="hr_talent">HR/Talent</option>
                    <option value="engineering_operations">Engineering/Ops</option>
                    <option value="finance_investor_relations">Finance/Investor</option>
                    <option value="go_to_market">Go To Market</option>
                    <option value="supply_chain">Supply Chain</option>
                  </select>
                </div>
                <input
                  value={threadForm.assignmentNote}
                  onChange={(event) => setThreadForm((current) => ({ ...current, assignmentNote: event.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder="Assignment note"
                />
                <button
                  type="button"
                  onClick={createInvestigation}
                  disabled={!selectedItem || Boolean(busyAction)}
                  className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  <UserCheck className="h-4 w-4" />
                  Open investigation
                </button>

                <div className="space-y-2">
                  {selectedThreads.map((thread) => (
                    <div key={thread.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-white px-2 py-1 text-xs font-medium text-gray-700">{label(thread.investigation_status)}</span>
                        <span className="rounded bg-white px-2 py-1 text-xs font-medium text-gray-700">{label(thread.priority)}</span>
                        {thread.governance_flags?.stale_unresolved && (
                          <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">Stale</span>
                        )}
                      </div>
                      <p className="mt-2 text-sm font-medium text-gray-950">{thread.title}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <PersonPill person={personById.get(thread.assigned_to ?? '')} />
                        <span className="rounded bg-white px-2 py-1 text-xs font-medium text-gray-500">
                          Department {label(thread.assigned_department)}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {['investigating', 'monitoring', 'blocked', 'resolved', 'archived'].map((status) => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => updateThreadStatus(thread.id, status)}
                            disabled={Boolean(busyAction)}
                            className="rounded border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:border-gray-300 disabled:opacity-50"
                          >
                            {label(status)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {selectedThreads.length === 0 && <p className="text-sm text-gray-500">No investigation thread for this item.</p>}
                </div>

                {selectedThreads[0] && (
                  <div className="space-y-2">
                    <textarea
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      className="min-h-[84px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      placeholder="Add investigation comment"
                    />
                    <button
                      type="button"
                      onClick={addComment}
                      disabled={!comment.trim() || Boolean(busyAction)}
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
                    >
                      <MessageSquare className="h-4 w-4" />
                      Add comment
                    </button>
                    <div className="space-y-2">
                      {selectedAssignmentHistory.slice(0, 3).map((row) => (
                        <div key={row.id} className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">
                          Reassigned from {personById.get(row.previous_assigned_to ?? '')?.display_name || row.previous_department || 'unassigned'} to {personById.get(row.new_assigned_to ?? '')?.display_name || row.new_department || 'unassigned'}.
                        </div>
                      ))}
                      {selectedComments.slice(-4).map((row) => (
                        <div key={row.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-gray-700">
                          {row.comment}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <SectionToggle id="memory" title="Decision memory" icon={ShieldCheck} />
            {expandedSections.memory && (
              <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
                <textarea
                  value={decision}
                  onChange={(event) => setDecision(event.target.value)}
                  className="min-h-[76px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder="Record decision summary"
                />
                <button
                  type="button"
                  onClick={saveDecision}
                  disabled={!decision.trim() || Boolean(busyAction)}
                  className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Save decision
                </button>
                <textarea
                  value={annotation}
                  onChange={(event) => setAnnotation(event.target.value)}
                  className="min-h-[76px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder="Add leadership annotation"
                />
                <button
                  type="button"
                  onClick={saveAnnotation}
                  disabled={!annotation.trim() || Boolean(busyAction)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
                >
                  Save annotation
                </button>
                <div className="space-y-2">
                  {selectedDecisions.slice(0, 3).map((row) => (
                    <div key={row.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <p className="text-sm font-medium text-gray-950">{row.decision_summary}</p>
                      <p className="mt-1 text-xs text-gray-500">Outcome: {label(row.outcome_status)}</p>
                    </div>
                  ))}
                  {selectedAnnotations.slice(0, 3).map((row) => (
                    <div key={row.id} className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                      <p className="text-sm text-blue-950">{row.content}</p>
                      <p className="mt-1 text-xs text-blue-700">{label(row.annotation_type)} / {label(row.visibility)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <SectionToggle id="watchlist" title="Watchlist and priority tuning" icon={SlidersHorizontal} />
            {expandedSections.watchlist && (
              <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
                <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
                  <select
                    value={watchlistForm.type}
                    onChange={(event) => setWatchlistForm((current) => ({ ...current, type: event.target.value }))}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    {WATCHLIST_TYPES.map((type) => <option key={type} value={type}>{label(type)}</option>)}
                  </select>
                  <input
                    value={watchlistForm.value}
                    onChange={(event) => setWatchlistForm((current) => ({ ...current, value: event.target.value }))}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    placeholder="Topic, region, competitor, or regulation"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={watchlistForm.priority}
                    onChange={(event) => setWatchlistForm((current) => ({ ...current, priority: event.target.value }))}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                  <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={watchlistForm.muted}
                      onChange={(event) => setWatchlistForm((current) => ({ ...current, muted: event.target.checked }))}
                    />
                    Muted
                  </label>
                  <button
                    type="button"
                    onClick={saveWatchlist}
                    disabled={!watchlistForm.value.trim() || Boolean(busyAction)}
                    className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(payload?.executiveExperience?.watchlists ?? []).slice(0, 12).map((item) => (
                    <span
                      key={`${item.watchlist_type}-${item.watchlist_value}`}
                      className={`rounded-lg border px-2 py-1 text-xs font-medium ${
                        item.muted ? 'border-gray-200 bg-gray-100 text-gray-500' : 'border-blue-100 bg-blue-50 text-blue-700'
                      }`}
                    >
                      {label(item.watchlist_type)}: {item.watchlist_value}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-950">
              <Target className="h-4 w-4 text-gray-500" />
              Attention management
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Active investigations</p>
                <p className="mt-1 text-lg font-semibold text-gray-950">{collaboration.governance?.activeThreadCount ?? 0}</p>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Stale threads</p>
                <p className="mt-1 text-lg font-semibold text-gray-950">{collaboration.governance?.staleThreadIds?.length ?? 0}</p>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Held alerts</p>
                <p className="mt-1 text-lg font-semibold text-gray-950">{heldEscalations}</p>
              </div>
              {routeMode && (
                <>
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <p className="text-xs text-gray-500">Orphan investigations</p>
                    <p className="mt-1 text-lg font-semibold text-gray-950">{governanceSafety?.orphan_investigations ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <p className="text-xs text-gray-500">Validation warnings</p>
                    <p className="mt-1 text-lg font-semibold text-gray-950">{governanceSafety?.validation_warning_count ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <p className="text-xs text-gray-500">Degraded context</p>
                    <p className="mt-1 text-lg font-semibold text-gray-950">{degradedContext?.degraded ? 'Yes' : 'No'}</p>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-950">
              <History className="h-4 w-4 text-gray-500" />
              Activity timeline
            </div>
            <div className="mt-3 space-y-2">
              {(routeMode ? historicalTimeline : [...(collaboration.acknowledgments ?? []), ...(collaboration.auditEvents ?? []), ...escalationEvents])
                .sort((a: any, b: any) => {
                  const priority = Number(b.event_priority ?? 0) - Number(a.event_priority ?? 0);
                  if (Math.abs(priority) > 20) return priority;
                  return String(b.occurred_at ?? b.created_at ?? '').localeCompare(String(a.occurred_at ?? a.created_at ?? ''));
                })
                .slice(0, 6)
                .map((event: any, index: number) => (
                  <div key={`${event.id ?? index}`} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold text-gray-500">
                        {label(event.acknowledgment_type ?? event.event_type ?? event.escalation_state ?? 'activity')}
                      </p>
                      {Number(event.coalesced_count ?? 1) > 1 && (
                        <span className="rounded bg-white px-2 py-0.5 text-[11px] font-medium text-gray-500">
                          {Number(event.coalesced_count)} coalesced
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-800">{event.event_summary ?? event.finding_summary ?? event.reason ?? event.notes ?? 'MarketPulse activity changed.'}</p>
                    <p className="mt-1 text-xs text-gray-600">{event.occurred_at || event.created_at ? new Date(event.occurred_at ?? event.created_at).toLocaleString() : 'Recent activity'}</p>
                  </div>
                ))}
              {(routeMode ? historicalTimeline.length === 0 : ((collaboration.acknowledgments ?? []).length === 0 && (collaboration.auditEvents ?? []).length === 0 && escalationEvents.length === 0)) && (
                <p className="text-sm text-gray-500">No lifecycle or escalation activity has been recorded yet.</p>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-950">
              <Search className="h-4 w-4 text-gray-500" />
              Opportunity intelligence
            </div>
            <div className="mt-3 space-y-2">
              {opportunities.slice(0, 4).map((item: any) => (
                <div key={item.id} className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                  <p className="text-sm font-medium text-emerald-950">{item.title}</p>
                  <p className="mt-1 text-xs leading-5 text-emerald-800">{item.summary}</p>
                  <p className="mt-2 text-xs font-medium text-emerald-700">{label(item.materiality_level)} / Confidence {score(item.confidence)}</p>
                </div>
              ))}
              {opportunities.length === 0 && (
                <p className="text-sm text-gray-500">No non-predictive opportunity signals have been synthesized yet.</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
