/**
 * Phase 4 — Community discovery + recommendation review panel.
 *
 * Four-step UX as required by the prompt:
 *   STEP 1 — Discover Communities (button, optional inputs)
 *   STEP 2 — Review Recommendations (list with explanations)
 *   STEP 3 — Approve / Reject / Dismiss / Activate
 *   STEP 4 — Run Listening (handled by the existing executions panel)
 *
 * Compact UI. No layout redesign. Every recommendation card includes the
 * "WHY" and the score breakdown so nothing is surfaced opaquely.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

type Status = 'suggested' | 'approved' | 'rejected' | 'dismissed' | 'activated';

type Recommendation = {
  id: string;
  source_type: string;
  source_identifier: string;
  display_name: string;
  recommendation_reason: string;
  recommendation_category: string | null;
  confidence_score: number;
  estimated_signal_quality: number;
  estimated_volume: number;
  estimated_cost: number;
  strategic_relevance: number;
  related_keywords: string[];
  related_competitors: string[];
  recommendation_status: Status;
  source_metadata?: Record<string, unknown>;
};

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type Props = {
  companyId: string;
  fetchWithAuth: FetchWithAuth;
  onSourceActivated?: () => void;
};

const CATEGORY_LABEL: Record<string, string> = {
  industry_match: 'Industry match',
  icp_overlap: 'ICP overlap',
  competitor_adjacent: 'Competitor adjacent',
  keyword_density: 'Keyword density',
  buyer_intent_hotspot: 'Buyer intent',
  support_complaint_hotspot: 'Support pain',
};

const STATUS_TONE: Record<Status, string> = {
  suggested: 'bg-slate-200 text-slate-700',
  approved: 'bg-sky-100 text-sky-800',
  rejected: 'bg-rose-100 text-rose-800',
  dismissed: 'bg-slate-100 text-slate-500',
  activated: 'bg-emerald-100 text-emerald-800',
};

function fmtPct(value: number | null | undefined): string {
  if (typeof value !== 'number') return '—';
  return `${Math.round(value * 100)}%`;
}

export default function CommunityDiscoveryPanel({ companyId, fetchWithAuth, onSourceActivated }: Props) {
  const [items, setItems] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | Status>('all');

  // Discovery-form state
  const [industry, setIndustry] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [icp, setIcp] = useState<string>('');
  const [keywordText, setKeywordText] = useState<string>('');
  const [competitorText, setCompetitorText] = useState<string>('');
  const [discovering, setDiscovering] = useState<boolean>(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(
        `/api/active-leads/recommendations?companyId=${encodeURIComponent(companyId)}`,
      );
      if (!resp.ok) throw new Error(`Failed to load (${resp.status})`);
      const json = (await resp.json()) as { items: Recommendation[] };
      setItems(json.items ?? []);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load recommendations');
    } finally {
      setLoading(false);
    }
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    void load();
  }, [load]);

  const runDiscovery = useCallback(async () => {
    if (!companyId) return;
    setDiscovering(true);
    setError(null);
    try {
      const resp = await fetchWithAuth('/api/active-leads/discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          industryCategory: industry || null,
          description: description || null,
          icp: icp || null,
          keywords: keywordText.split(',').map((k) => k.trim()).filter(Boolean),
          competitors: competitorText.split(',').map((c) => c.trim()).filter(Boolean),
        }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Discovery failed (${resp.status}): ${body}`);
      }
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'Discovery failed');
    } finally {
      setDiscovering(false);
    }
  }, [companyId, fetchWithAuth, industry, description, icp, keywordText, competitorText, load]);

  const act = useCallback(
    async (rec: Recommendation, action: 'approve' | 'reject' | 'dismiss' | 'activate') => {
      if (!companyId) return;
      setRunning(rec.id);
      setError(null);
      try {
        const resp = await fetchWithAuth('/api/active-leads/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId, recommendationId: rec.id, action }),
        });
        const json = await resp.json();
        if (!resp.ok || json.ok === false) {
          throw new Error(json?.detail ?? json?.error ?? `Action failed (${resp.status})`);
        }
        if (action === 'activate') onSourceActivated?.();
        await load();
      } catch (err: any) {
        setError(err?.message ?? 'Action failed');
      } finally {
        setRunning(null);
      }
    },
    [companyId, fetchWithAuth, load, onSourceActivated],
  );

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((i) => i.recommendation_status === filter);
  }, [items, filter]);

  if (!companyId) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Community Discovery</h3>
        <p className="text-xs text-slate-500">
          Recommendations are advisory. Activating a source creates it in 'inactive' state — nothing runs until
          you trigger it from the Listening Executions panel.
        </p>
      </div>

      <div className="border-b border-slate-200 px-4 py-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="Industry (e.g. SaaS, fintech)"
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <input
            value={keywordText}
            onChange={(e) => setKeywordText(e.target.value)}
            placeholder="Keywords (comma-separated)"
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <input
            value={competitorText}
            onChange={(e) => setCompetitorText(e.target.value)}
            placeholder="Competitors (comma-separated)"
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short company description"
            className="rounded border border-slate-300 px-2 py-1 text-xs md:col-span-2"
          />
          <input
            value={icp}
            onChange={(e) => setIcp(e.target.value)}
            placeholder="ICP / target persona"
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[11px] text-slate-500">
            Discovery is deterministic and uses a curated seed dataset. No external search APIs.
          </p>
          <button
            type="button"
            onClick={() => void runDiscovery()}
            disabled={discovering}
            className="rounded bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {discovering ? 'Discovering…' : 'Discover communities'}
          </button>
        </div>
      </div>

      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</div>
      )}

      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-[11px]">
        <div className="flex flex-wrap gap-1">
          {(['all', 'suggested', 'approved', 'activated', 'rejected', 'dismissed'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`rounded px-1.5 py-0.5 ${
                filter === s ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border border-slate-300 px-2 py-0.5 text-slate-700 hover:bg-slate-50"
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="px-4 py-3 text-xs text-slate-500">
          {loading ? 'Loading…' : 'No recommendations in this view. Run discovery to surface communities.'}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {filtered.map((rec) => (
            <li key={rec.id} className="px-4 py-3 text-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{rec.display_name}</span>
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_TONE[rec.recommendation_status]}`}>
                      {rec.recommendation_status}
                    </span>
                    <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                      {rec.source_type}
                    </span>
                    {rec.recommendation_category && (
                      <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                        {CATEGORY_LABEL[rec.recommendation_category] ?? rec.recommendation_category}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-slate-700">{rec.recommendation_reason}</p>
                  <div className="mt-1 grid grid-cols-2 gap-x-3 text-[11px] text-slate-500 md:grid-cols-4">
                    <span>Confidence <strong className="text-slate-700">{fmtPct(rec.confidence_score)}</strong></span>
                    <span>Quality <strong className="text-slate-700">{fmtPct(rec.estimated_signal_quality)}</strong></span>
                    <span>Strategic <strong className="text-slate-700">{fmtPct(rec.strategic_relevance)}</strong></span>
                    <span>Est cost <strong className="text-slate-700">{rec.estimated_cost}</strong></span>
                  </div>
                  {rec.related_keywords.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {rec.related_keywords.slice(0, 6).map((k) => (
                        <span key={k} className="rounded bg-slate-50 px-1 py-0.5 text-[10px] text-slate-600">{k}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  {rec.recommendation_status === 'suggested' && (
                    <>
                      <button
                        type="button"
                        onClick={() => void act(rec, 'approve')}
                        disabled={running === rec.id}
                        className="rounded border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void act(rec, 'dismiss')}
                        disabled={running === rec.id}
                        className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        onClick={() => void act(rec, 'reject')}
                        disabled={running === rec.id}
                        className="rounded border border-rose-200 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {rec.recommendation_status === 'approved' && (
                    <button
                      type="button"
                      onClick={() => void act(rec, 'activate')}
                      disabled={running === rec.id}
                      className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {running === rec.id ? 'Activating…' : 'Activate source'}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
