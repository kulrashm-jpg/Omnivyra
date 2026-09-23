/**
 * PI/WS-F — the ERASURE PLANNER: what happens to each governance record when
 * the person it names is erased.
 *
 * PURE. No I/O, no clock, no database. Given a tenant, a person, every
 * governance record naming that person and the addresses the person is known
 * at, this module returns the decision and nothing else. The procedure that
 * acts on the decision — reading the claims, writing the carried-forward
 * records, revoking the originals, deleting the person, and the two defects
 * (DEFECT-008, DEFECT-010) that make that order mandatory — lives in
 * `./personErasure`.
 *
 * The seam is the one `mayContact` already has: a pure evaluator whose verdict
 * is a function of its inputs, so it can be replayed and defended long after
 * the fact, with `contactGovernanceRepository` doing the I/O beside it. A
 * compliance decision that can only be reproduced by re-running a delete is
 * not a decision anyone can audit.
 *
 * ─── WHAT THE PLAN DECIDES ────────────────────────────────────────────────
 * One `GovernanceErasureAction` per record naming the person, each carrying a
 * disposition:
 *
 *   reanchored        the instruction continues as target-anchored records,
 *                     one per contact point the record's channel can govern;
 *   unenforceable     there is nothing to carry it onto (see below);
 *   history_retained  already revoked before the erasure, so ADR §16 leaves it
 *                     exactly as written.
 *
 * Records belonging to another tenant, or naming another person, are filtered
 * out before anything is decided — defence in depth behind a query that is
 * already tenant-scoped.
 *
 * ─── THE CASE THAT CANNOT BE SAVED, AND IS REPORTED INSTEAD ───────────────
 * A person-only suppression on a person with NO contact points has nothing to
 * re-anchor onto. After erasure there is no person and no address, so there is
 * nothing the instruction could protect and no identity resolution that could
 * recreate the person — but the platform must not pretend the instruction was
 * carried forward. Every such record is planned as `unenforceable`, which is
 * what the caller surfaces as `suppressionsLostToErasure`. It is reported, not
 * dropped silently, and the caller decides whether to proceed.
 *
 * Nothing the planner produces rewrites what a compliance record said: it
 * never changes an original record's anchor, and it never proposes deleting
 * one.
 */

import type { GovernanceChannel, GovernanceRecord, GovernanceType } from './contactGovernance';

/**
 * The `identity_claims.claim_type` values that name something a person can be
 * CONTACTED at. `domain` is an organisation, not an address; `external_profile`
 * and `external_id` name an account on a platform this table does not govern
 * and for which `normalizeGovernanceTarget` has no normaliser. Including them
 * would write values into `target_normalized` that no send path will ever
 * present, producing governance that looks enforced and is not.
 */
export const CONTACT_CLAIM_TYPES = ['email', 'phone'] as const;
export type ContactClaimType = typeof CONTACT_CLAIM_TYPES[number];

export interface PersonContactPoint {
  claimType: ContactClaimType;
  /** `identity_claims.normalized_value` — already normalised by W1's writers. */
  normalizedValue: string;
}

/**
 * Which contact points a record's channel can actually govern.
 *
 * An `email` record must not be re-anchored onto a phone number: the resulting
 * row would be unmatchable (the evaluator compares the normalised recipient for
 * the requested channel) and would misreport the instruction. `*` means every
 * channel including ones that do not exist yet, so it takes every contact point
 * we have. An unknown channel is treated as `*` — conservative, because
 * over-covering a suppression costs reach and under-covering it costs
 * compliance.
 */
export function contactClaimTypesForChannel(channel: GovernanceChannel): ContactClaimType[] {
  if (channel === 'email') return ['email'];
  if (channel === 'phone' || channel === 'whatsapp') return ['phone'];
  return [...CONTACT_CLAIM_TYPES];
}

export type ErasureDisposition =
  /** Live record: the instruction continues as one or more target-anchored records. */
  | 'reanchored'
  /** Live record with nothing to re-anchor onto. The instruction ends here. */
  | 'unenforceable'
  /**
   * Already revoked before the erasure. Untouchable — ADR §16 forbids updating
   * anything but `revoked_at`/`revoked_reason`, and those are already set. It
   * survives the delete only because `contact_governance_has_anchor` admits
   * revoked rows (20261027000000).
   */
  | 'history_retained';

export interface GovernanceErasureAction {
  recordId: string;
  channel: GovernanceChannel;
  governanceType: GovernanceType;
  effectiveFrom: string;
  effectiveUntil: string | null;
  /** True when the record already carried a target and therefore already survives on its own terms. */
  wasTargetAnchored: boolean;
  /** The normalised addresses the instruction is carried forward onto. */
  reanchorTargets: string[];
  disposition: ErasureDisposition;
  reason: string;
}

export interface PersonErasurePlan {
  organizationId: string;
  personId: string;
  contactPoints: PersonContactPoint[];
  actions: GovernanceErasureAction[];
}

export interface PlanPersonErasureInput {
  organizationId: string;
  personId: string;
  /**
   * EVERY governance record naming this person — revoked ones included. A
   * revoked person-only record is as fatal to the delete as a live one, because
   * the CHECK that DEFECT-008 trips is not predicated on `revoked_at`.
   */
  records: GovernanceRecord[];
  contactPoints: PersonContactPoint[];
}

/**
 * Decide what happens to each governance record. PURE — no I/O, no clock.
 *
 * Same discipline as `mayContact`: the decision is a function of its inputs so
 * it can be replayed and defended later, and the I/O lives in `erasePerson`.
 */
export function planPersonErasure(input: PlanPersonErasureInput): PersonErasurePlan {
  if (!input.organizationId?.trim()) {
    throw new PersonErasureError('organizationId is required — erasure is never tenant-less', 'tenant_required');
  }
  if (!input.personId?.trim()) {
    throw new PersonErasureError('personId is required', 'person_required');
  }

  const contactPoints = dedupeContactPoints(input.contactPoints ?? []);

  const actions: GovernanceErasureAction[] = (input.records ?? [])
    // Defence in depth. The query is tenant-scoped, but a record from another
    // tenant must never be revoked or re-anchored by this tenant's erasure.
    .filter((r) => r.organizationId === input.organizationId)
    .filter((r) => r.personId === input.personId)
    .map((r) => {
      const wasTargetAnchored = Boolean(r.targetNormalized && r.targetNormalized.trim());

      if (r.revokedAt !== null) {
        return action(r, wasTargetAnchored, [], 'history_retained',
          'already revoked before erasure; append-only history is not rewritten');
      }

      const allowed = new Set<string>(contactClaimTypesForChannel(r.channel));
      const targets = contactPoints
        .filter((cp) => allowed.has(cp.claimType))
        .map((cp) => cp.normalizedValue);

      // A both-anchored record whose own target is not among the person's
      // claims still names a real address the instruction was written about —
      // it is a contact point the claims table simply does not know. Carrying
      // it forward is what keeps DEFECT-010's shape enforceable after erasure.
      if (wasTargetAnchored && !targets.includes(r.targetNormalized as string)) {
        targets.push(r.targetNormalized as string);
      }

      if (targets.length === 0) {
        return action(r, wasTargetAnchored, [], 'unenforceable',
          'person-scoped instruction with no contact point to carry it onto; it cannot survive erasure');
      }

      return action(r, wasTargetAnchored, targets, 'reanchored',
        `carried forward onto ${targets.length} target(s) before the person was erased`);
    });

  return {
    organizationId: input.organizationId,
    personId: input.personId,
    contactPoints,
    actions,
  };
}

function action(
  r: GovernanceRecord,
  wasTargetAnchored: boolean,
  reanchorTargets: string[],
  disposition: ErasureDisposition,
  reason: string,
): GovernanceErasureAction {
  return {
    recordId: r.id,
    channel: r.channel,
    governanceType: r.governanceType,
    effectiveFrom: r.effectiveFrom,
    effectiveUntil: r.effectiveUntil,
    wasTargetAnchored,
    reanchorTargets,
    disposition,
    reason,
  };
}

/**
 * Same address claimed twice (different evidence) must not produce two writes.
 *
 * Exported because `erasePerson`'s claims reader applies the same rule to the
 * rows it loads: one normalisation of "what counts as a contact point", used
 * both when reading them and when planning against them.
 */
export function dedupeContactPoints(points: PersonContactPoint[]): PersonContactPoint[] {
  const seen = new Set<string>();
  const out: PersonContactPoint[] = [];
  for (const p of points) {
    const value = typeof p?.normalizedValue === 'string' ? p.normalizedValue.trim() : '';
    if (!value) continue;
    if (!(CONTACT_CLAIM_TYPES as readonly string[]).includes(p.claimType)) continue;
    const key = `${p.claimType}\u0000${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ claimType: p.claimType, normalizedValue: value });
  }
  return out;
}

export class PersonErasureError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'PersonErasureError';
  }
}
