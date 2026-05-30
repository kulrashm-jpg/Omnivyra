/**
 * Active Leads — Executive Summary Strip.
 *
 * Six at-a-glance metrics rendered directly below the page hero and
 * above the sticky tab navigation. Every metric is derived from data
 * already exposed by Active Leads endpoints — no new backend logic.
 *
 * Endpoints reused (all already in use elsewhere in the workspace):
 *   GET  /api/active-leads/capabilities      (listening-coverage + active profiles)
 *   GET  /api/active-leads/sources           (connected + active profile counts)
 *   GET  /api/active-leads/opportunities     (open + high-intent counts)
 *   POST /api/active-leads/source-recommendations/discovery
 *                                             (recommendations not yet enabled)
 *
 * Each metric tile is a button. Clicking navigates to the relevant tab
 * via the parent-supplied `onNavigate` callback. Loading state shows
 * dashes; partial failures leave the affected metric as a dash and do
 * not block the others.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

type FetchWithAuth = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
type TabKey = 'discover' | 'monitor' | 'opportunities';

type Props = {
  companyId: string;
  fetchWithAuth: FetchWithAuth;
  onNavigate: (tab: TabKey) => void;
};

type Metrics = {
  coveragePct: number | null;
  connectedSources: number | null;
  activeProfiles: number | null;
  openOpportunities: number | null;
  highIntent: number | null;
  recommendedNotEnabled: number | null;
};

const INITIAL_METRICS: Metrics = {
  coveragePct: null,
  connectedSources: null,
  activeProfiles: null,
  openOpportunities: null,
  highIntent: null,
  recommendedNotEnabled: null,
};

type PlatformBucketLite = {
  platform: string;
  state?: string;
  monitoring_ready?: boolean;
};
type CapabilitiesLite = {
  buckets?: {
    listening_enabled?: PlatformBucketLite[];
  };
  all_platforms?: PlatformBucketLite[];
};

type SourceLite = {
  source_identifier: string;
  status: string;
};
type SourcesLite = { items?: SourceLite[] };

type OpportunitiesLite = {
  total?: number;
  type_counts?: Record<string, number>;
};

type DiscoveryItemLite = { source_identifier?: string; source_id?: string };
type DiscoveryLite = { items?: DiscoveryItemLite[] };

export default function ExecutiveSummaryStrip({ companyId, fetchWithAuth, onNavigate }: Props) {
  const [metrics, setMetrics] = useState<Metrics>(INITIAL_METRICS);
  const [loading, setLoading] = useState<boolean>(true);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);

    const safeJson = async <T,>(p: Promise<Response>): Promise<T | null> => {
      try {
        const r = await p;
        if (!r.ok) return null;
        return (await r.json().catch(() => null)) as T | null;
      } catch {
        return null;
      }
    };

    const [capabilities, sources, opportunities, discovery] = await Promise.all([
      safeJson<CapabilitiesLite>(
        fetchWithAuth(`/api/active-leads/capabilities?companyId=${encodeURIComponent(companyId)}`),
      ),
      safeJson<SourcesLite>(
        fetchWithAuth(`/api/active-leads/sources?companyId=${encodeURIComponent(companyId)}`),
      ),
      safeJson<OpportunitiesLite>(
        fetchWithAuth(`/api/active-leads/opportunities?companyId=${encodeURIComponent(companyId)}`),
      ),
      safeJson<DiscoveryLite>(
        fetchWithAuth('/api/active-leads/source-recommendations/discovery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId }),
        }),
      ),
    ]);

    // Listening coverage: enabled platforms / all platforms seen.
    let coveragePct: number | null = null;
    if (capabilities) {
      const all = capabilities.all_platforms?.length ?? 0;
      const enabled = capabilities.buckets?.listening_enabled?.length ?? 0;
      coveragePct = all > 0 ? Math.round((enabled / all) * 100) : 0;
    }

    // Sources counts.
    const sourceItems = sources?.items ?? null;
    const connectedSources = sourceItems ? sourceItems.length : null;
    const activeProfiles = sourceItems
      ? sourceItems.filter((s) => s.status === 'active').length
      : null;

    // Opportunities totals.
    const openOpportunities = opportunities?.total ?? null;
    const highIntent = opportunities?.type_counts?.buying_intent ?? null;

    // Recommended sources not yet enabled.
    let recommendedNotEnabled: number | null = null;
    if (discovery) {
      const recItems = discovery.items ?? [];
      const connectedIds = new Set((sourceItems ?? []).map((s) => s.source_identifier.toLowerCase()));
      recommendedNotEnabled = recItems.filter((rec) => {
        const id = (rec.source_identifier ?? rec.source_id ?? '').toString().toLowerCase();
        const bare = id.includes(':') ? id.split(':').slice(1).join(':') : id;
        return id && !connectedIds.has(bare) && !connectedIds.has(id);
      }).length;
    }

    setMetrics({
      coveragePct,
      connectedSources,
      activeProfiles,
      openOpportunities,
      highIntent,
      recommendedNotEnabled,
    });
    setLoading(false);
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    void load();
  }, [load]);

  const tiles = useMemo(() => buildTiles(metrics, onNavigate), [metrics, onNavigate]);

  return (
    <section
      aria-label="Active Leads summary"
      className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
            At a glance
          </p>
          <h2 className="mt-0.5 text-sm font-semibold text-gray-800">Platform status</h2>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-xs font-medium text-gray-500 hover:text-gray-700 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <Tile key={t.key} loading={loading} {...t} />
        ))}
      </div>
    </section>
  );
}

type TileSpec = {
  key: string;
  label: string;
  value: string;
  accent: string;
  onClick: () => void;
};

function buildTiles(metrics: Metrics, onNavigate: (tab: TabKey) => void): TileSpec[] {
  const fmt = (v: number | null): string => (v === null ? '—' : String(v));
  const pct = (v: number | null): string => (v === null ? '—' : `${v}%`);
  return [
    {
      key: 'coverage',
      label: 'Listening Coverage',
      value: pct(metrics.coveragePct),
      accent: 'text-sky-700',
      onClick: () => onNavigate('monitor'),
    },
    {
      key: 'connected',
      label: 'Connected Sources',
      value: fmt(metrics.connectedSources),
      accent: 'text-gray-800',
      onClick: () => onNavigate('monitor'),
    },
    {
      key: 'active',
      label: 'Active Profiles',
      value: fmt(metrics.activeProfiles),
      accent: 'text-emerald-700',
      onClick: () => onNavigate('monitor'),
    },
    {
      key: 'open',
      label: 'Open Opportunities',
      value: fmt(metrics.openOpportunities),
      accent: 'text-purple-700',
      onClick: () => onNavigate('opportunities'),
    },
    {
      key: 'high_intent',
      label: 'High Intent',
      value: fmt(metrics.highIntent),
      accent: 'text-rose-700',
      onClick: () => onNavigate('opportunities'),
    },
    {
      key: 'not_enabled',
      label: 'Recommended · Not Enabled',
      value: fmt(metrics.recommendedNotEnabled),
      accent: 'text-amber-700',
      onClick: () => onNavigate('discover'),
    },
  ];
}

function Tile({
  label,
  value,
  accent,
  loading,
  onClick,
}: {
  label: string;
  value: string;
  accent: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2.5 text-left transition hover:border-gray-300 hover:bg-white hover:shadow-sm"
    >
      <div className="text-[11px] font-medium text-gray-500 group-hover:text-gray-700">{label}</div>
      <div className={`mt-1 text-xl font-bold tracking-tight ${accent}`}>
        {loading ? <span className="inline-block h-5 w-10 animate-pulse rounded bg-gray-200" /> : value}
      </div>
    </button>
  );
}
