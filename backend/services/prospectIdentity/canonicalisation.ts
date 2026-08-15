/**
 * W3 — legacy → canonical identity canonicalisation.
 *
 * Turns identity evidence that is ALREADY explicit in legacy records into
 * durable, auditable `identity_claims`. It creates no person, no account, and
 * no relationship that was not already asserted by the data.
 *
 * ─── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────
 * It does not resolve, match, merge or deduplicate. The W1 shadow resolver
 * answers "would this resolve"; `identityResolutionService` is the live
 * resolve-or-create path. This module is neither: it is a TRANSCRIBER. Its
 * whole job is to move evidence that currently lives implicitly in a column
 * into the claim layer, where it can be queried, explained and revoked.
 *
 * That boundary is the point. A backfill that also matched would be a second
 * identity engine, and the one thing worse than no canonicalisation is two
 * disagreeing ones.
 *
 * ─── WHY CLAIMS ARE INSERTED, NOT UPSERTED ─────────────────────────────────
 * `uq_identity_claims_tenant_identity` is a PARTIAL unique index
 * (`WHERE revoked_at IS NULL`). PostgREST emits a column-only ON CONFLICT
 * clause, which PostgreSQL refuses to infer against a partial index — the
 * exact 42P10 failure W0.1 and W0.2 were spent diagnosing. So this inserts and
 * treats a unique violation as "already claimed".
 *
 * That is not a workaround; it is the correct shape. The database constraint —
 * not a prior SELECT — decides whether the claim exists, so two workers racing
 * on the same evidence produce one row rather than two (§20). A
 * SELECT-then-INSERT would be a lost-update bug wearing an idempotency costume.
 *
 * ─── TENANT ─────────────────────────────────────────────────────────────────
 * Every claim carries the tenant of the record it came from, and evidence is
 * never read across tenants. Nothing here compares a value in one tenant to a
 * value in another.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { normalizeClaimValue, type ClaimType } from './normalization';

/** Bumped when the derivation rules change, so a claim can be traced to the logic that made it. */
export const CANONICALISATION_VERSION = 'w3.1';

/** Marks every row this module writes, so its output is separable from hand entry. */
export const CANONICALISATION_SOURCE = 'w3_backfill';

/** One claim this module is prepared to assert, before any database contact. */
export interface DerivedClaim {
  organizationId: string;
  /** NULL when the evidence names an identifier but no person — a recorded observation, not an assertion. */
  personId: string | null;
  claimType: ClaimType;
  platform: string | null;
  normalizedValue: string;
  rawValue: string | null;
  sourceTable: string;
  sourceId: string;
  sourceColumn: string;
  /**
   * Provenance override. W3's backfill leaves this unset and is recorded as
   * `w3_backfill`; a live writer (LI-5D) sets its own, because a claim created
   * by today's ingestion must not describe itself as a historical backfill.
   */
  source?: string;
  /** Evidence override, paired with `source`. Summary only — never a payload. */
  evidence?: Record<string, unknown>;
}

export type DerivationOutcome = 'derived' | 'unusable';

export interface DerivationSummary {
  scanned: number;
  derived: number;
  unusable: number;
  byEvidence: Record<string, number>;
}

/** What a persistence run did. `alreadyPresent` is the idempotency signal. */
export interface BackfillResult {
  attempted: number;
  inserted: number;
  alreadyPresent: number;
  failed: number;
  errors: Array<{ sourceTable: string; sourceId: string; code: string | null; message: string }>;
}

// ── derivation (pure) ───────────────────────────────────────────────────────

interface PersonRow { id: string; company_id: string; primary_email: string | null; primary_phone: string | null }
interface ContactRow { id: string; organization_id: string; platform: string; platform_user_id: string }

/**
 * Claims implied by a canonical person's own columns.
 *
 * `primary_email` / `primary_phone` are already the tenant-scoped identity the
 * spine enforces uniqueness on, so transcribing them asserts nothing new — it
 * only makes the assertion inspectable and revocable.
 */
export function deriveFromPerson(row: PersonRow): DerivedClaim[] {
  const out: DerivedClaim[] = [];
  const base = { organizationId: row.company_id, personId: row.id, platform: null, sourceTable: 'unified_persons', sourceId: row.id };

  const email = normalizeClaimValue('email', row.primary_email);
  if (email) out.push({ ...base, claimType: 'email', normalizedValue: email, rawValue: row.primary_email, sourceColumn: 'primary_email' });

  const phone = normalizeClaimValue('phone', row.primary_phone);
  if (phone) out.push({ ...base, claimType: 'phone', normalizedValue: phone, rawValue: row.primary_phone, sourceColumn: 'primary_phone' });

  return out;
}

/**
 * Claims implied by a legacy social contact.
 *
 * `contacts` carries a platform identity and nothing else — no email, no phone,
 * no name. It therefore yields an identifier we can record but CANNOT attribute
 * to a person, so `personId` stays null. That is not a failure of the backfill;
 * it is the honest shape of the evidence, and `identity_claims.person_id` was
 * made nullable in W1 precisely so an observation could be stored without
 * inventing an owner for it.
 *
 * `contacts.unified_person_id` is honoured when a previous process already
 * linked one — this module never establishes that link itself.
 */
export function deriveFromContact(row: ContactRow & { unified_person_id?: string | null }): DerivedClaim[] {
  const platform = String(row.platform ?? '').trim().toLowerCase();
  const value = normalizeClaimValue('external_id', row.platform_user_id);
  if (!platform || !value) return [];

  return [{
    organizationId: row.organization_id,
    personId: row.unified_person_id ?? null,
    claimType: 'external_id',
    platform,
    normalizedValue: value,
    rawValue: row.platform_user_id,
    sourceTable: 'contacts',
    sourceId: row.id,
    sourceColumn: 'platform_user_id',
  }];
}

// ── shadow analysis (read-only) ─────────────────────────────────────────────

/**
 * Compute what a backfill WOULD assert, writing nothing. Run before persistence
 * so the impact is known rather than discovered.
 */
export async function analyseCanonicalisation(organizationId?: string): Promise<{
  persons: DerivationSummary; contacts: DerivationSummary; claims: DerivedClaim[];
}> {
  const claims: DerivedClaim[] = [];
  const personSummary: DerivationSummary = { scanned: 0, derived: 0, unusable: 0, byEvidence: {} };
  const contactSummary: DerivationSummary = { scanned: 0, derived: 0, unusable: 0, byEvidence: {} };

  let pq = ownedDbTable('unified_persons').select('id, company_id, primary_email, primary_phone');
  if (organizationId) pq = pq.eq('company_id', organizationId);
  const { data: persons, error: pErr } = await pq;
  if (pErr) throw new Error(`unified_persons scan failed: ${pErr.message}`);

  for (const p of (persons ?? []) as PersonRow[]) {
    personSummary.scanned += 1;
    const derived = deriveFromPerson(p);
    if (derived.length === 0) personSummary.unusable += 1;
    for (const d of derived) {
      personSummary.derived += 1;
      personSummary.byEvidence[d.claimType] = (personSummary.byEvidence[d.claimType] ?? 0) + 1;
      claims.push(d);
    }
  }

  let cq = ownedDbTable('contacts').select('id, organization_id, platform, platform_user_id, unified_person_id');
  if (organizationId) cq = cq.eq('organization_id', organizationId);
  const { data: contacts, error: cErr } = await cq;
  if (cErr) throw new Error(`contacts scan failed: ${cErr.message}`);

  for (const ct of (contacts ?? []) as Array<ContactRow & { unified_person_id: string | null }>) {
    contactSummary.scanned += 1;
    const derived = deriveFromContact(ct);
    if (derived.length === 0) { contactSummary.unusable += 1; continue; }
    for (const d of derived) {
      contactSummary.derived += 1;
      const key = d.personId ? `${d.claimType}:linked` : `${d.claimType}:unresolved`;
      contactSummary.byEvidence[key] = (contactSummary.byEvidence[key] ?? 0) + 1;
      claims.push(d);
    }
  }

  return { persons: personSummary, contacts: contactSummary, claims };
}

// ── persistence (idempotent) ────────────────────────────────────────────────

const toRow = (d: DerivedClaim, at: string) => ({
  organization_id: d.organizationId,
  person_id: d.personId,
  claim_type: d.claimType,
  platform: d.platform,
  normalized_value: d.normalizedValue,
  raw_value: d.rawValue,
  source: d.source ?? CANONICALISATION_SOURCE,
  source_reference: `${d.sourceTable}:${d.sourceId}`,
  evidence: d.evidence ?? {
    canonicalisationVersion: CANONICALISATION_VERSION,
    sourceTable: d.sourceTable,
    sourceColumn: d.sourceColumn,
    sourceId: d.sourceId,
    derivation: 'direct_column_transcription',
    observedAt: at,
  },
  // Direct transcription of a stored identifier. Not an inference — but not
  // independently verified either, which is what verification_state records.
  confidence: 1,
  verification_state: 'unverified',
  observed_at: at,
});

/**
 * Persist derived claims. Idempotent by database constraint, not by prior read.
 *
 * A `23505` means an equivalent active claim already exists — the correct
 * outcome on a second run, and the reason a re-run converges instead of
 * duplicating.
 */
export async function persistClaims(claims: DerivedClaim[], at: string = new Date().toISOString()): Promise<BackfillResult> {
  const result: BackfillResult = { attempted: 0, inserted: 0, alreadyPresent: 0, failed: 0, errors: [] };

  for (const d of claims) {
    result.attempted += 1;
    const { error } = await ownedDbTable('identity_claims').insert(toRow(d, at));
    if (!error) { result.inserted += 1; continue; }
    if (error.code === '23505') { result.alreadyPresent += 1; continue; }
    result.failed += 1;
    result.errors.push({ sourceTable: d.sourceTable, sourceId: d.sourceId, code: error.code ?? null, message: error.message });
  }

  return result;
}

/** Shadow analysis followed by persistence. `dryRun` stops before any write. */
export async function runCanonicalisation(options: { organizationId?: string; dryRun?: boolean } = {}) {
  const analysis = await analyseCanonicalisation(options.organizationId);
  if (options.dryRun !== false) {
    return { ...analysis, persisted: null as BackfillResult | null, dryRun: true };
  }
  const persisted = await persistClaims(analysis.claims);
  return { ...analysis, persisted, dryRun: false };
}
