/**
 * A7A — the production port set for enrichment execution.
 *
 * ─── THE GAP THIS CLOSES ───────────────────────────────────────────────────
 * Every port the executor needs already had a production factory:
 *
 *   authorizeCost / releaseCost   `makeTenantFundedExecutionPort`   (cost.ts)
 *   resolveCredential             `makeTenantCredentialPort`        (credentials.ts)
 *   findRecentObservation         `defaultFindRecentObservation`    (observations.ts)
 *   persistObservation            `makePersistObservation`          (persistence.ts)
 *
 * What did not exist was anything that COMPOSED them. `ExecuteEnrichmentPorts`
 * appeared in the codebase only as a TYPE: both `executePlannedField` and
 * `executeEnrichmentRecorded` took it as a parameter, and every caller was a
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

import { makeTenantFundedExecutionPort } from './providers/cost';
import { makeTenantCredentialPort } from './providers/credentials';
// Imported from the modules directly rather than through `providers/index.ts`:
// the barrel re-exports the whole provider surface, and a narrow import keeps
// this seam from depending on things it does not use.
import { defaultFindRecentObservation } from './providers/observations';
import { makePersistObservation } from './providers/persistence';
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
  const credential = makeTenantCredentialPort();

  return {
    // Tenant-funded: authorises without reserving, releases nothing.
    ...makeTenantFundedExecutionPort(),

    resolveCredential: (input) => credential.resolveCredential(input),

    // A7A — THE WIRING. The A4J implementation, unchanged: tenant-scoped,
    // provider-scoped, attribute-scoped, superseded-excluding, requiring TOTAL
    // coverage of the requested set, and failing CLOSED on a read error. No
    // second lookup was written; this is the same object the tests prove.
    findRecentObservation: defaultFindRecentObservation,

    persistObservation: makePersistObservation(),

    now: () => new Date().toISOString(),

    ...overrides,
  };
}
