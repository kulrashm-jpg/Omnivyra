/**
 * PG-001 — PURPOSE-AWARE CONTACT GOVERNANCE. Stages 1–2 only.
 *
 * ═══ STATUS ════════════════════════════════════════════════════════════════
 * TECHNICAL BASELINE RATIFIED (DR-A, DR-1…DR-12). SCHEMA DESIGNED BUT
 * UNAPPLIED. NOTHING IS NARROWED.
 *
 * Ratification is NOT legal approval, and the owner was explicit about that.
 * Two gates remain open and both are load-bearing:
 *
 *   LQ-1  how broadly an unsubscribe objection reaches. Until it is answered,
 *         DR-1 forbids narrowing ANY unsubscribe — including one that provably
 *         came from an outreach task. A task id is context, not consent.
 *   LQ-4  whether some mail (security, breach, billing) must reach a person
 *         regardless of any restriction. Until it is answered, account-path
 *         enforcement stays off and E2/E5 stay undecided (DR-12).
 *
 * THE PRACTICAL CONSEQUENCE, STATED SO NOBODY IS SURPRISED: this mechanism is
 * complete and inert. Every record evaluates exactly as it did before, because
 * no production path writes a narrow scope and every stored scope is NULL.
 * That is the intended outcome of a forward-only rollout, not an omission.
 *
 * Still unauthorized: applying the migration, backfill, shadow evaluation,
 * enforcement activation, legacy-store retirement, commit, push, deployment.
 *
 * ═══ THE PROBLEM THIS MODEL EXISTS TO SOLVE ════════════════════════════════
 * `mayContact` is purpose-UNAWARE. No governance type or column says whether a
 * restriction covers prospect outreach, account mail, or everything, and the
 * one category-shaped type (`campaign_exclusion`) is storable but never
 * evaluated. Purpose therefore lives nowhere in data — only in the identity of
 * whichever module happens to be sending. That is why the domain-verification
 * reminder (E4) had to be settled by an owner decision instead of by code, and
 * why the equivalent questions for the email-job queue (E2) and activation
 * outreach (E5) are still open.
 *
 * ═══ THE MODEL (C3 — hybrid) ═══════════════════════════════════════════════
 * Two SEPARATE dimensions, deliberately not collapsed into one:
 *
 *   RESTRICTION SCOPE   what a standing instruction covers.
 *                       "Do not contact this person for outreach."
 *   ATTEMPT PURPOSE     what a delivery is for.
 *                       "I am about to send an account email."
 *
 * A restriction APPLIES to an attempt when:
 *     its scope is `all`, OR the attempt's purpose is `all`, OR the two match.
 *
 * ─── THE TWO CONSERVATIVE DEFAULTS ────────────────────────────────────────
 * Both are approved, and both are strictest-wins:
 *
 *   an UNLABELLED restriction  → `all`   (it keeps covering everything)
 *   an UNDECLARED or UNKNOWN
 *   attempt purpose            → `all`   (it stays subject to everything)
 *
 * Those two defaults are what make adoption behaviour-preserving: with no
 * record labelled and no caller declaring, every verdict is identical to
 * today's. Purpose can therefore NARROW applicability only through an EXPLICIT
 * classification of a record — never by omission, never by accident.
 *
 * ─── WHAT PURPOSE MAY NEVER DO ────────────────────────────────────────────
 * It may never turn a fail-closed outcome into an allow. A store read error, a
 * missing tenant, a failed or ambiguous identity resolution, and an
 * unanchorable subject all still BLOCK, and purpose is not consulted on any of
 * those paths — it applies only to records already loaded and already in force.
 *
 * ─── WHAT IS DELIBERATELY UNCHANGED ───────────────────────────────────────
 * `mayContact` keeps its severity bands and their ordering, lowest-band-wins
 * precedence, `'*'` channel semantics, effective-date and revocation rules, and
 * tenant isolation. Purpose is ORTHOGONAL to all of them: when it is eventually
 * wired, it belongs as one additional filter after tenant and channel and
 * BEFORE the band sort — never folded into the bands, because a band encodes
 * severity while purpose encodes applicability, and conflating them would make
 * an outreach-scoped record look weaker than it is.
 *
 * ═══ HISTORICAL RECORDS — DECIDED (DR-A) ═══════════════════════════════════
 * FORWARD-ONLY. Existing records are neither backfilled nor reinterpreted;
 * they keep `purpose_scope IS NULL`, which means every purpose. The D1 audit
 * established why this is the only defensible answer: of the three canonical
 * writers only one records anything about WHY a restriction exists, `source`
 * names the module rather than the cause, and the legacy Path B store has no
 * type column at all. Most historical rows simply cannot be classified from
 * their own provenance.
 *
 * `unsubscribe` remains the hardest case, and DR-1 settles it conservatively:
 * the operator feedback route can prove the outreach CONTEXT of an objection
 * (it carries a task id) but not its BREADTH, so it may not narrow. Source
 * specificity is designed for and permitted by the schema; it is not yet used.
 *
 * ═══ DECISIONS THIS FILE MUST NOT DISTURB ══════════════════════════════════
 *   E4 (domain-verification reminder) stays EXEMPT under its own owner
 *      decision, and that exemption is E4 ONLY.
 *   E2 (email-job queue drain) and E5 (activation outreach) stay UNDECIDED.
 *   Path B outreach stays NON-DELIVERABLE: `lead_outreach` is absent from the
 *      Edge Function's allow-list, and this model does not change that.
 *   R1, R2 and R3-A′ stay unchanged; R3-B stays deferred.
 */

/**
 * The approved vocabulary.
 *
 *   outreach  prospect/marketing contact — Path B dispatch, readiness, and
 *             export disclosure.
 *   account   communications about the recipient's OWN account: credentials,
 *             billing, verification status, security.
 *   all       every purpose. The superset and the safe default, not a third
 *             peer value.
 */
export const CONTACT_PURPOSES = ['outreach', 'account', 'all'] as const;
export type ContactPurpose = typeof CONTACT_PURPOSES[number];

/** The approved default for an unlabelled restriction AND an undeclared attempt. */
export const DEFAULT_CONTACT_PURPOSE: ContactPurpose = 'all';

export const isContactPurpose = (v: unknown): v is ContactPurpose =>
  typeof v === 'string' && (CONTACT_PURPOSES as readonly string[]).includes(v);

/**
 * Does a restriction with this scope apply to an attempt with this purpose?
 *
 * PURE, and NOT WIRED into any evaluator. Anything unrecognised — null,
 * undefined, a stale string from an older writer, a value from a future
 * vocabulary — collapses to `all`, so an unknown value can only ever make the
 * rule STRICTER. There is no input to this function that produces a narrower
 * answer than today's behaviour.
 */
export function purposeApplies(
  restrictionScope: unknown,
  attemptPurpose: unknown,
): boolean {
  const scope: ContactPurpose = isContactPurpose(restrictionScope) ? restrictionScope : DEFAULT_CONTACT_PURPOSE;
  const attempt: ContactPurpose = isContactPurpose(attemptPurpose) ? attemptPurpose : DEFAULT_CONTACT_PURPOSE;
  return scope === 'all' || attempt === 'all' || scope === attempt;
}

/**
 * The only values `contact_governance_records.purpose_scope` may hold.
 *
 * `'all'` is deliberately ABSENT: NULL is the single spelling of "every
 * purpose" (DR-10), because two spellings of one state is exactly what the
 * canonical model exists to prevent — the argument that table already makes for
 * `dnc_permanent` and channel `'*'`.
 */
export const STORABLE_PURPOSE_SCOPES = ['outreach', 'account'] as const;
export type StorablePurposeScope = typeof STORABLE_PURPOSE_SCOPES[number];

/**
 * Which governance types may carry a narrow scope AT ALL.
 *
 * MUST stay identical to `contact_governance_purpose_scope_scopeable_type` in
 * migration 20261126000000. A test asserts the two lists match, because a
 * drift here would let code write a scope the database refuses — or, worse,
 * believe a type is scopeable when the row it reads can never be.
 *
 * The six exclusions, each with a ratified reason:
 *   bounce_hard, invalid_contact  endpoint-intrinsic; no purpose axis exists
 *   deferred                      DR-5, a temporal operational state
 *   campaign_exclusion            DR-6, inert and NARROWER than any purpose
 *   dnc_permanent                 all-purpose by its own semantics
 *   dnc_channel                   DR-2, purpose-blind; channel ⊥ purpose
 */
export const SCOPEABLE_GOVERNANCE_TYPES = ['unsubscribe', 'consent_withdrawn', 'complaint'] as const;
export type ScopeableGovernanceType = typeof SCOPEABLE_GOVERNANCE_TYPES[number];

export const isScopeableGovernanceType = (v: unknown): v is ScopeableGovernanceType =>
  typeof v === 'string' && (SCOPEABLE_GOVERNANCE_TYPES as readonly string[]).includes(v);

/**
 * Read the stored column into the evaluation vocabulary.
 *
 * NULL — and anything else unrecognised, including a value from a future
 * vocabulary — becomes `all`. There is no input that yields a NARROWER answer
 * than today's behaviour, which is what makes adoption verdict-preserving.
 */
export function restrictionScopeFromColumn(value: unknown): ContactPurpose {
  return isContactPurpose(value) ? value : DEFAULT_CONTACT_PURPOSE;
}
