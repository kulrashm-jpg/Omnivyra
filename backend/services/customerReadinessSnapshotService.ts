/**
 * customerReadinessSnapshotService.ts
 *
 * Generates + persists daily snapshots of the Customer Readiness model so the
 * Evolution engine has real history. Writes ONLY to customer_readiness_snapshots.
 * Deterministic build; idempotent persistence (one snapshot per company per day).
 * No mutations to any other table; no emails / notifications / recommendations.
 */

import { supabase } from '../db/supabaseClient';
import type { CompanyReadiness } from './customerReadinessService';
import { companyOpportunities } from './customerOpportunityService';
import { computeCompanyPriority } from './customerOpportunityPriorityService';

export const SNAPSHOT_VERSION = 'readiness-snapshot-v1';

export interface SnapshotRow {
  company_id: string;
  taken_at: string;
  snapshot_date: string; // YYYY-MM-DD (UTC) — idempotency key
  tenant_status: string;
  overall_readiness_score: number;
  readiness_bucket: string;
  priority_score: number;
  priority_tier: string;
  opportunity_count: number;
  company_profile_ready: string;
  website_ready: string;
  ga_ready: string;
  gsc_ready: string;
  social_ready: string;
  community_ready: string;
  team_ready: string;
  billing_ready: string;
  snapshot_version: string;
}

/** Build one deterministic snapshot row from the current readiness model. Pure. */
export function buildSnapshotRow(c: CompanyReadiness, takenAt: string): SnapshotRow {
  const opp = companyOpportunities(c);
  const prio = computeCompanyPriority(c, opp, Date.parse(takenAt) || undefined);
  return {
    company_id: c.company_id,
    taken_at: takenAt,
    snapshot_date: takenAt.slice(0, 10), // UTC date
    tenant_status: c.tenant_status,
    overall_readiness_score: c.overall_readiness_score,
    readiness_bucket: c.readiness_bucket,
    priority_score: prio.priority_score,
    priority_tier: prio.priority_tier,
    opportunity_count: opp.opportunity_count,
    company_profile_ready: c.company_profile_ready,
    website_ready: c.website_ready,
    ga_ready: c.ga_ready,
    gsc_ready: c.gsc_ready,
    social_ready: c.social_ready,
    community_ready: c.community_ready,
    team_ready: c.team_ready,
    billing_ready: c.billing_ready,
    snapshot_version: SNAPSHOT_VERSION,
  };
}

/** Injectable writer seam — default persists to the snapshot table idempotently. */
export interface SnapshotWriter {
  /** Returns the number of rows actually inserted (duplicates per-day are skipped). */
  upsertDaily: (rows: SnapshotRow[]) => Promise<number>;
}

const defaultWriter: SnapshotWriter = {
  upsertDaily: async (rows) => {
    if (rows.length === 0) return 0;
    // ignoreDuplicates → conflicts on (company_id, snapshot_date) are skipped, not updated.
    const { data, error } = await supabase
      .from('customer_readiness_snapshots')
      .upsert(rows, { onConflict: 'company_id,snapshot_date', ignoreDuplicates: true })
      .select('snapshot_id');
    if (error) throw new Error(error.message);
    return data?.length ?? 0;
  },
};

export interface SnapshotResult { total: number; inserted: number; skipped: number; taken_at: string; }

/**
 * Generate + persist one snapshot per company. Idempotent: a same-day rerun inserts 0.
 */
export async function generateReadinessSnapshots(
  companies: CompanyReadiness[],
  takenAt: string,
  deps: { writer?: SnapshotWriter } = {},
): Promise<SnapshotResult> {
  const writer = deps.writer ?? defaultWriter;
  const rows = companies.map((c) => buildSnapshotRow(c, takenAt));
  const inserted = await writer.upsertDaily(rows);
  return { total: rows.length, inserted, skipped: rows.length - inserted, taken_at: takenAt };
}
