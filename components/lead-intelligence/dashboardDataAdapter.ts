/**
 * INT-003A — Dashboard data-source boundary (Gap 2).
 *
 * The dashboard UI consumes ONLY this interface. Today's implementation is
 * the Wave 4 behaviour moved here verbatim:
 *
 *     Bulk Read API (GET /api/leads/intelligence, id-driven)
 *       ↓
 *     Client aggregation in the component
 *
 * FUTURE AGGREGATE ADAPTER CONTRACT
 * ---------------------------------
 * A server-side "Dashboard Aggregate API" plugs in as another
 * `IntelligenceDashboardDataAdapter` — same `load(companyId)` signature, same
 * `DashboardSourceSnapshot` result — with `serverAggregated: true` and, when
 * the server can no longer return per-lead items economically, an `items`
 * array limited to the drill-down table's page while the KPI counts come from
 * a future optional `aggregates` extension of the snapshot. Swapping adapters
 * must require ZERO changes to IntelligenceDashboard: the component already
 * receives its adapter via a prop with this module's bulk adapter as the
 * default. No such endpoint exists today and none is introduced here.
 *
 * TECHNICAL DEBT — CURRENT LIMITATIONS (Gap 3)
 * See DASHBOARD_LIMITATIONS below: each entry records WHY the limitation
 * exists, not just what it is.
 */

import { apiFetch } from '@/lib/apiFetch';
import { leadKeyFor, type CanonicalLeadView } from '@/lib/leadIntelligence';
import { fetchLeads, emptyFilters } from './leadIntelligenceClient';
import type { LeadIntelligenceListItemDTO } from '@/backend/services/leadIntelligenceReadApi/dto';

export const DASHBOARD_COHORT_LIMIT = 100;

export interface DashboardCohortLead {
  leadId: string;
  leadKey: string;
  label: string;
}

export interface DashboardSourceSnapshot {
  /** Company-wide lead count as reported by the lead list API (display only). */
  portfolioTotal: number;
  /** The analyzed cohort (latest N leads), keyed by lead id. */
  cohort: Map<string, DashboardCohortLead>;
  /** Persisted intelligence list items for the cohort — never recomputed. */
  items: LeadIntelligenceListItemDTO[];
  /** True when the intelligence read failed (UI fails open to "unavailable"). */
  failed: boolean;
}

export interface IntelligenceDashboardDataAdapter {
  /** Stable identifier for diagnostics/tests. */
  readonly id: string;
  /** False today: aggregation happens client-side over cohort items. */
  readonly serverAggregated: boolean;
  load(companyId: string): Promise<DashboardSourceSnapshot>;
}

/**
 * Documented technical debt of the current dashboard (WHY included).
 * Rendered nowhere — this is the module-internal record the INT-003A
 * mandate requires, kept type-checked and test-pinned so it cannot rot.
 */
export const DASHBOARD_LIMITATIONS: ReadonlyArray<{ limitation: string; why: string }> = [
  {
    limitation: 'Cohort-based analytics',
    why: 'The Wave 1 bulk endpoint is deliberately id-driven (caller supplies ≤200 lead ids) so it stays a pure read over persisted envelopes with no new query surface; every number is computed over the supplied cohort, never the whole tenant.',
  },
  {
    limitation: 'Latest leads only',
    why: 'The cohort is the lead list API’s latest page (occurredAt desc, capped at DASHBOARD_COHORT_LIMIT) — the only ordering that endpoint guarantees without new backend work.',
  },
  {
    limitation: 'No portfolio aggregation',
    why: 'Aggregating all leads client-side would require paging the entire tenant through the id-driven bulk endpoint (N requests of 200 ids), which is a scale and abuse hazard; company-wide numbers must come from a server aggregate instead.',
  },
  {
    limitation: 'No server aggregation',
    why: 'A Dashboard Aggregate API was intentionally deferred: aggregation logic server-side would duplicate scoring-adjacent semantics before the ownership question between engine layers (program audit Finding 2) is settled. The adapter boundary in this module is the prepared plug-in point.',
  },
  {
    limitation: 'Best channel unavailable',
    why: 'LeadIntelligenceListItemDTO carries topAction but not bestChannel — best channel exists only in the detail DTO, and INT waves prohibit DTO changes from presentation work.',
  },
  {
    limitation: 'Raw intent score unavailable',
    why: 'The list DTO persists intentBand only; the numeric intent score lives in the detail DTO. Distribution charts therefore bucket by band.',
  },
  {
    limitation: 'Schema version unavailable',
    why: 'The list DTO exposes engineVersion only; schemaVersion/generation are detail-DTO fields, so the version card can only break down engine versions.',
  },
  {
    limitation: 'Generation distribution unavailable',
    why: 'Per-lead generationVersion is not in the list DTO (same reason as schema version); regeneration cadence is approximated by the generatedAt recency tiles instead.',
  },
];

/** Today's adapter: Bulk Read API → client aggregation (Wave 4 behaviour, moved verbatim). */
export const bulkReadDashboardAdapter: IntelligenceDashboardDataAdapter = {
  id: 'bulk-read-client-aggregation',
  serverAggregated: false,
  async load(companyId: string): Promise<DashboardSourceSnapshot> {
    const empty: DashboardSourceSnapshot = { portfolioTotal: 0, cohort: new Map(), items: [], failed: false };
    if (!companyId) return empty;
    try {
      const leads = await fetchLeads(companyId, emptyFilters(), { limit: DASHBOARD_COHORT_LIMIT, offset: 0 }, { by: 'occurredAt', order: 'desc' });
      const byId = new Map<string, DashboardCohortLead>();
      for (const view of leads.rows as CanonicalLeadView[]) {
        const leadId = view.sourceRef?.id;
        if (!leadId || byId.has(leadId)) continue;
        byId.set(leadId, {
          leadId,
          leadKey: leadKeyFor(view),
          label: view.identity?.email ?? view.identity?.contactId ?? leadId,
        });
      }

      const ids = [...byId.keys()];
      if (ids.length === 0) {
        return { portfolioTotal: leads.total, cohort: byId, items: [], failed: false };
      }
      const params = new URLSearchParams({
        company_id: companyId,
        ids: ids.join(','),
        limit: String(Math.min(Math.max(ids.length, 1), 100)),
        offset: '0',
        sort: 'score',
        order: 'desc',
      });
      const res = await apiFetch(`/api/leads/intelligence?${params.toString()}`);
      if (!res.ok) {
        return { portfolioTotal: leads.total, cohort: byId, items: [], failed: true };
      }
      const body = (await res.json().catch(() => null)) as { items?: unknown } | null;
      const raw = Array.isArray(body?.items) ? (body!.items as unknown[]) : [];
      const items = raw.filter(
        (x): x is LeadIntelligenceListItemDTO =>
          Boolean(x) && typeof x === 'object' && typeof (x as LeadIntelligenceListItemDTO).leadId === 'string' && (x as LeadIntelligenceListItemDTO).leadId !== '',
      );
      return { portfolioTotal: leads.total, cohort: byId, items, failed: false };
    } catch {
      return { ...empty, failed: true };
    }
  },
};
