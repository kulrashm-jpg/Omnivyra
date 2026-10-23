/**
 * PI FOUNDATION — matrix item S: can a provider silently overwrite a human
 * correction?
 *
 * The ratified answer is that "human wins" is an authority DECLARATION (data),
 * never a branch in production code — so this file tests the mechanism with
 * data and changes nothing. Two separate facts come out of it, and the second
 * is the one that matters operationally:
 *
 *   1. WITH a declaration naming `human` for an attribute, b1b.1 lets the human
 *      value win even when a provider observed something later. The mechanism
 *      works.
 *   2. A tenant CAN now make that declaration. b1b.2 attached storage to the
 *      resolver seam (migration 20261123000000), so the gap this file used to
 *      record as a dependency is closed. What remains true, and is still
 *      pinned below, is that nothing declares it on a tenant's behalf: a tenant
 *      with no declaration keeps exactly the old recency behaviour.
 *
 * Both are pinned here deliberately, because the second is the easy thing to
 * get wrong. "Human corrections are protected" must mean "protected where the
 * tenant said so", never "humans always win" — the latter would be the origin
 * magic D-3 was ratified to avoid.
 *
 * Nothing here is relationship-specific yet, because relationship-scoped
 * arbitration is itself deferred: this gate only makes the relationship
 * SUBJECT expressible. What it establishes is that human provenance has
 * somewhere to live and a defined way to be honoured.
 */
// Storage is stubbed: this file is about PRECEDENCE, and the store has its own
// suite. `rows` is what the tenant has declared; `lastTenant` proves the
// resolver asks for the tenant it was given rather than any tenant.
const declarations = {
  rows: [] as Array<{
    organizationId: string; entityType: string; attribute: string;
    providers: readonly string[]; declaredByUserId: string | null; updatedAt: string | null;
  }>,
  lastTenant: null as string | null,
};
jest.mock('../../services/prospectIdentity/attributeAuthorityStore', () => ({
  AUTHORITY_ENTITY_TYPES: ['person', 'account', 'relationship'],
  isAuthorityEntityType: (v: unknown) =>
    typeof v === 'string' && ['person', 'account', 'relationship'].includes(v),
  loadAuthorityDeclarations: async (organizationId: string, entityType: string) => {
    declarations.lastTenant = organizationId;
    return declarations.rows.filter(
      (r) => r.organizationId === organizationId && r.entityType === entityType);
  },
}));

import {
  decideCanonicalUpdates, type ArbitrationCandidate,
} from '../../services/prospectIdentity/ingestionBoundary';
import {
  buildAttributeAuthority, resolveAttributeAuthority, authoritativeProvidersFor,
} from '../../services/prospectIdentity/attributeAuthority';
import { PERSON_ATTRIBUTE_COLUMNS } from '../../services/prospectIdentity/attributes';

const P = PERSON_ATTRIBUTE_COLUMNS;
const ORG_A = '00000000-0000-4000-8000-00000000000a';

const HUMAN_AT = '2026-01-01T00:00:00.000Z';
const PROVIDER_AT = '2026-06-01T00:00:00.000Z';   // deliberately LATER

const candidate = (
  id: string, value: string, provider: string, observedAt: string,
): ArbitrationCandidate => ({
  id, attribute: 'job_title', normalized_value: value,
  provider, observed_at: observedAt, recorded_at: observedAt, confidence: null,
});

const HUMAN = candidate('h1', 'Chief Revenue Officer', 'human', HUMAN_AT);
const PROVIDER = candidate('p1', 'VP Sales', 'apollo', PROVIDER_AT);

// ════════════════════════════════════════════════════════════════════════════
describe('S — with a human authority declaration, the human value holds', () => {
  it('a LATER provider observation does not displace an earlier human one', () => {
    const { authority, rejected } = buildAttributeAuthority('person', { job_title: ['human'] }, P);
    expect(rejected).toEqual([]);

    const d = decideCanonicalUpdates({ job_title: null }, [PROVIDER, HUMAN], P, authority);
    expect(d.apply).toEqual([{
      attribute: 'job_title', value: 'Chief Revenue Officer',
      // b1b names its own reason: the human value won because the tenant
      // DECLARED that source authoritative, not because it was newest.
      assertionId: 'h1', reason: 'authoritative_source',
    }]);
  });

  it('the declaration does not silence the disagreement, it resolves it', () => {
    const { authority } = buildAttributeAuthority('person', { job_title: ['human'] }, P);
    const d = decideCanonicalUpdates({ job_title: null }, [PROVIDER, HUMAN], P, authority);
    // `contested` is how an operator can still see that a provider disagrees.
    // Authority narrowing the field must not hide that.
    expect(d.contested).toContain('job_title');
  });

  it('it also protects an already-canonical human value from a newer provider', () => {
    const { authority } = buildAttributeAuthority('person', { job_title: ['human'] }, P);
    const d = decideCanonicalUpdates(
      { job_title: 'Chief Revenue Officer' }, [PROVIDER, HUMAN], P, authority);
    expect(d.apply.filter((a) => a.value === 'VP Sales')).toEqual([]);
  });

  it('the declaration is per ATTRIBUTE — it does not make human authoritative everywhere', () => {
    const { authority } = buildAttributeAuthority('person', { job_title: ['human'] }, P);
    expect(authoritativeProvidersFor(authority, 'job_title')).toEqual(['human']);
    expect(authoritativeProvidersFor(authority, 'department')).toEqual([]);

    const dept = candidate('d1', 'Revenue', 'apollo', PROVIDER_AT);
    const d = decideCanonicalUpdates({ department: null }, [
      { ...dept, attribute: 'department' },
    ], P, authority);
    // Undeclared attributes keep plain D-1 recency, unchanged.
    expect(d.apply[0]).toMatchObject({ attribute: 'department', value: 'Revenue' });
  });
});

describe('S — no declaration means the OLD behaviour, not a new default', () => {
  it('a tenant that declared nothing resolves to an empty declaration', async () => {
    declarations.rows = [];
    const authority = await resolveAttributeAuthority(ORG_A, 'person');
    expect(authority.byAttribute).toEqual({});
    expect(authoritativeProvidersFor(authority, 'job_title')).toEqual([]);
  });

  it('and then a newer PROVIDER value still wins over a human correction', async () => {
    declarations.rows = [];
    const authority = await resolveAttributeAuthority(ORG_A, 'person');
    const d = decideCanonicalUpdates({ job_title: null }, [PROVIDER, HUMAN], P, authority);
    // Deliberate, and the point of the whole design: without a declaration
    // b1b.2 behaves exactly like b1b.1. Human precedence is something a tenant
    // ASKS FOR; it is never conferred by the word 'human'.
    expect(d.apply[0]).toMatchObject({ value: 'VP Sales', assertionId: 'p1' });
    expect(d.contested).toContain('job_title');
  });

  it('a DECLARED tenant gets the human value through the same resolver', async () => {
    declarations.rows = [{
      organizationId: ORG_A, entityType: 'person', attribute: 'job_title',
      providers: ['human'], declaredByUserId: 'user-a', updatedAt: null,
    }];
    const authority = await resolveAttributeAuthority(ORG_A, 'person');
    const d = decideCanonicalUpdates({ job_title: null }, [PROVIDER, HUMAN], P, authority);
    expect(d.apply[0]).toMatchObject({
      value: 'Chief Revenue Officer', assertionId: 'h1', reason: 'authoritative_source',
    });
    declarations.rows = [];
  });

  it('a declaration cannot reach another tenant', async () => {
    // The stub records which tenant was asked for; the resolver must pass the
    // tenant it was given, because that is the first leg of the storage key.
    declarations.rows = [];
    await resolveAttributeAuthority(ORG_A, 'person');
    expect(declarations.lastTenant).toBe(ORG_A);
    await expect(resolveAttributeAuthority('', 'person')).rejects.toThrow(/organizationId is required/);
  });

  it('origin is recorded on the assertion either way, so the correction is never LOST', () => {
    // The evidence survives even while arbitration does not yet prefer it:
    // `source_assertions.origin` + `asserted_by_user_id` (migration
    // 20261122000000) keep the human claim attributable and re-decidable the
    // moment a declaration exists. Losing an arbitration is recoverable;
    // losing the evidence would not be.
    const { authority } = buildAttributeAuthority('person', { job_title: ['human'] }, P);
    const withDeclaration = decideCanonicalUpdates({ job_title: 'VP Sales' }, [PROVIDER, HUMAN], P, authority);
    expect(withDeclaration.apply[0]).toMatchObject({ value: 'Chief Revenue Officer' });
  });
});
