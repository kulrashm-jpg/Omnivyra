/**
 * CANONICAL PERSISTENCE POLICY — the activation boundary for the Phase A
 * content foundation.
 *
 * WHAT THIS ANSWERS
 * -----------------
 *   "Should Omnivyra create a durable CANONICAL content artifact right now?"
 *
 * It deliberately does NOT answer:
 *   "Should this text be compared against existing content and regenerated?"
 * That is the ORIGINALITY policy (ORIGINALITY_GATE_ENABLED), which is separate,
 * independently controlled, and untouched by this module. The two are genuinely
 * orthogonal in this codebase: assertOriginality() never reads `content`, and
 * nothing here consults novelty, similarity, embeddings or memory.
 *
 * WHY IT EXISTS
 * -------------
 * The Phase A migration creates `content`, `content_variant`, `content_asset`,
 * `content_revision` and `publication_lineage`. Several live paths already call
 * the canonical writers today — `POST /api/posts/generate`,
 * `POST /api/threads/generate`, `POST /api/content`, the variant/status/lineage
 * routes. Those calls currently fail against missing tables and are swallowed by
 * existing try/catch, so the foundation is inert ONLY because the tables are
 * absent.
 *
 * That is an accident, not a boundary. The moment the DDL lands, those paths
 * would begin writing — which would make a "schema-only" migration a functional
 * release and forfeit the clean DROP rollback. This policy converts
 *
 *     FOUNDATION INERT BECAUSE TABLES ARE MISSING
 * into
 *     FOUNDATION INERT BY POLICY
 *
 * so the schema can be introduced, verified and (if needed) dropped without ever
 * changing runtime behaviour.
 *
 * DEFAULT: DENY
 * -------------
 * Unset, empty, malformed or unexpected configuration all deny. Only an explicit
 * affirmative value enables persistence. This is the inverse of
 * ORIGINALITY_GATE_ENABLED's default-ON, and deliberately so — the safe default
 * for "write durable rows" is "don't".
 *
 * SCOPE NOTE — artifact vs intelligence
 * -------------------------------------
 * This policy governs the CANONICAL ARTIFACT surface only:
 *     content · content_variant · content_asset · content_revision
 *     publication_lineage
 *
 * It does NOT govern the CONTENT INTELLIGENCE surface:
 *     content_memory · content_originality
 *
 * Those are written by indexContentUnit() / persistOriginality(), which are
 * already gated by ORIGINALITY_GATE_ENABLED at their call sites. Folding them in
 * here would couple the two policies that this phase exists to separate. See the
 * phase report for the operational consequence: making ALL EIGHT Phase A tables
 * inert requires this policy denied AND the originality flag disabled.
 *
 * The legacy `content_assets` table (PLURAL — campaign asset flow, already in
 * production) is NOT part of this surface and is intentionally not gated.
 */

/** Why canonical persistence was allowed or refused. */
export type CanonicalPersistenceReason = 'allowed' | 'policy_disabled';

export interface PersistenceDecision {
  allowed: boolean;
  reason: CanonicalPersistenceReason;
}

/**
 * Optional diagnostic context. The policy needs NO input to decide — it is a
 * pure configuration read — so this exists only so callers can label refusals in
 * logs and errors. It deliberately carries no tenant, campaign, platform,
 * originality or model information: the decision must never vary by tenant.
 */
export interface CanonicalPersistenceContext {
  /** e.g. 'createContent', 'upsertVariant' — diagnostics only. */
  operation?: string;
}

/** The single control. Repository convention: explicit affirmative = enabled. */
export const CANONICAL_PERSISTENCE_ENV = 'CANONICAL_PERSISTENCE_ENABLED';

/**
 * Matches the house boolean-env convention used by SEMANTIC_ROOT_ENABLED and
 * BOLT_RUNTIME_DELEGATION_ENABLED: an explicit affirmative token, anything else
 * (including unset, '', 'yes please', 'TRUE!', 'maybe') is false.
 *
 * NOTE: deliberately NOT `Boolean(process.env.X)`, which would treat 'false' and
 * '0' as true — the exact failure this boundary must not have.
 */
const AFFIRMATIVE = /^(1|true|on|yes)$/;

/**
 * True iff canonical persistence is explicitly enabled.
 *
 * FAIL-SAFE: any throw while reading configuration denies. A policy that fails
 * open would silently write rows the operator believed were suppressed.
 */
export function isCanonicalPersistenceEnabled(): boolean {
  try {
    return AFFIRMATIVE.test(String(process.env[CANONICAL_PERSISTENCE_ENV] ?? '').trim().toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Evaluate the policy. Deterministic, side-effect free, tenant-neutral, and
 * independent of originality — safe to call anywhere, including in tests.
 *
 * `schema_absent` is deliberately NOT a reason this policy can return: deciding
 * it would require querying the database, which this module must not do. Schema
 * presence remains the database's concern and surfaces as an ordinary write
 * error once persistence is allowed.
 */
export function evaluateCanonicalPersistence(
  _context: CanonicalPersistenceContext = {},
): PersistenceDecision {
  return isCanonicalPersistenceEnabled()
    ? { allowed: true, reason: 'allowed' }
    : { allowed: false, reason: 'policy_disabled' };
}

/**
 * Thrown when a canonical write is attempted while the policy denies.
 *
 * Carries `status` + `code` so `respondServiceError` (lib/content/
 * contentApiHelpers.ts) maps it to a clean 503 with a machine-readable code —
 * no API-layer changes required. Generation paths already wrap these writers in
 * try/catch and continue with `content_id: null`, so for them the observable
 * behaviour is IDENTICAL to today, where the same call fails on a missing table.
 */
export class CanonicalPersistenceDisabledError extends Error {
  readonly name = 'CanonicalPersistenceDisabledError';
  readonly code = 'CANONICAL_PERSISTENCE_DISABLED';
  readonly status = 503;
  readonly reason: CanonicalPersistenceReason;

  constructor(operation: string, reason: CanonicalPersistenceReason = 'policy_disabled') {
    super(
      `[canonicalPersistencePolicy] ${operation} refused: canonical content persistence is disabled ` +
        `(${CANONICAL_PERSISTENCE_ENV} is not enabled). The Phase A content foundation is intentionally ` +
        `inert; enable it deliberately once the schema is verified.`,
    );
    this.reason = reason;
  }
}

/**
 * Guard for canonical writers. Throws when denied; returns silently when
 * allowed. Kept as a helper so every writer enforces identically and a new
 * writer cannot accidentally invent its own weaker rule.
 */
export function assertCanonicalPersistenceAllowed(operation: string): void {
  const decision = evaluateCanonicalPersistence({ operation });
  if (!decision.allowed) {
    throw new CanonicalPersistenceDisabledError(operation, decision.reason);
  }
}
