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
import type { IntelligenceSnapshotSourcePort, RawLeadRows } from './types';

type Row = Record<string, unknown>;

const LIMITS = { events: 1000, touchpoints: 1000, sessions: 200 };

/**
 * INT-001A (Finding 3) — deterministic snapshot ordering. Every collection is
 * ordered explicitly: primary = the table's own timestamp column, secondary =
 * id (unique) so identical timestamps still order identically across
 * executions. NOTE: campaign_touchpoints has NO created_at — its timestamp is
 * touched_at; ordering by a missing column would error and fail-open to [].
 * The input fingerprint is unaffected (it canonicalizes row order itself).
 */
const ORDER_COLUMNS: Record<string, string> = {
  tracking_events: 'created_at',
  visitor_sessions: 'created_at',
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
    return !error && Array.isArray(data) ? (data as Row[]) : [];
  } catch {
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
