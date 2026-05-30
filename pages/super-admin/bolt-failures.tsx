/**
 * /super-admin/bolt-failures
 *
 * Super-admin-only failure observability view. Two sections:
 *
 *   1. Dashboard rollups (by stage / provider / campaign type / normalized
 *      type, plus top raw_error_message values and unknown count).
 *   2. Recent terminal failure list with click-through to the full detail
 *      (raw_error_message, stack_excerpt, strategy_snapshot, run history).
 *
 * Role gate: SUPER_ADMIN cookie check + userRole fallback — same auth
 * pattern as the planner-control page. Read-only — never mutates state.
 */

import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';

interface BucketCount { key: string; count: number; }

interface DashboardSnapshot {
  window: { since: string; until: string };
  total_terminal_failures: number;
  by_stage: BucketCount[];
  by_provider: BucketCount[];
  by_campaign_type: BucketCount[];
  by_normalized_type: BucketCount[];
  top_raw_messages: BucketCount[];
  unknown_count: number;
}

interface FailureListItem {
  id: string;
  run_id: string;
  campaign_id: string | null;
  company_id: string | null;
  failed_stage: string;
  current_stage: string | null;
  pipeline_mode: string | null;
  campaign_type: string | null;
  raw_error_message: string | null;
  provider: string | null;
  normalized_error_type: string | null;
  retriable: boolean | null;
  occurred_at: string;
}

interface FailureDetail extends FailureListItem {
  strategy_id: string | null;
  stack_excerpt: string | null;
  strategy_snapshot: Record<string, unknown> | null;
  run_history: Array<{
    id: string;
    failed_stage: string;
    normalized_error_type: string | null;
    provider: string | null;
    raw_error_message: string | null;
    occurred_at: string;
    is_terminal: boolean;
  }>;
}

function useSuperAdminGate() {
  const router = useRouter();
  const { isLoading: ctxLoading, isAuthenticated, userRole } = useCompanyContext();
  const [authResolved, setAuthResolved] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [cookieChecked, setCookieChecked] = useState(false);

  useEffect(() => {
    fetch('/api/admin/check-super-admin', { credentials: 'include' })
      .then((r) => r.json())
      .then((json: { isSuperAdmin?: boolean }) => {
        if (json.isSuperAdmin) {
          setIsSuperAdmin(true);
          setAuthResolved(true);
        }
      })
      .catch(() => {})
      .finally(() => setCookieChecked(true));
  }, []);

  useEffect(() => {
    if (!cookieChecked) return;
    if (authResolved) return;
    if (ctxLoading) return;
    if (!isAuthenticated) { router.replace('/login'); return; }
    if (userRole === 'SUPER_ADMIN') {
      setIsSuperAdmin(true);
      setAuthResolved(true);
    } else {
      router.replace('/login');
    }
  }, [cookieChecked, authResolved, ctxLoading, isAuthenticated, userRole, router]);

  return { authResolved, isSuperAdmin };
}

function BucketTable({ title, rows }: { title: string; rows: BucketCount[] }) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{title}</div>
        <div className="text-sm text-slate-400">No data.</div>
      </div>
    );
  }
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{title}</div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-slate-100 first:border-t-0">
              <td className="py-1.5 pr-2 text-slate-700 truncate max-w-[260px]" title={r.key}>{r.key}</td>
              <td className="py-1.5 w-12 text-right text-slate-500 tabular-nums">{r.count}</td>
              <td className="py-1.5 w-24 pl-2">
                <div className="h-1.5 rounded bg-slate-100">
                  <div
                    className="h-1.5 rounded bg-indigo-500"
                    style={{ width: `${Math.round((r.count / max) * 100)}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FailureRow({ item, onSelect }: { item: FailureListItem; onSelect: (id: string) => void }) {
  return (
    <tr
      className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
      onClick={() => onSelect(item.id)}
    >
      <td className="py-2 px-2 text-xs text-slate-500 whitespace-nowrap">
        {new Date(item.occurred_at).toLocaleString()}
      </td>
      <td className="py-2 px-2 text-xs">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{item.normalized_error_type ?? 'unknown'}</span>
      </td>
      <td className="py-2 px-2 text-xs text-slate-600">{item.provider ?? '—'}</td>
      <td className="py-2 px-2 text-xs text-slate-700">{item.failed_stage}</td>
      <td className="py-2 px-2 text-xs text-slate-600">{item.campaign_type ?? '—'}</td>
      <td className="py-2 px-2 text-xs text-slate-600 truncate max-w-[420px]" title={item.raw_error_message ?? undefined}>
        {item.raw_error_message ?? '—'}
      </td>
    </tr>
  );
}

interface RowFailureItem {
  id: string;
  run_id: string;
  campaign_id: string | null;
  daily_plan_id: string | null;
  week_number: number | null;
  activity_id: string | null;
  platform: string | null;
  content_type: string | null;
  failure_code: string;
  failure_message: string;
  stage: string | null;
  occurred_at: string;
  created_at: string;
}

interface RowFailureListResponse {
  items: RowFailureItem[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  migration_required?: boolean;
  notice?: string;
}

interface RowFailureSummaryResponse {
  rows_failed: number;
  by_code: Array<{ key: string; count: number }>;
  by_platform: Array<{ key: string; count: number }>;
  by_content_type: Array<{ key: string; count: number }>;
  by_week: Array<{ key: number; count: number }>;
  by_stage: Array<{ key: string; count: number }>;
  migration_required?: boolean;
  notice?: string;
}

type DrawerTab = 'overview' | 'rows';

function RowSummaryBuckets({ summary }: { summary: RowFailureSummaryResponse }) {
  const renderBucket = (label: string, rows: Array<{ key: string | number; count: number }>) => {
    if (!rows.length) return (
      <div className="rounded border border-slate-200 bg-white p-2">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{label}</div>
        <div className="text-xs text-slate-400">—</div>
      </div>
    );
    return (
      <div className="rounded border border-slate-200 bg-white p-2">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{label}</div>
        <ul className="space-y-0.5">
          {rows.slice(0, 5).map((r) => (
            <li key={String(r.key)} className="flex items-baseline justify-between text-xs">
              <span className="truncate pr-2">{String(r.key)}</span>
              <span className="text-slate-500 tabular-nums">{r.count}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      {renderBucket('By code', summary.by_code)}
      {renderBucket('By stage', summary.by_stage)}
      {renderBucket('By platform', summary.by_platform)}
      {renderBucket('By content type', summary.by_content_type)}
      <div className="col-span-2">
        {renderBucket('By week', summary.by_week.map((r) => ({ key: `Week ${r.key}`, count: r.count })))}
      </div>
    </div>
  );
}

interface RowFailuresTabProps {
  failureId: string;
}

function RowFailuresTab({ failureId }: RowFailuresTabProps) {
  const [summary, setSummary] = useState<RowFailureSummaryResponse | null>(null);
  const [list, setList] = useState<RowFailureListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterCode, setFilterCode] = useState('');
  const [filterPlatform, setFilterPlatform] = useState('');
  const [sort, setSort] = useState<'occurred_at' | 'failure_code' | 'platform' | 'content_type' | 'week_number'>('occurred_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [offset, setOffset] = useState(0);
  const PAGE = 25;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE));
      params.set('offset', String(offset));
      params.set('sort', sort);
      params.set('order', order);
      if (search.trim()) params.set('search', search.trim());
      if (filterCode.trim()) params.set('failure_code', filterCode.trim());
      if (filterPlatform.trim()) params.set('platform', filterPlatform.trim());
      const [s, l] = await Promise.all([
        fetch(`/api/super-admin/bolt-failures/${failureId}/rows-summary`, { credentials: 'include' }).then((r) => r.json()),
        fetch(`/api/super-admin/bolt-failures/${failureId}/rows?${params.toString()}`, { credentials: 'include' }).then((r) => r.json()),
      ]);
      setSummary(s as RowFailureSummaryResponse);
      setList(l as RowFailureListResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [failureId, offset, sort, order, search, filterCode, filterPlatform]);

  useEffect(() => { void reload(); }, [reload]);

  const migrationRequired = !!(summary?.migration_required || list?.migration_required);

  return (
    <div className="space-y-3">
      {migrationRequired && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <div className="font-semibold mb-0.5">Migration required</div>
          {summary?.notice || list?.notice || 'bolt_row_failure_diagnostics is not present. Apply the 20260816 migration to enable row-level diagnostics.'}
        </div>
      )}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}
      {summary && !migrationRequired && (
        <section>
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Diagnostic summary</div>
          <div className="rounded border border-slate-200 bg-white p-2 mb-2">
            <div className="text-2xl font-semibold text-slate-900">{summary.rows_failed}</div>
            <div className="text-xs text-slate-500">rows failed</div>
          </div>
          <RowSummaryBuckets summary={summary} />
        </section>
      )}
      {!migrationRequired && (
        <section>
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Row failures</div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <input
              type="text"
              placeholder="Search message…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
            />
            <input
              type="text"
              placeholder="Code (e.g. DAILY_PLAN_INVALID_PLATFORM)"
              value={filterCode}
              onChange={(e) => { setFilterCode(e.target.value); setOffset(0); }}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
            />
            <input
              type="text"
              placeholder="Platform (e.g. linkedin)"
              value={filterPlatform}
              onChange={(e) => { setFilterPlatform(e.target.value); setOffset(0); }}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
            />
          </div>
          <div className="rounded border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  {[
                    { col: 'occurred_at' as const, label: 'When' },
                    { col: 'failure_code' as const, label: 'Code' },
                    { col: 'platform' as const, label: 'Platform' },
                    { col: 'content_type' as const, label: 'Type' },
                    { col: 'week_number' as const, label: 'Wk' },
                  ].map((h) => (
                    <th
                      key={h.col}
                      className="py-1.5 px-2 cursor-pointer select-none"
                      onClick={() => {
                        if (sort === h.col) {
                          setOrder(order === 'asc' ? 'desc' : 'asc');
                        } else {
                          setSort(h.col);
                          setOrder('desc');
                        }
                        setOffset(0);
                      }}
                    >
                      {h.label}{sort === h.col ? (order === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                  <th className="py-1.5 px-2">Message</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? <tr><td colSpan={6} className="py-3 text-center text-slate-400">Loading…</td></tr>
                  : (list?.items ?? []).length === 0
                    ? <tr><td colSpan={6} className="py-3 text-center text-slate-400">No row failures recorded for this run.</td></tr>
                    : (list?.items ?? []).map((r) => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="py-1.5 px-2 whitespace-nowrap text-slate-500">{new Date(r.occurred_at).toLocaleTimeString()}</td>
                        <td className="py-1.5 px-2 font-mono text-[10px]">{r.failure_code}</td>
                        <td className="py-1.5 px-2">{r.platform ?? '—'}</td>
                        <td className="py-1.5 px-2">{r.content_type ?? '—'}</td>
                        <td className="py-1.5 px-2 text-slate-500">{r.week_number ?? '—'}</td>
                        <td className="py-1.5 px-2 text-slate-700 truncate max-w-[260px]" title={r.failure_message}>{r.failure_message}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          {list && list.total > 0 && (
            <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
              <span>{offset + 1}–{Math.min(offset + (list.items.length ?? 0), list.total)} of {list.total}</span>
              <div className="space-x-1">
                <button
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}
                  disabled={offset === 0}
                  className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs disabled:opacity-50"
                >Prev</button>
                <button
                  onClick={() => list.has_more && setOffset(offset + PAGE)}
                  disabled={!list.has_more}
                  className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs disabled:opacity-50"
                >Next</button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function DetailDrawer({ detail, onClose }: { detail: FailureDetail | null; onClose: () => void }) {
  const [tab, setTab] = useState<DrawerTab>('overview');
  // Reset to overview every time the drawer opens for a new failure
  // so the operator always lands on the canonical summary view.
  useEffect(() => { setTab('overview'); }, [detail?.id]);
  if (!detail) return null;
  return (
    <div className="fixed inset-0 z-50 flex bg-black/40" onClick={onClose}>
      <div className="ml-auto h-full w-full max-w-2xl bg-white shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Failure detail</h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg leading-none">✕</button>
          </div>
          <div className="flex gap-1 px-4 -mb-px">
            {([
              { id: 'overview' as const, label: 'Overview' },
              { id: 'rows' as const, label: 'Row failures' },
            ]).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 text-xs border-b-2 ${tab === t.id ? 'border-indigo-500 text-indigo-700 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="px-4 py-3 space-y-4 text-sm">
          {tab === 'rows'
            ? <RowFailuresTab failureId={detail.id} />
            : <>
          <section>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Identifiers</div>
            <div className="grid grid-cols-2 gap-1 text-xs">
              <div className="text-slate-500">run_id</div><div className="font-mono">{detail.run_id}</div>
              <div className="text-slate-500">campaign_id</div><div className="font-mono">{detail.campaign_id ?? '—'}</div>
              <div className="text-slate-500">company_id</div><div className="font-mono">{detail.company_id ?? '—'}</div>
              <div className="text-slate-500">strategy_id</div><div className="font-mono">{detail.strategy_id ?? '—'}</div>
            </div>
          </section>
          <section>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Classification</div>
            <div className="grid grid-cols-2 gap-1 text-xs">
              <div className="text-slate-500">normalized_error_type</div><div>{detail.normalized_error_type ?? '—'}</div>
              <div className="text-slate-500">provider</div><div>{detail.provider ?? '—'}</div>
              <div className="text-slate-500">retriable</div><div>{detail.retriable ? 'yes' : 'no'}</div>
              <div className="text-slate-500">failed_stage</div><div>{detail.failed_stage}</div>
              <div className="text-slate-500">current_stage</div><div>{detail.current_stage ?? '—'}</div>
              <div className="text-slate-500">pipeline_mode</div><div>{detail.pipeline_mode ?? '—'}</div>
              <div className="text-slate-500">campaign_type</div><div>{detail.campaign_type ?? '—'}</div>
            </div>
          </section>
          <section>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Raw error</div>
            <pre className="rounded bg-slate-50 border border-slate-200 p-2 text-[11px] text-slate-700 whitespace-pre-wrap break-words">{detail.raw_error_message ?? '—'}</pre>
          </section>
          {detail.stack_excerpt && (
            <section>
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Stack excerpt</div>
              <pre className="rounded bg-slate-50 border border-slate-200 p-2 text-[11px] text-slate-700 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">{detail.stack_excerpt}</pre>
            </section>
          )}
          <section>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Strategy snapshot</div>
            <pre className="rounded bg-slate-50 border border-slate-200 p-2 text-[11px] text-slate-700 whitespace-pre-wrap break-words">{detail.strategy_snapshot ? JSON.stringify(detail.strategy_snapshot, null, 2) : '—'}</pre>
          </section>
          <section>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Run history ({detail.run_history.length})</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1 pr-2">When</th>
                  <th className="py-1 pr-2">Stage</th>
                  <th className="py-1 pr-2">Type</th>
                  <th className="py-1 pr-2">Provider</th>
                  <th className="py-1 pr-2">Terminal</th>
                </tr>
              </thead>
              <tbody>
                {detail.run_history.map((h) => (
                  <tr key={h.id} className="border-t border-slate-100">
                    <td className="py-1 pr-2 whitespace-nowrap">{new Date(h.occurred_at).toLocaleTimeString()}</td>
                    <td className="py-1 pr-2">{h.failed_stage}</td>
                    <td className="py-1 pr-2">{h.normalized_error_type ?? '—'}</td>
                    <td className="py-1 pr-2">{h.provider ?? '—'}</td>
                    <td className="py-1 pr-2">{h.is_terminal ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          </>}
        </div>
      </div>
    </div>
  );
}

export default function BoltFailuresPage() {
  const { authResolved, isSuperAdmin } = useSuperAdminGate();

  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [items, setItems] = useState<FailureListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FailureDetail | null>(null);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      const [d, l] = await Promise.all([
        fetch('/api/super-admin/bolt-failures/dashboard', { credentials: 'include' }).then((r) => r.json()),
        fetch('/api/super-admin/bolt-failures?limit=100', { credentials: 'include' }).then((r) => r.json()),
      ]);
      setDashboard(d as DashboardSnapshot);
      setItems((l as { items: FailureListItem[] }).items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    void refetch();
  }, [isSuperAdmin, refetch]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    fetch(`/api/super-admin/bolt-failures/${selectedId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((json) => { if (!cancelled) setDetail(json as FailureDetail); })
      .catch(() => { if (!cancelled) setDetail(null); });
    return () => { cancelled = true; };
  }, [selectedId]);

  if (!authResolved) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">Resolving super-admin session…</div>;
  }
  if (!isSuperAdmin) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">Access denied.</div>;
  }

  return (
    <>
      <Head><title>BOLT failures · super-admin</title></Head>
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-7xl mx-auto px-6 pt-6 pb-12">
          <nav className="flex flex-wrap items-center gap-2 text-xs mb-4">
            <span className="text-gray-500">Operational tooling:</span>
            <a href="/super-admin/system-health" className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 font-medium text-gray-700 hover:bg-gray-50">System health</a>
            <a href="/super-admin/oauth-health" className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 font-medium text-gray-700 hover:bg-gray-50">OAuth health</a>
            <a href="/super-admin/planner-control" className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 font-medium text-gray-700 hover:bg-gray-50">Planner control</a>
            <a href="/super-admin/bolt-failures" className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 font-medium text-indigo-700">BOLT failures</a>
            <a href="/super-admin/dashboard" className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 font-medium text-gray-700 hover:bg-gray-50">Dashboard</a>
          </nav>

          <header className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">BOLT failures</h1>
              <p className="text-sm text-slate-500">Terminal failures from the BOLT pipeline. Classification, top messages, and per-run detail.</p>
            </div>
            <button
              onClick={() => void refetch()}
              className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
              disabled={loading}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </header>

          {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

          {dashboard && (
            <section className="mb-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Terminal failures</div>
                  <div className="text-2xl font-semibold text-slate-900">{dashboard.total_terminal_failures}</div>
                  <div className="text-xs text-slate-400">last 7 days</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Unknown classification</div>
                  <div className="text-2xl font-semibold text-slate-900">{dashboard.unknown_count}</div>
                  <div className="text-xs text-slate-400">needs operator review</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Window</div>
                  <div className="text-xs text-slate-700 mt-1">
                    {new Date(dashboard.window.since).toLocaleDateString()} →<br />
                    {new Date(dashboard.window.until).toLocaleDateString()}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Top stage</div>
                  <div className="text-sm font-semibold text-slate-900 truncate" title={dashboard.by_stage[0]?.key}>{dashboard.by_stage[0]?.key ?? '—'}</div>
                  <div className="text-xs text-slate-400">{dashboard.by_stage[0]?.count ?? 0} failures</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <BucketTable title="By stage" rows={dashboard.by_stage} />
                <BucketTable title="By provider" rows={dashboard.by_provider} />
                <BucketTable title="By campaign type" rows={dashboard.by_campaign_type} />
                <BucketTable title="By normalized type" rows={dashboard.by_normalized_type} />
                <div className="md:col-span-2">
                  <BucketTable title="Top raw error messages" rows={dashboard.top_raw_messages} />
                </div>
              </div>
            </section>
          )}

          <section>
            <h2 className="text-sm font-semibold text-slate-700 mb-2">Recent terminal failures</h2>
            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr className="text-left text-xs text-slate-500">
                    <th className="py-2 px-2">When</th>
                    <th className="py-2 px-2">Type</th>
                    <th className="py-2 px-2">Provider</th>
                    <th className="py-2 px-2">Stage</th>
                    <th className="py-2 px-2">Campaign type</th>
                    <th className="py-2 px-2">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0
                    ? <tr><td colSpan={6} className="py-4 text-center text-xs text-slate-400">No failures in window.</td></tr>
                    : items.map((it) => <FailureRow key={it.id} item={it} onSelect={setSelectedId} />)}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
      <DetailDrawer detail={detail} onClose={() => setSelectedId(null)} />
    </>
  );
}
