import Head from 'next/head';
import Link from 'next/link';
import type { ComponentType, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Lightbulb,
  RefreshCw,
  Target,
  X,
} from 'lucide-react';

import { useCompanyContext } from '../../components/CompanyContext';

type Priority = 'low' | 'medium' | 'high';
type InsightType = 'positive' | 'negative' | 'warning';
type HealthSeverity = 'low' | 'medium' | 'high';

type DashboardSummary = {
  touchpoints: number;
  expected_events: number;
  missed_events: number;
  open_gaps: number;
  resolved_gaps: number;
};

type ActionableItem = {
  id: string;
  type: 'prompt' | 'gap';
  title: string;
  description: string;
  priority: Priority;
  confidence: number | null;
  score: number | null;
  unified_person_id: string | null;
  suggested_action: string;
};

type InsightItem = {
  type: InsightType;
  title: string;
  description: string;
  source: string;
  metric: number;
};

type HealthWarning = {
  type: 'warning';
  title: string;
  description: string;
  severity: HealthSeverity;
};

type IntelligenceDashboardResponse = {
  success: boolean;
  company_id: string;
  summary: DashboardSummary;
  actionable_items: ActionableItem[];
  insights: InsightItem[];
  health: HealthWarning[];
};

const AUTO_REFRESH_MS = 45_000;
const numberFormatter = new Intl.NumberFormat('en-US');
const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});

function formatNumber(value: number | null | undefined): string {
  const normalized = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return numberFormatter.format(normalized);
}

function formatLastUpdated(value: string | null): string {
  if (!value) {
    return 'Not refreshed yet';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Not refreshed yet';
  }

  return `Last updated ${timeFormatter.format(date)}`;
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function priorityClasses(priority: Priority): string {
  if (priority === 'high') {
    return 'border-red-200 bg-red-50 text-red-700';
  }
  if (priority === 'medium') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function insightClasses(type: InsightType): {
  border: string;
  badge: string;
  icon: ComponentType<{ className?: string }>;
} {
  if (type === 'positive') {
    return {
      border: 'border-emerald-200',
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: CheckCircle2,
    };
  }
  if (type === 'negative') {
    return {
      border: 'border-red-200',
      badge: 'bg-red-50 text-red-700 border-red-200',
      icon: CircleAlert,
    };
  }
  return {
    border: 'border-amber-200',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    icon: AlertTriangle,
  };
}

function severityClasses(severity: HealthSeverity): string {
  if (severity === 'high') {
    return 'border-red-200 bg-red-50 text-red-700';
  }
  if (severity === 'medium') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <Icon className="h-4 w-4 shrink-0 text-slate-500" />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-normal text-slate-950">{formatNumber(value)}</p>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
      {label}
    </div>
  );
}

export default function IntelligencePage() {
  const { selectedCompanyId, selectedCompanyName, isLoading: companyLoading } = useCompanyContext();
  const [dashboard, setDashboard] = useState<IntelligenceDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePrompt, setActivePrompt] = useState<ActionableItem | null>(null);
  const [responseForm, setResponseForm] = useState({
    amount: '',
    currency: 'USD',
    notes: '',
  });
  const [responseSubmitting, setResponseSubmitting] = useState(false);
  const [responseError, setResponseError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const dashboardLoadedRef = useRef(false);

  const dashboardUrl = useMemo(() => {
    if (!selectedCompanyId) {
      return '/api/intelligence/dashboard';
    }

    return `/api/intelligence/dashboard?companyId=${encodeURIComponent(selectedCompanyId)}`;
  }, [selectedCompanyId]);

  const fetchDashboard = useCallback(async (options: { background?: boolean } = {}) => {
    if (companyLoading) {
      return;
    }

    if (!selectedCompanyId) {
      dashboardLoadedRef.current = false;
      setDashboard(null);
      setError('No company selected');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const isBackgroundRefresh = options.background === true && dashboardLoadedRef.current;
    if (isBackgroundRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError(null);
    }

    try {
      const response = await fetch(dashboardUrl, { credentials: 'include' });
      const json = await response.json().catch(() => null);

      if (!response.ok) {
        if (!isBackgroundRefresh) {
          dashboardLoadedRef.current = false;
          setDashboard(null);
          setError(json?.error ?? 'Failed to load intelligence dashboard');
        }
        return;
      }

      dashboardLoadedRef.current = true;
      setDashboard(json as IntelligenceDashboardResponse);
      setLastUpdatedAt(new Date().toISOString());
    } catch {
      if (!isBackgroundRefresh) {
        dashboardLoadedRef.current = false;
        setDashboard(null);
        setError('Failed to load intelligence dashboard');
      }
    } finally {
      if (isBackgroundRefresh) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [companyLoading, dashboardUrl, selectedCompanyId]);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    if (companyLoading || !selectedCompanyId) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void fetchDashboard({ background: true });
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [companyLoading, fetchDashboard, selectedCompanyId]);

  const openPromptResponseModal = (item: ActionableItem) => {
    setActivePrompt(item);
    setResponseForm({ amount: '', currency: 'USD', notes: '' });
    setResponseError(null);
    setSuccessMessage(null);
  };

  const closePromptResponseModal = () => {
    if (responseSubmitting) return;
    setActivePrompt(null);
    setResponseError(null);
  };

  const submitPromptResponse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activePrompt) return;

    const amount = Number(String(responseForm.amount).replace(/,/g, ''));
    const currency = responseForm.currency.trim().toUpperCase() || 'USD';
    const notes = responseForm.notes.trim();

    if (!Number.isFinite(amount) || amount < 0) {
      setResponseError('Enter a valid revenue amount.');
      return;
    }

    setResponseSubmitting(true);
    setResponseError(null);

    try {
      const response = await fetch('/api/intelligence/respond', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intelligence_prompt_id: activePrompt.id,
          response_type: 'revenue_update',
          response_payload: {
            amount,
            currency,
            notes: notes || null,
          },
        }),
      });
      const json = await response.json().catch(() => null);

      if (!response.ok) {
        setResponseError(json?.error ?? 'Failed to submit prompt response.');
        return;
      }

      setActivePrompt(null);
      setResponseForm({ amount: '', currency: 'USD', notes: '' });
      setSuccessMessage('Revenue update recorded.');
      await fetchDashboard();
    } catch {
      setResponseError('Failed to submit prompt response.');
    } finally {
      setResponseSubmitting(false);
    }
  };

  const summary = dashboard?.summary ?? {
    touchpoints: 0,
    expected_events: 0,
    missed_events: 0,
    open_gaps: 0,
    resolved_gaps: 0,
  };

  const isInitialLoading = (companyLoading || loading) && !dashboard && !error;

  return (
    <>
      <Head>
        <title>Intelligence | Omnivyra</title>
      </Head>

      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto flex max-w-screen-xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-500">{selectedCompanyName || 'Current company'}</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">Intelligence</h1>
            </div>
            <button
              type="button"
              onClick={() => fetchDashboard()}
              disabled={loading || refreshing || companyLoading || !selectedCompanyId}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-50"
            >
              <RefreshCw className={classNames('h-4 w-4', (loading || refreshing) && 'animate-spin')} />
              {refreshing ? 'Refreshing' : 'Refresh'}
            </button>
          </header>

          {dashboard ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
              <span>{refreshing ? 'Refreshing dashboard...' : formatLastUpdated(lastUpdatedAt)}</span>
              <span className="h-1 w-1 rounded-full bg-slate-300" aria-hidden="true" />
              <span>Auto refresh every {AUTO_REFRESH_MS / 1000}s</span>
            </div>
          ) : null}

          {isInitialLoading ? (
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500 shadow-sm">
              Loading intelligence dashboard...
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
              {error}
            </div>
          ) : (
            <>
              {successMessage ? (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {successMessage}
                </div>
              ) : null}

              <section className="grid gap-4 sm:grid-cols-3">
                <SummaryCard label="Touchpoints" value={summary.touchpoints} icon={Activity} />
                <SummaryCard label="Missed events" value={summary.missed_events} icon={AlertTriangle} />
                <SummaryCard label="Open gaps" value={summary.open_gaps} icon={Target} />
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-slate-950">Actionable Items</h2>
                  <span className="text-sm text-slate-500">
                    {formatNumber(dashboard?.actionable_items.length ?? 0)}
                  </span>
                </div>
                {dashboard?.actionable_items.length ? (
                  <div className="grid gap-3">
                    {dashboard.actionable_items.map((item) => (
                      <article
                        key={`${item.type}-${item.id}`}
                        className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                      >
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-semibold text-slate-950">{item.title}</h3>
                              <span
                                className={classNames(
                                  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize',
                                  priorityClasses(item.priority)
                                )}
                              >
                                {item.priority}
                              </span>
                            </div>
                            <p className="text-sm leading-6 text-slate-600">{item.description}</p>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                            {item.unified_person_id ? (
                              <Link
                                href={`/intelligence/person/${encodeURIComponent(item.unified_person_id)}`}
                                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-100"
                              >
                                View person
                              </Link>
                            ) : null}
                            {item.type === 'prompt' ? (
                              <button
                                type="button"
                                onClick={() => openPromptResponseModal(item)}
                                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800"
                              >
                                Update
                                <ArrowRight className="h-4 w-4" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled
                                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-500"
                              >
                                {item.suggested_action || 'Review'}
                                <ArrowRight className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyState label="No actionable items." />
                )}
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-slate-950">Insights</h2>
                  <span className="text-sm text-slate-500">{formatNumber(dashboard?.insights.length ?? 0)}</span>
                </div>
                {dashboard?.insights.length ? (
                  <div className="grid gap-3 lg:grid-cols-3">
                    {dashboard.insights.map((insight, index) => {
                      const tone = insightClasses(insight.type);
                      const Icon = tone.icon;

                      return (
                        <article
                          key={`${insight.type}-${insight.source}-${index}`}
                          className={classNames('rounded-lg border bg-white p-4 shadow-sm', tone.border)}
                        >
                          <div className="flex items-start gap-3">
                            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />
                            <div className="min-w-0 space-y-3">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="text-sm font-semibold text-slate-950">{insight.title}</h3>
                                  <span
                                    className={classNames(
                                      'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize',
                                      tone.badge
                                    )}
                                  >
                                    {insight.type}
                                  </span>
                                </div>
                                <p className="text-sm leading-6 text-slate-600">{insight.description}</p>
                              </div>
                              <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                                <span className="rounded-md bg-slate-100 px-2 py-1">{insight.source}</span>
                                <span className="rounded-md bg-slate-100 px-2 py-1">
                                  {formatNumber(insight.metric)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState label="No insights available." />
                )}
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-slate-950">Health</h2>
                  <span className="text-sm text-slate-500">{formatNumber(dashboard?.health.length ?? 0)}</span>
                </div>
                {dashboard?.health.length ? (
                  <div className="grid gap-3">
                    {dashboard.health.map((warning, index) => (
                      <article
                        key={`${warning.title}-${index}`}
                        className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex min-w-0 gap-3">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                            <div className="min-w-0">
                              <h3 className="text-sm font-semibold text-slate-950">{warning.title}</h3>
                              <p className="mt-2 text-sm leading-6 text-slate-600">{warning.description}</p>
                            </div>
                          </div>
                          <span
                            className={classNames(
                              'inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize',
                              severityClasses(warning.severity)
                            )}
                          >
                            {warning.severity}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-emerald-200 bg-white px-4 py-8 text-center text-sm text-emerald-700 shadow-sm">
                    <Lightbulb className="mx-auto mb-3 h-5 w-5" />
                    No system warnings.
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      {activePrompt ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="prompt-response-title"
        >
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <h2 id="prompt-response-title" className="text-base font-semibold text-slate-950">
                  Update revenue outcome
                </h2>
                <p className="mt-1 text-sm leading-5 text-slate-500">{activePrompt.title}</p>
              </div>
              <button
                type="button"
                onClick={closePromptResponseModal}
                disabled={responseSubmitting}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={submitPromptResponse} className="space-y-4 px-5 py-5">
              <div className="grid gap-4 sm:grid-cols-[1fr_112px]">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Amount</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={responseForm.amount}
                    onChange={(event) =>
                      setResponseForm((current) => ({ ...current, amount: event.target.value }))
                    }
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition-colors focus:border-slate-500"
                    required
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Currency</span>
                  <input
                    type="text"
                    maxLength={3}
                    value={responseForm.currency}
                    onChange={(event) =>
                      setResponseForm((current) => ({
                        ...current,
                        currency: event.target.value.toUpperCase(),
                      }))
                    }
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm uppercase text-slate-950 shadow-sm outline-none transition-colors focus:border-slate-500"
                    required
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">Notes</span>
                <textarea
                  value={responseForm.notes}
                  onChange={(event) =>
                    setResponseForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  rows={4}
                  className="mt-1 w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-950 shadow-sm outline-none transition-colors focus:border-slate-500"
                />
              </label>

              {responseError ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {responseError}
                </div>
              ) : null}

              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closePromptResponseModal}
                  disabled={responseSubmitting}
                  className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={responseSubmitting}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-50"
                >
                  {responseSubmitting ? 'Submitting...' : 'Submit update'}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
