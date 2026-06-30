/**
 * Legacy `leads`-API compatibility projection: CanonicalLeadView → legacy Lead row.
 *
 * Reconstructs the EXACT legacy `leads` row shape the existing GET /api/leads
 * contract returns. The `website`/legacy adapter is lossless for `leads` rows —
 * every column except `source` is preserved verbatim in `attribution.sourceMetadata`
 * (only `source` is consumed, into `attribution.originalSource`). So a faithful
 * round-trip is: sourceMetadata (all columns incl. nulls + any extra) + restored
 * `source`. Structured fallbacks (identity / sourceRef / organizationId) are used
 * ONLY when a column is genuinely absent — never overriding a present value (incl. null).
 */

import type { CanonicalLeadView } from './types';

export interface LegacyLeadRow {
  id: string;
  company_id: string;
  website_id?: string | null;
  created_by: string | null;
  name: string;
  email: string;
  phone: string | null;
  source: string;
  integration_id: string | null;
  form_id: string | null;
  metadata: Record<string, unknown>;
  attribution?: Record<string, unknown>;
  visitor_session_id?: string | null;
  consent_state?: string | null;
  is_test: boolean;
  created_at: string;
  unified_person_id: string | null;
  [extra: string]: unknown;
}

export function toLegacyLeadRow(view: CanonicalLeadView): LegacyLeadRow {
  // Clone the original row's preserved columns (incl. null values + any extra columns).
  const row: Record<string, unknown> = { ...(view.attribution.sourceMetadata ?? {}) };

  // `source` is the only `leads` column the adapter consumes — restore it verbatim.
  row.source = view.attribution.originalSource ?? row.source ?? null;

  // Structured fallbacks ONLY when sourceMetadata didn't carry the column (defensive;
  // for real `leads` rows every column is present, so these never override).
  if (!('id' in row)) row.id = view.sourceRef?.id ?? null;
  if (!('company_id' in row)) row.company_id = view.organizationId;
  if (!('email' in row)) row.email = view.identity.email ?? null;
  if (!('phone' in row)) row.phone = view.identity.phone ?? null;
  if (!('unified_person_id' in row)) row.unified_person_id = view.identity.unifiedPersonId ?? null;

  return row as unknown as LegacyLeadRow;
}
