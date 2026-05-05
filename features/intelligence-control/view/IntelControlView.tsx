/**
 * Intelligence Orchestration Control Panel
 *
 * Super-admin only. Four tabs:
 *   1. Global Config     — edit priority, frequency, enabled, concurrency per job type
 *   2. Company Overrides — search company, view + edit per-job overrides
 *   3. Account Boost     — apply / remove new-account boost
 *   4. Execution Insights — aggregated runs from intelligence_execution_log
 */

import { Activity, TrendingUp } from 'lucide-react';
import type { useIntelControl } from '@/hooks/useIntelControl';
import { TABS } from '@/features/intelligence-control/constants';
import GlobalConfigTab from '@/features/intelligence-control/components/GlobalConfigTab';
import CompanyOverridesTab from '@/features/intelligence-control/components/CompanyOverridesTab';
import BoostTab from '@/features/intelligence-control/components/BoostTab';
import InsightsTab from '@/features/intelligence-control/components/InsightsTab';

type S = ReturnType<typeof useIntelControl>;

export default function IntelControlView({
  state,
  actions,
}: {
  state: S['state'];
  actions: S['actions'];
}) {
  const { tab } = state;
  const { setTab } = actions;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <Activity className="h-5 w-5 text-indigo-600" />
              <h1 className="text-xl font-bold text-gray-900">Intelligence Orchestration</h1>
              <span className="text-[10px] font-bold text-white bg-indigo-600 px-2 py-0.5 rounded-full">SUPER ADMIN</span>
            </div>
            <p className="text-sm text-gray-500">
              Control execution priority, frequency, and per-company overrides for all intelligence jobs.
            </p>
          </div>
        </div>

        {/* Resolution rule callout */}
        <div className="bg-gray-900 rounded-xl px-5 py-4 flex items-start gap-4">
          <TrendingUp className="h-5 w-5 text-indigo-400 mt-0.5 shrink-0" />
          <div className="grid grid-cols-3 gap-6 text-xs w-full">
            <div>
              <p className="text-white font-bold mb-0.5">Resolution Order</p>
              <p className="text-gray-400">Boost &gt; Company Override &gt; Global Default</p>
            </div>
            <div>
              <p className="text-white font-bold mb-0.5">Priority Scale</p>
              <p className="text-gray-400">1 = highest urgency · 10 = lowest urgency</p>
            </div>
            <div>
              <p className="text-white font-bold mb-0.5">Override Rules</p>
              <p className="text-gray-400">Only non-null override fields are applied</p>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 w-fit">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                tab === t.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          {tab === 'global' && (
            <GlobalConfigTab
              configs={state.cfgConfigs}
              loading={state.cfgLoading}
              edits={state.cfgEdits}
              saving={state.cfgSaving}
              msg={state.cfgMsg}
              load={actions.loadSchedulerConfig}
              save={actions.updateSchedulerConfig}
              setEdit={actions.setCfgEdit}
              setMsg={actions.setCfgMsg}
            />
          )}
          {tab === 'overrides' && (
            <CompanyOverridesTab
              companies={state.companies}
              search={state.ovrSearch}
              selectedId={state.ovrSelectedId}
              jobs={state.ovrJobs}
              loading={state.ovrLoading}
              expanded={state.ovrExpanded}
              editOverride={state.ovrEditOverride}
              saving={state.ovrSaving}
              deleting={state.ovrDeleting}
              msg={state.ovrMsg}
              setSearch={actions.setOvrSearch}
              setSelectedId={actions.setOvrSelectedId}
              toggleExpand={actions.toggleOvrExpand}
              setField={actions.setOvrField}
              setMsg={actions.setOvrMsg}
              loadOverrides={actions.loadOverrides}
              saveOverride={actions.createOverride}
              removeOverride={actions.deleteOverride}
            />
          )}
          {tab === 'boost' && (
            <BoostTab
              companies={state.companies}
              search={state.bstSearch}
              selectedId={state.bstSelectedId}
              duration={state.bstDuration}
              action={state.bstAction}
              loading={state.bstLoading}
              msg={state.bstMsg}
              setSearch={actions.setBstSearch}
              setSelectedId={actions.setBstSelectedId}
              setDuration={actions.setBstDuration}
              setAction={actions.setBstAction}
              setMsg={actions.setBstMsg}
              submit={actions.triggerBoost}
            />
          )}
          {tab === 'insights' && (
            <InsightsTab
              days={state.insDays}
              data={state.insData}
              loading={state.insLoading}
              error={state.insError}
              load={actions.loadInsights}
              setDays={actions.setInsDays}
            />
          )}
        </div>

      </div>
    </div>
  );
}
