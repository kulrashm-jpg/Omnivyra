/**
 * Phase 4 — Opportunity Intelligence Feed UI.
 *
 * Filters: opportunity type chips, platform chips, min confidence,
 * min urgency. Every card surfaces:
 *   • Opportunity type badge
 *   • Score breakdown (base → multipliers → final)
 *   • Matched keywords
 *   • Moderation outcome
 *   • Source trace (execution id, platform, source_identifier, detected_at)
 *   • Cluster pointer
 *
 * Compact list. No layout redesign.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

const OPPORTUNITY_TYPES = [
  'buying_intent',
  'competitor_dissatisfaction',
  'hiring_signal',
  'migration_signal',
  'product_research',
  'integration_need',
  'support_frustration',
  'generic_interest',
] as const;
type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

const TYPE_LABEL: Record<OpportunityType, string> = {
  buying_intent: 'Buying intent',
  competitor_dissatisfaction: 'Competitor pain',
  hiring_signal: 'Hiring signal',
  migration_signal: 'Migration',
  product_research: 'Research',
  integration_need: 'Integration need',
  support_frustration: 'Support pain',
  generic_interest: 'Generic interest',
};

const TYPE_TONE: Record<OpportunityType, string> = {
  buying_intent: 'bg-emerald-100 text-emerald-800',
  competitor_dissatisfaction: 'bg-rose-100 text-rose-800',
  hiring_signal: 'bg-sky-100 text-sky-800',
  migration_signal: 'bg-amber-100 text-amber-800',
  product_research: 'bg-indigo-100 text-indigo-800',
  integration_need: 'bg-cyan-100 text-cyan-800',
  support_frustration: 'bg-pink-100 text-pink-800',
  generic_interest: 'bg-slate-100 text-slate-600',
};

type OpportunityExplanation = {
  why: string;
  matched_keywords: string[];
  score_breakdown: {
    base_total_score: number;
    type_multiplier: number;
    keyword_match_bonus: number;
    moderation_penalty: number;
    final: number;
  };
  source_trace: {
    listening_execution_id: string | null;
    source_type: string | null;
    source_identifier: string | null;
    platform: string;
    detected_at: string | null;
  };
  moderation: { outcome: 'approved' | 'flagged' | 'blocked' | 'requires_review'; reasons: string[] };
  cluster: { cluster_key: string | null; cluster_id: string | null };
};

type FeedItem = {
  id: string;
  signal_id: string;
  opportunity_type: OpportunityType;
  opportunity_score: number;
  confidence_score: number;
  urgency_score: number;
  platform: string;
  source_identifier: string | null;
  detected_reason: string;
  matched_keywords: string[];
  author_metadata: { author_handle?: string | null; platform_user_id?: string | null };
  explanation: OpportunityExplanation;
  /** PR-OPA-1: verbatim source excerpt (max 300 chars). Nullable for legacy rows. */
  signal_excerpt: string | null;
  /** PR-OPA-2: rule-derived next-step guidance. Null when type is generic_interest. */
  suggested_next_action: string | null;
  /** PR-OPA-3: resolved identity fields. Null when platform unsupported or metadata absent. */
  resolved_company: string | null;
  resolved_role: string | null;
  identity_confidence: 'high' | 'medium' | 'low' | null;
  /** PR-OPA-6: read-time-derived priority score the server orders by. */
  priority_score: number | null;
  created_at: string;
};

type FeedResponse = {
  items: FeedItem[];
  next_cursor: string | null;
  total: number;
  type_counts: Record<string, number>;
};

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type Props = {
  companyId: string;
  fetchWithAuth: FetchWithAuth;
};

function fmtPct(value: number | null | undefined): string {
  if (typeof value !== 'number') return '—';
  return `${Math.round(value * 100)}%`;
}

function fmtTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export default function OpportunityFeedPanel({ companyId, fetchWithAuth }: Props) {
  const [typeFilters, setTypeFilters] = useState<OpportunityType[]>([]);
  const [platformFilters, setPlatformFilters] = useState<string[]>([]);
  const [minConfidence, setMinConfidence] = useState<number>(0);
  const [minUrgency, setMinUrgency] = useState<number>(0);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL('/api/active-leads/opportunities', window.location.origin);
      url.searchParams.set('companyId', companyId);
      if (typeFilters.length > 0) url.searchParams.set('types', typeFilters.join(','));
      if (platformFilters.length > 0) url.searchParams.set('platforms', platformFilters.join(','));
      if (minConfidence > 0) url.searchParams.set('minConfidence', String(minConfidence));
      if (minUrgency > 0) url.searchParams.set('minUrgency', String(minUrgency));
      const resp = await fetchWithAuth(url.pathname + url.search);
      if (!resp.ok) throw new Error(`Failed to load (${resp.status})`);
      const json = (await resp.json()) as FeedResponse;
      setItems(json.items ?? []);
      setCounts(json.type_counts ?? {});
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load opportunities');
    } finally {
      setLoading(false);
    }
  }, [companyId, fetchWithAuth, typeFilters, platformFilters, minConfidence, minUrgency]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleType = useCallback((t: OpportunityType) => {
    setTypeFilters((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }, []);

  const togglePlatform = useCallback((p: string) => {
    setPlatformFilters((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }, []);

  const platformsInUse = useMemo(() => {
    return [...new Set(items.map((i) => i.platform))];
  }, [items]);

  if (!companyId) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Opportunity Intelligence Feed</h3>
          <p className="text-xs text-slate-500">
            Every opportunity carries an explanation — score breakdown, matched keywords, moderation outcome, and source trace.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-4 py-2 text-[11px]">
        {OPPORTUNITY_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => toggleType(t)}
            className={`rounded px-1.5 py-0.5 ${
              typeFilters.includes(t) ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {TYPE_LABEL[t]} ({counts[t] ?? 0})
          </button>
        ))}
      </div>

      {platformsInUse.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-4 py-2 text-[11px]">
          <span className="text-slate-500">Platform:</span>
          {platformsInUse.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => togglePlatform(p)}
              className={`rounded px-1.5 py-0.5 ${
                platformFilters.includes(p) ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-2 text-[11px] text-slate-600">
        <label className="flex items-center gap-1">
          Min confidence
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(minConfidence * 100)}
            onChange={(e) => setMinConfidence(Number(e.target.value) / 100)}
            className="w-24"
          />
          <span className="w-8 text-right">{fmtPct(minConfidence)}</span>
        </label>
        <label className="flex items-center gap-1">
          Min urgency
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(minUrgency * 100)}
            onChange={(e) => setMinUrgency(Number(e.target.value) / 100)}
            className="w-24"
          />
          <span className="w-8 text-right">{fmtPct(minUrgency)}</span>
        </label>
      </div>

      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</div>
      )}

      {items.length === 0 ? (
        <div className="px-4 py-3 text-xs text-slate-500">
          {loading ? 'Loading…' : 'No opportunities match the current filters yet.'}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => {
            const isExpanded = expanded === item.id;
            const breakdown = item.explanation.score_breakdown;
            return (
              <li key={item.id} className="px-4 py-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${TYPE_TONE[item.opportunity_type]}`}>
                        {TYPE_LABEL[item.opportunity_type]}
                      </span>
                      <span className="text-[10px] text-slate-500">{item.platform}</span>
                      {item.source_identifier && (
                        <span className="text-[10px] text-slate-500">· {item.source_identifier}</span>
                      )}
                      {item.author_metadata?.author_handle && (
                        <span className="text-[10px] text-slate-500">· {item.author_metadata.author_handle}</span>
                      )}
                      <span className="text-[10px] text-slate-400">· {fmtTime(item.created_at)}</span>
                    </div>
                    <p className="mt-1 text-slate-700">{item.detected_reason}</p>
                    {item.signal_excerpt && (
                      <figure className="mt-2 rounded-md border-l-2 border-violet-300 bg-violet-50/60 px-3 py-2">
                        <figcaption className="text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                          What was said
                        </figcaption>
                        <blockquote className="mt-1 text-[13px] italic leading-snug text-slate-800">
                          “{item.signal_excerpt}”
                        </blockquote>
                      </figure>
                    )}
                    {item.suggested_next_action && (
                      <div className="mt-2 rounded-md border-l-2 border-emerald-300 bg-emerald-50/60 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                          Suggested Next Action
                        </div>
                        <p className="mt-0.5 text-[13px] font-medium text-slate-800">
                          {item.suggested_next_action}
                        </p>
                      </div>
                    )}
                    {(item.identity_confidence === 'high' || item.identity_confidence === 'medium') && (
                      <div className="mt-2 rounded-md border-l-2 border-sky-300 bg-sky-50/60 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-700">
                          Identity
                        </div>
                        <dl className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                          {item.resolved_company && (
                            <>
                              <dt className="font-medium text-slate-500">Company:</dt>
                              <dd className="text-slate-800">{item.resolved_company}</dd>
                            </>
                          )}
                          {item.resolved_role && (
                            <>
                              <dt className="font-medium text-slate-500">Role:</dt>
                              <dd className="text-slate-800">{item.resolved_role}</dd>
                            </>
                          )}
                          <dt className="font-medium text-slate-500">Confidence:</dt>
                          <dd className={item.identity_confidence === 'high' ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
                            {item.identity_confidence === 'high' ? 'High' : 'Medium'}
                          </dd>
                        </dl>
                      </div>
                    )}
                    <div className="mt-1 grid grid-cols-2 gap-x-3 text-[11px] text-slate-500 md:grid-cols-4">
                      <span>Opp <strong className="text-slate-700">{fmtPct(item.opportunity_score)}</strong></span>
                      <span>Confidence <strong className="text-slate-700">{fmtPct(item.confidence_score)}</strong></span>
                      <span>Urgency <strong className="text-slate-700">{fmtPct(item.urgency_score)}</strong></span>
                      <span>Moderation <strong className="text-slate-700">{item.explanation.moderation.outcome}</strong></span>
                    </div>
                    {item.matched_keywords.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {item.matched_keywords.slice(0, 6).map((k) => (
                          <span key={k} className="rounded bg-slate-50 px-1 py-0.5 text-[10px] text-slate-600">{k}</span>
                        ))}
                      </div>
                    )}
                    {isExpanded && (
                      <div className="mt-2 rounded border border-slate-200 bg-slate-50 px-2 py-2 text-[11px] text-slate-600">
                        <div className="font-semibold text-slate-700">Score breakdown</div>
                        <div className="mt-1 grid grid-cols-2 gap-x-3">
                          <span>Base total: <strong>{breakdown.base_total_score}</strong></span>
                          <span>Type ×: <strong>{breakdown.type_multiplier}</strong></span>
                          <span>Keyword bonus: <strong>{breakdown.keyword_match_bonus}</strong></span>
                          <span>Moderation ×: <strong>{breakdown.moderation_penalty}</strong></span>
                          <span className="col-span-2 mt-1 border-t border-slate-200 pt-1">
                            Final: <strong>{breakdown.final}</strong>
                          </span>
                        </div>
                        <div className="mt-2 font-semibold text-slate-700">Provenance</div>
                        <div className="mt-1 break-all">
                          Exec: <code className="text-slate-500">{item.explanation.source_trace.listening_execution_id ?? '—'}</code>
                        </div>
                        <div>Detected at: {fmtTime(item.explanation.source_trace.detected_at)}</div>
                        {item.explanation.cluster.cluster_key && (
                          <div>Cluster: <code className="text-slate-500">{item.explanation.cluster.cluster_key}</code></div>
                        )}
                        {item.explanation.moderation.reasons.length > 0 && (
                          <div className="mt-1 text-slate-500">
                            Moderation reasons: {item.explanation.moderation.reasons.join(', ')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpanded((cur) => (cur === item.id ? null : item.id))}
                    className="shrink-0 rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                  >
                    {isExpanded ? 'Hide' : 'Explain'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
