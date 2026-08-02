import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import {
  CANONICAL_LEAD_SOURCES,
  CANONICAL_LEAD_SOURCE_LABELS,
  leadKeyFor,
  type CanonicalLeadView,
} from '@/lib/leadIntelligence';
import {
  fetchLeads,
  downloadLeadExport,
  emptyFilters,
  leadsKey,
  type LeadFilterState,
  type LeadListResult,
  type LeadSortState,
} from './leadIntelligenceClient';

const PAGE_SIZE = 25;

function intentPct(v: CanonicalLeadView): number {
  const i = v.scores.intent ?? v.scores.total ?? 0;
  return Math.round(i * 100);
}

function IntentBadge({ view }: { view: CanonicalLeadView }) {
  const pct = intentPct(view);
  const cls = pct >= 70 ? 'bg-emerald-100 text-emerald-700' : pct >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600';
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{pct}%</span>;
}

export default function LeadListPanel({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [filters, setFilters] = useState<LeadFilterState>(emptyFilters());
  const [sort, setSort] = useState<LeadSortState>({ by: 'occurredAt', order: 'desc' });
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const patch = useCallback((p: Partial<LeadFilterState>) => { setOffset(0); setFilters((f) => ({ ...f, ...p })); }, []);
  const toggleSource = useCallback((s: string) => {
    setOffset(0);
    setFilters((f) => ({ ...f, source: f.source.includes(s) ? f.source.filter((x) => x !== s) : [...f.source, s] }));
  }, []);

  // OPT-005 Phase 2C: the list is an SWR entry keyed on the exact request URL
  // (company + every filter + paging + sort). The original 250 ms debounce is
  // preserved by only promoting the target key to the active SWR key after the
  // debounce window — typing never fires per-keystroke requests.
  const targetQuery = companyId
    ? { url: leadsKey(companyId, filters, { limit: PAGE_SIZE, offset }, sort), filters, offset, sort }
    : null;
  const [activeQuery, setActiveQuery] = useState<typeof targetQuery>(null);
  useEffect(() => {
    if (!targetQuery) return;
    setExportError(null); // parity: the old hook cleared the error on every query change
    const t = setTimeout(() => setActiveQuery(targetQuery), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, targetQuery?.url]);

  const { data, error: swrError, isLoading } = useSWR<LeadListResult>(
    activeQuery ? activeQuery.url : null,
    () => fetchLeads(companyId, activeQuery!.filters, { limit: PAGE_SIZE, offset: activeQuery!.offset }, activeQuery!.sort)
  );

  // Loading covers the debounce window plus any uncached first fetch of the
  // active key — the same span the old hook flagged. Cached pages paint
  // instantly and revalidate in the background.
  const loading = targetQuery !== null && (targetQuery.url !== activeQuery?.url || isLoading);
  const error = exportError ?? (swrError ? (swrError instanceof Error ? swrError.message : 'Failed to load') : null);

  const total = data?.total ?? 0;
  const rows = data?.rows ?? [];
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + PAGE_SIZE, total);
  const activeFilterCount = useMemo(
    () => (filters.source.length ? 1 : 0) + ['status', 'campaign', 'content', 'owner', 'from', 'to', 'intentMin', 'interest', 'search']
      .filter((k) => String((filters as unknown as Record<string, unknown>)[k] ?? '').trim()).length,
    [filters],
  );

  const openLead = (v: CanonicalLeadView) => router.push(`/lead-intelligence/${encodeURIComponent(leadKeyFor(v))}`);

  const doExport = async (format: 'csv' | 'excel') => {
    setExporting(true);
    try { await downloadLeadExport(companyId, filters, format); }
    catch (e) { setExportError(e instanceof Error ? e.message : 'Export failed'); }
    finally { setExporting(false); }
  };

  const input = 'rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500';

  return (
    <div className="space-y-4">
      {/* Search + export */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          className={`${input} w-full sm:max-w-md`}
          placeholder="Search name, email, company, campaign, content, source, identity…"
          value={filters.search}
          onChange={(e) => patch({ search: e.target.value })}
        />
        <div className="flex items-center gap-2">
          <select className={input} value={`${sort.by}:${sort.order}`} onChange={(e) => { const [by, order] = e.target.value.split(':'); setSort({ by: by as LeadSortState['by'], order: order as LeadSortState['order'] }); }}>
            <option value="occurredAt:desc">Newest first</option>
            <option value="occurredAt:asc">Oldest first</option>
            <option value="intent:desc">Highest intent</option>
            <option value="intent:asc">Lowest intent</option>
          </select>
          <button disabled={exporting} onClick={() => doExport('csv')} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">CSV</button>
          <button disabled={exporting} onClick={() => doExport('excel')} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Excel</button>
        </div>
      </div>

      {/* Source chips */}
      <div className="flex flex-wrap gap-2">
        {CANONICAL_LEAD_SOURCES.map((s) => (
          <button
            key={s}
            onClick={() => toggleSource(s)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${filters.source.includes(s) ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
          >
            {CANONICAL_LEAD_SOURCE_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <input className={input} placeholder="Status" value={filters.status} onChange={(e) => patch({ status: e.target.value })} />
        <input className={input} placeholder="Campaign" value={filters.campaign} onChange={(e) => patch({ campaign: e.target.value })} />
        <input className={input} placeholder="Content / interest" value={filters.content} onChange={(e) => patch({ content: e.target.value })} />
        <input className={input} placeholder="Owner (user id)" value={filters.owner} onChange={(e) => patch({ owner: e.target.value })} />
        <label className="flex items-center gap-2 text-sm text-gray-600">Intent ≥
          <input className={`${input} w-24`} type="number" min={0} max={1} step={0.1} placeholder="0.0–1.0" value={filters.intentMin} onChange={(e) => patch({ intentMin: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600">From
          <input className={`${input} flex-1`} type="date" value={filters.from} onChange={(e) => patch({ from: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600">To
          <input className={`${input} flex-1`} type="date" value={filters.to} onChange={(e) => patch({ to: e.target.value })} />
        </label>
        <button onClick={() => { setOffset(0); setFilters(emptyFilters()); }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Clear filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Campaign</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Intent</th>
              <th className="px-4 py-3">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">Loading leads…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                No leads match your filters yet. Leads from every connected source will appear here.
              </td></tr>
            )}
            {!loading && rows.map((v) => (
              <tr key={leadKeyFor(v)} onClick={() => openLead(v)} className="cursor-pointer hover:bg-purple-50/40">
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-gray-900">{v.identity.email ?? v.identity.platform ?? v.unifiedPersonId ?? 'Unknown contact'}</p>
                  <p className="text-xs text-gray-500">{String((v.attribution.sourceMetadata?.company_name ?? v.attribution.sourceMetadata?.name) ?? '') || '—'}</p>
                </td>
                <td className="px-4 py-3"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{v.sourceLabel}</span></td>
                <td className="px-4 py-3 text-sm text-gray-700">{v.campaign ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-700">{v.status ?? 'new'}</td>
                <td className="px-4 py-3"><IntentBadge view={v} /></td>
                <td className="px-4 py-3 text-sm text-gray-500">{v.occurredAt ? new Date(v.occurredAt).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{total > 0 ? `Showing ${showingFrom}–${showingTo} of ${total.toLocaleString()}` : 'No results'}</p>
        <div className="flex items-center gap-2">
          <button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">Previous</button>
          <button disabled={showingTo >= total || loading} onClick={() => setOffset(offset + PAGE_SIZE)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}
