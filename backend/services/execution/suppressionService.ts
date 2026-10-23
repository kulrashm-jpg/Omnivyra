/**
 * LC-501 (W5.1) — C1 Suppression & Consent Platform (THE ONE suppression engine).
 *
 * Every outbound connector MUST consult `isSuppressed` before dispatch — there is no
 * other suppression logic anywhere. Fail-CLOSED for safety: a lookup error suppresses,
 * and never lets a message through on an error.
 *
 * ─── A3 / CONTRACT 13 — GOVERNANCE CONVERGENCE ────────────────────────────
 * `contact_governance_records` is now the CANONICAL store, and this module reads
 * and writes it first. `suppression_entries` — the table this service used to
 * own outright — is on its way out.
 *
 * WHY CONVERGE HERE RATHER THAN AT THE CALLERS. This module is the only reader
 * of `suppression_entries` in the codebase; `executionBridge` and
 * `pages/api/lead-intelligence/execution.ts` reach it exclusively through these
 * three functions. Migrating the implementation therefore migrates every
 * consumer without touching a single call site, which is both the smallest and
 * the safest change available.
 *
 * WHY THE LEGACY TABLE IS STILL READ AND STILL WRITTEN. Two reasons, neither
 * cosmetic:
 *   1. GLOBAL SCOPE. This service can suppress a target for EVERY tenant via the
 *      `__global__` sentinel. The canonical model has no global scope and no
 *      sentinel — ADR D-1 is explicit that governance is never tenant-less — so
 *      a global suppression is simply not expressible canonically. Dropping the
 *      legacy write would silently delete that capability.
 *   2. Retiring a table requires a proven-zero-consumer sweep, which is out of
 *      this wave's scope. Until then, a row that exists only in the legacy table
 *      must still block a send.
 * Both tables hold ZERO rows in production, so there is no data to merge — the
 * convergence is entirely about which store new writes land in, and both stores
 * are consulted on every read.
 *
 * WHAT REMAINS OWED (reported, not hidden): the `__global__` scope needs a
 * product decision before `suppression_entries` can be dropped, and
 * `outreach_suppressions` still carries task/lead/channel scopes that the
 * canonical person/target model cannot express at all.
 *
 * ─── NOT IN SCOPE ─────────────────────────────────────────────────────────
 * `consent_records` is NOT touched, read, written or referenced by this module.
 * It is an OAuth / platform-capability consent ledger — a different domain from
 * contact governance, and deliberately excluded.
 *
 * Every governance RULE lives in `prospectIdentity/contactGovernance.mayContact`,
 * which is called and never reimplemented. No second governance engine exists here.
 * PHASE 4A: the call is now made through
 * `prospectIdentity/contactGovernanceEvaluation.evaluateCanonicalGovernance`,
 * the one impure edge Path A and Path B share, so neither seam can drift on what
 * is loaded or what reaches the evaluator. The evaluator itself is unchanged and
 * still the sole owner of the rules.
 */

/**
 * ═══ PATH A UNDER THE TRANSITIONAL CONTRACT (Phase 4C-0) ════════════════════
 *
 * The system-wide contract is recorded once, in
 * `prospectIdentity/contactGovernanceEvaluation`. This note is Path A's part of
 * it and does not restate the whole.
 *
 * WHAT PATH A READS, AND ONLY PATH A. Canonical first through the shared edge,
 * then `suppression_entries` — INCLUDING the `__global__` sentinel, which no
 * other path sees. The legacy read runs only when canonical returned allowed,
 * so legacy can add a block and can never lift one.
 *
 * THE `__global__` SENTINEL, PRECISELY.
 *   - A live global row blocks EVERY tenant here, and keeps doing so. That is
 *     deliberate and unchanged.
 *   - The global WRITE is unreachable through the application: this module
 *     writes `'__global__'` only when `companyId` is falsy, its only caller is
 *     the operator route, which always passes a resolved tenant, and the
 *     `unsubscribe` helper requires a tenant and has no callers. So the scope is
 *     read-live and write-dead through supported flows.
 *   - A tenant release can never clear a global row: the legacy update filters
 *     `company_id = companyId ?? '__global__'`.
 *   - Canonical governance has no global scope and must not acquire one
 *     (ADR D-1). The platform-wide operational stop already lives elsewhere, in
 *     `execution_controls` (its own `'__global__'` singleton, its own writer,
 *     its own authorization) — a different capability from suppression.
 *
 * PERMITTED DURING THE TRANSITION: documentation, and observability that logs
 * no endpoint value.
 *
 * PROHIBITED: any new production dependency on `suppression_entries`; exposing
 * it to Path B, C or D; any write path that can reach a null `companyId`; a
 * global scope in canonical governance.
 *
 * WHAT WOULD END THE TRANSITION (none of it satisfied, none authorized): the
 * owner/legal answer on whether any requirement depends on cross-tenant
 * suppression; a consumer inventory covering what static analysis cannot see;
 * authorized production row counts verified by project REF, never by Studio
 * name; a disposition for any rows found; replacement-behaviour tests proving
 * that removing this read cannot turn a blocked contact into an allowed one,
 * including the loss of its fail-closed contribution; a rollback plan; and
 * separate schema authorization. Retiring `__global__` is NOT retiring this
 * table — it also serves tenant rows.
 *
 * NOT CLAIMED: that this store is empty, that no external consumer exists, or
 * that any legal position for or against cross-tenant suppression has been
 * established. None of those is knowable from this repository.
 *
 * KNOWN, DEFERRED, DELIBERATELY NOT FIXED HERE: the legacy `target` column is
 * matched after trim-and-lowercase only, while canonical matching normalises
 * phone numbers by stripping non-digits. For email the two agree exactly. A
 * dual-spelling lookup would change legacy matching semantics and must not ride
 * along with a structural refactor or a retirement.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { type GovernanceType } from '../prospectIdentity/contactGovernance';
import {
  evaluateCanonicalGovernance,
  type GovernanceScopeEvaluated,
} from '../prospectIdentity/contactGovernanceEvaluation';
import { loadGovernanceRecords, normalizeGovernanceTarget } from '../prospectIdentity/contactGovernanceRepository';
import { recordContactGovernance, revokeContactGovernance } from '../prospectIdentity/contactGovernanceWriter';
import { resolveRecipientOwner } from '../prospectIdentity/recipientOwner';
import {
  recordGovernanceFailClosed,
  recordGovernanceGateDecision,
  type GovernanceFailClosedStage,
} from '../prospectIdentity/telemetry';
import { logger } from '../logger';

const T = 'suppression_entries';
const GLOBAL = '__global__';
const norm = (v: string): string => String(v ?? '').trim().toLowerCase();

/**
 * The reason vocabulary, as a runtime-checkable tuple.
 *
 * DR-3. This used to be a bare type union, which TypeScript erases: the
 * operator route passed `b.reason` straight from the request body, so ANY
 * string reached `toGovernanceType`, fell through its `default:` branch and was
 * silently recorded as a do-not-contact. The canonical write happens before the
 * legacy mirror, so the result was a canonical DNC whose mirror was then
 * rejected by `suppression_reason_check` — a half-written restriction with an
 * uninterpretable cause.
 *
 * MUST stay identical to `suppression_reason_check` in 20260727030000.
 */
export const SUPPRESSION_REASONS = [
  'unsubscribe', 'consent_withdrawn', 'dsar', 'legal_hold', 'bounce', 'complaint', 'manual',
] as const;
export type SuppressionReason = typeof SUPPRESSION_REASONS[number];

export const isSuppressionReason = (v: unknown): v is SuppressionReason =>
  typeof v === 'string' && (SUPPRESSION_REASONS as readonly string[]).includes(v);

export interface SuppressionResult {
  suppressed: boolean;
  reason?: string;
  scope?: string;
  /** A3 — which store answered: the canonical table, or the legacy one. */
  store?: 'canonical' | 'legacy';
  /**
   * P4-2 / O3 — WHICH ANCHOR the canonical evaluator matched on.
   *
   * `scope` cannot answer this on its own because it is OVERLOADED between the
   * two stores: a canonical answer puts `person` or `target` there, while a
   * legacy answer puts the `suppression_entries.scope` column, whose CHECK
   * admits only `global` or `tenant`. A consumer reading `scope` therefore has
   * to read `store` as well to know which vocabulary it received. This field is
   * canonical-only and unambiguous.
   *
   * ATTACHED ONLY when a real `mayContact` verdict matched, and only with the
   * value that verdict reported. It is OMITTED — never `null`, never guessed,
   * and never derived from the legacy `scope` — for a legacy answer, an
   * allow-by-absence, a non-decision, and every fail-closed exit. Response
   * metadata only: nothing reads it to decide anything and it is not persisted.
   */
  matchedBy?: 'person' | 'target';
  /**
   * PHASE 4C-2 — which governance scopes this call actually evaluated.
   * Observability metadata only; nothing reads it to decide anything.
   *
   * OMITTED ENTIRELY when nothing was evaluated — a tenant-less question, an
   * empty target, or a read that failed before completing. That keeps every
   * existing response shape byte-identical for those cases and makes the field's
   * PRESENCE itself meaningful: it appears only when a store was really read.
   */
  scopesEvaluated?: readonly GovernanceScopeEvaluated[];
}

/**
 * Translate this service's reason vocabulary into the ADR's closed governance
 * vocabulary.
 *
 * Two of the reasons have no direct canonical counterpart, and the mapping is a
 * judgement recorded here rather than buried:
 *   dsar       — an erasure request is a standing instruction never to contact
 *   legal_hold — likewise, for a different legal reason
 * Both become a do-not-contact. `manual` is an operator acting without a stated
 * cause, which is also a do-not-contact.
 *
 * CHANNEL DECIDES WHICH DNC. The database refuses `dnc_permanent` on a specific
 * channel (`contact_governance_permanent_is_all_channels`) and refuses
 * `dnc_channel` on `*` (`contact_governance_channel_dnc_is_specific`), because
 * two spellings of one state is exactly what the canonical model exists to
 * prevent. The mapping honours that rather than fighting it.
 */
export function toGovernanceType(reason: SuppressionReason, channel: string): GovernanceType {
  switch (reason) {
    case 'unsubscribe': return 'unsubscribe';
    case 'consent_withdrawn': return 'consent_withdrawn';
    case 'complaint': return 'complaint';
    case 'bounce': return 'bounce_hard';
    case 'dsar':
    case 'legal_hold':
    case 'manual':
    default:
      return channel === '*' ? 'dnc_permanent' : 'dnc_channel';
  }
}

/**
 * A fail-closed exit that knows WHICH stage could not answer.
 *
 * `canonicalVerdict` has two distinct ways to be unable to decide — it could not
 * learn who the recipient is, or it could not read the governance table — and
 * W2-A found them conflated under one counter and one reason string. They are
 * different outages in different tables, so the stage travels with the throw.
 */
class GovernanceStageError extends Error {
  constructor(readonly stage: GovernanceFailClosedStage, readonly failReason: string) {
    super(`${stage}: ${failReason}`);
    this.name = 'GovernanceStageError';
  }
}

/**
 * W2-B / D-2 — the person behind a recipient is resolved by
 * `prospectIdentity/recipientOwner.resolveRecipientOwner` (WP3 / L1 moved it
 * there unchanged so Path A and Path B share one lookup).
 */

/**
 * Consult the CANONICAL store. Returns null when it has nothing to say.
 *
 * Fails closed by THROWING, so the caller's catch turns an unresolvable identity
 * or an unreadable governance table into a suppression. Reading either as
 * "nobody is suppressed" would contact people who asked not to be — the one
 * failure mode this layer exists to prevent.
 *
 * W2-B: a person anchor IS now resolved from the recipient (see
 * `resolveRecipientOwner`), so person-anchored and target-anchored records are
 * both visible here. Target matching is unchanged and still applies on its own.
 *
 * PHASE 4C-2 returns the canonical scopes ALONGSIDE the verdict rather than
 * inside it, because they must survive an `allowed` verdict: the caller then
 * goes on to the legacy read and appends to this list. `verdict: null` keeps its
 * existing meaning — "the canonical store had nothing to say" — and this
 * function's signature is internal, so no contract changes.
 */
interface CanonicalStep {
  verdict: SuppressionResult | null;
  scopes: readonly GovernanceScopeEvaluated[];
}

async function canonicalVerdict(companyId: string, channel: string, target: string): Promise<CanonicalStep> {
  const normalizedTarget = normalizeGovernanceTarget(channel, target);

  const person = await resolveRecipientOwner(companyId, channel, normalizedTarget);
  if (!person.ok) throw new GovernanceStageError('person_resolution', person.reason ?? 'person_unresolved');

  // PHASE 4A — the load-and-evaluate triple is shared with Path B so the two
  // seams cannot drift on what is loaded or what reaches the evaluator. The
  // IDENTITY above stays Path A's own: this seam is reached with a raw recipient,
  // which is a different question from Path B's task anchor.
  const evaluated = await evaluateCanonicalGovernance({
    organizationId: companyId,
    channel,
    personId: person.personId,
    target,
    now: new Date().toISOString(),
  });
  // `=== false`, NOT `!evaluated.ok`. This repository compiles with
  // `strict: false`, under which truthiness does not narrow a discriminated
  // union — the negated form leaves `evaluated` as the whole union and
  // `.error` unreachable. The same class of defect produced the bulk of the
  // `backend-tests` audit's failures.
  if (evaluated.ok === false) throw new GovernanceStageError('canonical_read', evaluated.error);

  const verdict = evaluated.verdict;
  const scopes = evaluated.scopesEvaluated;

  // `deferred` is temporal backpressure — "not now" — which at this boolean seam
  // is still "do not send". Collapsing it to allowed would send during exactly
  // the window the recipient asked us not to.
  if (verdict.decision === 'allowed') return { verdict: null, scopes };
  // The scope list is attached by the caller, in ONE place (`withScopes`), so
  // the omit-when-empty rule cannot be applied inconsistently across exits.
  // A canonical block SHORT-CIRCUITS: the legacy store is never read, so it is
  // never listed — which is the whole reason the list is derived from completed
  // operations rather than from a static vocabulary.
  // P4-2 / O3 — the ONLY place in this module where a canonical verdict becomes
  // a `SuppressionResult`, and therefore the only place `matchedBy` can be
  // attached. The guard admits exactly the two values the evaluator can report:
  // anything else — including `null`, which `mayContact` returns on an `allowed`
  // verdict — contributes no key at all. `scope` is left EXACTLY as it was, so
  // no existing field or value changes.
  const canonicalAnchor = verdict.matchedBy === 'person' || verdict.matchedBy === 'target'
    ? { matchedBy: verdict.matchedBy }
    : {};

  return {
    verdict: {
      suppressed: true,
      reason: verdict.governanceType ?? verdict.reason,
      scope: verdict.matchedBy === 'person' ? 'person' : 'target',
      store: 'canonical',
      ...canonicalAnchor,
    },
    scopes,
  };
}

/**
 * W06 — record a suppression that happened because governance could not be
 * ASKED, distinct from one the rules actually asserted.
 *
 * The counter is a platform aggregate with no tenant label; the log line
 * carries the tenant, and the logger attaches request_id / correlation_id /
 * org_id from the existing request context, so an operator can join a specific
 * fail-closed suppression back to the request that caused it.
 *
 * The target is NEVER logged. It is an email or a phone number — precisely the
 * personal data the suppression exists to protect. Channel and stage are enough
 * to diagnose, and neither identifies a person.
 *
 * Returns the result it was given so a caller can `return observeFailClosed(...)`
 * in one expression and cannot accidentally observe without returning, or
 * return without observing.
 */
function observeFailClosed<T extends SuppressionResult>(
  stage: GovernanceFailClosedStage,
  companyId: string,
  channel: string,
  result: T,
): T {
  try {
    recordGovernanceFailClosed(stage);
    recordGovernanceGateDecision('suppressed', result.store ?? 'none');
    logger.warn('contact_governance_failclosed', {
      companyId: companyId || null,
      channel,
      stage,
      reason: result.reason ?? null,
      store: result.store ?? null,
    });
  } catch {
    /* observation must never break the gate */
  }
  return result;
}

/**
 * PHASE 4C-2 — attach the scope list ONLY when something was actually
 * evaluated.
 *
 * Omitting an empty list is deliberate and load-bearing: every existing
 * response shape for a non-decision (empty target, no tenant) or a read that
 * failed before completing stays byte-identical, so the field's PRESENCE is
 * itself the signal that a store was really read.
 */
const withScopes = <T extends SuppressionResult>(result: T, scopes: readonly GovernanceScopeEvaluated[]): T =>
  (scopes.length === 0 ? result : { ...result, scopesEvaluated: scopes });

/** Is this target suppressed for this channel? Canonical first, then legacy. Fail-closed. */
export async function isSuppressed(companyId: string, channel: string, target: string): Promise<SuppressionResult> {
  const t = norm(target);
  // DELIBERATELY UNOBSERVED. An empty target is not a governance decision:
  // governance was never consulted, and there is no contact to govern. Counting
  // it would inflate the `allowed` series with non-events, which is the same
  // reason LI-5E counts "only genuine resolutions" — a counter that includes
  // non-events cannot be read as a rate.
  if (!t) return { suppressed: false };

  // A governance question without a tenant cannot be answered — `mayContact`
  // itself refuses one for the same reason — so it is refused rather than
  // guessed.
  if (!companyId || !String(companyId).trim()) {
    return observeFailClosed('no_tenant', companyId, channel, { suppressed: true, reason: 'suppression_no_tenant_failclosed' });
  }

  // PHASE 4C-2 — the canonical scopes, carried forward so the legacy step can
  // append to them. Declared here so they are still in scope at every exit.
  let scopes: readonly GovernanceScopeEvaluated[] = [];
  try {
    const canonical = await canonicalVerdict(companyId, channel, target);
    scopes = canonical.scopes;
    if (canonical.verdict) {
      // A REAL suppression: the rules answered. Counted separately from the
      // fail-closed exits above so a governance outage can never hide inside
      // the compliance signal.
      recordGovernanceGateDecision('suppressed', 'canonical');
      return withScopes(canonical.verdict, scopes);
    }
  } catch (e) {
    // W2-B — an unresolvable IDENTITY and an unreadable GOVERNANCE TABLE are
    // both fail-closed, and both are now reported as what they are. An operator
    // reading `governance_lookup_failed_failclosed` would go and check the
    // governance table, which in the identity case is working fine.
    const stage: GovernanceFailClosedStage = e instanceof GovernanceStageError ? e.stage : 'canonical_read';
    const reason = stage === 'person_resolution'
      ? 'governance_person_resolution_failed_failclosed'
      : 'governance_lookup_failed_failclosed';
    return observeFailClosed(stage, companyId, channel, { suppressed: true, reason, store: 'canonical' });
  }

  // LEGACY — still authoritative for anything the canonical model cannot hold,
  // notably the `__global__` scope. It can add a suppression; it can never
  // remove one the canonical store asserted, because that path already returned.
  try {
    const { data, error } = await ownedDbTable(T)
      .select('reason, scope, company_id, channel')
      .eq('target', t)
      .eq('active', true)
      .in('channel', ['*', channel])
      .in('company_id', [GLOBAL, companyId])
      .limit(1);
    // PHASE 4C-2 — the legacy read did NOT complete, so `suppression_entries`
    // is not listed. The canonical scopes still are: that read did complete, and
    // the existing `legacy_read` stage already says which store could not answer.
    if (error) return observeFailClosed('legacy_read', companyId, channel, withScopes({ suppressed: true, reason: 'suppression_lookup_error_failclosed', store: 'legacy' }, scopes)); // fail-closed
    // The read completed. One value for the whole query, which spans the tenant
    // rows and the `__global__` sentinel together.
    const legacyScopes: readonly GovernanceScopeEvaluated[] = [...scopes, 'suppression_entries'];
    const row = Array.isArray(data) && data[0] ? (data[0] as Record<string, unknown>) : null;
    if (row) {
      recordGovernanceGateDecision('suppressed', 'legacy');
      return withScopes({ suppressed: true, reason: String(row.reason), scope: String(row.scope), store: 'legacy' }, legacyScopes);
    }
    // Allowed by ABSENCE — both stores were read and neither had anything to
    // say. Counted so that "nobody is suppressed" and "we never checked" stop
    // being the same observation.
    recordGovernanceGateDecision('allowed', 'none');
    return withScopes({ suppressed: false }, legacyScopes);
  } catch {
    // As above: the legacy read threw, so it is not listed.
    return observeFailClosed('legacy_exception', companyId, channel, withScopes({ suppressed: true, reason: 'suppression_exception_failclosed', store: 'legacy' }, scopes));
  }
}

export interface AddSuppressionResult {
  /** Legacy row id, preserved so existing callers keep working unchanged. */
  id: string | null;
  /** Canonical `contact_governance_records.id`, or null for a global suppression. */
  canonicalId: string | null;
  /** W2-B / D-5 — did the legacy mirror actually accept the row? */
  legacyRecorded: boolean;
  /**
   * A stable fault code when it did not. NEVER the database message: a unique
   * violation on `uq_suppression` quotes the conflicting tuple, which contains
   * the target — an email address or a phone number. The code says what went
   * wrong without carrying the person.
   */
  legacyError: string | null;
  /**
   * FALSE when the canonical restriction is in force but the legacy mirror
   * disagrees. The restriction is still effective — the canonical store answers
   * first — but the operation did not complete, and a caller must be able to
   * tell the difference.
   */
  complete: boolean;
}

/**
 * W2-B / D-5 — a legacy fault, named without naming the person.
 *
 * PostgREST hands back the server message verbatim, and for a constraint
 * violation that message embeds the offending values. Propagating it would put
 * a recipient address into an API response and a log line, which is exactly
 * what the suppression exists to protect. The SQLSTATE is diagnostic and
 * carries nothing personal.
 */
const legacyFault = (prefix: string, error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.trim() ? `${prefix}:${code.trim()}` : prefix;
};

/**
 * W2-B / D-5 — observe a divergence between the two stores.
 *
 * Reuses the fail-closed observation pattern: a counter with no tenant label and
 * a log line the request context joins back to a tenant. The target is never
 * logged, for the same reason `observeFailClosed` never logs it.
 *
 * This is NOT a fail-closed suppression, so it deliberately does not touch the
 * fail-closed counter — a store divergence is a consistency fault, not a
 * governance outage, and merging them would make either unreadable.
 */
function observeLegacyDivergence(operation: 'write' | 'release', companyId: string | null, channel: string, fault: string): void {
  try {
    logger.warn('contact_governance_legacy_divergence', {
      companyId: companyId || null,
      channel,
      operation,
      fault,
    });
  } catch {
    /* observation must never break the gate */
  }
}

/**
 * Record a do-not-contact instruction.
 *
 * CANONICAL FIRST, AND IT MAY THROW. If the canonical write fails this function
 * propagates the error rather than reporting success, deliberately: telling a
 * caller a suppression was recorded when the authoritative store holds nothing
 * is worse than an error, because the next send would go out believing it was
 * cleared. This is a new failure mode on the DB-error path only; the success
 * path is unchanged.
 *
 * The legacy row is still written, so a reader that has not yet migrated — and
 * the `__global__` scope, which is not canonically expressible — keep working
 * until `suppression_entries` is formally retired.
 *
 * W2-B / D-5 — THE LEGACY WRITE RESULT IS NOW CHECKED. It used to be discarded:
 * `const { data } = await …upsert(…)` ignored `error`, so a rejected legacy
 * write returned `{ id: null }` and read as success. The canonical restriction
 * is NOT rolled back when the mirror fails — ADR §16 keeps the instruction, and
 * revoking a real do-not-contact to make two stores agree would contact someone
 * who asked us not to. The caller is told it is incomplete instead.
 */
export async function addSuppression(input: { companyId: string | null; channel?: string; target: string; reason: SuppressionReason; actor?: string | null; metadata?: Record<string, unknown> }): Promise<AddSuppressionResult> {
  const channel = input.channel ?? '*';

  // DR-3 — DEFENCE IN DEPTH, behind the route's own 400. An unrecognised reason
  // must never become a do-not-contact by falling through `toGovernanceType`'s
  // `default:` branch. Refusing is strictly safer than guessing: nothing is
  // written to either store, so there is no half-recorded restriction to
  // reconcile, and the caller learns the input was wrong rather than being told
  // a suppression it did not ask for is now in force.
  if (!isSuppressionReason(input.reason)) {
    throw new Error(`addSuppression: unsupported reason — expected one of ${SUPPRESSION_REASONS.join(', ')}`);
  }

  let canonicalId: string | null = null;

  // A global suppression has no tenant, and canonical governance is never
  // tenant-less (ADR D-1). It stays legacy-only, and that is the documented
  // residual blocking `suppression_entries`' retirement.
  if (input.companyId) {
    const written = await recordContactGovernance({
      organizationId: input.companyId,
      governanceType: toGovernanceType(input.reason, channel),
      channel,
      target: input.target,
      source: 'suppression_service',
      // SUMMARY ONLY — the writer rejects evidence carrying content. The
      // original reason word is kept because the canonical vocabulary is
      // coarser than this service's and the distinction (dsar vs legal_hold vs
      // manual) is worth preserving for an operator.
      evidence: { legacyReason: input.reason, actor: input.actor ?? null },
    });
    canonicalId = written.id;
  }

  // The legacy key is unchanged: `uq_suppression (company_id, channel, target)`,
  // so a repeat of the same instruction still upserts onto one row and replay
  // stays idempotent.
  let legacyId: string | null = null;
  let legacyError: string | null = null;
  try {
    const res = await ownedDbTable(T).upsert({
      company_id: input.companyId ?? GLOBAL, scope: input.companyId ? 'tenant' : 'global', channel,
      target: norm(input.target), reason: input.reason, created_by: input.actor ?? null, metadata: input.metadata ?? {}, active: true, released_at: null,
    }, { onConflict: 'company_id,channel,target' }).select('id').maybeSingle();
    if (res?.error) legacyError = legacyFault('legacy_write_failed', res.error);
    else legacyId = res?.data ? String((res.data as { id: unknown }).id) : null;
  } catch (e) {
    legacyError = legacyFault('legacy_write_exception', e);
  }

  if (legacyError) observeLegacyDivergence('write', input.companyId, channel, legacyError);

  // `legacyRecorded` keys on the ERROR, not on the returned id: a successful
  // upsert can legitimately answer with no row (`maybeSingle` on a conflict
  // resolution), and treating that as a failure would report a healthy write as
  // partial.
  return {
    id: legacyId,
    canonicalId,
    legacyRecorded: legacyError === null,
    legacyError,
    complete: legacyError === null,
  };
}

/**
 * R3-A′ — recover the legacy key from the canonical record's OWN provenance.
 *
 * ─── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * `addSuppression` hands the same raw string to both stores, and they key it
 * differently: canonical through `normalizeGovernanceTarget` (which strips
 * punctuation from a phone number), legacy through `norm` (which only trims and
 * lowercases). So one call can write `+15550100000` canonically and
 * `+1 555 010 0000` legacy-side. A release that names either spelling then
 * misses the other store, which is M3/M5.
 *
 * The canonical writer PERSISTS the original string as `target_raw`
 * (`contactGovernanceWriter`), precisely so a normalisation bug stays auditable.
 * `norm(target_raw)` therefore reconstructs the legacy key EXACTLY — the same
 * transformation `addSuppression` applied when it wrote that row. No formatting
 * variant is guessed, and no equivalence policy is invented.
 *
 * ─── WHY A LOCAL READ RATHER THAN A WIDER SHARED ONE ──────────────────────
 * `loadGovernanceRecords` is shared by the Path B dispatch gate (once per
 * evaluation), Path A and Path C, and `GovernanceRecord` lives in the pure
 * evaluator module. Adding `target_raw` there would push a column every hot
 * reader must carry — and a field the pure evaluator must never consult — into
 * two files this seam has no business changing. This read is scoped to ONE
 * tenant and to the EXACT record ids this release revoked, which is as narrow as
 * the question gets.
 *
 * Returns `ok: false` when the provenance cannot be read. The caller must then
 * refuse to claim a completed release: an unknown key is an unconfirmed one.
 */
async function legacyKeysFromProvenance(
  companyId: string,
  revokedIds: readonly string[],
): Promise<{ ok: boolean; keys: readonly string[] }> {
  if (revokedIds.length === 0) return { ok: true, keys: [] };

  let res: { data?: unknown; error?: unknown };
  try {
    res = await ownedDbTable('contact_governance_records')
      .select('id, target_raw')                 // `target_raw` per CONTACT_GOVERNANCE_COLUMNS
      .eq('organization_id', companyId)         // TENANT FIRST, always
      .in('id', [...revokedIds]);               // ONLY the records this release revoked
  } catch {
    return { ok: false, keys: [] };
  }
  if (res?.error) return { ok: false, keys: [] };

  // Deduplicated: several canonical records can share one original spelling —
  // two governance types on one endpoint, say — and that is one legacy row.
  const keys = new Set<string>();
  for (const row of (res?.data ?? []) as Array<Record<string, unknown>>) {
    const raw = typeof row.target_raw === 'string' ? row.target_raw.trim() : '';
    // A null or blank provenance is NOT a failure and NOT a guess: a
    // person-anchored record has no target and therefore no legacy twin. It
    // contributes no key.
    if (raw) keys.add(norm(raw));
  }
  return { ok: true, keys: [...keys] };
}

/**
 * R2 — what the legacy half of a release actually did, as three distinct facts
 * rather than two.
 *
 *   deactivated  the update matched and deactivated at least one row. The only
 *                outcome that may be reported as a completed legacy release.
 *   no_match     the query SUCCEEDED and matched NOTHING. Not an error, and NOT
 *                a confirmed release: the row may never have existed, may
 *                already have been inactive, or — the M3 case — may still be
 *                active under a different spelling of the same endpoint. This
 *                seam cannot tell those apart without a second, differently
 *                keyed query, which is out of scope, so it reports what it
 *                knows and claims nothing more.
 *   failed       the update errored or threw.
 */
export type LegacyReleaseOutcome = 'deactivated' | 'no_match' | 'failed';

export interface ReleaseSuppressionResult {
  /** How many canonical records were revoked. */
  canonicalRevoked: number;
  /** W2-B / D-5 — did the legacy deactivation actually land? */
  legacyDeactivated: boolean;
  /**
   * R2 — which of the three legacy outcomes occurred. `no_match` exists because
   * a zero-row update is neither a success nor a failure, and collapsing it into
   * either is what made M3 possible.
   */
  legacyOutcome: LegacyReleaseOutcome;
  /** A stable fault code when it did not. Never carries the target — see `legacyFault`. */
  legacyError: string | null;
  /**
   * FALSE when the release did not finish. The target may STILL be suppressed by
   * a legacy row that was not deactivated, so a caller must not report a
   * completed release.
   */
  complete: boolean;
}

/**
 * Release (un-suppress) a target on a channel.
 *
 * Canonical records are REVOKED, never deleted: ADR §16 keeps the original
 * instruction, its provenance and its effective period readable, which is what
 * makes the history defensible to a regulator. The legacy row is deactivated the
 * way it always was.
 *
 * Only records naming this EXACT channel are revoked. A `*` record is a
 * broader instruction than the one being released, and silently narrowing it
 * would lift a suppression the operator did not ask to lift. W2-B / D-4 keeps
 * this, and keeps it SYMMETRIC: the legacy update is channel-exact too, so a
 * `*` row survives a channel release in both stores.
 *
 * W2-B / D-5 — THE LEGACY UPDATE RESULT IS NOW CHECKED. It used to be
 * discarded, so a rejected deactivation left the target blocked by a legacy row
 * while this function — and the route above it — reported a completed release.
 * Nothing here claims atomicity across the two stores: it reports exactly which
 * halves completed.
 *
 * ─── R2: A ZERO-ROW UPDATE IS NOT A SUCCESS ────────────────────────────────
 * W2-B keyed completion on the ABSENCE OF AN ERROR, which left M3 open: a
 * phone release issued with a different spelling from the one stored matches no
 * legacy row, errors on nothing, and was reported `complete: true` while the
 * row stayed active and kept blocking.
 *
 * The update now requests a representation (`.select('id')`) so the AFFECTED-ROW
 * COUNT is observable, which is the same pattern `personErasure` uses to count
 * the rows its own update touched. Under PostgREST an update without a
 * representation answers `data: null` — the count is simply not knowable, which
 * is precisely why the old code could not tell a no-op from a success.
 *
 * WHICH ROWS MATCH IS UNCHANGED. The filters are identical; only a return
 * representation is requested. Three outcomes are now distinguished, and only
 * the first may be called complete — see `LegacyReleaseOutcome`.
 */
export async function releaseSuppression(companyId: string | null, channel: string, target: string): Promise<ReleaseSuppressionResult> {
  let canonicalRevoked = 0;

  const revokedIds: string[] = [];
  if (companyId) {
    const loaded = await loadGovernanceRecords({ organizationId: companyId, target, channel });
    if (!loaded.ok) throw new Error(loaded.error ?? 'canonical governance read failed');
    for (const record of loaded.records) {
      if (record.channel !== channel) continue;
      const { revoked } = await revokeContactGovernance({
        organizationId: companyId,
        id: record.id,
        reason: 'released_via_suppression_service',
      });
      // R3-A′ — remember WHICH records were revoked, so the legacy key can be
      // recovered from their own provenance rather than from the request's
      // formatting.
      if (revoked) { canonicalRevoked += 1; revokedIds.push(record.id); }
    }
  }

  let legacyError: string | null = null;
  let legacyDeactivatedRows = 0;

  // R3-A′ — the keys to deactivate:
  //   1. the REQUEST's own key, exactly as before. It is the only thing that can
  //      match a legacy row with no canonical counterpart, so removing it would
  //      regress the legacy-only case.
  //   2. plus `norm(target_raw)` for each canonical record this release actually
  //      revoked — the spelling `addSuppression` used when it wrote that row.
  // Deduplicated, so the common case where both agree issues ONE update.
  const provenance = companyId
    ? await legacyKeysFromProvenance(companyId, revokedIds)
    : { ok: true as const, keys: [] as readonly string[] };
  if (!provenance.ok) {
    // The relationship could not be established. Not a guess, and not a claim:
    // an unknown key is an unconfirmed release.
    legacyError = 'legacy_provenance_unreadable';
  }
  const legacyKeys = [...new Set<string>([norm(target), ...provenance.keys])];

  if (legacyError === null) {
    for (const key of legacyKeys) {
      try {
        // `.select('id')` makes the affected-row count observable (R2). Every
        // filter is unchanged: tenant (or the global sentinel), EXACT channel,
        // and `active = true`. Only the key varies, and only to a value a
        // canonical record recorded for itself.
        const res = await ownedDbTable(T).update({ active: false, released_at: new Date().toISOString() })
          .eq('target', key).eq('channel', channel).eq('active', true)
          .eq('company_id', companyId ?? GLOBAL)
          .select('id');
        if (res?.error) { legacyError = legacyFault('legacy_release_failed', res.error); break; }
        legacyDeactivatedRows += ((res?.data ?? []) as Array<unknown>).length;
      } catch (e) {
        legacyError = legacyFault('legacy_release_exception', e);
        break;
      }
    }
  }

  // R2 — three outcomes, and only a confirmed deactivation counts as complete.
  // A `no_match` is observed, not inferred from silence: the query succeeded and
  // returned no rows.
  const legacyOutcome: LegacyReleaseOutcome = legacyError !== null
    ? 'failed'
    : (legacyDeactivatedRows > 0 ? 'deactivated' : 'no_match');

  if (legacyError) observeLegacyDivergence('release', companyId, channel, legacyError);
  // A zero-row release is a DIVERGENCE SIGNAL too, not a non-event: it is the
  // shape M3 takes. Observed with the same PII-safe pattern — tenant, channel
  // and a fault code, never the target.
  if (legacyOutcome === 'no_match') observeLegacyDivergence('release', companyId, channel, 'legacy_release_no_match');

  return {
    canonicalRevoked,
    legacyDeactivated: legacyOutcome === 'deactivated',
    legacyOutcome,
    legacyError,
    complete: legacyOutcome === 'deactivated',
  };
}

/** Convenience: record an unsubscribe (the most common consumer-facing path). */
export const unsubscribe = (companyId: string, target: string, channel = '*', actor?: string) =>
  addSuppression({ companyId, channel, target, reason: 'unsubscribe', actor });
