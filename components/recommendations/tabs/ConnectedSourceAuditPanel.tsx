/**
 * PR-CAR-4 — Connected Source Audit panel.
 *
 * Section #4 of the rebuilt Active Leads workspace. Answers
 * "of the sources I already have, which should I keep, monitor,
 * or consider pausing?"
 *
 * Consumes GET /api/active-leads/source-recommendations/audit.
 * Read-only by construction — no source state mutation here.
 * Every action is a recommendation; the user retains control.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

type FetchWithAuth = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

type YieldRating = 'high' | 'medium' | 'low';
type SourceTier = 'highly_recommended' | 'recommended' | 'low_relevance';
type RecommendationStrength = 'very_strong' | 'strong' | 'moderate' | 'weak';
type AuditAction = 'Keep' | 'Monitor' | 'Consider Pausing';
type OpportunityType =
  | 'buying_intent'
  | 'competitor_dissatisfaction'
  | 'migration_signal'
  | 'hiring_signal'
  | 'growth_signal'
  | 'integration_need';

type RecommendedSourceAuditItem = {
  source_id: string;
  source_name: string;
  source_type: string;
  tier: SourceTier;
  strength: RecommendationStrength;
  overall_score: number;
  yield: {
    lead_potential: YieldRating;
    signal_volume: YieldRating;
    signal_quality: YieldRating;
    discovery_efficiency: YieldRating;
    scores: Record<string, number>;
  };
  best_for: OpportunityType[];
  not_ideal_for: OpportunityType[];
  primary_opportunity: OpportunityType | null;
  secondary_opportunity: OpportunityType | null;
  weakest_opportunity: OpportunityType | null;
  rationale: string;
  confidence: number;
  fit_reasons: string[];
  action: AuditAction;
  action_reason: string;
};

type ApiResponse = {
  ok: boolean;
  generated_at: string;
  items: RecommendedSourceAuditItem[];
  context: {
    confidence: number;
    missing_fields: string[];
  };
};

const ACTION_ORDER: AuditAction[] = ['Keep', 'Monitor', 'Consider Pausing'];

const ACTION_TONE: Record<AuditAction, string> = {
  Keep: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  Monitor: 'bg-amber-100 text-amber-800 border-amber-200',
  'Consider Pausing': 'bg-slate-100 text-slate-700 border-slate-200',
};

const STRENGTH_LABEL: Record<RecommendationStrength, string> = {
  very_strong: 'Very Strong',
  strong: 'Strong',
  moderate: 'Moderate',
  weak: 'Weak',
};

const OPPORTUNITY_LABEL: Record<OpportunityType, string> = {
  buying_intent: 'Buying Intent',
  competitor_dissatisfaction: 'Competitor Pain',
  migration_signal: 'Migration',
  hiring_signal: 'Hiring',
  growth_signal: 'Growth',
  integration_need: 'Integration',
};

const YIELD_TONE: Record<YieldRating, string> = {
  high: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-slate-100 text-slate-500',
};

const YIELD_LABEL: Record<YieldRating, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

type Props = {
  companyId: string;
  fetchWithAuth: FetchWithAuth;
};

export default function ConnectedSourceAuditPanel({ companyId, fetchWithAuth }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWithAuth(
        `/api/active-leads/source-recommendations/audit?companyId=${encodeURIComponent(companyId)}`,
        { cache: 'no-store' },
      );
      const body = (await response.json().catch(() => ({}))) as Partial<ApiResponse> & { error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || 'Failed to load source audit');
      setData(body as ApiResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load source audit');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const out: Record<AuditAction, RecommendedSourceAuditItem[]> = {
      Keep: [],
      Monitor: [],
      'Consider Pausing': [],
    };
    for (const item of data?.items ?? []) out[item.action].push(item);
    for (const action of ACTION_ORDER) {
      out[action].sort((a, b) => b.overall_score - a.overall_score);
    }
    return out;
  }, [data]);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">
            Section 4 · What you currently have
          </p>
          <h2 className="mt-1 text-xl font-bold text-gray-900">Connected Source Audit</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            How your connected listening sources score against your company context. Suggestions only — no source state changes here.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      )}

      {!loading && data && data.items.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
          No connected sources yet. Add sources in Listening Configuration below.
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="mt-6 space-y-6">
          {ACTION_ORDER.map((action) => {
            const items = grouped[action];
            if (items.length === 0) return null;
            return (
              <div key={action}>
                <div className="mb-2 flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ACTION_TONE[action]}`}>
                    {action}
                  </span>
                  <span className="text-xs text-gray-500">{items.length} source{items.length === 1 ? '' : 's'}</span>
                </div>
                <ul className="space-y-3">
                  {items.map((item) => (
                    <AuditCard key={item.source_id} item={item} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AuditCard({ item }: { item: RecommendedSourceAuditItem }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-start justify-between gap-3 p-4 text-left"
      >
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <span aria-hidden="true" className="mt-0.5 text-gray-400">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">{item.source_name}</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                {item.source_type}
              </span>
              <span className="text-xs text-gray-500">{STRENGTH_LABEL[item.strength]}</span>
            </div>
            {!expanded && (
              <p className="mt-1 line-clamp-2 text-sm text-gray-700">{item.action_reason}</p>
            )}
          </div>
        </div>
        <div className="text-right text-xs text-gray-500">
          <div className="font-medium text-gray-700">{Math.round(item.overall_score * 100)}%</div>
          <div>conf {Math.round(item.confidence * 100)}%</div>
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-gray-100 px-4 pb-4 pt-3">
          <p className="text-sm text-gray-700">{item.action_reason}</p>

          {item.fit_reasons.length > 0 && (
            <div className="rounded-lg bg-emerald-50/60 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Why this matches your company</div>
              <ul className="mt-1 space-y-0.5 text-sm text-emerald-900">
                {item.fit_reasons.map((reason, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span aria-hidden="true" className="select-none text-emerald-500">·</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Signal breakdown</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {item.best_for.length === 0 && (
                  <span className="text-xs text-gray-400">No standout opportunity types.</span>
                )}
                {item.best_for.map((type) => (
                  <span key={type} className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                    {OPPORTUNITY_LABEL[type]}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Expected yield</div>
              <div className="mt-1 grid grid-cols-2 gap-1.5 text-xs">
                <YieldChip label="Lead Potential" rating={item.yield.lead_potential} />
                <YieldChip label="Signal Volume" rating={item.yield.signal_volume} />
                <YieldChip label="Signal Quality" rating={item.yield.signal_quality} />
                <YieldChip label="Discovery Efficiency" rating={item.yield.discovery_efficiency} />
              </div>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

function YieldChip({ label, rating }: { label: string; rating: YieldRating }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-gray-50 px-2 py-1">
      <span className="text-[11px] text-gray-600">{label}</span>
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${YIELD_TONE[rating]}`}>
        {YIELD_LABEL[rating]}
      </span>
    </div>
  );
}
