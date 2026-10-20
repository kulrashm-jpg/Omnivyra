/**
 * WP3 / L1 — who owns this recipient address, within this tenant?
 *
 * Extracted unchanged from `execution/suppressionService.ts` (W2-B / D-2) so
 * Path A and Path B resolve a recipient through ONE lookup. It resolves an
 * identity and nothing else: no governance rule, no anchor order, no write.
 *
 * ─── WHY `identity_claims`, AND WHY THIS IS NOT A SECOND IDENTITY MODEL ───
 * `identity_claims` is already the canonical endpoint-to-person store: it is
 * what `personErasure` reads to find a person's contact points, and its
 * `normalized_value` is produced by the SAME normalisers that
 * `normalizeGovernanceTarget` uses. So the reverse lookup is keyed on the
 * identical string the governance reader compares against. `claim_type` is
 * narrowed by `contactClaimTypesForChannel`, the same helper the erasure planner
 * uses to decide which contact points a channel can govern.
 *
 * ─── TENANT ───────────────────────────────────────────────────────────────
 * `organization_id` is the FIRST predicate. An endpoint that belongs to another
 * tenant's person resolves to nothing here, and even if it somehow did resolve,
 * `loadGovernanceRecords` and `mayContact` each filter on the tenant again.
 *
 * ─── THREE OUTCOMES, AND ONLY ONE OF THEM IS AN ERROR ─────────────────────
 *   resolved      — exactly one person claims this endpoint
 *   absent        — the table answered and no person claims it. NOT an error:
 *                   target-only matching legitimately remains in force
 *   `ok: false`   — the read failed, or two different persons claim the same
 *                   endpoint. We do not know whose restriction might apply, and
 *                   uncertainty must never become an allow
 *
 * Ambiguity should be unrepresentable — `uq_identity_claims_tenant_identity` is
 * unique on `(organization_id, claim_type, platform, normalized_value)` among
 * live rows — but it is checked rather than assumed, because a `'*'` channel
 * queries two claim types at once and the cost of being wrong here is
 * contacting someone who asked us not to.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { contactClaimTypesForChannel } from './erasurePlan';

export interface RecipientOwnerResolution {
  /** FALSE means the person is UNKNOWN and the caller must fail closed. */
  ok: boolean;
  personId: string | null;
  reason: string | null;
}

export async function resolveRecipientOwner(
  companyId: string,
  channel: string,
  normalizedTarget: string | null,
): Promise<RecipientOwnerResolution> {
  // Nothing to resolve from. Not a failure: a caller with no target has
  // nothing to look up.
  if (!normalizedTarget) return { ok: true, personId: null, reason: 'no_target_to_resolve' };

  let res: { data?: unknown; error?: unknown };
  try {
    res = await ownedDbTable('identity_claims')
      .select('person_id')
      .eq('organization_id', companyId)          // TENANT FIRST, always
      .eq('normalized_value', normalizedTarget)
      .is('revoked_at', null)
      .in('claim_type', [...contactClaimTypesForChannel(channel)]);
  } catch {
    return { ok: false, personId: null, reason: 'contact_point_read_failed' };
  }
  if (res?.error) return { ok: false, personId: null, reason: 'contact_point_read_failed' };

  const ids = [...new Set(
    ((res?.data ?? []) as Array<Record<string, unknown>>)
      .map((r) => (typeof r.person_id === 'string' && r.person_id.trim() ? r.person_id : null))
      .filter((v): v is string => v !== null),
  )];

  if (ids.length > 1) return { ok: false, personId: null, reason: 'ambiguous_contact_point' };
  if (ids.length === 1) return { ok: true, personId: ids[0], reason: null };
  // The table answered: no person claims this endpoint. Target matching stands.
  return { ok: true, personId: null, reason: 'no_person_claim' };
}
