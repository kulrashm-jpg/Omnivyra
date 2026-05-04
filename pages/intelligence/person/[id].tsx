import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  GitBranch,
  HelpCircle,
  RefreshCw,
  Target,
} from 'lucide-react';

import { useCompanyContext } from '../../../components/CompanyContext';

type PersonRecord = {
  id: string;
  company_id: string;
  primary_email: string | null;
  primary_phone: string | null;
  external_keys: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type TouchpointRecord = {
  id: string;
  source: string;
  unified_source: Record<string, unknown>;
  touchpoint_type: string;
  reference_table: string;
  reference_id: string;
  occurred_at: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type ExpectedEventRecord = {
  id: string;
  trigger_touchpoint_id: string;
  expected_event_type: string;
  due_at: string;
  status: string;
  completed_touchpoint_id: string | null;
  created_at: string;
  updated_at: string;
};

type GapRecord = {
  id: string;
  expected_event_instance_id: string;
  gap_type: string;
  priority: string;
  status: string;
  detected_at: string;
  resolved_at: string | null;
  metadata: Record<string, unknown>;
};

type PromptRecord = {
  id: string;
  intelligence_gap_id: string;
  prompt_type: string;
  title: string;
  message: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type AttributionTouchpoint = {
  id: string;
  source: string;
  touchpoint_type: string;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
} | null;

type AttributionRecord = {
  id: string;
  revenue_touchpoint_id: string;
  attributed_touchpoint_id: string;
  attribution_type: string;
  created_at: string;
  revenue_touchpoint: AttributionTouchpoint;
  attributed_touchpoint: AttributionTouchpoint;
};

type PersonIntelligenceResponse = {
  success: boolean;
  company_id: string;
  unified_person_id: string;
  person: PersonRecord;
  touchpoints: TouchpointRecord[];
  expected_events: ExpectedEventRecord[];
  gaps: GapRecord[];
  prompts: PromptRecord[];
  attribution: AttributionRecord[];
};

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function queryText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? '').trim();
  return String(value ?? '').trim();
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not set';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not set' : dateFormatter.format(date);
}

function statusClasses(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'resolved' || normalized === 'responded') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (normalized === 'missed' || normalized === 'open' || normalized === 'pending') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function MetadataDetails({ metadata }: { metadata: Record<string, unknown> | null | undefined }) {
  const normalized = metadata && Object.keys(metadata).length > 0 ? metadata : null;
  if (!normalized) {
    return null;
  }

  return (
    <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <summary className="cursor-pointer font-medium text-slate-700">Metadata</summary>
      <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words">
        {JSON.stringify(normalized, null, 2)}
      </pre>
    </details>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
      {label}
    </div>
  );
}

export default function PersonIntelligencePage() {
  const router = useRouter();
  const { selectedCompanyName } = useCompanyContext();
  const personId = useMemo(() => queryText(router.query.id), [router.query.id]);
  const [data, setData] = useState<PersonIntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPerson = useCallback(async () => {
    if (!router.isReady || !personId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/intelligence/person/${encodeURIComponent(personId)}`, {
        credentials: 'include',
      });
      const json = await response.json().catch(() => null);

      if (!response.ok) {
        setData(null);
        setError(json?.error ?? 'Failed to load person intelligence');
        return;
      }

      setData(json as PersonIntelligenceResponse);
    } catch {
      setData(null);
      setError('Failed to load person intelligence');
    } finally {
      setLoading(false);
    }
  }, [personId, router.isReady]);

  useEffect(() => {
    void fetchPerson();
  }, [fetchPerson]);

  const personLabel =
    data?.person.primary_email ||
    data?.person.primary_phone ||
    (personId ? `Person ${personId.slice(0, 8)}` : 'Person');

  return (
    <>
      <Head>
        <title>{personLabel} | Intelligence | Omnivyra</title>
      </Head>

      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto flex max-w-screen-xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <header className="flex flex-col gap-4 border-b border-slate-200 pb-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link
                href="/intelligence"
                className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-950"
              >
                <ArrowLeft className="h-4 w-4" />
                Intelligence
              </Link>
              <button
                type="button"
                onClick={() => fetchPerson()}
                disabled={loading || !personId}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-50"
              >
                <RefreshCw className={classNames('h-4 w-4', loading && 'animate-spin')} />
                Refresh
              </button>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-500">{selectedCompanyName || 'Current company'}</p>
              <h1 className="mt-1 break-words text-2xl font-semibold tracking-normal text-slate-950">
                {personLabel}
              </h1>
              {data?.person ? (
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span className="rounded-md bg-white px-2 py-1 shadow-sm">ID {data.person.id}</span>
                  {data.person.primary_phone ? (
                    <span className="rounded-md bg-white px-2 py-1 shadow-sm">{data.person.primary_phone}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </header>

          {loading && !data ? (
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500 shadow-sm">
              Loading person intelligence...
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
              {error}
            </div>
          ) : data ? (
            <>
              <section className="grid gap-4 sm:grid-cols-5">
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-sm font-medium text-slate-500">Touchpoints</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">{data.touchpoints.length}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-sm font-medium text-slate-500">Expected Events</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">{data.expected_events.length}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-sm font-medium text-slate-500">Gaps</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">{data.gaps.length}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-sm font-medium text-slate-500">Prompts</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">{data.prompts.length}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-sm font-medium text-slate-500">Attribution</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">{data.attribution.length}</p>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-base font-semibold text-slate-950">Touchpoint Timeline</h2>
                {data.touchpoints.length ? (
                  <div className="grid gap-3">
                    {data.touchpoints.map((touchpoint) => (
                      <article key={touchpoint.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Activity className="h-4 w-4 text-slate-500" />
                              <h3 className="text-sm font-semibold text-slate-950">{touchpoint.touchpoint_type}</h3>
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                                {touchpoint.source}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-slate-500">
                              {touchpoint.reference_table} · {touchpoint.reference_id}
                            </p>
                            <MetadataDetails metadata={touchpoint.metadata} />
                          </div>
                          <p className="shrink-0 text-sm text-slate-500">{formatDate(touchpoint.occurred_at)}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyState label="No touchpoints linked to this person." />
                )}
              </section>

              <section className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-3">
                  <h2 className="text-base font-semibold text-slate-950">Expected Events</h2>
                  {data.expected_events.length ? (
                    <div className="grid gap-3">
                      {data.expected_events.map((event) => (
                        <article key={event.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex items-start gap-3">
                            <Target className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-sm font-semibold text-slate-950">{event.expected_event_type}</h3>
                                <span
                                  className={classNames(
                                    'rounded-full border px-2 py-0.5 text-xs font-medium capitalize',
                                    statusClasses(event.status)
                                  )}
                                >
                                  {event.status}
                                </span>
                              </div>
                              <p className="mt-2 text-sm text-slate-500">Due {formatDate(event.due_at)}</p>
                              {event.completed_touchpoint_id ? (
                                <p className="mt-1 break-words text-xs text-slate-500">
                                  Completed by {event.completed_touchpoint_id}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState label="No expected events for this person." />
                  )}
                </div>

                <div className="space-y-3">
                  <h2 className="text-base font-semibold text-slate-950">Gaps</h2>
                  {data.gaps.length ? (
                    <div className="grid gap-3">
                      {data.gaps.map((gap) => (
                        <article key={gap.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-sm font-semibold text-slate-950">{gap.gap_type}</h3>
                                <span
                                  className={classNames(
                                    'rounded-full border px-2 py-0.5 text-xs font-medium capitalize',
                                    statusClasses(gap.status)
                                  )}
                                >
                                  {gap.status}
                                </span>
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs capitalize text-slate-600">
                                  {gap.priority}
                                </span>
                              </div>
                              <p className="mt-2 text-sm text-slate-500">Detected {formatDate(gap.detected_at)}</p>
                              <MetadataDetails metadata={gap.metadata} />
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState label="No gaps for this person." />
                  )}
                </div>
              </section>

              <section className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-3">
                  <h2 className="text-base font-semibold text-slate-950">Prompts</h2>
                  {data.prompts.length ? (
                    <div className="grid gap-3">
                      {data.prompts.map((prompt) => (
                        <article key={prompt.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex items-start gap-3">
                            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-sm font-semibold text-slate-950">{prompt.title}</h3>
                                <span
                                  className={classNames(
                                    'rounded-full border px-2 py-0.5 text-xs font-medium capitalize',
                                    statusClasses(prompt.status)
                                  )}
                                >
                                  {prompt.status}
                                </span>
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-600">{prompt.message}</p>
                              <p className="mt-2 text-xs text-slate-500">Created {formatDate(prompt.created_at)}</p>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState label="No prompts for this person." />
                  )}
                </div>

                <div className="space-y-3">
                  <h2 className="text-base font-semibold text-slate-950">Attribution</h2>
                  {data.attribution.length ? (
                    <div className="grid gap-3">
                      {data.attribution.map((attribution) => (
                        <article key={attribution.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex items-start gap-3">
                            <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-sm font-semibold text-slate-950">{attribution.attribution_type}</h3>
                                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                  Revenue linked
                                </span>
                              </div>
                              <p className="mt-2 text-sm text-slate-600">
                                {attribution.attributed_touchpoint?.touchpoint_type ?? 'Unknown touchpoint'} credited for{' '}
                                {attribution.revenue_touchpoint?.touchpoint_type ?? 'revenue'}.
                              </p>
                              <p className="mt-2 break-words text-xs text-slate-500">
                                Revenue {attribution.revenue_touchpoint_id}
                              </p>
                              <p className="mt-1 break-words text-xs text-slate-500">
                                Attributed {attribution.attributed_touchpoint_id}
                              </p>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState label="No attribution records for this person." />
                  )}
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-slate-500" />
                  <h2 className="text-base font-semibold text-slate-950">Identity</h2>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <dl className="grid gap-4 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="font-medium text-slate-500">Primary email</dt>
                      <dd className="mt-1 break-words text-slate-950">{data.person.primary_email || 'Not set'}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-500">Primary phone</dt>
                      <dd className="mt-1 break-words text-slate-950">{data.person.primary_phone || 'Not set'}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-500">Created</dt>
                      <dd className="mt-1 text-slate-950">{formatDate(data.person.created_at)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-500">Updated</dt>
                      <dd className="mt-1 text-slate-950">{formatDate(data.person.updated_at)}</dd>
                    </div>
                  </dl>
                  <MetadataDetails metadata={data.person.external_keys} />
                </div>
              </section>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
