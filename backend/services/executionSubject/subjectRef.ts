/**
 * PI-EXECUTION-SUBJECT-IMPL-024 — the explicit execution subject.
 *
 * Substrate C (selected in 022) makes the planner subject-neutral: a website
 * lead and a canonical PI prospect are both first-class subjects of ONE planner.
 * This module is the whole of that identity, and every semantic consumer of the
 * old implicit `leadId === leads.id` assumption now takes a `SubjectRef`.
 *
 * ─── WHY A KIND AND NOT A BARE ID ─────────────────────────────────────────
 * Before 024 the execution layer carried a single opaque string. Two modules
 * INTERPRETED it — the snapshot loader and the person anchor — and both read
 * `leads` by `id`. A canonical prospect id reaching either of them matched
 * nothing and was reported as "not a failure": the snapshot came back null and
 * the person came back null, silently. The id spaces are disjoint, so nothing
 * detected the mistake.
 *
 * The kind makes the subject's meaning explicit rather than assumed. It is a
 * DISCRIMINATOR, not a disambiguator: it exists so a consumer cannot guess.
 *
 * ─── EXACTLY TWO KINDS ────────────────────────────────────────────────────
 *   lead     → `leads.id`            — the website/form/visitor conversion
 *   prospect → `canonical_leads.id`  — the canonical PI prospect
 *
 * 023 established these are the only two the repository supports, and adding a
 * third is a contract change, not a configuration one.
 *
 * ─── SUBJECT ≠ PERSON, AND THE PERSON IS NEVER PART OF IDENTITY ───────────
 * `unified_persons.id` is nullable on both subject kinds, is not unique in
 * reverse (nothing constrains `(company_id, unified_person_id)`), and is
 * resolved AFTER the subject is known. Those three properties disqualify it as
 * an identity component. The person is resolved FROM a subject — see
 * `resolveSubjectPersonId` — and governance, quota and suppression then operate
 * on the person. One subject resolves to at most one person; one person may own
 * several subjects, and in production 18 of 19 people own two.
 *
 * ─── TENANT TRAVELS ALONGSIDE, NEVER INSIDE ───────────────────────────────
 * `companyId` is not part of `SubjectRef`. It is passed with it, because the
 * tenant is a property of the REQUEST, not of the subject's identity, and every
 * scoped query must place it first. `SubjectScopedRef` is the pair.
 *
 * ─── UNKNOWN KINDS FAIL CLOSED ────────────────────────────────────────────
 * `parseSubjectRef` refuses anything outside the two kinds rather than falling
 * back to `lead`. A silent fallback is exactly the defect 024 exists to remove:
 * it would reinterpret a prospect as a website lead and lose the person.
 */

export const SUBJECT_KINDS = ['lead', 'prospect'] as const;
export type SubjectKind = typeof SUBJECT_KINDS[number];

/** The identity of a thing outreach can be planned for. Carries no tenant. */
export interface SubjectRef {
  readonly kind: SubjectKind;
  readonly id: string;
}

/** A subject together with the tenant the request is scoped to. */
export interface SubjectScopedRef extends SubjectRef {
  readonly companyId: string;
}

export class SubjectError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'SubjectError';
  }
}

/** A declaration, not an arrow: only a declaration's `never` narrows control flow. */
function fail(message: string, code: string): never {
  throw new SubjectError(message, code);
}

export function isSubjectKind(v: unknown): v is SubjectKind {
  return typeof v === 'string' && (SUBJECT_KINDS as readonly string[]).includes(v);
}

/**
 * The table a kind's id refers to. Exported so a consumer states its assumption
 * rather than hard-coding a table name next to an opaque id — the shape that
 * made the old defect invisible.
 */
export const SUBJECT_SOURCE_TABLE: Record<SubjectKind, string> = {
  lead: 'leads',
  prospect: 'canonical_leads',
};

/**
 * Build a validated subject. Refuses an unknown kind and a non-uuid id.
 *
 * FAIL CLOSED: there is deliberately no default kind. A caller that does not
 * know what it is holding must not be allowed to assert that it holds a lead.
 */
export function parseSubjectRef(kind: unknown, id: unknown): SubjectRef {
  if (!isSubjectKind(kind)) {
    fail(
      `unknown execution subject kind ${JSON.stringify(kind)} — expected one of ${SUBJECT_KINDS.join(', ')}`,
      'unknown_subject_kind',
    );
  }
  // NON-EMPTY, not uuid-shaped. The id's FORMAT is the referenced table's
  // concern, and `outreach_tasks.lead_id` / `lead_intelligence_profiles.lead_id`
  // have always been text. 024 adds the KIND and deliberately adds no new
  // constraint on the id itself — tightening that is a separate change with its
  // own compatibility surface.
  const subjectId = typeof id === 'string' ? id.trim() : '';
  if (!subjectId) fail('an execution subject requires an id', 'invalid_subject_id');
  return { kind, id: subjectId };
}

/** The same, with the tenant. `companyId` is required: it is the first predicate of every read. */
export function parseSubjectScopedRef(companyId: unknown, kind: unknown, id: unknown): SubjectScopedRef {
  const tenant = typeof companyId === 'string' ? companyId.trim() : '';
  if (!tenant) {
    fail('companyId is required — an execution subject is never tenant-less', 'tenant_required');
  }
  const subject = parseSubjectRef(kind, id);
  return { companyId: tenant, kind: subject.kind, id: subject.id };
}

/**
 * The website lead subject, stated explicitly.
 *
 * Every pre-024 caller held a `leads.id` and said `leadId`. Those call sites now
 * say `leadSubject(id)`, which is the same value with its meaning written down.
 */
export const leadSubject = (id: string): SubjectRef => parseSubjectRef('lead', id);

/** The canonical PI prospect subject (`canonical_leads.id`). */
export const prospectSubject = (id: string): SubjectRef => parseSubjectRef('prospect', id);

/**
 * A stable display/log form. NOT an identity: nothing keys on this string, and
 * no database column stores it. Kind and id are always stored as two columns so
 * a tenant-safe composite key stays possible.
 */
export const describeSubject = (s: SubjectRef): string => `${s.kind}:${s.id}`;

/**
 * Exhaustiveness helper. A `switch` over `SubjectKind` ends with
 * `return assertNeverSubject(kind)`, so adding a third kind becomes a COMPILE
 * error at every consumer rather than a silent default branch.
 */
export function assertNeverSubject(kind: never): never {
  fail(`unhandled execution subject kind ${JSON.stringify(kind)}`, 'unhandled_subject_kind');
}
