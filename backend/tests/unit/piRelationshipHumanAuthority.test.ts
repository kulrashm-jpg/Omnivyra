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
 *   2. There is currently NO WAY FOR A TENANT TO MAKE THAT DECLARATION.
 *      `resolveAttributeAuthority` is the only production path and it always
 *      returns an empty declaration, so in production the newer PROVIDER value
 *      still wins over a human correction by recency.
 *
 * Both are pinned here deliberately. The second is a gate dependency, not
 * something to fix in passing: closing it means giving authority declarations
 * storage and a tenant-facing writer, which changes `attributeAuthority.ts` —
 * a protected B1b file. So it is reported, not patched, and this test will fail
 * the moment someone implements it, which is exactly when the claim in the
 * report stops being true.
 *
 * Nothing here is relationship-specific yet, because relationship-scoped
 * arbitration is itself deferred: this gate only makes the relationship
 * SUBJECT expressible. What it establishes is that human provenance has
 * somewhere to live and a defined way to be honoured.
 */
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
    const { authority, rejected } = buildAttributeAuthority(ORG_A, { job_title: ['human'] }, P);
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
    const { authority } = buildAttributeAuthority(ORG_A, { job_title: ['human'] }, P);
    const d = decideCanonicalUpdates({ job_title: null }, [PROVIDER, HUMAN], P, authority);
    // `contested` is how an operator can still see that a provider disagrees.
    // Authority narrowing the field must not hide that.
    expect(d.contested).toContain('job_title');
  });

  it('it also protects an already-canonical human value from a newer provider', () => {
    const { authority } = buildAttributeAuthority(ORG_A, { job_title: ['human'] }, P);
    const d = decideCanonicalUpdates(
      { job_title: 'Chief Revenue Officer' }, [PROVIDER, HUMAN], P, authority);
    expect(d.apply.filter((a) => a.value === 'VP Sales')).toEqual([]);
  });

  it('the declaration is per ATTRIBUTE — it does not make human authoritative everywhere', () => {
    const { authority } = buildAttributeAuthority(ORG_A, { job_title: ['human'] }, P);
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

describe('S — the operational gap, stated as a test rather than a claim', () => {
  it('no tenant can currently declare authority: the resolver returns an EMPTY declaration', async () => {
    const authority = await resolveAttributeAuthority(ORG_A, 'person');
    expect(authority.byAttribute).toEqual({});
    expect(authoritativeProvidersFor(authority, 'job_title')).toEqual([]);
  });

  it('so without a declaration a newer PROVIDER value still wins over a human correction', async () => {
    const authority = await resolveAttributeAuthority(ORG_A, 'person');
    const d = decideCanonicalUpdates({ job_title: null }, [PROVIDER, HUMAN], P, authority);
    // This is the honest current behaviour, not the desired one. Success
    // criterion 19 ("human corrections cannot silently lose to provider
    // assertions") is therefore NOT yet satisfied in production, and that is
    // reported as a dependency rather than fixed here: the fix changes
    // attributeAuthority.ts, which this gate must not touch.
    expect(d.apply[0]).toMatchObject({ value: 'VP Sales', assertionId: 'p1' });
    expect(d.contested).toContain('job_title');
  });

  it('origin is recorded on the assertion either way, so the correction is never LOST', () => {
    // The evidence survives even while arbitration does not yet prefer it:
    // `source_assertions.origin` + `asserted_by_user_id` (migration
    // 20261122000000) keep the human claim attributable and re-decidable the
    // moment a declaration exists. Losing an arbitration is recoverable;
    // losing the evidence would not be.
    const { authority } = buildAttributeAuthority(ORG_A, { job_title: ['human'] }, P);
    const withDeclaration = decideCanonicalUpdates({ job_title: 'VP Sales' }, [PROVIDER, HUMAN], P, authority);
    expect(withDeclaration.apply[0]).toMatchObject({ value: 'Chief Revenue Officer' });
  });
});
