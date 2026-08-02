/**
 * Lead Intelligence workspace — client data layer.
 *
 * Thin wrappers over the repository-backed APIs (/api/lead-intelligence/*). The
 * workspace does NO aggregation, filtering, search, sorting, pagination or export
 * client-side — every operation is a query param forwarded to the repository.
 */

import type { ScopedMutator } from 'swr';
import { apiFetch } from '@/lib/apiFetch';
import type { CanonicalLeadView, LeadStats, LeadProfile } from '@/lib/leadIntelligence';

export interface LeadListResult {
  rows: CanonicalLeadView[];
  total: number;
  limit: number;
  offset: number;
}

export interface LeadFilterState {
  search: string;
  source: string[];
  status: string;
  campaign: string;
  content: string;
  owner: string;
  from: string;
  to: string;
  intentMin: string;
  interest: string;
}

export interface LeadSortState {
  by: 'occurredAt' | 'intent';
  order: 'asc' | 'desc';
}

export const emptyFilters = (): LeadFilterState => ({
  search: '', source: [], status: '', campaign: '', content: '', owner: '', from: '', to: '', intentMin: '', interest: '',
});

function applyFilterParams(p: URLSearchParams, f: LeadFilterState): void {
  if (f.search.trim()) p.set('q', f.search.trim());
  if (f.source.length) p.set('source', f.source.join(','));
  if (f.status.trim()) p.set('status', f.status.trim());
  if (f.campaign.trim()) p.set('campaign', f.campaign.trim());
  if (f.content.trim()) p.set('content', f.content.trim());
  if (f.owner.trim()) p.set('owner', f.owner.trim());
  if (f.from.trim()) p.set('from', f.from.trim());
  if (f.to.trim()) p.set('to', f.to.trim());
  if (f.interest.trim()) p.set('interest', f.interest.trim());
  if (f.intentMin.trim() && !Number.isNaN(Number(f.intentMin))) p.set('intent_min', f.intentMin.trim());
}

/* ── OPT-005 Phase 2C — SWR cache keys ──────────────────────────────────────
 * Each key IS the exact request URL, so the cache entry carries every
 * parameter that affects the returned data (company, filters, paging, sort).
 * The fetch functions below build their request URL from the same builders,
 * guaranteeing key ↔ request parity. */

export function leadStatsKey(companyId: string): string {
  return `/api/lead-intelligence/stats?company_id=${encodeURIComponent(companyId)}`;
}

export function leadsKey(
  companyId: string,
  filters: LeadFilterState,
  page: { limit: number; offset: number },
  sort: LeadSortState,
): string {
  const p = new URLSearchParams({ company_id: companyId });
  applyFilterParams(p, filters);
  p.set('limit', String(page.limit));
  p.set('offset', String(page.offset));
  p.set('sort', sort.by);
  p.set('order', sort.order);
  return `/api/lead-intelligence/leads?${p.toString()}`;
}

export function leadProfileKey(companyId: string, key: string): string {
  return `/api/lead-intelligence/profile?${new URLSearchParams({ company_id: companyId, key }).toString()}`;
}

export async function fetchLeadStats(companyId: string): Promise<LeadStats> {
  const res = await apiFetch(leadStatsKey(companyId));
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load lead stats');
  return res.json();
}

export async function fetchLeads(
  companyId: string,
  filters: LeadFilterState,
  page: { limit: number; offset: number },
  sort: LeadSortState,
): Promise<LeadListResult> {
  const res = await apiFetch(leadsKey(companyId, filters, page, sort));
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load leads');
  return res.json();
}

export async function fetchLeadProfile(companyId: string, key: string): Promise<LeadProfile> {
  const res = await apiFetch(leadProfileKey(companyId, key));
  if (res.status === 404) throw new Error('Lead not found');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load lead profile');
  return res.json();
}

/* ── W2b — Operational console (consumes the single Operations API; no new backend) ── */

export interface OperationalOverlay {
  status: string | null;
  assignee: string | null;
  notes: Array<{ id: string; body: string; author_id: string | null; pinned: boolean; created_at: string }>;
  tasks: Array<{ id: string; title: string; task_type: string; status: string; priority: string; owner_id: string | null; due_at: string | null }>;
}

const OPS = '/api/lead-intelligence/operations';

export function operationalOverlayKey(companyId: string, entityId: string): string {
  return `${OPS}?${new URLSearchParams({ company_id: companyId, entity_id: entityId }).toString()}`;
}

export async function fetchOperationalOverlay(companyId: string, entityId: string): Promise<OperationalOverlay> {
  const res = await apiFetch(operationalOverlayKey(companyId, entityId));
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load operational state');
  return res.json();
}

/**
 * OPT-005 Phase 2C — centralized invalidation after a successful lead
 * operation: revalidate the stats, leads (every filter variant) and
 * operational-overlay entries of THIS company only. Revalidate-only —
 * no optimistic writes. `mutate` is the global mutator from useSWRConfig().
 */
export function invalidateLeadIntelligenceReads(mutate: ScopedMutator, companyId: string): Promise<unknown> {
  const companyParam = `company_id=${encodeURIComponent(companyId)}`;
  return mutate(
    (key: unknown) =>
      typeof key === 'string' &&
      (key.includes(`${companyParam}&`) || key.endsWith(companyParam)) &&
      (key.startsWith('/api/lead-intelligence/stats?') ||
        key.startsWith('/api/lead-intelligence/leads?') ||
        key.startsWith(`${OPS}?`))
  );
}

/** All mutations flow through the ONE Operations API action dispatcher. */
export async function operationsAction(companyId: string, action: string, payload: Record<string, unknown>): Promise<unknown> {
  const res = await apiFetch(OPS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_id: companyId, action, ...payload }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || 'Operation failed');
  return json;
}

/** Repository-backed export → trigger a client download (auth-safe via apiFetch Bearer). */
export async function downloadLeadExport(
  companyId: string,
  filters: LeadFilterState,
  format: 'csv' | 'excel',
): Promise<void> {
  const p = new URLSearchParams({ company_id: companyId, format });
  applyFilterParams(p, filters);
  const res = await apiFetch(`/api/lead-intelligence/export?${p.toString()}`);
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = format === 'excel' ? 'lead-intelligence.xls' : 'lead-intelligence.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
