/**
 * Deterministic dedupe key for idempotent canonical-lead upserts.
 *
 * Repeated ingestion of the same source row resolves to the SAME key, so the
 * durable store upserts (never duplicates) while source history is preserved in the
 * events timeline. The key is a readable composite string (no hashing dependency),
 * scoped within a tenant by the store's (company_id, dedupe_key) uniqueness.
 */

import type { CanonicalLead, CanonicalLeadInput } from './types';

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();

export function computeLeadDedupeKey(lead: CanonicalLead | CanonicalLeadInput): string {
  const ref = lead.sourceRef;
  if (ref && ref.id) {
    // Natural identity: the originating source row.
    return `src:${norm(lead.source)}|tbl:${norm(ref.table)}|id:${norm(ref.id)}`;
  }
  // Fallback: source + resolved person + occurrence (stable for identity-bearing rows).
  const person = norm(lead.identity.unifiedPersonId ?? lead.identity.email ?? lead.identity.phone
    ?? lead.identity.contactId ?? (lead.identity.platform && lead.identity.platformUserId ? `${lead.identity.platform}:${lead.identity.platformUserId}` : ''));
  return `src:${norm(lead.source)}|person:${person}|at:${norm(lead.occurredAt)}`;
}
