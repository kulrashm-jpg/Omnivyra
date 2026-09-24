/**
 * PI/WS-F — the canonical ERASURE path for a `unified_persons` row.
 *
 * ─── WHY THIS MODULE EXISTS ───────────────────────────────────────────────
 * Nothing in this repository deletes a person. That is not an oversight that
 * makes deletion safe; it is the reason two defects stayed latent. The moment a
 * delete happens, `contact_governance_person_tenant_fk`
 * (`ON DELETE SET NULL (person_id)`, D-3) fires as an UPDATE on every governance
 * record naming that person, and that UPDATE is checked against the table's
 * CHECKs and its partial unique index:
 *
 *   DEFECT-008  a PERSON-ONLY record (`person_id` set, `target_normalized`
 *               NULL) becomes anchored to nothing, violates
 *               `contact_governance_has_anchor`, and aborts the DELETE (23514).
 *
 *   DEFECT-010  `uq_contact_governance_identity` keys on
 *               `coalesce(person_id::text, target_normalized)`. A BOTH-anchored
 *               record's key is its PERSON, and nulling the person changes that
 *               key to its TARGET. If a target-anchored record already holds
 *               `(organization_id, channel, governance_type, target)` and is
 *               live, the SET NULL update collides and aborts the DELETE
 *               (23505). The shape that traps is the erasure-SAFE-looking one.
 *
 * Neither is a bug in the foreign key or the CHECK. Both are what happens when
 * a compliance record is forced to change its identity as a side effect of a
 * delete nobody defined. This module defines it.
 *
 * ─── THE MODEL: RE-ANCHOR, THEN REVOKE, THEN DELETE ───────────────────────
 * A person-anchored instruction says "do not contact this human". Once the
 * human's record is gone, the only thing the platform can still recognise is an
 * ADDRESS. So, before the delete:
 *
 *   1. read the person's contact points from `identity_claims` — which CASCADEs
 *      on person delete, so this must happen first or the evidence is gone;
 *   2. for each LIVE person-anchored governance record, write the same
 *      instruction as TARGET-anchored records, one per applicable contact
 *      point, through the existing writer (INSERT, catch 23505 — the index is
 *      partial and `ON CONFLICT` answers 42P10);
 *   3. REVOKE the person-anchored original, with a reason. Revoked, never
 *      deleted (ADR §16). It leaves the partial unique index, which is what
 *      makes DEFECT-010 unreachable;
 *   4. delete the person.
 *
 * The original record still reads exactly as it was written — a person-scoped
 * instruction, in force from its own `effective_from`, closed out at erasure.
 * Nothing rewrites what a compliance record said.
 *
 * ─── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────
 * It does not seal the original in place by writing a target onto it. That
 * would change what a historical compliance record claims its subject was, and
 * ADR §16 exists to prevent precisely that.
 *
 * It does not delete a governance record, ever. It does not weaken, narrow or
 * drop a suppression that it can still enforce. It does not touch outreach
 * history, delivery evidence, decisions or source records — those carry their
 * own SET NULL edges and survive by design. It sets no retention period:
 * retention is undecided and inventing one here would decide it silently.
 *
 * It does not surface a residual identifier. The re-anchored records carry the
 * ORIGINATING RECORD's id, never the erased person's id: an erasure that leaves
 * the erased subject's key behind in a surviving row is not an erasure.
 *
 * ─── WHERE THE DECISION LIVES ─────────────────────────────────────────────
 * Which of those things happens to which record — including the instructions
 * that cannot be carried forward at all — is decided by `planPersonErasure` in
 * `./erasurePlan`, which is pure and takes no clock. This module is the
 * procedure: it reads the evidence, writes the carried-forward records,
 * revokes the originals, deletes the person, and fails closed at every step.
 * It re-exports the planner, so the whole erasure path is still reachable
 * through this module alone.
 */

import { ownedDbTable } from '../../db/writeOwner';
import type { GovernanceRecord, GovernanceType } from './contactGovernance';
import { ALL_CHANNELS } from './contactGovernance';
import {
  recordContactGovernance,
  revokeContactGovernance,
  GovernanceWriteError,
} from './contactGovernanceWriter';
import {
  CONTACT_CLAIM_TYPES,
  PersonErasureError,
  dedupeContactPoints,
  planPersonErasure,
  type ContactClaimType,
  type GovernanceErasureAction,
  type PersonContactPoint,
  type PersonErasurePlan,
} from './erasurePlan';

// The planner's surface stays importable from here, unchanged: `index.ts` and
// the WS-F tests reach erasure through this module and must not have to know
// that the decision half lives in a sibling file.
export {
  planPersonErasure,
  contactClaimTypesForChannel,
  PersonErasureError,
  CONTACT_CLAIM_TYPES,
} from './erasurePlan';
export type {
  ContactClaimType,
  ErasureDisposition,
  GovernanceErasureAction,
  PersonContactPoint,
  PersonErasurePlan,
  PlanPersonErasureInput,
} from './erasurePlan';

/** Provenance stamped on every record this module creates. */
export const ERASURE_SOURCE = 'person_erasure';

const errCode = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;

export interface ErasePersonInput {
  organizationId: string;
  personId: string;
  /** Why the person is being erased. Becomes the revocation reason on every closed-out record. */
  reason: string;
  /** Injected, never read from a clock — the same discipline as `mayContact`. */
  now?: string;
}

export interface ErasePersonResult {
  personId: string;
  organizationId: string;
  deleted: boolean;
  plan: PersonErasurePlan;
  /** Target-anchored records created, by the record they were carried forward from. */
  reanchored: Array<{ fromRecordId: string; target: string; newRecordId: string; outcome: 'created' | 'already_present' }>;
  /** Person-anchored records closed out. Revoked, never deleted. */
  revoked: string[];
  /**
   * Instructions that could not be carried forward. SURFACED, not swallowed:
   * the caller is expected to log or alarm on a non-empty array.
   */
  suppressionsLostToErasure: GovernanceErasureAction[];
}

/**
 * Erase a person, preserving every governance instruction that can still be
 * enforced.
 *
 * FAIL CLOSED. Any failure before the delete aborts the erasure with the person
 * intact. A half-erased person whose suppressions were revoked but whose row
 * survives is strictly worse than one that was never erased: the human is
 * contactable again and the record that said not to is closed.
 */
export async function erasePerson(input: ErasePersonInput): Promise<ErasePersonResult> {
  if (!input.organizationId?.trim()) {
    throw new PersonErasureError('organizationId is required — erasure is never tenant-less', 'tenant_required');
  }
  if (!input.personId?.trim()) {
    throw new PersonErasureError('personId is required', 'person_required');
  }
  if (!input.reason?.trim()) {
    // Every record this closes out needs a reason; `contact_governance_revocation_coherent`
    // enforces the pair in the database and this makes it explicit at the edge.
    throw new PersonErasureError('reason is required — an unexplained erasure is an unusable audit record', 'reason_required');
  }
  const now = input.now ?? new Date().toISOString();

  // 1. Contact points FIRST. `identity_claims.person_id` is ON DELETE CASCADE
  //    (W4, 20260923000000), so after the delete this evidence no longer exists.
  const contactPoints = await loadContactPoints(input.organizationId, input.personId);

  // 2. Every governance record naming the person, REVOKED ONES INCLUDED.
  const records = await loadPersonAnchoredGovernance(input.organizationId, input.personId);

  const plan = planPersonErasure({
    organizationId: input.organizationId,
    personId: input.personId,
    records,
    contactPoints,
  });

  // 3. Carry the enforceable instructions forward, BEFORE anything is revoked.
  //    Order matters: if a write fails we abort with the original instructions
  //    still live and the person still present.
  const reanchored: ErasePersonResult['reanchored'] = [];
  for (const a of plan.actions) {
    if (a.disposition !== 'reanchored') continue;
    for (const target of a.reanchorTargets) {
      try {
        const written = await recordContactGovernance({
          organizationId: plan.organizationId,
          governanceType: a.governanceType,
          channel: a.channel,
          // TARGET-anchored, explicitly. The person is about to stop existing.
          personId: null,
          target,
          source: ERASURE_SOURCE,
          // The instruction has been in force since it was first recorded. A
          // new `effective_from` would claim the person consented in between.
          effectiveFrom: a.effectiveFrom,
          effectiveUntil: a.effectiveUntil ?? undefined,
          evidence: {
            // The ORIGINATING RECORD, never the erased person id.
            reanchored_from_record_id: a.recordId,
            reanchored_from_anchor: 'person',
            reanchored_at: now,
          },
        });
        reanchored.push({ fromRecordId: a.recordId, target, newRecordId: written.id, outcome: written.outcome });
      } catch (err) {
        // A pre-existing live target record is NOT an error — the writer
        // already resolves 23505 to `already_present`. Anything that reaches
        // here is a real failure and must stop the erasure.
        throw new PersonErasureError(
          `could not carry governance record ${a.recordId} forward onto '${target}': `
          + `${err instanceof GovernanceWriteError ? `${err.code}: ` : ''}${(err as Error).message}`,
          'reanchor_failed',
        );
      }
    }
  }

  // 4. Close out the person-anchored originals. Revoked, never deleted — and
  //    revocation is what removes them from `uq_contact_governance_identity`,
  //    which is what makes DEFECT-010 unreachable.
  const revoked: string[] = [];
  for (const a of plan.actions) {
    if (a.disposition === 'history_retained') continue;   // already revoked; ADR §16 forbids touching it
    const res = await revokeContactGovernance({
      organizationId: plan.organizationId,
      id: a.recordId,
      reason: revocationReason(input.reason, a),
      revokedAt: now,
    });
    if (res.revoked) revoked.push(a.recordId);
  }

  // 5. The erasure itself.
  const deleted = await deletePersonRow(input.organizationId, input.personId);

  return {
    personId: input.personId,
    organizationId: input.organizationId,
    deleted,
    plan,
    reanchored,
    revoked,
    suppressionsLostToErasure: plan.actions.filter((a) => a.disposition === 'unenforceable'),
  };
}

function revocationReason(reason: string, a: GovernanceErasureAction): string {
  const tail = a.disposition === 'reanchored'
    ? `re-anchored onto ${a.reanchorTargets.length} target(s)`
    : 'no contact point to carry it onto; instruction not enforceable after erasure';
  return `person erased: ${reason} — ${tail}`;
}

/**
 * The person's contact points, from the canonical claims table.
 *
 * Revoked claims are excluded: a claim the tenant has retired is not an address
 * the platform believes belongs to this person, and re-anchoring a suppression
 * onto it would block an address on evidence the platform itself withdrew.
 */
async function loadContactPoints(organizationId: string, personId: string): Promise<PersonContactPoint[]> {
  const res = await ownedDbTable('identity_claims')
    .select('claim_type, normalized_value')
    .eq('organization_id', organizationId)    // TENANT FIRST, always
    .eq('person_id', personId)
    .is('revoked_at', null)
    .in('claim_type', [...CONTACT_CLAIM_TYPES]);

  if (res.error) {
    throw new PersonErasureError(
      `could not read the person's contact points: ${res.error.message}`,
      errCode(res.error) ?? 'contact_points_unreadable',
    );
  }
  return dedupeContactPoints(((res.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    claimType: String(r.claim_type) as ContactClaimType,
    normalizedValue: String(r.normalized_value ?? ''),
  })));
}

/**
 * Every governance record anchored to this person.
 *
 * NO `revoked_at IS NULL` FILTER, deliberately. The reader used for evaluation
 * (`loadGovernanceRecords`) filters revoked rows because they cannot decide
 * anything. Erasure is the opposite question: which rows will the
 * `ON DELETE SET NULL (person_id)` update touch? Every row naming the person,
 * whatever its state. Filtering here is how DEFECT-008 survives the fix.
 */
async function loadPersonAnchoredGovernance(organizationId: string, personId: string): Promise<GovernanceRecord[]> {
  const res = await ownedDbTable('contact_governance_records')
    .select('id, organization_id, person_id, target_normalized, channel, governance_type, effective_from, effective_until, revoked_at')
    .eq('organization_id', organizationId)    // TENANT FIRST, always
    .eq('person_id', personId);

  if (res.error) {
    throw new PersonErasureError(
      `could not read the person's governance records: ${res.error.message}`,
      errCode(res.error) ?? 'governance_unreadable',
    );
  }

  return ((res.data ?? []) as Array<Record<string, unknown>>)
    .map((r) => ({
      id: String(r.id),
      organizationId: String(r.organization_id),
      personId: r.person_id == null ? null : String(r.person_id),
      targetNormalized: r.target_normalized == null ? null : String(r.target_normalized),
      channel: String(r.channel),
      governanceType: String(r.governance_type) as GovernanceType,
      effectiveFrom: String(r.effective_from),
      effectiveUntil: r.effective_until == null ? null : String(r.effective_until),
      revokedAt: r.revoked_at == null ? null : String(r.revoked_at),
    }))
    .filter((r) => r.organizationId === organizationId);
}

async function deletePersonRow(organizationId: string, personId: string): Promise<boolean> {
  const res = await ownedDbTable('unified_persons')
    .delete()
    .eq('company_id', organizationId)         // TENANT FIRST — never erase another tenant's person
    .eq('id', personId)
    .select('id');

  if (res.error) {
    const code = errCode(res.error);
    // `unified_persons_merge_tenant_fk` is ON DELETE NO ACTION (LI-4C, ADR §15):
    // a survivor cannot be deleted while another person is merged into it. That
    // is the documented, intended behaviour, and merging is disabled today — but
    // a raw 23503 would tell a caller nothing about why.
    if (code === '23503') {
      throw new PersonErasureError(
        'the person is the survivor of a merge and cannot be erased until the merged people are resolved',
        'merge_survivor',
      );
    }
    throw new PersonErasureError(
      `person delete failed (${code}): ${res.error.message}`,
      code ?? 'delete_failed',
    );
  }
  return ((res.data ?? []) as unknown[]).length > 0;
}

/**
 * KNOWN LIMITATIONS, recorded rather than hidden:
 *
 * 1. Contact points come only from `identity_claims`. `contacts`,
 *    `engagement_threads` and the lead tables may hold an address this table
 *    does not, and no correspondence between them has been proven from data
 *    (the same gap A3 recorded for `leads.lead_id`). A suppression whose only
 *    address lives there will be reported as `unenforceable` even though an
 *    address exists somewhere. Widening the source is a data-proof job, not a
 *    guess.
 *
 * 2. `identity_claims.normalized_value` is taken as already normalised — W1's
 *    `identity_claims_value_is_normalized` CHECK guarantees lowercase, and W1's
 *    writers run the same `normalizeEmail`/`normalizePhone` the governance
 *    writer runs. The governance writer normalises again on the way in, so a
 *    divergence would surface as a mismatch rather than a silent bad target.
 *
 * 3. Erasure is not transactional across the two tables. Steps 3 and 4 are
 *    ordered so that a failure leaves suppression STRONGER than before (extra
 *    target records, originals still live) and the person present. A retry is
 *    safe: re-anchoring is idempotent by 23505 and revocation is guarded by
 *    `.is('revoked_at', null)`.
 *
 * 4. This module does not decide a retention period for anything. Retention is
 *    an open policy question and a default invented here would answer it.
 */
