/**
 * A7A — the production port set for enrichment execution.
 *
 * ─── THE CANONICAL PRODUCTION COMPOSITION ─────────────────────────────────
 * This is the ONE place the production port set is assembled. A6's boundary
 * exports `defaultExecuteEnrichmentPorts`, and since A7K that name IS this
 * function — re-exported, not reimplemented — so the two cannot drift apart.
 * The composition lives here rather than in the API handler because both the
 * handler and the service-layer executors need it, and a service must not
 * import an API handler to obtain its own dependencies.
 *
 * ─── IDENTITY IS THE CONTRACT, NOT SHAPE ──────────────────────────────────
 * Every member below is the exact production SINGLETON, referenced. This is
 * load-bearing rather than stylistic: `async () => null` satisfies
 * `findRecentObservation`'s type perfectly and disables suppression completely,
 * and thirteen such stubs exist in this repository. TypeScript can prove a port
 * is PRESENT; only identity can prove it is REAL. Calling `make*()` here would
 * produce behaviourally identical closures that fail that check — a second
 * dependency graph that looks correct in review and is invisible in a diff.
 *
 * ─── THE GAP THIS CLOSES ───────────────────────────────────────────────────
 * Every port the executor needs already had a production singleton:
 *
 *   authorizeCost / releaseCost   `tenantFundedExecutionPort`       (cost.ts)
 *   resolveCredential             `tenantCredentialPort`            (credentials.ts)
 *   findRecentObservation         `defaultFindRecentObservation`    (observations.ts)
 *   persistObservation            `defaultPersistObservation`       (persistence.ts)
 *
 * What did not exist was anything that COMPOSED them. `ExecuteEnrichmentPorts`
 * appeared in the codebase only as a TYPE: both the plan seam and the recorded
 * execution seam took it as a parameter, and every caller was a
 * test supplying its own stubs. So the duplicate-suppression lookup — built,
 * unit-proven and fail-closed since A4J — was exported and injected nowhere.
 *
 * The A6 audit named the consequence precisely: a future retry consumer that
 * forgot to inject the finder would get **no suppression and no error**, and
 * would pay a provider for evidence the tenant already holds. This module makes
 * the safe set the DEFAULT, so forgetting is no longer possible.
 *
 * ─── WHY A DEFAULT PARAMETER AND NOT A HARD-WIRED CALL ────────────────────
 * The executors keep taking `ports`, so every existing test still injects its
 * own doubles unchanged; the default only applies when a caller supplies
 * nothing. Dependency injection is preserved, and the production path stops
 * depending on a caller remembering.
 *
 * ─── CONSTRUCTION IS INERT ─────────────────────────────────────────────────
 * Nothing here performs I/O, reads a credential or contacts a provider. Each
 * factory returns closures over the real readers; the work happens only when the
 * executor calls a port. That is why building this set per call is free and why
 * importing this module has no side effect.
 *
 * ─── TENANT-FUNDED, DELIBERATELY ───────────────────────────────────────────
 * The cost port is the tenant-funded one, not the credit one: the tenant owns
 * the vendor subscription and Omnivyra charges no credits, so `authorizeCost`
 * reserves nothing and `releaseCost` has nothing to undo. Using the credit port
 * here would bill for a call Omnivyra never pays for.
 *
 * ─── NOT A SCHEDULER ───────────────────────────────────────────────────────
 * Assembling ports does not start anything. There is still no retry consumer,
 * no reclaimer and no scheduler, and nothing here reads `execution_status`,
 * `provider_call_state` or `next_retry_at`.
 */

// A7K — the SINGLETONS, not the factories. Every one of these is the exact
// instance the rest of the platform already uses; see the identity note below
// for why that distinction is the whole contract.
//
// Imported from the modules directly rather than through `providers/index.ts`:
// the barrel re-exports the whole provider surface, and a narrow import keeps
// this seam from depending on things it does not use. It is the same binding
// either way — the barrel re-exports these exports — so identity is unaffected.
import { tenantFundedExecutionPort } from './providers/cost';
import { tenantCredentialPort } from './providers/credentials';
import { defaultFindRecentObservation } from './providers/observations';
import { defaultPersistObservation } from './providers/persistence';
import type { ExecuteEnrichmentPorts } from './providers/execute';

/**
 * The real ports, assembled.
 *
 * `overrides` exists for the narrow case of a caller that must replace ONE port
 * — a diagnostic that supplies its own clock, say — without losing the safety of
 * the rest. It is not a testing seam: tests inject a full set through the
 * executor's own `ports` parameter, exactly as they always have.
 */
export function makeProductionEnrichmentPorts(
  overrides: Partial<ExecuteEnrichmentPorts> = {},
): ExecuteEnrichmentPorts {
  return {
    // Tenant-funded: authorises without reserving, releases nothing. SPREAD, so
    // `authorizeCost` and `releaseCost` remain the SAME function objects the
    // singleton holds — see the identity note above.
    ...tenantFundedExecutionPort,

    // The singleton's method, referenced. NOT `(i) => port.resolveCredential(i)`:
    // a delegating arrow is a different function object and would defeat the
    // identity check while behaving identically, which is exactly the kind of
    // difference that is invisible in review.
    resolveCredential: tenantCredentialPort.resolveCredential,

    // A7A — THE WIRING. The A4J implementation, unchanged: tenant-scoped,
    // provider-scoped, attribute-scoped, superseded-excluding, requiring TOTAL
    // coverage of the requested set, and failing CLOSED on a read error. No
    // second lookup was written; this is the same object the tests prove.
    findRecentObservation: defaultFindRecentObservation,

    persistObservation: defaultPersistObservation,

    // The one member that is legitimately fresh per call, and the one the
    // identity contract deliberately does not cover: a clock holds no state and
    // has no production instance to diverge from.
    now: () => new Date().toISOString(),

    ...overrides,
  };
}
