/**
 * ActivityCostRange — pre-activity credit cost preview with provisional notation.
 *
 * Shows what an activity will cost BEFORE the user starts it, using the
 * catalog-derived band from GET /api/billing/activity-cost-range:
 *
 *   • Token-priced activities (campaigns, content, blogs, reports): a min–max
 *     band. We anchor on the MINIMUM ("starting estimate") and explicitly flag
 *     that the final charge MAY RISE toward the max as actual usage settles —
 *     i.e. the deduction shown is NOT firm.
 *   • Fixed-fee activities: a single flat number (no upward reconciliation).
 *
 * Read-only. Never deducts credits — purely a transparency surface.
 */

import React, { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';

export interface ActivityCreditRange {
  actionKey: string;
  minCredits: number;
  maxCredits: number;
  expectedCredits: number;
  tokenPriced: boolean;
  source: 'action_pricing_config' | 'credit_cost_config';
}

interface Props {
  companyId: string;
  /** One action key or several — order is preserved in the rendered list. */
  actions: string | string[];
  /** Optional friendly labels keyed by action key (falls back to the key). */
  labels?: Record<string, string>;
  /** 'inline' = compact single-line badges; 'list' = labelled rows. */
  variant?: 'inline' | 'list';
  className?: string;
}

const PROVISIONAL_TITLE =
  'Starting estimate. This is the minimum reserved when the activity begins — ' +
  'the final charge settles against actual usage and may rise toward the upper ' +
  'bound (e.g. when an asset/image is added). It is not a firm deduction yet.';

function bandText(r: ActivityCreditRange): string {
  if (!r.tokenPriced || r.maxCredits <= r.minCredits) return `${r.minCredits} cr`;
  return `~${r.minCredits} cr · est. ${r.minCredits}–${r.maxCredits}`;
}

/** Small standalone badge for a single resolved range (presentational). */
export function ActivityCostBadge({ range }: { range: ActivityCreditRange }) {
  const provisional = range.tokenPriced && range.maxCredits > range.minCredits;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
        provisional
          ? 'border-amber-200 bg-amber-50 text-amber-800'
          : 'border-slate-200 bg-slate-50 text-slate-700'
      }`}
      title={provisional ? PROVISIONAL_TITLE : 'Fixed fee — charged once, no usage reconciliation.'}
    >
      {bandText(range)}
      {provisional && (
        <>
          <span className="font-medium">· may rise</span>
          <Info className="h-3 w-3 opacity-70" />
        </>
      )}
    </span>
  );
}

export default function ActivityCostRange({
  companyId,
  actions,
  labels,
  variant = 'inline',
  className,
}: Props) {
  const list = Array.isArray(actions) ? actions : [actions];
  const key = list.join(',');
  const [ranges, setRanges] = useState<ActivityCreditRange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!companyId || list.length === 0) return;
    setLoading(true);
    setError(null);
    fetchWithAuth(
      `/api/billing/activity-cost-range?companyId=${encodeURIComponent(companyId)}&actions=${encodeURIComponent(key)}`,
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((j) => {
        if (!cancelled) setRanges(Array.isArray(j?.ranges) ? j.ranges : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // key captures the actions list; companyId scopes the band.
  }, [companyId, key]);

  if (loading && ranges.length === 0) {
    return <span className={`text-xs text-slate-400 ${className ?? ''}`}>Estimating cost…</span>;
  }
  if (error) {
    return <span className={`text-xs text-slate-400 ${className ?? ''}`}>Cost estimate unavailable</span>;
  }
  if (ranges.length === 0) return null;

  if (variant === 'inline') {
    return (
      <span className={`inline-flex flex-wrap items-center gap-2 ${className ?? ''}`}>
        {ranges.map((r) => (
          <ActivityCostBadge key={r.actionKey} range={r} />
        ))}
      </span>
    );
  }

  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      {ranges.map((r) => (
        <div key={r.actionKey} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-slate-600">{labels?.[r.actionKey] ?? r.actionKey}</span>
          <ActivityCostBadge range={r} />
        </div>
      ))}
    </div>
  );
}
