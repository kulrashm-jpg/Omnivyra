import React, { useEffect, useState } from 'react';
import { CANONICAL_LEAD_SOURCE_LABELS, type CanonicalLeadSource, type LeadStats, type CanonicalLeadView } from '@/lib/leadIntelligence';
import { fetchLeadStats, fetchLeads, emptyFilters } from './leadIntelligenceClient';

/** Status-bucket labels for the headline tiles — presentation grouping only (no business logic). */
const STATUS_GROUPS: Record<string, string[]> = {
  New: ['new'],
  Active: ['contacted', 'reviewing', 'engaged', 'active', 'open', 'in_progress'],
  Qualified: ['qualified'],
  Converted: ['won', 'converted', 'closed_won', 'paid'],
};

function sumStatuses(byStatus: Record<string, number>, keys: string[]): number {
  return keys.reduce((acc, k) => acc + (byStatus[k] ?? 0), 0);
}

function MetricCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${accent ?? 'text-gray-900'}`}>{value.toLocaleString()}</p>
    </div>
  );
}

function DistributionRow({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 truncate text-sm text-gray-700">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-purple-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right text-sm tabular-nums text-gray-600">{count.toLocaleString()} ({pct}%)</span>
    </div>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  const d = Math.floor(diff / 86_400_000);
  if (d > 0) return `${d}d ago`;
  const h = Math.floor(diff / 3_600_000);
  if (h > 0) return `${h}h ago`;
  const m = Math.floor(diff / 60_000);
  return m > 0 ? `${m}m ago` : 'just now';
}

export default function OverviewPanel({ companyId }: { companyId: string }) {
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [recent, setRecent] = useState<CanonicalLeadView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!companyId) return;
    setLoading(true); setError(null);
    Promise.all([
      fetchLeadStats(companyId),
      fetchLeads(companyId, emptyFilters(), { limit: 8, offset: 0 }, { by: 'occurredAt', order: 'desc' }),
    ])
      .then(([s, list]) => { if (active) { setStats(s); setRecent(list.rows); } })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : 'Failed to load'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companyId]);

  if (loading) return <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">Loading overview…</div>;
  if (error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>;
  if (!stats) return null;

  const byStatus = stats.byStatus ?? {};
  const sources = Object.entries(stats.bySource ?? {}).sort(([, a], [, b]) => b - a);
  const intent = stats.intentBands;
  const statusEntries = Object.entries(byStatus).sort(([, a], [, b]) => b - a);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Total Leads" value={stats.total} accent="text-purple-700" />
        <MetricCard label="High Intent" value={intent.high} accent="text-emerald-600" />
        <MetricCard label="New" value={sumStatuses(byStatus, STATUS_GROUPS.New)} />
        <MetricCard label="Active" value={sumStatuses(byStatus, STATUS_GROUPS.Active)} />
        <MetricCard label="Qualified" value={sumStatuses(byStatus, STATUS_GROUPS.Qualified)} />
        <MetricCard label="Converted" value={sumStatuses(byStatus, STATUS_GROUPS.Converted)} accent="text-emerald-700" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">Lead Source Distribution</h3>
          <div className="mt-4 space-y-3">
            {sources.length === 0 && <p className="text-sm text-gray-500">No leads yet.</p>}
            {sources.map(([src, count]) => (
              <DistributionRow key={src} label={CANONICAL_LEAD_SOURCE_LABELS[src as CanonicalLeadSource] ?? src} count={count} total={stats.total} />
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">Intent Distribution</h3>
          <div className="mt-4 space-y-3">
            <DistributionRow label="High (≥70%)" count={intent.high} total={stats.total} />
            <DistributionRow label="Medium (40–69%)" count={intent.medium} total={stats.total} />
            <DistributionRow label="Low (<40%)" count={intent.low} total={stats.total} />
          </div>
          <div className="mt-5 flex gap-4 border-t border-gray-100 pt-4 text-sm text-gray-600">
            <span>With identity: <strong className="text-gray-900">{stats.withIdentity.toLocaleString()}</strong></span>
            <span>With campaign: <strong className="text-gray-900">{stats.withCampaign.toLocaleString()}</strong></span>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">Status Distribution</h3>
          <div className="mt-4 space-y-3">
            {statusEntries.length === 0 && <p className="text-sm text-gray-500">No leads yet.</p>}
            {statusEntries.map(([s, count]) => (
              <DistributionRow key={s} label={s} count={count} total={stats.total} />
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900">Recent Activity</h3>
        <div className="mt-4 divide-y divide-gray-100">
          {recent.length === 0 && <p className="text-sm text-gray-500">No recent leads.</p>}
          {recent.map((r) => (
            <div key={`${r.source}-${r.sourceRef?.id ?? r.occurredAt}`} className="flex items-center justify-between py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">
                  {r.identity.email ?? r.identity.platform ?? r.unifiedPersonId ?? 'Unknown contact'}
                </p>
                <p className="truncate text-xs text-gray-500">
                  {r.sourceLabel}{r.campaign ? ` · ${r.campaign}` : ''}{r.status ? ` · ${r.status}` : ''}
                </p>
              </div>
              <span className="ml-3 shrink-0 text-xs text-gray-400">{timeAgo(r.occurredAt)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
