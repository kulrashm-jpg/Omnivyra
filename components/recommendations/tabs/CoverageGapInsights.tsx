/**
 * Active Leads — Coverage Gap Insights banner.
 *
 * Sits directly below the Executive Summary Strip. Surfaces up to 3
 * opportunity types where the user's CONNECTED sources don't yet
 * cover that type well, alongside concrete recommended sources to
 * add (drawn from the existing discovery endpoint).
 *
 * Inputs (both already in use elsewhere on the page; no new API):
 *   GET  /api/active-leads/source-recommendations/audit?companyId=X
 *        → connected sources with their best_for[] opportunity types
 *   POST /api/active-leads/source-recommendations/discovery
 *        → candidate sources with their best_for[] + overall_score
 *
 * Coverage rule per opportunity type:
 *   connectedCount = audit items where best_for includes type
 *   - 0 connected → 'low'
 *   - 1 connected → 'medium'
 *   - 2+ connected → 'high' (skip — no material gap)
 *
 * Auto-collapse: if no under-covered type has at least one candidate
 * recommendation, the banner renders nothing.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

type FetchWithAuth = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
type TabKey = 'discover' | 'monitor' | 'opportunities';

type OpportunityType =
  | 'buying_intent'
  | 'competitor_dissatisfaction'
  | 'migration_signal'
  | 'hiring_signal'
  | 'growth_signal'
  | 'integration_need';

const SCORED_OPPORTUNITY_TYPES: OpportunityType[] = [
  'buying_intent',
  'competitor_dissatisfaction',
  'migration_signal',
  'hiring_signal',
  'growth_signal',
  'integration_need',
];

const OPPORTUNITY_LABEL: Record<OpportunityType, string> = {
  buying_intent: 'Buying Intent',
  competitor_dissatisfaction: 'Competitor Pain',
  migration_signal: 'Migration Signals',
  hiring_signal: 'Hiring Signals',
  growth_signal: 'Growth Signals',
  integration_need: 'Integration Needs',
};

const MAX_INSIGHTS = 3;
const MAX_ADDITIONS_PER_INSIGHT = 3;

type AuditItemLite = {
  source_id: string;
  source_type: string;
  source_name: string;
  best_for: OpportunityType[];
};
type AuditResponse = { ok?: boolean; items?: AuditItemLite[] };

type DiscoveryItemLite = {
  source_id: string;
  source_type: string;
  source_name: string;
  best_for: OpportunityType[];
  overall_score: number;
};
type DiscoveryResponse = { ok?: boolean; items?: DiscoveryItemLite[] };

type Severity = 'low' | 'medium';

type Insight = {
  type: OpportunityType;
  severity: Severity;
  connectedCount: number;
  additions: Array<{ id: string; name: string }>;
};

type Props = {
  companyId: string;
  fetchWithAuth: FetchWithAuth;
  onNavigate: (tab: TabKey) => void;
};

function connectedKey(item: { source_type: string; source_name: string }): string {
  return `${item.source_type}::${item.source_name.toLowerCase().trim()}`;
}

function severityForCount(count: number): Severity | 'high' {
  if (count === 0) return 'low';
  if (count === 1) return 'medium';
  return 'high';
}

function computeInsights(audit: AuditItemLite[], discovery: DiscoveryItemLite[]): Insight[] {
  const connectedKeys = new Set(audit.map(connectedKey));
  const raw: Insight[] = [];

  for (const type of SCORED_OPPORTUNITY_TYPES) {
    const connectedCount = audit.filter((a) => a.best_for.includes(type)).length;
    const severity = severityForCount(connectedCount);
    if (severity === 'high') continue;

    const additions = discovery
      .filter((d) => !connectedKeys.has(connectedKey(d)) && d.best_for.includes(type))
      .sort((a, b) => b.overall_score - a.overall_score)
      .slice(0, MAX_ADDITIONS_PER_INSIGHT)
      .map((d) => ({ id: d.source_id, name: d.source_name }));

    // No suggested additions = no actionable gap.
    if (additions.length === 0) continue;

    raw.push({ type, severity, connectedCount, additions });
  }

  // Order: low before medium; within a severity, fewer connected first.
  raw.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'low' ? -1 : 1;
    return a.connectedCount - b.connectedCount;
  });

  return raw.slice(0, MAX_INSIGHTS);
}

export default function CoverageGapInsights({ companyId, fetchWithAuth, onNavigate }: Props) {
  const [audit, setAudit] = useState<AuditItemLite[] | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryItemLite[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [failed, setFailed] = useState<boolean>(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    const safeJson = async <T,>(p: Promise<Response>): Promise<T | null> => {
      try {
        const r = await p;
        if (!r.ok) return null;
        return (await r.json().catch(() => null)) as T | null;
      } catch {
        return null;
      }
    };

    const [auditRes, discoveryRes] = await Promise.all([
      safeJson<AuditResponse>(
        fetchWithAuth(
          `/api/active-leads/source-recommendations/audit?companyId=${encodeURIComponent(companyId)}`,
        ),
      ),
      safeJson<DiscoveryResponse>(
        fetchWithAuth('/api/active-leads/source-recommendations/discovery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId }),
        }),
      ),
    ]);

    if (!auditRes && !discoveryRes) {
      setFailed(true);
    }
    setAudit(auditRes?.items ?? []);
    setDiscovery(discoveryRes?.items ?? []);
    setLoading(false);
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    void load();
  }, [load]);

  const insights = useMemo(() => {
    if (!audit || !discovery) return [];
    return computeInsights(audit, discovery);
  }, [audit, discovery]);

  // Auto-collapse when there are no material gaps (or the endpoints failed).
  if (loading) return null;
  if (failed) return null;
  if (insights.length === 0) return null;

  return (
    <section
      aria-label="Coverage gap insights"
      className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 shadow-sm"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
            Coverage gaps
          </span>
          <span className="text-[11px] text-amber-700/80">
            {insights.length} of 6 opportunity types under-covered
          </span>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('discover')}
          className="text-xs font-medium text-amber-800 underline-offset-2 hover:underline"
        >
          Review in Discover →
        </button>
      </header>

      <ul className="mt-2 space-y-1.5">
        {insights.map((insight) => (
          <li key={insight.type} className="text-sm text-amber-900">
            <span className="font-semibold">{OPPORTUNITY_LABEL[insight.type]}</span>{' '}
            coverage is{' '}
            <SeverityBadge severity={insight.severity} />
            .{' '}
            <span className="text-amber-800">
              Recommended addition{insight.additions.length === 1 ? '' : 's'}:{' '}
              {insight.additions.map((addition, idx) => (
                <React.Fragment key={addition.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate('discover')}
                    className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[12px] text-amber-900 ring-1 ring-amber-200 hover:bg-white"
                  >
                    {addition.name}
                  </button>
                  {idx < insight.additions.length - 1 ? ' ' : ''}
                </React.Fragment>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const tone =
    severity === 'low'
      ? 'bg-rose-100 text-rose-700 ring-rose-200'
      : 'bg-amber-100 text-amber-800 ring-amber-200';
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${tone}`}
    >
      {severity}
    </span>
  );
}
