import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCompanyContext } from '@/components/CompanyContext';
import IntelligenceWorkspace, {
  type IntelligenceWorkspaceView,
} from '@/components/dashboard/IntelligenceWorkspace';

type GrowthGuidanceAlert = {
  type: 'critical_attention' | 'readiness_signal' | 'progress_signal' | 'stalled_execution' | 'missing_intelligence' | 'next_step' | 'upgrade_preview';
  severity: 'high' | 'medium' | 'low';
  message: string;
  action_hint?: string;
  impact?: string;
  effort?: 'low' | 'medium' | 'high';
  category_rank: number;
  action_id?: string;
  action_key?: string;
  action_status?: 'pending' | 'in_progress' | 'completed';
  validation_failed?: boolean;
  action_feedback?: string;
};

type GrowthGuidancePayload = {
  companyId: string;
  generatedAt: string;
  readiness: {
    stage: 'no_signal' | 'early_signal' | 'consistent_signal' | 'ready_to_scale';
    score: number;
  };
  executionMetrics?: {
    total_actions: number;
    completed_actions: number;
    pending_actions: number;
    completion_rate: number;
    avg_completion_time_days: number;
  };
  alerts: GrowthGuidanceAlert[];
};

const GUIDANCE_GROUP_ORDER: Array<GrowthGuidanceAlert['type']> = [
  'critical_attention',
  'readiness_signal',
  'progress_signal',
  'stalled_execution',
  'missing_intelligence',
  'next_step',
  'upgrade_preview',
];

function getQueryString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && value[0]) return String(value[0]).trim();
  return '';
}

function formatGuidanceLabel(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function CMOIntelligenceDashboard() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const [activeView, setActiveView] = useState<IntelligenceWorkspaceView>(() => {
    const view = getQueryString(router.query.intelTab);
    if (view === 'market-pulse' || view === 'active-leads') {
      return view;
    }
    return 'market-pulse';
  });

  useEffect(() => {
    const view = getQueryString(router.query.intelTab);
    if (view === 'intelligence') {
      const companyIdQuery = getQueryString(router.query.companyId);
      void router.replace(
        companyIdQuery ? `/intelligence?companyId=${encodeURIComponent(companyIdQuery)}` : '/intelligence'
      );
      return;
    }
    if (view === 'market-pulse' || view === 'active-leads') {
      setActiveView(view);
      return;
    }
    setActiveView('market-pulse');
  }, [router, router.query.companyId, router.query.intelTab]);

  const companyId = useMemo(
    () => getQueryString(router.query.companyId) || selectedCompanyId || '',
    [router.query.companyId, selectedCompanyId]
  );
  const [guidance, setGuidance] = useState<GrowthGuidancePayload | null>(null);
  const [guidanceLoading, setGuidanceLoading] = useState(false);
  const [updatingActionId, setUpdatingActionId] = useState<string | null>(null);
  const groupedGuidance = useMemo(() => {
    const groups = new Map<GrowthGuidanceAlert['type'], GrowthGuidanceAlert[]>();
    for (const type of GUIDANCE_GROUP_ORDER) groups.set(type, []);

    for (const alert of guidance?.alerts ?? []) {
      const current = groups.get(alert.type) ?? [];
      current.push(alert);
      groups.set(alert.type, current);
    }

    return GUIDANCE_GROUP_ORDER
      .map((type) => ({
        type,
        label: formatGuidanceLabel(type),
        alerts: groups.get(type) ?? [],
      }))
      .filter((group) => group.alerts.length > 0);
  }, [guidance]);

  useEffect(() => {
    if (!companyId) {
      setGuidance(null);
      return;
    }

    let cancelled = false;

    const loadGuidance = async () => {
      setGuidanceLoading(true);
      try {
        const response = await fetch(`/api/dashboard/growth-guidance?companyId=${encodeURIComponent(companyId)}`, {
          credentials: 'include',
        });
        if (!response.ok) {
          throw new Error('Failed to load growth guidance');
        }
        const payload = await response.json() as GrowthGuidancePayload;
        if (!cancelled) {
          setGuidance(payload);
        }
      } catch (error) {
        console.error('[dashboard/intelligence] growth guidance load failed:', error);
        if (!cancelled) {
          setGuidance(null);
        }
      } finally {
        if (!cancelled) {
          setGuidanceLoading(false);
        }
      }
    };

    void loadGuidance();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const updateGuidanceAction = async (
    actionId: string,
    status: 'in_progress' | 'completed',
  ) => {
    setUpdatingActionId(actionId);
    try {
      const response = await fetch('/api/intelligence/action/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          action_id: actionId,
          status,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update action');
      }

      const payload = await response.json() as {
        status?: 'pending' | 'in_progress' | 'completed';
        validation_failed?: boolean;
        message?: string | null;
      };

      setGuidance((current) => {
        if (!current) return current;
        return {
          ...current,
          alerts: current.alerts.map((alert) =>
            alert.action_id === actionId
              ? {
                  ...alert,
                  action_status: payload.status ?? status,
                  validation_failed: payload.validation_failed ?? false,
                  action_feedback: payload.message ?? undefined,
                }
              : alert
          ),
        };
      });
    } catch (error) {
      console.error('[dashboard/intelligence] action update failed:', error);
    } finally {
      setUpdatingActionId(null);
    }
  };

  if (!companyId) {
    return (
      <>
        <Head>
          <title>CMO Intelligence Dashboard</title>
        </Head>
        <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-gray-50 to-gray-100 px-3 py-8 sm:px-4 lg:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="rounded-[28px] border border-white/80 bg-white/92 p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
              <h1 className="text-3xl font-bold tracking-tight text-gray-900">Signals Workspace</h1>
              <p className="mt-3 text-sm leading-relaxed text-gray-600 md:text-base">
                Select a company to review market signals and active leads.
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Signals Workspace</title>
      </Head>

      <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-gray-50 to-gray-100 px-3 py-8 sm:px-4 lg:px-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="px-1">
            <h2 className="text-3xl font-bold tracking-tight text-gray-950 md:text-[2rem]">
              What you should focus on right now
            </h2>
          </div>

          <div className="rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-600">
                  Growth Guidance
                </p>
                <h3 className="text-2xl font-bold tracking-tight text-gray-900 md:text-3xl">
                  What matters most right now
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600 md:text-base">
                  Guidance adapts to current publishing, campaign, engagement, and integration signal. It works even
                  before analytics is connected.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:w-[280px]">
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-600">
                    Readiness Stage
                  </p>
                  <p className="mt-1 text-base font-semibold capitalize text-emerald-950">
                    {guidance?.readiness.stage?.replace(/_/g, ' ') || (guidanceLoading ? 'Loading' : 'Unavailable')}
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                    Readiness Score
                  </p>
                  <p className="mt-1 text-base font-semibold text-gray-900">
                    {typeof guidance?.readiness.score === 'number' ? `${guidance.readiness.score}/100` : (guidanceLoading ? '...' : '--')}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Execution Progress</p>
                <p className="mt-1 text-base font-semibold text-gray-900">
                  {typeof guidance?.executionMetrics?.completion_rate === 'number'
                    ? `${Math.round(guidance.executionMetrics.completion_rate * 100)}%`
                    : '--'}
                </p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Completed vs Pending</p>
                <p className="mt-1 text-base font-semibold text-gray-900">
                  {typeof guidance?.executionMetrics?.completed_actions === 'number' && typeof guidance?.executionMetrics?.pending_actions === 'number'
                    ? `${guidance.executionMetrics.completed_actions} / ${guidance.executionMetrics.pending_actions}`
                    : '--'}
                </p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Avg Completion Time</p>
                <p className="mt-1 text-base font-semibold text-gray-900">
                  {typeof guidance?.executionMetrics?.avg_completion_time_days === 'number'
                    ? `${guidance.executionMetrics.avg_completion_time_days}d`
                    : '--'}
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-5">
              {groupedGuidance.map((group) => (
                <section key={group.type} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-gray-200" />
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                      {group.label}
                    </p>
                    <div className="h-px flex-1 bg-gray-200" />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {group.alerts.map((alert, index) => {
                      const accent =
                        alert.type === 'critical_attention'
                          ? 'border-red-200 bg-red-50'
                          : alert.type === 'readiness_signal'
                            ? 'border-blue-200 bg-blue-50'
                            : alert.type === 'progress_signal'
                              ? 'border-emerald-200 bg-emerald-50'
                              : alert.type === 'stalled_execution'
                                ? 'border-orange-200 bg-orange-50'
                              : alert.type === 'missing_intelligence'
                                ? 'border-amber-200 bg-amber-50'
                                : alert.type === 'next_step'
                                  ? 'border-teal-200 bg-teal-50'
                                  : 'border-violet-200 bg-violet-50';

                      const severityClass =
                        alert.severity === 'high'
                          ? 'bg-red-100 text-red-700'
                          : alert.severity === 'medium'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-100 text-emerald-700';
                      const hasAction = Boolean(alert.action_id);
                      const statusLabel =
                        alert.action_status === 'in_progress'
                          ? 'In Progress'
                          : alert.action_status === 'completed'
                            ? 'Completed'
                            : 'Pending';
                      const statusClass =
                        alert.action_status === 'in_progress'
                          ? 'bg-blue-100 text-blue-700'
                          : alert.action_status === 'completed'
                            ? 'bg-gray-200 text-gray-600'
                            : 'bg-gray-100 text-gray-700';
                      const cardStateClass =
                        alert.action_status === 'completed'
                          ? 'opacity-70'
                          : alert.action_status === 'in_progress'
                            ? 'ring-1 ring-blue-200'
                            : '';

                      return (
                        <div key={`${alert.type}-${index}`} className={`rounded-2xl border px-4 py-4 ${accent} ${cardStateClass}`}>
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                              {group.label}
                            </p>
                            <div className="flex items-center gap-2">
                              {hasAction && (
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClass}`}>
                                  {statusLabel}
                                </span>
                              )}
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${severityClass}`}>
                                {alert.severity}
                              </span>
                            </div>
                          </div>
                          <p className="mt-2 text-sm font-medium leading-6 text-gray-900">{alert.message}</p>
                          {alert.action_hint && (
                            <p className="mt-2 text-sm text-gray-700">
                              <span className="font-semibold">Next action:</span> {alert.action_hint}
                            </p>
                          )}
                          {alert.impact && <p className="mt-1 text-xs text-gray-600">{alert.impact}</p>}
                          {alert.effort && (
                            <p className="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-gray-500">
                              Effort: {alert.effort}
                            </p>
                          )}
                          {alert.action_feedback && (
                            <p className="mt-2 text-xs text-amber-700">
                              {alert.action_feedback}
                            </p>
                          )}
                          {hasAction && alert.action_id && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={updatingActionId === alert.action_id || alert.action_status === 'completed'}
                                onClick={() => updateGuidanceAction(alert.action_id!, 'in_progress')}
                                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Mark as In Progress
                              </button>
                              <button
                                type="button"
                                disabled={updatingActionId === alert.action_id || alert.action_status === 'completed'}
                                onClick={() => updateGuidanceAction(alert.action_id!, 'completed')}
                                className="rounded-full border border-emerald-200 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Mark as Done
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}

              {!guidanceLoading && (!guidance || guidance.alerts.length === 0) && (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-500">
                  Growth guidance will appear here as soon as the company has enough baseline publishing, campaign, or
                  engagement state to evaluate.
                </div>
              )}

              {guidanceLoading && (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-500">
                  Loading growth guidance...
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-end">
              <div className="max-w-3xl">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                  Intelligence System
                </p>
                <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">Review live signals</h1>
                <p className="mt-3 text-sm leading-relaxed text-gray-600 md:text-base">
                  Use this workspace only for Market Pulse and Active Leads. Strategic Intelligence now lives on its own
                  dedicated page.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:w-[240px]">
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Views</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">2</p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Focus</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">Signals</p>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Designed For</p>
                <p className="mt-1 text-sm text-gray-700">
                  Teams reviewing market movement and buyer-intent signals without mixing them with the main
                  intelligence page.
                </p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Decision Quality</p>
                <p className="mt-1 text-sm text-gray-700">
                  Keeps Market Pulse and Active Leads together while leaving broader Intelligence on its own operating
                  page.
                </p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Output Standard</p>
                <p className="mt-1 text-sm text-gray-700">
                  A cleaner two-view shell focused only on signals that need active monitoring and action.
                </p>
              </div>
            </div>
          </div>

          <IntelligenceWorkspace
            companyId={companyId}
            activeView={activeView}
            onViewChange={setActiveView}
            fetchWithAuth={(input, init) =>
              fetch(input, {
                ...init,
                credentials: 'include',
              })
            }
          />
        </div>
      </div>
    </>
  );
}
