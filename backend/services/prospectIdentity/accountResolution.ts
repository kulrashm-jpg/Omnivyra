/**
 * W4 — deterministic prospect-account resolution.
 *
 * Resolves (and, when asked, creates) the EXTERNAL company a prospect belongs
 * to. `prospect_accounts` is that external company. It is never `companies`,
 * which is the Omnivyra tenant — conflating the two would make a tenant its own
 * prospect and collapse the isolation model. Every function here takes the
 * tenant as its first argument for exactly that reason.
 *
 * ─── DETERMINISTIC OR NOTHING ──────────────────────────────────────────────
 * Two identity keys, tried in order, both backed by a real unique index:
 *
 *   1. (organization_id, source, source_reference)  — a provider's own account id
 *   2. (organization_id, domain_normalized)         — the registrable domain
 *
 * A provider id beats a domain because it is issued by the system of record and
 * survives rebrands; a domain is inferred and can be shared (agencies,
 * holding companies) or absent.
 *
 * Company NAME is deliberately not an identity key at any level. Name matching
 * is where account resolution quietly becomes fuzzy resolution, and two
 * companies wrongly fused is not recoverable once people and claims hang off
 * the merged row.
 *
 * ─── AMBIGUITY IS AN ANSWER ────────────────────────────────────────────────
 * When the two keys point at different accounts, this returns `ambiguous` and
 * creates nothing. Picking a winner would be a silent merge.
 *
 * ─── NO SECOND ENGINE ──────────────────────────────────────────────────────
 * People are NOT resolved here. `identityResolutionService.resolveUnifiedPerson`
 * remains the only resolve-or-create path for a person; this module only
 * attaches an already-resolved person to an account.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { normalizeCompanyDomain } from './normalization';

/** Bumped when resolution rules change, so a row can be traced to the logic that made it. */
export const ACCOUNT_RESOLUTION_VERSION = 'w4.1';

/** Marks rows this module writes, distinct from W3's `w3_backfill`. */
export const W4_SOURCE = 'w4_account_activation';

export type AccountOutcome = 'matched_source' | 'matched_domain' | 'created' | 'ambiguous' | 'insufficient_evidence';

/** Evidence offered for one external company, before normalization. */
export interface AccountCandidate {
  /** Provider/system that issued `sourceReference`, e.g. `crm`, `import`. */
  source?: string | null;
  /** The provider's own immutable account id. Strongest evidence. */
  sourceReference?: string | null;
  /** Any of: bare host, URL, or an email address to take the domain from. */
  domain?: string | null;
  name?: string | null;
  legalName?: string | null;
  websiteUrl?: string | null;
}

export interface AccountResolution {
  organizationId: string;
  accountId: string | null;
  outcome: AccountOutcome;
  /** Distinct accounts the evidence pointed at. >1 means the keys disagreed. */
  candidateAccountIds: string[];
  normalizedDomain: string | null;
  sourceKey: { source: string; sourceReference: string } | null;
  reason: string;
}

const clean = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};
const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/** Look up by the provider's own account id. Tenant-scoped, active rows only. */
async function findBySourceRef(organizationId: string, source: string, ref: string): Promise<string[]> {
  const { data, error } = await ownedDbTable('prospect_accounts')
    .select('id')
    .eq('organization_id', organizationId)   // tenant boundary — never optional
    .eq('source', source)
    .eq('source_reference', ref)
    .eq('status', 'active')
    .limit(50);
  if (error) throw new Error(`prospect_accounts source lookup failed: ${error.message}`);
  return uniq((data ?? []).map((r: { id: string }) => r.id));
}

/** Look up by registrable domain. Tenant-scoped, active rows only. */
async function findByDomain(organizationId: string, domain: string): Promise<string[]> {
  const { data, error } = await ownedDbTable('prospect_accounts')
    .select('id')
    .eq('organization_id', organizationId)   // tenant boundary
    .eq('domain_normalized', domain)
    .eq('status', 'active')
    .limit(50);
  if (error) throw new Error(`prospect_accounts domain lookup failed: ${error.message}`);
  return uniq((data ?? []).map((r: { id: string }) => r.id));
}

/**
 * Resolve an external company WITHOUT writing. Read-only: safe to run in shadow.
 */
export async function resolveAccountShadow(
  organizationId: string,
  candidate: AccountCandidate,
): Promise<AccountResolution> {
  if (!organizationId?.trim()) throw new Error('organizationId is required for account resolution');

  const source = clean(candidate.source);
  const ref = clean(candidate.sourceReference);
  const domain = normalizeCompanyDomain(candidate.domain ?? candidate.websiteUrl ?? undefined) || null;
  const sourceKey = source && ref ? { source, sourceReference: ref } : null;

  const base = { organizationId, normalizedDomain: domain, sourceKey };

  if (!sourceKey && !domain) {
    return { ...base, accountId: null, outcome: 'insufficient_evidence', candidateAccountIds: [],
      reason: 'no provider reference and no resolvable domain — a name alone is not identity' };
  }

  const bySource = sourceKey ? await findBySourceRef(organizationId, sourceKey.source, sourceKey.sourceReference) : [];
  const byDomain = domain ? await findByDomain(organizationId, domain) : [];
  const all = uniq([...bySource, ...byDomain]);

  if (all.length > 1) {
    return { ...base, accountId: null, outcome: 'ambiguous', candidateAccountIds: all,
      reason: `evidence points at ${all.length} distinct accounts; refusing to merge` };
  }
  if (bySource.length === 1) {
    return { ...base, accountId: bySource[0], outcome: 'matched_source', candidateAccountIds: all,
      reason: 'matched an existing account by provider reference' };
  }
  if (byDomain.length === 1) {
    return { ...base, accountId: byDomain[0], outcome: 'matched_domain', candidateAccountIds: all,
      reason: 'matched an existing account by normalized domain' };
  }
  return { ...base, accountId: null, outcome: 'insufficient_evidence', candidateAccountIds: [],
    reason: 'no existing account matches this evidence' };
}

/**
 * Resolve, creating the account when nothing matches.
 *
 * Idempotent by database constraint. On a race, the loser's INSERT violates one
 * of the two unique indexes (`23505`) and we re-resolve rather than retrying
 * blindly — so two workers converge on one account instead of creating two.
 * A prior SELECT alone could not give that guarantee.
 *
 * Refuses to act on `ambiguous`: a caller that wants a merge must decide that
 * explicitly, elsewhere.
 */
export async function resolveOrCreateAccount(
  organizationId: string,
  candidate: AccountCandidate,
  at: string = new Date().toISOString(),
): Promise<AccountResolution> {
  const shadow = await resolveAccountShadow(organizationId, candidate);
  if (shadow.outcome !== 'insufficient_evidence' || (!shadow.sourceKey && !shadow.normalizedDomain)) {
    return shadow;   // matched, ambiguous, or genuinely no evidence — never create
  }

  const row = {
    organization_id: organizationId,
    domain_normalized: shadow.normalizedDomain,
    domain_raw: clean(candidate.domain) ?? clean(candidate.websiteUrl),
    name: clean(candidate.name),
    legal_name: clean(candidate.legalName),
    website_url: clean(candidate.websiteUrl),
    source: shadow.sourceKey?.source ?? W4_SOURCE,
    source_reference: shadow.sourceKey?.sourceReference ?? null,
    status: 'active',
    confidence: shadow.sourceKey ? 1 : 0.8,   // a provider id is stronger evidence than an inferred domain
    metadata: { accountResolutionVersion: ACCOUNT_RESOLUTION_VERSION, createdBy: W4_SOURCE, observedAt: at },
    first_seen_at: at,
  };

  const { data, error } = await ownedDbTable('prospect_accounts').insert(row).select('id').single();
  if (!error && data) {
    return { ...shadow, accountId: (data as { id: string }).id, outcome: 'created',
      candidateAccountIds: [(data as { id: string }).id], reason: 'no existing account matched; created from deterministic evidence' };
  }
  if (error?.code === '23505') {
    // Another worker won. Re-resolve so both callers see the same account.
    const again = await resolveAccountShadow(organizationId, candidate);
    return { ...again, reason: `${again.reason} (created concurrently by another worker)` };
  }
  throw new Error(`prospect_accounts insert failed: ${error?.message ?? 'unknown error'}`);
}

/**
 * Attach a person to their primary account.
 *
 * `unified_persons.account_id` is the canonical person -> account edge.
 * `identity_claims.account_id` is NOT a second relationship model — it marks a
 * claim whose SUBJECT is an account. Keeping those distinct is what stops two
 * competing answers to "which account is this person at".
 *
 * The write is tenant-filtered AND the database enforces tenant agreement via
 * `unified_persons_account_tenant_fk`, so a cross-tenant attachment fails even
 * if a caller gets the filter wrong.
 */
export async function attachPersonToAccount(
  organizationId: string,
  personId: string,
  accountId: string,
): Promise<{ attached: boolean; reason: string }> {
  if (!organizationId?.trim() || !personId || !accountId) {
    return { attached: false, reason: 'organizationId, personId and accountId are all required' };
  }

  const { data, error } = await ownedDbTable('unified_persons')
    .update({ account_id: accountId })
    .eq('id', personId)
    .eq('company_id', organizationId)      // tenant boundary
    .is('account_id', null)                // never silently re-home an attached person
    .select('id');

  if (error) {
    if (error.code === '23503') return { attached: false, reason: 'rejected by tenant integrity constraint' };
    throw new Error(`attachPersonToAccount failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{ id: string }>;
  return rows.length === 1
    ? { attached: true, reason: 'person attached to account' }
    : { attached: false, reason: 'person not found in this tenant, or already attached to an account' };
}
