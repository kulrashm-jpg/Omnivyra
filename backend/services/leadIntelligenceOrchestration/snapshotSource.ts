/**
 * INT-001 Phase 4 — durable snapshot source.
 *
 * Loads the STORED capture rows for one lead: the `leads` row plus its
 * `tracking_events`, `visitor_sessions` and `campaign_touchpoints`. Read-only,
 * tenant-scoped, bounded, fail-open — mirrors the hydration pattern used by
 * the existing read service without modifying it. The capture pipeline is
 * never touched.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { recordSnapshotReadFailure, type SnapshotCollection } from '../leadIntelligenceTelemetry';
import type { IntelligenceSnapshotSourcePort, RawLeadRows } from './types';

type Row = Record<string, unknown>;

/**
 * HARDEN-INT-001 (5) — DOCUMENTED LIMITATION, deliberately not changed.
 *
 * Collections are ordered ASCENDING and then capped, so a lead that exceeds a
 * cap contributes its OLDEST rows, not its most recent ones. For a lead with
 * >1000 tracking events the engines therefore analyse the earliest 1000.
 *
 * This is left as-is on purpose: no correctness defect is proven (the caps sit
 * far above real per-lead volumes), and flipping to newest-N would change the
 * inputs of every capped lead — changing its fingerprint, its intelligence and
 * forcing a mass regeneration. Ascending order is also what makes the journey
 * timeline read chronologically. If capped leads ever become common, the fix
 * is to select newest-N and re-sort ascending in the assembler, which is a
 * deliberate, separately-audited semantic change.
 */
const LIMITS = { events: 1000, touchpoints: 1000, sessions: 200 };

/**
 * INT-001A (Finding 3) — deterministic snapshot ordering. Every collection is
 * ordered explicitly: primary = the table's own timestamp column, secondary =
 * id (unique) so identical timestamps still order identically across
 * executions. Ordering by a column the table does not have makes PostgREST
 * reject the query, and readRows fails open to [] — silently emptying that
 * collection. Each entry below is therefore pinned to a column proven to exist
 * in the table's DDL (20260677_website_intelligence_foundation_phase1.sql):
 *   tracking_events.created_at      :297   visitor_sessions.started_at   :272
 *   campaign_touchpoints.touched_at :369   (neither of the latter two has
 *                                           a created_at column at all)
 * The input fingerprint is unaffected (it canonicalizes row order itself).
 */
const ORDER_COLUMNS: Record<string, string> = {
  tracking_events: 'created_at',
  visitor_sessions: 'started_at',
  campaign_touchpoints: 'touched_at',
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

async function readRows(table: string, tenant: string, col: string, val: string, limit: number): Promise<Row[]> {
  if (!val) return [];
  try {
    const { data, error } = await ownedDbTable(table)
      .select('*')
      .eq('company_id', tenant)
      .eq(col, val)
      .order(ORDER_COLUMNS[table] ?? 'id', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit);
    // HARDEN-INT-002: this fail-open is how the visitor_sessions ordering
    // defect stayed invisible in production — an errored read looked exactly
    // like "this lead has no sessions". Report it; still degrade to [].
    if (error) {
      recordSnapshotReadFailure(table as SnapshotCollection, tenant, String((error as { message?: string }).message ?? error));
      return [];
    }
    return Array.isArray(data) ? (data as Row[]) : [];
  } catch (e) {
    recordSnapshotReadFailure(table as SnapshotCollection, tenant, e instanceof Error ? e.message : String(e));
    return [];
  }
}

export const durableSnapshotSource: IntelligenceSnapshotSourcePort = {
  async load(companyId, leadId): Promise<RawLeadRows | null> {
    if (!companyId || !leadId) return null;
    let leadRow: Row | null = null;
    try {
      const { data, error } = await ownedDbTable('leads')
        .select('*')
        .eq('company_id', companyId)
        .eq('id', leadId)
        .limit(1);
      leadRow = !error && Array.isArray(data) && data.length > 0 ? (data[0] as Row) : null;
    } catch {
      leadRow = null;
    }
    if (!leadRow) return null;

    const sessionId = str(leadRow.visitor_session_id);
    const personId = str(leadRow.unified_person_id);

    const [trackingEventRows, touchpointRows, visitorSessionRows] = await Promise.all([
      readRows('tracking_events', companyId, 'visitor_session_id', sessionId, LIMITS.events),
      readRows('campaign_touchpoints', companyId, 'lead_id', leadId, LIMITS.touchpoints).then(async (rows) =>
        rows.length > 0 ? rows : readRows('campaign_touchpoints', companyId, 'visitor_session_id', sessionId, LIMITS.touchpoints),
      ),
      personId
        ? readRows('visitor_sessions', companyId, 'unified_person_id', personId, LIMITS.sessions)
        : readRows('visitor_sessions', companyId, 'id', sessionId, 1),
    ]);

    return { leadRow, trackingEventRows, visitorSessionRows, touchpointRows };
  },
};
