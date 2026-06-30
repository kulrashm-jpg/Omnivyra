/**
 * Repository compatibility reader for the legacy `leads` API (PERMANENT contract layer).
 *
 * The ONLY place the legacy GET /api/leads reads from — it owns the `leads` read and
 * the canonical→legacy projection. It mirrors the exact legacy query (ORDER BY
 * created_at DESC, LIMIT 500, the same eq/gte filters) and projects each row through
 * the canonical view + `toLegacyLeadRow`, yielding a byte-identical legacy row.
 * `leadService.getLeads` delegates here (one query, no duplication; the durable scope
 * is inherently website/manual/webhook because only the `leads` table holds those —
 * community/marketpulse/engagement are never read here).
 */

import { ownedDbTable } from '../../db/writeOwner';
import { projectExistingRow, toLegacyLeadRow, type LegacyLeadRow } from '../../../lib/leadIntelligence';

export interface LegacyLeadFilters {
  form_id?: string;
  integration_id?: string;
  source?: string;
  since?: string;
  search?: string; // accepted for contract parity; unused (the legacy query ignores it)
  is_test?: boolean;
}

const project = (row: Record<string, unknown>): LegacyLeadRow => toLegacyLeadRow(projectExistingRow('website', row));

export async function getLegacyLeads(companyId: string, filters?: LegacyLeadFilters): Promise<LegacyLeadRow[]> {
  let q = ownedDbTable('leads')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (filters?.form_id) q = q.eq('form_id', filters.form_id);
  if (filters?.integration_id) q = q.eq('integration_id', filters.integration_id);
  if (filters?.source) q = q.eq('source', filters.source);
  if (filters?.since) q = q.gte('created_at', filters.since);
  if (filters?.is_test !== undefined) q = q.eq('is_test', filters.is_test);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data || []) as Array<Record<string, unknown>>).map(project);
}
