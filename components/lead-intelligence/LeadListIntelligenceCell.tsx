/**
 * INT-003 Wave 3 — Lead List intelligence presentation helpers.
 *
 * PRESENTATION ONLY over GET /api/leads/intelligence (INT-003 Wave 1).
 * One authenticated GET per (page-of-ids × sort/filter selection) — no SWR,
 * no polling, no writes, no recomputation, no client-side ranking (ordering
 * comes back from the endpoint). Malformed payloads degrade to "no
 * intelligence" cells; rows are never hidden by absence of intelligence.
 */

import React from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { LeadIntelligenceListItemDTO } from '@/backend/services/leadIntelligenceReadApi/dto';

export type IntelListItem = LeadIntelligenceListItemDTO;

export interface IntelSort {
  by: 'score' | 'confidence' | 'generatedAt' | 'leadId';
  order: 'asc' | 'desc';
}

export interface IntelFilters {
  band: string;       // '' = off
  freshness: string;  // '' = off
  minScore: string;   // '' = off (string-typed form input)
}

export const INTEL_SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'intel:score:desc', label: 'Intelligence score (high→low)' },
  { value: 'intel:score:asc', label: 'Intelligence score (low→high)' },
  { value: 'intel:confidence:desc', label: 'Intelligence confidence' },
  { value: 'intel:generatedAt:desc', label: 'Recently generated' },
  { value: 'intel:leadId:asc', label: 'Lead id' },
];

export const INTEL_BANDS = ['hot', 'warm', 'cool', 'cold'] as const;
export const INTEL_FRESHNESS = ['fresh', 'stale', 'pending_regeneration', 'never_generated'] as const;

/** List-local badge styling (kept self-contained; mirrors the Wave 2 tones). */
const BAND_STYLE: Record<string, string> = {
  hot: 'border-red-200 bg-red-50 text-red-700',
  warm: 'border-orange-200 bg-orange-50 text-orange-700',
  cool: 'border-sky-200 bg-sky-50 text-sky-700',
  cold: 'border-gray-200 bg-gray-50 text-gray-600',
};

const FRESHNESS_BADGE: Record<string, { label: string; className: string }> = {
  fresh: { label: 'Up to date', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  stale: { label: 'Out of date', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  pending_regeneration: { label: 'Refresh queued', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  never_generated: { label: 'No intelligence', className: 'border-gray-200 bg-gray-50 text-gray-600' },
};

const pct = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';

export interface IntelQueryResult {
  /** Items keyed by leadId. */
  byId: Map<string, IntelListItem>;
  /** The endpoint's returned order (already sorted + filtered server-side). */
  order: string[];
  failed: boolean;
}

export const EMPTY_INTEL_RESULT: IntelQueryResult = { byId: new Map(), order: [], failed: false };

export function buildIntelligenceQuery(
  companyId: string,
  ids: string[],
  sort: IntelSort | null,
  filters: IntelFilters,
): string {
  const params = new URLSearchParams({
    company_id: companyId,
    ids: ids.join(','),
    limit: String(Math.min(Math.max(ids.length, 1), 100)),
    offset: '0',
  });
  if (sort) { params.set('sort', sort.by); params.set('order', sort.order); }
  if (filters.band) params.set('band', filters.band);
  if (filters.freshness) params.set('freshness', filters.freshness);
  if (filters.minScore.trim() && !Number.isNaN(Number(filters.minScore))) params.set('min_score', filters.minScore.trim());
  return `/api/leads/intelligence?${params.toString()}`;
}

/** ONE authenticated GET; tolerant of malformed bodies (degrades to empty). */
export async function fetchLeadListIntelligence(
  companyId: string,
  ids: string[],
  sort: IntelSort | null,
  filters: IntelFilters,
): Promise<IntelQueryResult> {
  try {
    const res = await apiFetch(buildIntelligenceQuery(companyId, ids, sort, filters));
    if (!res.ok) return { byId: new Map(), order: [], failed: true };
    const body = (await res.json().catch(() => null)) as { items?: unknown } | null;
    const rawItems = Array.isArray(body?.items) ? (body!.items as unknown[]) : [];
    const byId = new Map<string, IntelListItem>();
    const order: string[] = [];
    for (const raw of rawItems) {
      const item = raw && typeof raw === 'object' ? (raw as IntelListItem) : null;
      if (!item || typeof item.leadId !== 'string' || item.leadId === '') continue;
      if (!byId.has(item.leadId)) order.push(item.leadId);
      byId.set(item.leadId, item);
    }
    return { byId, order, failed: false };
  } catch {
    return { byId: new Map(), order: [], failed: true };
  }
}

/** Compact badge cluster for one row. Never hides the row; absence renders the empty badge. */
export function IntelligenceBadges({ item, pending }: { item: IntelListItem | null; pending: boolean }) {
  if (pending) return <span className="text-xs text-gray-400">…</span>;
  if (!item || item.status === 'never_generated') {
    const badge = FRESHNESS_BADGE.never_generated;
    return (
      <span data-testid="intel-empty" className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.className}`}>
        {badge.label}
      </span>
    );
  }
  const freshness = FRESHNESS_BADGE[item.freshness] ?? FRESHNESS_BADGE.never_generated;
  const generatedShort = item.generatedAt ? item.generatedAt.slice(0, 10) : null;
  const versionTooltip = [
    item.engineVersion ? `engine ${item.engineVersion}` : null,
    item.generatedAt ? `generated ${item.generatedAt}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <span data-testid="intel-badges" className="inline-flex flex-wrap items-center gap-1" title={versionTooltip || undefined}>
      {typeof item.overallScore === 'number' ? (
        <span className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
          {item.overallScore}
        </span>
      ) : null}
      {item.qualificationBand ? (
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${BAND_STYLE[item.qualificationBand] ?? BAND_STYLE.cold}`}>
          {item.qualificationBand}
        </span>
      ) : null}
      {item.primaryPersona ? (
        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
          {item.primaryPersona}
        </span>
      ) : null}
      {item.intentBand ? (
        <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">
          intent: {item.intentBand}
        </span>
      ) : null}
      {typeof item.confidence === 'number' ? (
        <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">
          {pct(item.confidence)}
        </span>
      ) : null}
      {item.topAction ? (
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
          {item.topAction}
        </span>
      ) : null}
      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${freshness.className}`}>{freshness.label}</span>
      {generatedShort ? <span className="text-[11px] text-gray-400">{generatedShort}</span> : null}
    </span>
  );
}
