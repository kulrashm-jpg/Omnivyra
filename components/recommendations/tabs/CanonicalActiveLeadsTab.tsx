import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import EmptyState from '../../shared/EmptyState';
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
import type { OpportunityTabProps } from './types';

type SourceType = 'engagement' | 'listening';

type SignalContact = {
  contact_id: string | null;
  platform: string | null;
  platform_user_id: string | null;
  display_name: string | null;
};

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

type SignalsResponse = {
  items: LeadSignal[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
};

type SignalGroup = {
  key: string;
  title: string;
  fallbackLabel: string;
  latestSignal: LeadSignal;
  signals: LeadSignal[];
  maxTotalScore: number;
};

const PAGE_SIZE = 20;
const FILTER_DEBOUNCE_MS = 250;

function formatDateLabel(value: string | null): string {
  if (!value) return 'Unknown date';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown date';
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function toPercent(value: number | null | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function displayContact(signal: LeadSignal): { title: string; fallbackLabel: string } {
  const displayName =
    signal.contact?.display_name ||
    (typeof signal.metadata?.display_name === 'string' ? signal.metadata.display_name : null);
  const authorHandle =
    (typeof signal.metadata?.author_handle === 'string' ? signal.metadata.author_handle : null) ||
    signal.platform_user_id;
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
      return {
        key,
        title,
        fallbackLabel,
        latestSignal,
        signals: sorted,
        maxTotalScore,
      };
    })
    .sort((a, b) => {
      const scoreDelta = b.maxTotalScore - a.maxTotalScore;
      if (scoreDelta !== 0) return scoreDelta;
      const ta = a.latestSignal.detected_at ? new Date(a.latestSignal.detected_at).getTime() : 0;
      const tb = b.latestSignal.detected_at ? new Date(b.latestSignal.detected_at).getTime() : 0;
      return tb - ta;
    });
}

export default function CanonicalActiveLeadsTab({
  companyId,
  fetchWithAuth,
}: OpportunityTabProps) {
  const router = useRouter();
  const [listeningSources, setListeningSources] = useState<Array<{
    id: string;
    display_name: string;
    source_identifier: string;
    status: string;
    metadata?: { platform?: string; keywords?: string[] } & Record<string, unknown>;
  }>>([]);
  const [sourceType, setSourceType] = useState<'all' | SourceType>('all');
  const [platform, setPlatform] = useState<string>('all');
  const [minScore, setMinScore] = useState<string>('');
  const [maxScore, setMaxScore] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [debouncedFilters, setDebouncedFilters] = useState({
    sourceType: 'all' as 'all' | SourceType,
    platform: 'all',
    minScore: '',
    maxScore: '',
    dateFrom: '',
    dateTo: '',
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

  useEffect(() => {
    if (!companyId) {
      setListeningSources([]);
      return;
    }
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
        // Phase 3 — sources fetch is advisory for the executions panel. A
        // failure here should not break the signals view.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, fetchWithAuth]);

  const fetchSignals = useCallback(
    async (targetPage: number, append: boolean) => {
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

        const response = await fetchWithAuth(`/api/leads/signals?${params.toString()}`, {
          cache: 'no-store',
        });
        const body = (await response.json().catch(() => ({}))) as Partial<SignalsResponse> & { error?: string };
        if (!response.ok) {
          throw new Error(body.error || 'Failed to load canonical lead signals');
        }
        const nextItems = Array.isArray(body.items) ? body.items : [];
        setItems((current) => (append ? [...current, ...nextItems] : nextItems));
        setTotal(typeof body.total === 'number' ? body.total : nextItems.length);
        setHasMore(Boolean(body.has_more));
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to load canonical lead signals');
        if (!append) setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [companyId, debouncedFilters, fetchWithAuth]
  );

  useEffect(() => {
    void fetchSignals(page, page > 1);
  }, [fetchSignals, page]);

  const groups = useMemo(() => groupSignals(items), [items]);

  const platformOptions = useMemo(() => {
    const values = new Set<string>();
    for (const item of items) {
      if (item.platform) values.add(item.platform);
    }
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
        const params = new URLSearchParams({
          organization_id: companyId,
          page: '1',
          page_size: '50',
        });
        if (selectedGroup.latestSignal.contact_key) {
          params.set('contact_key', selectedGroup.latestSignal.contact_key);
        } else if (selectedGroup.latestSignal.source_type === 'engagement' && selectedGroup.latestSignal.thread_id) {
          params.set('thread_id', selectedGroup.latestSignal.thread_id);
        } else {
          params.set('source_type', selectedGroup.latestSignal.source_type);
          params.set('source_id', selectedGroup.latestSignal.source_id);
        }

        const response = await fetchWithAuth(`/api/leads/signals?${params.toString()}`, {
          cache: 'no-store',
        });
        const body = (await response.json().catch(() => ({}))) as Partial<SignalsResponse> & { error?: string };
        if (!response.ok) {
          throw new Error(body.error || 'Failed to load lead signal details');
        }
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

  if (!companyId) {
    return <div className="py-4 text-sm text-gray-500">Select a company to view lead signals.</div>;
  }

  return (
    <div className="space-y-6">
      <LeadsCapabilityStatusPanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
      {companyId && (
        <CommunityDiscoveryPanel
          companyId={companyId}
          fetchWithAuth={fetchWithAuth}
        />
      )}
      {companyId && (
        <ListeningExecutionsPanel
          companyId={companyId}
          fetchWithAuth={fetchWithAuth}
          sources={listeningSources}
        />
      )}
      {companyId && (
        <OpportunityFeedPanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
      )}
      {companyId && (
        <IntelligencePanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
      )}
      {companyId && (
        <AnalystWorkspacePanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
      )}
      {companyId && (
        <EnterpriseConsolePanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
      )}
      {companyId && (
        <EnterpriseScalePanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
      )}
      {companyId && (
        <EnterpriseRuntimePanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
      )}
      {companyId && (
        <ProductionMaturityPanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
      )}
      {companyId && (
        <ProductionLaunchPanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
      )}
      {companyId && (
        <GALaunchPanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
      )}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Lead Signals</h3>
            <p className="mt-1 text-sm text-gray-500">
              One workspace for listening and engagement signals, grouped around the best available contact anchor.
            </p>
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
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-gray-500">
            <span className="block">Min score</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={minScore}
              onChange={(event) => setMinScore(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
              placeholder="0.00"
            />
          </label>
          <label className="space-y-1 text-xs text-gray-500">
            <span className="block">Max score</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={maxScore}
              onChange={(event) => setMaxScore(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
              placeholder="1.00"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs text-gray-500">
              <span className="block">From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
              />
            </label>
            <label className="space-y-1 text-xs text-gray-500">
              <span className="block">To</span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
              />
            </label>
          </div>
        </div>
      </section>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {groups.length === 0 && !loading ? (
        <EmptyState
          tone="no-results"
          title="No lead signals found"
          description="Adjust the filters or wait for the canonical signal feed to populate."
          primaryAction={{
            label: 'Reset filters',
            onClick: () => {
              setSourceType('all');
              setPlatform('all');
              setMinScore('');
              setMaxScore('');
              setDateFrom('');
              setDateTo('');
            },
          }}
        />
      ) : (
        <section className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
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
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              latest.source_type === 'engagement'
                                ? 'bg-sky-100 text-sky-700'
                                : 'bg-violet-100 text-violet-700'
                            }`}
                          >
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
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-700">
                        {latest.platform || 'Unknown platform'}
                      </span>
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
                              <span
                                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                  signal.source_type === 'engagement'
                                    ? 'bg-sky-100 text-sky-700'
                                    : 'bg-violet-100 text-violet-700'
                                }`}
                              >
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
        </section>
      )}
    </div>
  );
}
