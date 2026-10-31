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
 * history, delivery evidence or decisions — those carry their own SET NULL
 * edges and survive by design. Source records and the other provenance /
 * evidence rows are REDACTED in place (never deleted) by step 6; the per-table
 * policy is docs/architecture/PROSPECT-PROVENANCE-ERASURE-POLICY.md. It sets no retention period:
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

import { ownedDbRpc, ownedDbTable } from '../../db/writeOwner';
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
import type { EraseProvenanceResult } from '../prospectProvenance/redaction';

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

/**
 * The erasure-request ledger (20270112000003). Every erasure runs under ONE
 * request per person, leased to one runner: a retry or a duplicate request
 * resumes it, and a CONCURRENT one is refused (`erasure_in_progress`) instead
 * of running steps 3–5 twice in parallel. Steps 3–5 are marked as they commit;
 * steps 6 and 7 run in ONE database transaction (`pi_person_erasure_finalize`),
 * so a failed delete also rolls back the provenance redaction, the legacy-lead
 * detach and the score-evaluation redaction — there is no state in which the
 * graph is redacted while the person row still holds the name.
 */
export const ERASURE_LEDGER_OPEN = 'pi_person_erasure_open';
export const ERASURE_LEDGER_MARK = 'pi_person_erasure_mark';
export const ERASURE_LEDGER_FINALIZE = 'pi_person_erasure_finalize';

/** PostgREST / PostgreSQL codes for "the function does not exist". */
const FUNCTION_MISSING = new Set(['PGRST202', '42883']);

/** A ledger error code is a fixed label or an SQLSTATE — never a message (no PII in the ledger). */
const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,80}$/;

const errCode = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;

export interface ErasePersonInput {
  organizationId: string;
  personId: string;
  /** Why the person is being erased. Becomes the revocation reason on every closed-out record. */
  reason: string;
  /** Injected, never read from a clock — the same discipline as `mayContact`. */
  now?: string;
  /**
   * Who asked for the erasure (actor id or system label). Recorded on every
   * provenance redaction tombstone. Defaults to `person_erasure`.
   */
  requestedBy?: string;
  /**
   * Optional caller hook, run after steps 3-5 are marked and immediately
   * before finalize (steps 6-7), while this call holds the request's lease and
   * the person row still exists. The erasure API uses it to capture the
   * completion-verification inventory (20270115000000). It receives the
   * request handle so a database-side hook can prove it is the lease holder.
   * A hook that throws fails the attempt CLOSED exactly like a step failure:
   * the request is marked failed (code only), the lease is released, and
   * finalize is not reached.
   */
  beforeFinalize?: (request: { requestId: string; leaseToken: string; resumed: boolean }) => Promise<void>;
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
  /**
   * Owner decision 8, completed by closure A (20270109000000) — erasure of the
   * person's whole provenance/evidence graph (contributions incl. external_ref,
   * person source records and assertions, contacts, signals, feed items,
   * engagement text, lead_intelligence, prospect metadata), one transaction,
   * with an audit event (`erasureId`) that holds no value and no person id.
   * Rows are redacted, not deleted. See PROSPECT-PROVENANCE-ERASURE-POLICY.md.
   */
  /** NULL only when there was nothing left to erase (`deleted: false`, no request opened). */
  provenanceRedaction: EraseProvenanceResult | null;
  /** The `person_erasure_requests` row this call ran under (NULL when nothing was left to erase). */
  requestId: string | null;
  /** True when this call resumed an open request (a retry after a failure, or a crashed runner's lease expired). */
  resumed: boolean;
  /**
   * What finalize did besides provenance: legacy leads detached, score
   * evaluations redacted, and the retention policy each owner-selectable hook
   * applied. NULL when nothing was left to erase.
   */
  finalizeCounts: Record<string, unknown> | null;
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
  const requestedBy = input.requestedBy?.trim() || ERASURE_SOURCE;

  // 0. Open — or RESUME — the erasure request. Tenant-checked and serialised on
  //    the person row in the database. A person that no longer exists is
  //    answered as "nothing to erase", never as a failure: a completed request
  //    holds no person id, so a repeat cannot be told from an unknown id.
  const request = await openErasureRequest(input.organizationId, input.personId, input.reason, requestedBy);
  if (request === null) {
    return {
      personId: input.personId,
      organizationId: input.organizationId,
      deleted: false,
      plan: planPersonErasure({ organizationId: input.organizationId, personId: input.personId, records: [], contactPoints: [] }),
      reanchored: [],
      revoked: [],
      suppressionsLostToErasure: [],
      provenanceRedaction: null,
      requestId: null,
      resumed: false,
      finalizeCounts: null,
    };
  }

  try {
    return await runErasureSteps(input, now, request);
  } catch (err) {
    // Best effort: record a CODE (never a message) on the open request and
    // release the lease, so a retry resumes at once. The retry always re-runs
    // steps 3–5 (idempotent) and finalize re-checks everything.
    const code = err instanceof PersonErasureError && SAFE_CODE.test(err.code) ? err.code : 'unexpected';
    await markErasureStep(input.organizationId, request, 'failed', undefined, code).catch(() => undefined);
    throw err;
  }
}

interface ErasureRequestHandle { requestId: string; leaseToken: string; resumed: boolean }

async function runErasureSteps(
  input: ErasePersonInput,
  now: string,
  request: ErasureRequestHandle,
): Promise<ErasePersonResult> {
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
          // PG-001 / DR-7 — carried forward verbatim, for the same reason as
          // `effectiveFrom`. Dropping it would WIDEN a narrow restriction, and
          // inventing one would narrow a broad one; either way the person's own
          // instruction would change meaning at the moment of erasure.
          purposeScope: a.purposeScope,
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
  // J1 ER-2: the ledger ADDS this count across attempts (reanchored_count +
  // p_count). A resumed attempt finds the records an earlier attempt created as
  // `already_present`; counting those again over-summed. Report only what THIS
  // attempt created, so the ledger total is the number of carried-forward
  // records the erasure request created. (Step 4 already reports only rows it
  // newly revoked: rows revoked by an earlier attempt are skipped as history.)
  await markErasureStep(
    input.organizationId, request, 'governance_reanchored',
    reanchored.filter((r) => r.outcome === 'created').length,
  );

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
  await markErasureStep(input.organizationId, request, 'governance_revoked', revoked.length);

  // 5. Drop the historical employer leg from this person's own evidence, while
  //    `person_id` still identifies it. Fail closed: a failure throws and the
  //    person is not deleted.
  await clearPersonEvidenceAccountLinks(input.organizationId, input.personId);
  await markErasureStep(input.organizationId, request, 'evidence_links_cleared');

  // Caller hook (see ErasePersonInput.beforeFinalize). Lease held, person
  // present, steps 3-5 marked. A throw propagates to erasePerson's handler,
  // which records the code and releases the lease.
  if (input.beforeFinalize) {
    await input.beforeFinalize({ requestId: request.requestId, leaseToken: request.leaseToken, resumed: request.resumed });
  }

  // 6 + 7. ONE database transaction (`pi_person_erasure_finalize`):
  //    6   the provenance erasure (owner decision 8 / closure A, unchanged
  //        function, ALWAYS called while every link to the person still exists);
  //    6b  legacy `leads` of the person are stamped `person_erased_at`, so the
  //        FK's SET NULL is admissible (20270112000001) — the leads survive;
  //    6c  the person's `prospect_score_evaluations` are redacted through the
  //        one sanctioned path of the append-only trigger (20270112000002);
  //    6d/6e the owner-selectable retention hooks (default: retain);
  //    7   the tenant-first delete.
  //    If anything fails, all of it rolls back and the person is exactly as it
  //    was before step 6. The function also refuses while a LIVE person-anchored
  //    governance record remains (one written after step 4), so the delete never
  //    SET-NULLs a live instruction. FAIL CLOSED: any failure throws.
  const { deleted, provenanceRedaction, finalizeCounts } = await finalizeErasure(input.organizationId, request);

  return {
    personId: input.personId,
    organizationId: input.organizationId,
    deleted,
    plan,
    reanchored,
    revoked,
    suppressionsLostToErasure: plan.actions.filter((a) => a.disposition === 'unenforceable'),
    provenanceRedaction,
    requestId: request.requestId,
    resumed: request.resumed,
    finalizeCounts,
  };
}

// ─── erasure-request ledger calls ──────────────────────────────────────────

const LEDGER_MISSING_HINT = 'apply 20270112000000..20270112000003';

async function openErasureRequest(
  organizationId: string, personId: string, reason: string, requestedBy: string,
): Promise<ErasureRequestHandle | null> {
  const res = await ownedDbRpc(ERASURE_LEDGER_OPEN, {
    p_organization_id: organizationId,
    p_person_id: personId,
    p_reason: reason.trim(),
    p_requested_by: requestedBy,
  });
  if (res.error) {
    const code = errCode(res.error);
    const message = String(res.error.message ?? '');
    if (code === 'P0002') return null;                       // nothing of the person is left
    if (code && FUNCTION_MISSING.has(code)) {
      throw new PersonErasureError(`the erasure ledger is not deployed (${LEDGER_MISSING_HINT}): ${message}`, 'erasure_ledger_unavailable');
    }
    if (code === '42501') {
      throw new PersonErasureError('erasure refused: the person belongs to another tenant', 'cross_tenant');
    }
    if (code === '55P03') {
      throw new PersonErasureError('another erasure of this person is in progress; retry after it finishes or its lease expires', 'erasure_in_progress');
    }
    throw new PersonErasureError(`could not open the erasure request (${code ?? 'unknown'}): ${message}`, code ?? 'erasure_request_failed');
  }
  const data = (res.data ?? {}) as { request_id?: unknown; lease_token?: unknown; resumed?: unknown };
  if (typeof data.request_id !== 'string' || !data.request_id
      || typeof data.lease_token !== 'string' || !data.lease_token) {
    throw new PersonErasureError('the erasure ledger returned no request id / lease', 'erasure_request_unconfirmed');
  }
  return { requestId: data.request_id, leaseToken: data.lease_token, resumed: data.resumed === true };
}

async function markErasureStep(
  organizationId: string, request: ErasureRequestHandle,
  step: 'governance_reanchored' | 'governance_revoked' | 'evidence_links_cleared' | 'failed',
  count?: number, errorCode?: string,
): Promise<void> {
  const res = await ownedDbRpc(ERASURE_LEDGER_MARK, {
    p_organization_id: organizationId,
    p_request_id: request.requestId,
    p_lease_token: request.leaseToken,
    p_step: step,
    p_count: count ?? null,
    p_error_code: errorCode ?? null,
  });
  if (res.error) {
    // A marker that cannot be written fails closed: finalize refuses without
    // markers 3–5, and the retry re-runs the idempotent steps.
    const code = errCode(res.error);
    throw new PersonErasureError(
      `could not record erasure step ${step}: ${res.error.message}`,
      code === '55P03' ? 'erasure_lease_lost' : (code ?? 'erasure_mark_failed'),
    );
  }
}

async function finalizeErasure(
  organizationId: string, request: ErasureRequestHandle,
): Promise<{ deleted: boolean; provenanceRedaction: EraseProvenanceResult; finalizeCounts: Record<string, unknown> | null }> {
  const res = await ownedDbRpc(ERASURE_LEDGER_FINALIZE, {
    p_organization_id: organizationId,
    p_request_id: request.requestId,
    p_lease_token: request.leaseToken,
  });
  if (res.error) {
    const code = errCode(res.error);
    const message = String(res.error.message ?? '');
    if (code && FUNCTION_MISSING.has(code)) {
      throw new PersonErasureError(`the erasure ledger is not deployed (${LEDGER_MISSING_HINT}): ${message}`, 'erasure_ledger_unavailable');
    }
    // The function names the blocker; map by NAME, never by SQLSTATE alone
    // (a 23503 used to be reported as a merge survivor whatever blocked it).
    const blocker = /delete_blocked_by (\S+)/.exec(message)?.[1];
    if (blocker && /^unified_persons_merge_/.test(blocker)) {
      throw new PersonErasureError(
        'the person is the survivor of a merge and cannot be erased until the merged people are resolved',
        'merge_survivor',
      );
    }
    if (blocker) {
      throw new PersonErasureError(`person delete blocked by ${blocker} (${code}); nothing was erased`, 'delete_blocked');
    }
    if (/live_person_governance_remains/.test(message)) {
      throw new PersonErasureError('a live person-anchored governance record appeared after step 4; retry the erasure', 'governance_changed_retry');
    }
    if (/person_vanished_outside_ledger/.test(message)) {
      throw new PersonErasureError('the person was deleted outside the erasure ledger; an operator must review the request', 'person_vanished_outside_ledger');
    }
    if (code === '55P03') {
      throw new PersonErasureError('the erasure lease was taken over by another runner', 'erasure_lease_lost');
    }
    throw new PersonErasureError(`erasure finalize failed (${code ?? 'unknown'}): ${message}`, code ?? 'erasure_finalize_failed');
  }
  const data = (res.data ?? {}) as {
    deleted?: unknown; provenance?: Record<string, unknown> | null; provenance_erasure_id?: unknown;
    finalize_counts?: Record<string, unknown> | null;
  };
  const p = data.provenance ?? {};
  const erasureId = typeof p.erasure_id === 'string' ? p.erasure_id
    : (typeof data.provenance_erasure_id === 'string' ? data.provenance_erasure_id : '');
  if (!erasureId) {
    throw new PersonErasureError('the erasure finalize returned no provenance erasure event', 'provenance_erasure_unconfirmed');
  }
  const counts: Record<string, number> = {};
  if (p.counts && typeof p.counts === 'object') {
    for (const [k, v] of Object.entries(p.counts as Record<string, unknown>)) counts[k] = Number(v ?? 0);
  }
  return {
    deleted: data.deleted === true,
    provenanceRedaction: {
      status: 'erased',
      erasureId,
      redacted: Number(p.redacted ?? 0),
      alreadyRedacted: Number(p.already_redacted ?? 0),
      contributionIds: Array.isArray(p.contribution_ids) ? (p.contribution_ids as unknown[]).map(String) : [],
      canonicalLeadIds: Array.isArray(p.canonical_lead_ids) ? (p.canonical_lead_ids as unknown[]).map(String) : [],
      counts,
    },
    finalizeCounts: data.finalize_counts && typeof data.finalize_counts === 'object' ? data.finalize_counts : null,
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
    // PG-001: `purpose_scope` is selected because erasure must CARRY IT
    // FORWARD. Re-anchoring without it would silently widen a narrow
    // restriction — the person's own instruction would change meaning at the
    // moment they exercised their erasure right.
    .select('id, organization_id, person_id, target_normalized, channel, governance_type, effective_from, effective_until, revoked_at, purpose_scope')
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
      purposeScope: r.purpose_scope == null ? null : String(r.purpose_scope),
    }))
    .filter((r) => r.organizationId === organizationId);
}

/**
 * D1 (Option B) — drop the historical employer leg from the person's OWN evidence.
 *
 * Before O-5 the assertion writer set `account_id` on every row it wrote, so a
 * person-scoped assertion carried its subject AND that person's employer. The
 * writer is now subject-only, which makes this a HISTORICAL cleanup with a
 * finite, shrinking scope: rows written before O-5.
 *
 * It must run BEFORE the person row is deleted. Afterwards
 * `ON DELETE SET NULL (person_id)` has already nulled `person_id`, and nothing
 * stored on the row identifies it as this person's any more.
 *
 * SCOPE, deliberately narrow:
 *   - `source_assertions` only. `source_records.account_id` is contextual
 *     lineage with a separate role and is NOT in this decision.
 *   - `entity_type = 'person'` — account- and relationship-scoped evidence is
 *     untouched (relationship rows already hold NULL by
 *     `source_assertions_relationship_coherent`).
 *   - `account_id IS NOT NULL` — post-O-5 rows already satisfy the subject
 *     model, so they are not rewritten.
 *   - only `account_id` is set. No value, hash, subject or source identifier
 *     is rewritten.
 *
 * FAIL CLOSED. A failure here throws, so `pi_person_erasure_finalize` is never reached and
 * the person survives with their evidence intact — the same direction every
 * other step in this module fails in. Erasure remains NON-TRANSACTIONAL across
 * tables (see note 3 in the header): a failure after this step succeeds leaves
 * the account leg cleared and the person present, which is safe and retryable,
 * because clearing an already-cleared leg matches nothing.
 */
async function clearPersonEvidenceAccountLinks(
  organizationId: string,
  personId: string,
): Promise<number> {
  const res = await ownedDbTable('source_assertions')
    .update({ account_id: null })
    .eq('organization_id', organizationId)    // TENANT FIRST, always
    .eq('person_id', personId)
    .eq('entity_type', 'person')
    .not('account_id', 'is', null)
    .select('id');

  if (res.error) {
    throw new PersonErasureError(
      `could not clear the person's historical account associations: ${res.error.message}`,
      errCode(res.error) ?? 'evidence_account_link_unclearable',
    );
  }
  return ((res.data ?? []) as Array<unknown>).length;
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
 * 3. Erasure is not ONE transaction. Steps 3 (one INSERT per carried-forward
 *    target), 4 (one UPDATE per revoked record) and 5 each commit on their own;
 *    steps 6–7 commit together in `pi_person_erasure_finalize`. Steps 3 and 4
 *    are ordered so that a failure leaves suppression STRONGER than before
 *    (extra target records, originals still live) and the person present.
 *    Every step is idempotent (re-anchoring by 23505, revocation by
 *    `.is('revoked_at', null)`, step 5 matches nothing twice, step 6 reports
 *    zero counts), the ledger request is RESUMED by a retry and leased to one
 *    runner at a time, so a retry is always safe and always re-runs 3–5 (a
 *    record written between attempts must be carried forward too). Between a
 *    failed attempt and its retry the person row exists with its name and its
 *    provenance unredacted; only governance has moved (carried forward /
 *    revoked), which keeps suppression enforced.
 *
 * 4. This module does not decide a retention period for anything. Retention is
 *    an open policy question and a default invented here would answer it.
 */
