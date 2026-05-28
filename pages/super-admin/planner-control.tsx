/**
 * /super-admin/planner-control
 *
 * Operational control panel for the planner platform. Wraps the
 * `usePlannerControl` hook + the panel components and lays them out in a
 * single scrollable page with a global "auto-refresh" toggle.
 *
 * Role gate: SUPER_ADMIN. The hook checks the super-admin cookie + the
 * authenticated user role and redirects to /login when neither passes.
 */

import React from 'react';
import Head from 'next/head';
import { usePlannerControl } from '../../hooks/usePlannerControl';
import { Card, StatusBadge, relativeTimeMs } from '../../components/super-admin/planner-control/PrimitiveTiles';
import RolloutPanel from '../../components/super-admin/planner-control/RolloutPanel';
import {
  OverloadPanel, SemaphorePanel, ProviderBucketPanel,
  StreamLagPanel, RefinementAndSsePanel, CanaryGatePanel,
} from '../../components/super-admin/planner-control/InfraPanels';
import { AlertCountersPanel, AuditTrailPanel } from '../../components/super-admin/planner-control/AuditAndCountersPanel';
import EmergencyPanel from '../../components/super-admin/planner-control/EmergencyPanel';
import FeatureGovernancePanel from '../../components/super-admin/planner-control/FeatureGovernancePanel';

export default function PlannerControlPage() {
  const {
    isSuperAdmin, authResolved,
    data, loading, error,
    refetch, autoRefresh, setAutoRefresh,
    pendingAction, lastActionResult,
    callRollout, callFeature, callForceMode,
  } = usePlannerControl();

  if (!authResolved) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">
        Resolving super-admin session…
      </div>
    );
  }
  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">
        Access denied.
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Planner control · super-admin</title>
      </Head>
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-7xl mx-auto px-6 pt-6 pb-12">
          {/* Top nav (matches other super-admin pages) */}
          <nav className="flex flex-wrap items-center gap-2 text-xs mb-4">
            <span className="text-gray-500">Operational tooling:</span>
            <a href="/super-admin/system-health" className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 font-medium text-gray-700 hover:bg-gray-50">System health</a>
            <a href="/super-admin/oauth-health" className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 font-medium text-gray-700 hover:bg-gray-50">OAuth health</a>
            <a href="/super-admin/planner-control" className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 font-medium text-indigo-700">Planner control</a>
            <a href="/super-admin/dashboard" className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 font-medium text-gray-700 hover:bg-gray-50">Dashboard</a>
          </nav>

          <header className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Planner control</h1>
              <p className="text-sm text-slate-500">
                Live rollout, overload, semaphore, bucket, stream + feature governance for the planner platform.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {data?.ops_snapshot && (
                <span className="text-xs text-slate-500">
                  Snapshot {relativeTimeMs(data.ops_snapshot.taken_at_ms)}
                </span>
              )}
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                />
                auto-refresh (5s)
              </label>
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={loading}
                className="px-2 py-1 text-xs rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {loading ? 'Refreshing…' : 'Refresh now'}
              </button>
            </div>
          </header>

          {/* Action result banner */}
          {lastActionResult && (
            <div
              className={[
                'rounded-md border px-3 py-2 mb-3 text-xs',
                lastActionResult.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800',
              ].join(' ')}
            >
              <strong>{lastActionResult.ok ? 'OK' : 'Failed'}:</strong> {lastActionResult.message}
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 text-rose-800 text-xs px-3 py-2 mb-3">
              <strong>Inspect fetch failed:</strong> {error}
            </div>
          )}

          {/* Loading skeleton on first load */}
          {!data && loading && (
            <Card>
              <div className="text-xs text-slate-500">Loading planner control snapshot…</div>
            </Card>
          )}

          {data && (
            <div className="space-y-3">
              {/* Row 1: Rollout (full width) */}
              <RolloutPanel
                state={data.rollout_state}
                pendingAction={pendingAction}
                callRollout={callRollout}
              />

              {/* Row 2: overload + canary gates (2 cols) */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                <OverloadPanel ops={data.ops_snapshot} />
                <CanaryGatePanel
                  gates={data.canary_gates}
                  rolloutInCanary={data.rollout_state.status === 'in_canary'}
                />
              </div>

              {/* Row 3: semaphore + provider buckets (2 cols) */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                <SemaphorePanel ops={data.ops_snapshot} splitBrain={data.split_brain_report} />
                <ProviderBucketPanel ops={data.ops_snapshot} />
              </div>

              {/* Row 4: streams + refinement/SSE */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                <StreamLagPanel ops={data.ops_snapshot} />
                <RefinementAndSsePanel
                  orphan={data.orphan_refinement}
                  sseConnections={data.active_sse_connections}
                />
              </div>

              {/* Row 5: alert counters + audit trail */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                <AlertCountersPanel ops={data.ops_snapshot} />
                <AuditTrailPanel audit={data.rollout_audit_recent} />
              </div>

              {/* Row 6: feature governance */}
              <FeatureGovernancePanel
                features={data.feature_registry}
                pendingAction={pendingAction}
                callFeature={callFeature}
              />

              {/* Row 7: emergency controls (always last — keep visually separated) */}
              <EmergencyPanel
                pendingAction={pendingAction}
                callForceMode={callForceMode}
                currentClusterMode={data.ops_snapshot.cluster_overload?.mode}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
