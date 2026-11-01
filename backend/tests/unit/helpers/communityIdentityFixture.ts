/**
 * Fakes for the community person proof (communityIdentityProof.ts): the run's
 * subject → person, the discovered platform account, and identity_claims. Every
 * read is tenant-filtered exactly as the real port filters.
 */
import type {
  CommunityIdentityPort,
  DiscoveredUserRow,
  IdentityClaimRow,
  PersonProof,
} from '../../../services/orchestration/communityIdentityProof';
import { CONTRACT_ORG, contractContext } from './engineAdapterContractKit';

/** The person every adapter suite's step context names. */
export const PROVEN_PERSON = '77777777-7777-4777-8777-777777777777';
export const OTHER_PERSON = '12121212-1212-4121-8121-121212121212';
export const DISCOVERED_USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const PROVIDER_ID = 'ACoAAB-Provider-1';           // normalizes to lower case
export const VERIFIED_CLAIM = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const SUBJECT = contractContext().subject;

/** A proof that passes, for suites that test something other than identity. */
export const provenIdentity = async (): Promise<PersonProof> => ({
  ok: true, personId: PROVEN_PERSON, claimId: VERIFIED_CLAIM, discoveredUserId: DISCOVERED_USER,
  platform: 'linkedin', providerId: PROVIDER_ID.toLowerCase(),
});

/**
 * The evidence a verified fixture claim carries: the ONE accepted person-level
 * proof (identityVerification/verificationContract.ts). A fixture, not a writer —
 * nothing in the product produces this today.
 */
export function subjectOAuthEvidence(
  org: string = CONTRACT_ORG, personId: string = PROVEN_PERSON, providerId: string = PROVIDER_ID,
  completedAt: string = new Date(Date.now() - 60_000).toISOString(),
): Record<string, unknown> {
  return {
    method: 'subject_platform_oauth', provider: 'linkedin', provider_user_id: providerId,
    subject_person_id: personId, organization_id: org, flow_id: 'flow-fixture-1', completed_at: completedAt,
  };
}

export function identityWorld(org: string = CONTRACT_ORG) {
  const subjects = new Map<string, { org: string; personId: string | null }>([
    [`${SUBJECT.kind}:${SUBJECT.id}`, { org, personId: PROVEN_PERSON }],
  ]);
  const discovered = new Map<string, DiscoveredUserRow>([
    [DISCOVERED_USER, { id: DISCOVERED_USER, tenant_id: org, organization_id: org, platform: 'linkedin', external_user_id: PROVIDER_ID }],
  ]);
  const claims: IdentityClaimRow[] = [{
    id: VERIFIED_CLAIM, organization_id: org, person_id: PROVEN_PERSON, claim_type: 'external_id',
    platform: 'linkedin', normalized_value: PROVIDER_ID.toLowerCase(), verification_state: 'verified',
    verified_at: '2026-10-20T00:00:00.000Z', revoked_at: null, evidence: subjectOAuthEvidence(org),
  }];
  const knobs = { subjectUnreadable: false, discoveredUnreadable: false, claimsUnreadable: false };
  const reads: string[] = [];

  const port: CommunityIdentityPort = {
    async resolveRunPerson(o, subject) {
      reads.push('subject');
      if (knobs.subjectUnreadable) return { ok: false, personId: null };
      const s = subjects.get(`${subject.kind}:${subject.id}`);
      return { ok: true, personId: s && s.org === o ? s.personId : null };
    },
    async readDiscoveredUser(o, id) {
      reads.push('discovered_user');
      if (knobs.discoveredUnreadable) return undefined;
      const d = discovered.get(id);
      return d && d.organization_id === o ? { ...d } : null;
    },
    async readActiveExternalIdClaims(o, platform, value) {
      reads.push('claims');
      if (knobs.claimsUnreadable) return undefined;
      return claims
        .filter((c) => c.organization_id === o && c.claim_type === 'external_id' && c.platform === platform
          && c.normalized_value === value && c.revoked_at === null)
        .map((c) => ({ ...c }));
    },
  };

  return { port, subjects, discovered, claims, knobs, reads };
}
