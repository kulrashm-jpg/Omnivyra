/**
 * Backend ports for the canonical Lead Intelligence pipeline.
 *
 * Identity resolution REUSES the existing `identityResolutionService` (unified
 * persons) — it is never re-implemented here. The durable sink is intentionally a
 * caller-supplied port (see leadIntelligenceFacade); an in-memory sink is provided
 * as a real reference implementation for tests and buffering.
 *
 * ─── NO PERSON FROM A BARE SOCIAL HANDLE (owner decision, 2026-10-30) ─────
 * The adoption identity port decides per lead, with the shared rule in
 * `prospectProvenance/bridge/verifiedIdentity.ts`:
 *
 *   contact evidence (email / phone)        → resolveUnifiedPerson (W1) exactly as
 *                                             before — may match or create.
 *   social identifier only (`<platform>:user`
 *   and/or `contact_id`, no email / phone)  → READ-ONLY verification: link to the
 *                                             ONE person a linked, active
 *                                             identity_claims row names; otherwise
 *                                             NO person (`unifiedPersonId: null`).
 *                                             Never writes unified_persons or
 *                                             identity_claims.
 *   anything else (e.g. anonymous_id only)  → resolveUnifiedPerson, unchanged
 *                                             (not a social handle; outside the
 *                                             decision).
 *
 * An unverified author's platform / handle / contact id stay on the canonical
 * lead's identity hints (and therefore in `lead_intelligence`), as evidence.
 */

import type { IdentityResolverPort, LeadIntelligenceSink, CanonicalLead } from '../../../lib/leadIntelligence';
import { resolveUnifiedPerson } from '../identityResolutionService';
import {
  hasContactEvidence,
  hasSocialIdentifier,
  resolveVerifiedSocialPerson,
  socialHandlePairs,
  type SocialIdentityVerdict,
} from '../prospectProvenance/bridge/verifiedIdentity';

/** `matchedBy` for a social author linked through a verified claim. */
export const VERIFIED_SOCIAL_MATCH = 'verified_identity_claim';

export interface UnifiedPersonIdentityPortDeps {
  resolvePerson: typeof resolveUnifiedPerson;
  verifySocial: (organizationId: string, handles: Array<{ platform: string; platformUserId: string }>) => Promise<SocialIdentityVerdict>;
}

const DEFAULT_DEPS: UnifiedPersonIdentityPortDeps = {
  resolvePerson: (input) => resolveUnifiedPerson(input),
  verifySocial: (organizationId, handles) => resolveVerifiedSocialPerson(organizationId, handles),
};

/** Identity port backed by the existing unified-person resolver (reuse, not duplicate). */
export function createUnifiedPersonIdentityPort(deps: UnifiedPersonIdentityPortDeps = DEFAULT_DEPS): IdentityResolverPort {
  return {
    async resolve({ organizationId, email, phone, externalKeys }) {
      if (!hasContactEvidence(email, phone) && hasSocialIdentifier(externalKeys)) {
        // Social author with no contact fact: verify, never create.
        const verdict = await deps.verifySocial(organizationId, socialHandlePairs(externalKeys));
        return verdict.status === 'verified' && verdict.personId
          ? { unifiedPersonId: verdict.personId, matchedBy: VERIFIED_SOCIAL_MATCH }
          : { unifiedPersonId: null };
      }
      const result = await deps.resolvePerson({
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
