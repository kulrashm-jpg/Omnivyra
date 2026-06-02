/**
 * PR-UX-1 — Active Leads workspace, restructured into 3 primary tabs.
 *
 * Replaces the long-scroll 6-section layout with sticky-nav tabs:
 *
 *   Discover      — "Where should I listen?"
 *   Monitor       — "What am I actively monitoring?"
 *   Opportunities — "What should I act on?"
 *
 * Every panel from the prior layout is preserved; nothing is deleted.
 * The 6 ops/SRE/compliance panels not named in the new IA (Enterprise
 * Console/Scale/Runtime + Production Maturity/Launch + GA Launch) live
 * under a collapsed "Advanced Operations" disclosure on the Monitor tab
 * so they remain reachable.
 *
 * No backend changes, no API changes, no scoring changes — UX only.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';

import ExecutiveSummaryStrip from './ExecutiveSummaryStrip';
import CoverageGapInsights from './CoverageGapInsights';
import RecommendedSourcesPanel from './RecommendedSourcesPanel';
import ConnectedSourceAuditPanel from './ConnectedSourceAuditPanel';
import LeadsCapabilityStatusPanel from './LeadsCapabilityStatusPanel';
import ListeningExecutionsPanel from './ListeningExecutionsPanel';
import CommunityDiscoveryPanel from './CommunityDiscoveryPanel';
import OpportunityFeedPanel from './OpportunityFeedPanel';
import IntelligencePanel from './IntelligencePanel';
import AnalystWorkspacePanel from './AnalystWorkspacePanel';
import EnterpriseConsolePanel from './EnterpriseConsolePanel';
import EnterpriseScalePanel from './EnterpriseScalePanel';
import EnterpriseRuntimePanel from './EnterpriseRuntimePanel';
import ProductionMaturityPanel from './ProductionMaturityPanel';
import ProductionLaunchPanel from './ProductionLaunchPanel';
import GALaunchPanel from './GALaunchPanel';
import EmptyState from '../../shared/EmptyState';
import type { OpportunityTabProps } from './types';

type FetchWithAuth = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
type TabKey = 'opportunities' | 'monitor' | 'discover';

type SourceType = 'engagement' | 'listening';
type SignalContact = { contact_id: string | null; platform: string | null; platform_user_id: string | null; display_name: string | null };
type LeadSignal = {
  id: string;
  organization_id: string;
  source_type: SourceType;
  source_id: string;
  thread_id: string | null;
  platform: string | null;
  platform_user_id: string | null;
  content_text: string;
  intent_score: number | null;
  urgency_score: number | null;
  icp_score: number | null;
  confidence_score: number | null;
  total_score: number | null;
  detected_at: string | null;
  contact_key: string | null;
  metadata: Record<string, unknown>;
  contact?: SignalContact | null;
};
type SignalsResponse = { items: LeadSignal[]; total: number; page: number; page_size: number; has_more: boolean };
type SignalGroup = { key: string; title: string; fallbackLabel: string; latestSignal: LeadSignal; signals: LeadSignal[]; maxTotalScore: number };
type TabSummary = {
  newLeadItems: number | null;
  totalLeadItems: number | null;
  connectedSources: number | null;
  activeSources: number | null;
  recommendedSources: number | null;
};

const EMPTY_TAB_SUMMARY: TabSummary = {
  newLeadItems: null,
  totalLeadItems: null,
  connectedSources: null,
  activeSources: null,
  recommendedSources: null,
};

type SourceLite = {
  source_identifier: string;
  status: string;
};

type SourcesLite = { items?: SourceLite[] };

type OpportunitiesLite = {
  total?: number;
  items?: Array<{ created_at?: string | null }>;
};

type DiscoveryItemLite = { source_identifier?: string; source_id?: string };
type DiscoveryLite = { items?: DiscoveryItemLite[] };

const PAGE_SIZE = 20;
const FILTER_DEBOUNCE_MS = 250;

function formatDateLabel(value: string | null): string {
  if (!value) return 'Unknown date';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown date';
  return parsed.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function toPercent(value: number | null | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}
function displayContact(signal: LeadSignal): { title: string; fallbackLabel: string } {
  const displayName = signal.contact?.display_name || (typeof signal.metadata?.display_name === 'string' ? signal.metadata.display_name : null);
  const authorHandle = (typeof signal.metadata?.author_handle === 'string' ? signal.metadata.author_handle : null) || signal.platform_user_id;
  return {
    title: displayName || authorHandle || 'Unknown contact',
    fallbackLabel: authorHandle || signal.source_id,
  };
}
function buildGroupKey(signal: LeadSignal): string {
  if (signal.contact_key) return `contact:${signal.contact_key}`;
  if (signal.source_type === 'engagement' && signal.thread_id) return `thread:${signal.thread_id}`;
  return `source:${signal.source_id}`;
}
function groupSignals(signals: LeadSignal[]): SignalGroup[] {
  const byGroup = new Map<string, LeadSignal[]>();
  for (const signal of signals) {
    const key = buildGroupKey(signal);
    const existing = byGroup.get(key) ?? [];
    existing.push(signal);
    byGroup.set(key, existing);
  }
  return Array.from(byGroup.entries())
    .map(([key, groupedSignals]) => {
      const sorted = [...groupedSignals].sort((a, b) => {
        const ta = a.detected_at ? new Date(a.detected_at).getTime() : 0;
        const tb = b.detected_at ? new Date(b.detected_at).getTime() : 0;
        return tb - ta;
      });
      const latestSignal = sorted[0];
      const maxTotalScore = Math.max(...sorted.map((signal) => signal.total_score ?? 0));
      const { title, fallbackLabel } = displayContact(latestSignal);
      return { key, title, fallbackLabel, latestSignal, signals: sorted, maxTotalScore };
    })
    .sort((a, b) => {
      const scoreDelta = b.maxTotalScore - a.maxTotalScore;
      if (scoreDelta !== 0) return scoreDelta;
      const ta = a.latestSignal.detected_at ? new Date(a.latestSignal.detected_at).getTime() : 0;
      const tb = b.latestSignal.detected_at ? new Date(b.latestSignal.detected_at).getTime() : 0;
      return tb - ta;
    });
}

export default function CanonicalActiveLeadsTab({ companyId, fetchWithAuth }: OpportunityTabProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('opportunities');
  const tabSummary = useTabSummary(companyId, fetchWithAuth);

  if (!companyId) {
    return <div className="py-4 text-sm text-gray-500">Select a company to view the Active Leads workspace.</div>;
  }

  return (
    <div className="space-y-6">
      <ExecutiveSummaryStrip
        companyId={companyId}
        fetchWithAuth={fetchWithAuth}
        onNavigate={setActiveTab}
      />
      <CoverageGapInsights
        companyId={companyId}
        fetchWithAuth={fetchWithAuth}
        onNavigate={setActiveTab}
      />
      <StickyTabNav active={activeTab} onChange={setActiveTab} summary={tabSummary} />

      {activeTab === 'discover' && (
        <DiscoverTab companyId={companyId} fetchWithAuth={fetchWithAuth} />
      )}
      {activeTab === 'monitor' && (
        <MonitorTab companyId={companyId} fetchWithAuth={fetchWithAuth} />
      )}
      {activeTab === 'opportunities' && (
        <OpportunitiesTab companyId={companyId} fetchWithAuth={fetchWithAuth} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sticky tab nav
// ---------------------------------------------------------------------------

const TABS: Array<{ key: TabKey; label: string; sub: string }> = [
  { key: 'opportunities', label: 'Active Leads', sub: 'Who needs action now?' },
  { key: 'monitor',       label: 'Listening Setup', sub: 'What is monitoring?' },
  { key: 'discover',      label: 'Find Sources', sub: 'Where else to listen?' },
];

function useTabSummary(companyId: string | null, fetchWithAuth: FetchWithAuth): TabSummary {
  const [summary, setSummary] = useState<TabSummary>(EMPTY_TAB_SUMMARY);

  useEffect(() => {
    if (!companyId) {
      setSummary(EMPTY_TAB_SUMMARY);
      return;
    }
    let cancelled = false;
    const safeJson = async <T,>(p: Promise<Response>): Promise<T | null> => {
      try {
        const response = await p;
        if (!response.ok) return null;
        return (await response.json().catch(() => null)) as T | null;
      } catch {
        return null;
      }
    };

    const load = async () => {
      const [opportunities, sources, discovery] = await Promise.all([
        safeJson<OpportunitiesLite>(
          fetchWithAuth(`/api/active-leads/opportunities?companyId=${encodeURIComponent(companyId)}`),
        ),
        safeJson<SourcesLite>(
          fetchWithAuth(`/api/active-leads/sources?companyId=${encodeURIComponent(companyId)}`),
        ),
        safeJson<DiscoveryLite>(
          fetchWithAuth('/api/active-leads/source-recommendations/discovery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companyId }),
          }),
        ),
      ]);
      if (cancelled) return;

      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const newLeadItems = opportunities?.items
        ? opportunities.items.filter((item) => {
            if (!item.created_at) return false;
            const createdAt = new Date(item.created_at).getTime();
            return Number.isFinite(createdAt) && createdAt >= sevenDaysAgo;
          }).length
        : null;
      const sourceItems = sources?.items ?? null;
      const connectedIds = new Set((sourceItems ?? []).map((source) => source.source_identifier.toLowerCase()));
      const recommendedSources = discovery?.items
        ? discovery.items.filter((item) => {
            const id = (item.source_identifier ?? item.source_id ?? '').toString().toLowerCase();
            const bare = id.includes(':') ? id.split(':').slice(1).join(':') : id;
            return id && !connectedIds.has(id) && !connectedIds.has(bare);
          }).length
        : null;

      setSummary({
        newLeadItems,
        totalLeadItems: opportunities?.total ?? null,
        connectedSources: sourceItems ? sourceItems.length : null,
        activeSources: sourceItems ? sourceItems.filter((source) => source.status === 'active').length : null,
        recommendedSources,
      });
    };

    void load();
    return () => { cancelled = true; };
  }, [companyId, fetchWithAuth]);

  return summary;
}

function formatCount(value: number | null): string {
  return value === null ? '-' : String(value);
}

function tabBadge(tab: TabKey, summary: TabSummary): string {
  if (tab === 'opportunities') {
    return `${formatCount(summary.newLeadItems)} new / ${formatCount(summary.totalLeadItems)} total`;
  }
  if (tab === 'monitor') {
    return `${formatCount(summary.connectedSources)} connected / ${formatCount(summary.activeSources)} active`;
  }
  return `${formatCount(summary.recommendedSources)} recommended`;
}

function StickyTabNav({ active, onChange, summary }: { active: TabKey; onChange: (t: TabKey) => void; summary: TabSummary }) {
  return (
    <nav
      role="tablist"
      aria-label="Active Leads sections"
      className="sticky top-0 z-30 -mx-4 border-b border-gray-200 bg-gray-50/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      <div className="flex gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-gray-200">
        {TABS.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(t.key)}
              className={`flex-1 rounded-lg px-3 py-2 text-left transition ${
                isActive
                  ? 'bg-gray-900 text-white shadow-sm'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <div className="text-sm font-semibold">{t.label}</div>
              <div className={`text-[11px] ${isActive ? 'text-gray-300' : 'text-gray-500'}`}>{t.sub}</div>
              <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                isActive ? 'bg-white/15 text-white' : 'bg-gray-100 text-gray-600'
              }`}>
                {tabBadge(t.key, summary)}
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function SectionHeader({ eyebrow, title, subtitle, accent }: { eyebrow: string; title: string; subtitle?: string; accent?: string }) {
  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${accent ?? 'text-gray-500'}`}>{eyebrow}</p>
      <h2 className="mt-1 text-xl font-bold text-gray-900">{title}</h2>
      {subtitle && <p className="mt-1 max-w-2xl text-sm text-gray-600">{subtitle}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Discover
// ---------------------------------------------------------------------------

function DiscoverTab({ companyId, fetchWithAuth }: { companyId: string; fetchWithAuth: FetchWithAuth }) {
  return (
    <div className="space-y-8">
      {/* Recommended Sources */}
      <RecommendedSourcesPanel companyId={companyId} fetchWithAuth={fetchWithAuth} />

      {/* Community Discovery */}
      <section className="space-y-3">
        <SectionHeader
          eyebrow="Community Discovery"
          title="Add more listening sources when coverage is thin"
          subtitle="Choose an interest first. Details appear only when you want to tune the discovery."
          accent="text-emerald-700"
        />
        <CommunityDiscoveryPanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
      </section>

      {/* Connected Source Audit */}
      <ConnectedSourceAuditPanel companyId={companyId} fetchWithAuth={fetchWithAuth} />

      {/* Source Intelligence */}
      <section className="space-y-3">
        <SectionHeader
          eyebrow="Source Intelligence"
          title="Source performance"
          subtitle="Use this when you need to understand why certain sources are or are not producing useful leads."
          accent="text-indigo-700"
        />
        <IntelligencePanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
      </section>

      {/* Recommendation Scoring */}
      <section className="space-y-3">
        <SectionHeader
          eyebrow="Recommendation Scoring"
          title="Recommendation detail"
          subtitle="Support detail for analysts. Most users only need this when a recommendation looks surprising."
          accent="text-purple-700"
        />
        <AnalystWorkspacePanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Monitor
// ---------------------------------------------------------------------------

function MonitorTab({ companyId, fetchWithAuth }: { companyId: string; fetchWithAuth: FetchWithAuth }) {
  const [listeningSources, setListeningSources] = useState<Array<{
    id: string;
    display_name: string;
    source_identifier: string;
    status: string;
    metadata?: { platform?: string; keywords?: string[] } & Record<string, unknown>;
  }>>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetchWithAuth(
          `/api/active-leads/sources?companyId=${encodeURIComponent(companyId)}`,
        );
        if (!resp.ok) return;
        const json = (await resp.json()) as {
          items?: Array<{
            id: string;
            display_name: string;
            source_identifier: string;
            status: string;
            metadata?: Record<string, unknown>;
          }>;
        };
        if (cancelled) return;
        setListeningSources(
          (json.items ?? []).map((s) => ({
            id: s.id,
            display_name: s.display_name,
            source_identifier: s.source_identifier,
            status: s.status,
            metadata: s.metadata as { platform?: string; keywords?: string[] } & Record<string, unknown> | undefined,
          })),
        );
      } catch {
        // best-effort
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, fetchWithAuth]);

  return (
    <div className="space-y-8">
      {/* Active Listening Profiles + Integration Status + Platform Enablement
          all live inside LeadsCapabilityStatusPanel as its three sections. */}
      <section className="space-y-3">
        <SectionHeader
          eyebrow="Active Listening Profiles · Integration Status · Platform Enablement"
          title="What is currently monitoring"
          subtitle="Use this only when leads are missing, a platform is disconnected, or you need to change coverage."
          accent="text-sky-700"
        />
        <LeadsCapabilityStatusPanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
      </section>

      {/* Listening Configuration + Listening Executions */}
      <section className="space-y-3">
        <SectionHeader
          eyebrow="Listening Configuration · Listening Executions"
          title="Run or inspect source scans"
          subtitle="Operational controls for refreshing signals. Not required for daily lead review."
          accent="text-orange-700"
        />
        <ListeningExecutionsPanel
          companyId={companyId}
          fetchWithAuth={fetchWithAuth}
          sources={listeningSources}
        />
      </section>

      {/* Advanced Operations — preserved functionality, collapsed by default */}
      <section>
        <SectionHeader
          eyebrow="Advanced Operations"
          title="Ops, governance, runtime, and launch consoles"
          subtitle="Collapsed by default. Primarily for operators and admins."
          accent="text-gray-500"
        />
        <div className="mt-3 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
            className="flex w-full items-center justify-between px-6 py-4 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <span>{advancedOpen ? 'Hide' : 'Show'} advanced operations panels</span>
            <span className="text-xs text-gray-400">{advancedOpen ? '▲' : '▼'}</span>
          </button>
          {advancedOpen && (
            <div className="space-y-4 border-t border-gray-200 bg-gray-50 p-6">
              <EnterpriseConsolePanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
              <EnterpriseScalePanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
              <EnterpriseRuntimePanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
              <ProductionMaturityPanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
              <ProductionLaunchPanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
              <GALaunchPanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3 — Opportunities
// ---------------------------------------------------------------------------

function OpportunitiesTab({ companyId, fetchWithAuth }: { companyId: string; fetchWithAuth: FetchWithAuth }) {
  const router = useRouter();

  // Lead Signals workspace state (preserved from prior layout)
  const [sourceType, setSourceType] = useState<'all' | SourceType>('all');
  const [platform, setPlatform] = useState<string>('all');
  const [minScore, setMinScore] = useState<string>('');
  const [maxScore, setMaxScore] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [debouncedFilters, setDebouncedFilters] = useState({
    sourceType: 'all' as 'all' | SourceType,
    platform: 'all', minScore: '', maxScore: '', dateFrom: '', dateTo: '',
  });
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<LeadSignal[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<SignalGroup | null>(null);
  const [detailSignals, setDetailSignals] = useState<LeadSignal[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedFilters({ sourceType, platform, minScore, maxScore, dateFrom, dateTo });
      setPage(1);
    }, FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [sourceType, platform, minScore, maxScore, dateFrom, dateTo]);

  const fetchSignals = useCallback(async (targetPage: number, append: boolean) => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        organization_id: companyId,
        page: String(targetPage),
        page_size: String(PAGE_SIZE),
      });
      if (debouncedFilters.sourceType !== 'all') params.set('source_type', debouncedFilters.sourceType);
      if (debouncedFilters.platform !== 'all') params.set('platform', debouncedFilters.platform);
      if (debouncedFilters.minScore.trim()) params.set('min_score', debouncedFilters.minScore.trim());
      if (debouncedFilters.maxScore.trim()) params.set('max_score', debouncedFilters.maxScore.trim());
      if (debouncedFilters.dateFrom) params.set('date_from', debouncedFilters.dateFrom);
      if (debouncedFilters.dateTo) params.set('date_to', debouncedFilters.dateTo);

      const response = await fetchWithAuth(`/api/leads/signals?${params.toString()}`, { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as Partial<SignalsResponse> & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Failed to load lead signals');
      const nextItems = Array.isArray(body.items) ? body.items : [];
      setItems((current) => (append ? [...current, ...nextItems] : nextItems));
      setTotal(typeof body.total === 'number' ? body.total : nextItems.length);
      setHasMore(Boolean(body.has_more));
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load lead signals');
      if (!append) setItems([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, debouncedFilters, fetchWithAuth]);

  useEffect(() => {
    void fetchSignals(page, page > 1);
  }, [fetchSignals, page]);

  const groups = useMemo(() => groupSignals(items), [items]);
  const platformOptions = useMemo(() => {
    const values = new Set<string>();
    for (const item of items) if (item.platform) values.add(item.platform);
    return Array.from(values).sort();
  }, [items]);

  useEffect(() => {
    if (!selectedGroup) {
      setDetailSignals([]);
      setDetailError(null);
      return;
    }
    const fetchDetails = async () => {
      if (!companyId) return;
      setDetailLoading(true);
      setDetailError(null);
      try {
        const params = new URLSearchParams({ organization_id: companyId, page: '1', page_size: '50' });
        if (selectedGroup.latestSignal.contact_key) {
          params.set('contact_key', selectedGroup.latestSignal.contact_key);
        } else if (selectedGroup.latestSignal.source_type === 'engagement' && selectedGroup.latestSignal.thread_id) {
          params.set('thread_id', selectedGroup.latestSignal.thread_id);
        } else {
          params.set('source_type', selectedGroup.latestSignal.source_type);
          params.set('source_id', selectedGroup.latestSignal.source_id);
        }
        const response = await fetchWithAuth(`/api/leads/signals?${params.toString()}`, { cache: 'no-store' });
        const body = (await response.json().catch(() => ({}))) as Partial<SignalsResponse> & { error?: string };
        if (!response.ok) throw new Error(body.error || 'Failed to load lead signal details');
        setDetailSignals(Array.isArray(body.items) ? body.items : []);
      } catch (fetchError) {
        setDetailError(fetchError instanceof Error ? fetchError.message : 'Failed to load lead signal details');
        setDetailSignals([]);
      } finally {
        setDetailLoading(false);
      }
    };
    void fetchDetails();
  }, [companyId, fetchWithAuth, selectedGroup]);

  return (
    <div className="space-y-8">
      {/* Opportunity-type filter chips (visual nav; OpportunityFeedPanel owns
          its own filter state — these chips are scroll/section labels.) */}
      <section>
        <SectionHeader
          eyebrow="Active lead queue"
          title="Leads and opportunities that need action"
          subtitle="Review the strongest signals first, then open details only when you need proof or source context."
          accent="text-purple-700"
        />
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <FilterChip label="Buying Intent" tone="emerald" />
          <FilterChip label="Competitor Pain" tone="rose" />
          <FilterChip label="Migration Signals" tone="amber" />
          <FilterChip label="Research Signals" tone="indigo" />
        </div>
        <div className="mt-4">
          <OpportunityFeedPanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
        </div>
      </section>

      {/* Lead Signals workspace — supporting detail, collapsed by default. */}
      <details className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <summary className="cursor-pointer list-none px-6 py-4">
          <SectionHeader
            eyebrow="Supporting detail"
            title="Raw signals grouped by contact"
            subtitle="Open this when you need to inspect the evidence behind the lead queue."
            accent="text-violet-700"
          />
        </summary>
      <section className="space-y-3 border-t border-gray-100 px-6 pb-6 pt-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Lead Signals</h3>
              <p className="mt-1 text-sm text-gray-500">Will be replaced by the Lead object workspace once that rollout completes.</p>
            </div>
            <div className="text-sm text-gray-500">
              {loading && items.length === 0 ? 'Loading signals...' : `${total} signal${total === 1 ? '' : 's'} loaded`}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
            <label className="space-y-1 text-xs text-gray-500">
              <span className="block">Source type</span>
              <select
                value={sourceType}
                onChange={(event) => setSourceType(event.target.value as 'all' | SourceType)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
              >
                <option value="all">All sources</option>
                <option value="engagement">Engagement</option>
                <option value="listening">Listening</option>
              </select>
            </label>
            <label className="space-y-1 text-xs text-gray-500">
              <span className="block">Platform</span>
              <select
                value={platform}
                onChange={(event) => setPlatform(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
              >
                <option value="all">All platforms</option>
                {platformOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-gray-500">
              <span className="block">Min score</span>
              <input type="number" min="0" max="1" step="0.01" value={minScore}
                onChange={(event) => setMinScore(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700" placeholder="0.00" />
            </label>
            <label className="space-y-1 text-xs text-gray-500">
              <span className="block">Max score</span>
              <input type="number" min="0" max="1" step="0.01" value={maxScore}
                onChange={(event) => setMaxScore(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700" placeholder="1.00" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-xs text-gray-500">
                <span className="block">From</span>
                <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700" />
              </label>
              <label className="space-y-1 text-xs text-gray-500">
                <span className="block">To</span>
                <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700" />
              </label>
            </div>
          </div>

          {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

          {groups.length === 0 && !loading ? (
            <div className="mt-6">
              <EmptyState
                tone="no-results"
                title="No lead signals found"
                description="Adjust the filters or wait for the canonical signal feed to populate."
                primaryAction={{
                  label: 'Reset filters',
                  onClick: () => {
                    setSourceType('all'); setPlatform('all'); setMinScore(''); setMaxScore(''); setDateFrom(''); setDateTo('');
                  },
                }}
              />
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
              <div className="space-y-3">
                {groups.map((group) => {
                  const active = selectedGroup?.key === group.key;
                  const latest = group.latestSignal;
                  const labels = displayContact(latest);
                  return (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() => setSelectedGroup(group)}
                      className={`w-full rounded-xl border bg-white p-4 text-left shadow-sm transition ${
                        active ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-gray-200 hover:border-indigo-300'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-gray-800">{labels.title}</span>
                            {labels.title !== labels.fallbackLabel && (
                              <span className="text-xs text-gray-400">@{labels.fallbackLabel}</span>
                            )}
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              latest.source_type === 'engagement' ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700'
                            }`}>
                              {latest.source_type}
                            </span>
                          </div>
                          <p className="line-clamp-2 text-sm leading-6 text-gray-600">{latest.content_text}</p>
                        </div>
                        <div className="space-y-1 text-right">
                          <div className="text-sm font-semibold text-gray-800">{toPercent(group.maxTotalScore)}</div>
                          <div className="text-xs text-gray-500">{formatDateLabel(latest.detected_at)}</div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-700">{latest.platform || 'Unknown platform'}</span>
                        <span>{group.signals.length} signal{group.signals.length === 1 ? '' : 's'}</span>
                        <span>Intent {toPercent(latest.intent_score)}</span>
                        <span>Urgency {toPercent(latest.urgency_score)}</span>
                        <span>ICP {toPercent(latest.icp_score)}</span>
                      </div>
                    </button>
                  );
                })}

                {hasMore && (
                  <button
                    type="button"
                    onClick={() => setPage((current) => current + 1)}
                    disabled={loading}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {loading ? 'Loading...' : 'Load more signals'}
                  </button>
                )}
              </div>

              <aside className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                {!selectedGroup ? (
                  <div className="py-6 text-sm text-gray-500">Select a lead signal group to inspect related activity.</div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-gray-800">{selectedGroup.title}</h4>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                          {selectedGroup.latestSignal.source_type}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-500">
                        Showing all signals for the same {selectedGroup.latestSignal.contact_key ? 'contact' : selectedGroup.latestSignal.thread_id ? 'conversation' : 'source'}.
                      </p>
                    </div>

                    {detailError && <div className="text-sm text-red-600">{detailError}</div>}
                    {detailLoading ? (
                      <div className="text-sm text-gray-500">Loading related signals...</div>
                    ) : (
                      <div className="space-y-3">
                        {detailSignals.map((signal) => (
                          <div key={signal.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600">
                                  {signal.platform || 'Unknown platform'}
                                </span>
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                  signal.source_type === 'engagement' ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700'
                                }`}>
                                  {signal.source_type}
                                </span>
                              </div>
                              <div className="text-xs font-medium text-gray-700">{toPercent(signal.total_score)}</div>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-gray-700">{signal.content_text}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                              <span>{formatDateLabel(signal.detected_at)}</span>
                              <span>Confidence {toPercent(signal.confidence_score)}</span>
                              {signal.thread_id && (
                                <button
                                  type="button"
                                  onClick={() => router.push(`/engagement?thread=${encodeURIComponent(signal.thread_id as string)}`)}
                                  className="font-medium text-indigo-600 hover:text-indigo-800"
                                >
                                  View Conversation
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </aside>
            </div>
          )}
        </div>
      </section>
      </details>
    </div>
  );
}

function FilterChip({ label, tone }: { label: string; tone: 'emerald' | 'rose' | 'amber' | 'indigo' }) {
  const tones: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  };
  return <span className={`rounded-full px-2.5 py-1 font-medium ring-1 ${tones[tone]}`}>{label}</span>;
}
