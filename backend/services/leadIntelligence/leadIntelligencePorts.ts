/**
 * Backend ports for the canonical Lead Intelligence pipeline.
 *
 * Identity resolution REUSES the existing `identityResolutionService` (unified
 * persons) — it is never re-implemented here. The durable sink is intentionally a
 * caller-supplied port (see leadIntelligenceFacade); an in-memory sink is provided
 * as a real reference implementation for tests and buffering.
 */

import type { IdentityResolverPort, LeadIntelligenceSink, CanonicalLead } from '../../../lib/leadIntelligence';
import { resolveUnifiedPerson } from '../identityResolutionService';

/** Identity port backed by the existing unified-person resolver (reuse, not duplicate). */
export function createUnifiedPersonIdentityPort(): IdentityResolverPort {
  return {
    async resolve({ organizationId, email, phone, externalKeys }) {
      const result = await resolveUnifiedPerson({
        companyId: organizationId,
        email: email ?? null,
        phone: phone ?? null,
        externalKeys: externalKeys ?? null,
      });
      return { unifiedPersonId: result.unifiedPersonId, matchedBy: result.matchedBy };
    },
  };
}

/** Real in-memory sink (tests / buffering). Durable persistence is a deferred port. */
export function createInMemorySink(): { sink: LeadIntelligenceSink; emitted: CanonicalLead[] } {
  const emitted: CanonicalLead[] = [];
  return { sink: { async emit(lead) { emitted.push(lead); } }, emitted };
}
