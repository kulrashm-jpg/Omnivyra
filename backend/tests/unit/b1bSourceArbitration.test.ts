/**
 * B1b — source arbitration, exactly as ratified in D22-B1a.
 *
 * Every test here names the decision it pins (D-1..D-5, O-1..O-7) so that a future
 * change to this behaviour has to argue with a ratified decision rather than with
 * a test someone wrote.
 *
 * The seven cases from the B1a brief are covered explicitly and labelled, because
 * they were the part the owner was asked to rule on and the part most likely to be
 * "simplified" later by someone who has not read the reasoning.
 */
// b1b.2 attached storage to the authority seam. These tests are about the
// ARBITRATION RULES, not about storage, so the store is stubbed to "this tenant
// has declared nothing" -- which is what every tenant looked like under b1b.1
// and is still the default. Declaration behaviour is covered separately.
const declarations = { rows: [] as Array<{
  organizationId: string; entityType: string; attribute: string;
  providers: readonly string[]; declaredByUserId: string | null; updatedAt: string | null;
}> };
jest.mock('../../services/prospectIdentity/attributeAuthorityStore', () => ({
  AUTHORITY_ENTITY_TYPES: ['person', 'account', 'relationship'],
  isAuthorityEntityType: (v: unknown) =>
    typeof v === 'string' && ['person', 'account', 'relationship'].includes(v),
  loadAuthorityDeclarations: async () => declarations.rows,
}));

import {
  decideCanonicalUpdates, type ArbitrationCandidate,
} from '../../services/prospectIdentity/ingestionBoundary';
import {
  buildAttributeAuthority, noAttributeAuthority, authoritativeProvidersFor,
  normalizeProviderKey, resolveAttributeAuthority, ATTRIBUTE_AUTHORITY_VERSION,
} from '../../services/prospectIdentity/attributeAuthority';
import {
  PERSON_ATTRIBUTE_COLUMNS, ACCOUNT_ATTRIBUTE_COLUMNS,
} from '../../services/prospectIdentity/attributes';

const P = PERSON_ATTRIBUTE_COLUMNS;

/** A candidate. Timestamps are ISO; `null` means the column was not selected. */
const c = (
  id: string, value: string | null,
  over: Partial<ArbitrationCandidate> = {},
  attribute = 'job_title',
): ArbitrationCandidate => ({
  id, attribute, normalized_value: value,
  provider: 'alpha', observed_at: null, recorded_at: null, confidence: null, ...over,
});

const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-02-01T00:00:00.000Z';
const T3 = '2026-03-01T00:00:00.000Z';

// ════════════════════════════════════════════════════════════════════════════
describe('D-1 — the arbitration timestamp is COALESCE(observed_at, recorded_at)', () => {
  it('prefers observed_at, the provider\'s own account of when it saw the value', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'VP', { observed_at: T1, recorded_at: T3 }),
      c('a2', 'CRO', { observed_at: T2, recorded_at: T1 }),
    ], P);
    // a1 was RECORDED later, but a2 was OBSERVED later. Observation wins.
    expect(d.apply).toEqual([
      { attribute: 'job_title', value: 'CRO', assertionId: 'a2', reason: 'newest_observation' },
    ]);
  });

  it('falls back to recorded_at when a provider supplied no observation time', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'VP', { observed_at: null, recorded_at: T1 }),
      c('a2', 'CRO', { observed_at: null, recorded_at: T2 }),
    ], P);
    expect(d.apply[0]).toMatchObject({ value: 'CRO', reason: 'newest_observation' });
  });

  it('mixes the two coherently: an observed time competes with a recorded one', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'VP', { observed_at: T3, recorded_at: T1 }),
      c('a2', 'CRO', { observed_at: null, recorded_at: T2 }),
    ], P);
    expect(d.apply[0]).toMatchObject({ value: 'VP', assertionId: 'a1' });
  });

  it('refuses to order candidates it cannot time, rather than guessing', () => {
    // Reachable only from a caller that selected neither column: recorded_at is
    // NOT NULL in the schema. Fail closed, never pick.
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'VP', { observed_at: null, recorded_at: null }),
      c('a2', 'CRO', { observed_at: T2 }),
    ], P);
    expect(d.apply).toEqual([]);
    expect(d.withhold).toEqual([{ attribute: 'job_title', reason: 'sources_disagree' }]);
  });

  it('treats an unparseable timestamp as no timestamp, not as epoch zero', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'VP', { observed_at: 'not-a-date' }),
      c('a2', 'CRO', { observed_at: T2 }),
    ], P);
    expect(d.apply).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('D-2 — confidence is a tie-break ONLY', () => {
  it('does not consult confidence when recency already decided', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'VP', { observed_at: T2, confidence: 0.01 }),
      c('a2', 'CRO', { observed_at: T1, confidence: 0.99 }),
    ], P);
    expect(d.apply[0]).toMatchObject({ value: 'VP', reason: 'newest_observation' });
  });

  it('breaks a timestamp tie by the highest stated confidence', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'VP', { observed_at: T2, confidence: 0.4 }),
      c('a2', 'CRO', { observed_at: T2, confidence: 0.8 }),
    ], P);
    expect(d.apply).toEqual([
      { attribute: 'job_title', value: 'CRO', assertionId: 'a2', reason: 'newest_then_highest_confidence' },
    ]);
  });

  it('refuses the tie-break when ANY tied candidate states no confidence', () => {
    // A missing confidence is never treated as low: that would reward a provider
    // for inventing a number over one honest enough not to.
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'VP', { observed_at: T2, confidence: 0.8 }),
      c('a2', 'CRO', { observed_at: T2, confidence: null }),
    ], P);
    expect(d.apply).toEqual([]);
    expect(d.withhold).toEqual([{ attribute: 'job_title', reason: 'sources_disagree' }]);
  });

  it('ignores a confidence outside the range the database CHECK allows', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'VP', { observed_at: T2, confidence: 1.5 }),
      c('a2', 'CRO', { observed_at: T2, confidence: 0.8 }),
    ], P);
    expect(d.apply).toEqual([]);   // a1's confidence is not stated, so no tie-break
  });

  it('withholds when confidence ties too', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'VP', { observed_at: T2, confidence: 0.5 }),
      c('a2', 'CRO', { observed_at: T2, confidence: 0.5 }),
    ], P);
    expect(d.withhold).toEqual([{ attribute: 'job_title', reason: 'sources_disagree' }]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('B1a brief section 5 — all seven cases, by number', () => {
  const two = (a: Partial<ArbitrationCandidate>, b: Partial<ArbitrationCandidate>) =>
    decideCanonicalUpdates({ job_title: null }, [c('a1', 'A-value', a), c('a2', 'B-value', b)], P);

  it('case 1 — A newer AND more confident: A wins on recency alone', () => {
    const d = two({ observed_at: T2, confidence: 0.9 }, { observed_at: T1, confidence: 0.2 });
    expect(d.apply[0]).toMatchObject({ value: 'A-value', reason: 'newest_observation' });
  });

  it('case 2 — A newer but LESS confident: A still wins. Recency is primary', () => {
    const d = two({ observed_at: T2, confidence: 0.2 }, { observed_at: T1, confidence: 0.9 });
    expect(d.apply[0]).toMatchObject({ value: 'A-value', reason: 'newest_observation' });
  });

  it('case 3 — A older but SUBSTANTIALLY more confident: the newer still wins', () => {
    // "Substantially" is not expressible. Confidence is record-level and not
    // comparable between providers (O-2), so no magnitude threshold exists.
    const d = two({ observed_at: T1, confidence: 1.0 }, { observed_at: T3, confidence: 0.01 });
    expect(d.apply[0]).toMatchObject({ value: 'B-value', reason: 'newest_observation' });
  });

  it('case 4 — same timestamp, different confidence: the more confident wins', () => {
    const d = two({ observed_at: T2, confidence: 0.3 }, { observed_at: T2, confidence: 0.7 });
    expect(d.apply[0]).toMatchObject({ value: 'B-value', reason: 'newest_then_highest_confidence' });
  });

  it('case 5 — same timestamp, same confidence: NO winner', () => {
    const d = two({ observed_at: T2, confidence: 0.7 }, { observed_at: T2, confidence: 0.7 });
    expect(d.apply).toEqual([]);
    expect(d.withhold).toEqual([{ attribute: 'job_title', reason: 'sources_disagree' }]);
  });

  it('case 6 — identical values: not a conflict at all', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'Same', { observed_at: T1 }), c('a2', 'Same', { observed_at: T2 }),
    ], P);
    expect(d.apply[0]).toMatchObject({ value: 'Same', reason: 'single_uncontested_assertion' });
    expect(d.contested).toEqual([]);
  });

  it('case 7 — values conflict and neither wins: canonical untouched, conflict reported', () => {
    const d = decideCanonicalUpdates({ job_title: 'Incumbent' }, [
      c('a1', 'A-value', { observed_at: T2, confidence: 0.5 }),
      c('a2', 'B-value', { observed_at: T2, confidence: 0.5 }),
    ], P);
    expect(d.apply).toEqual([]);
    expect(d.withhold).toEqual([{ attribute: 'job_title', reason: 'sources_disagree' }]);
    expect(d.contested).toEqual(['job_title']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('D-3 — declared authority, as data', () => {
  const authFor = (providers: string[]) =>
    buildAttributeAuthority('person', { job_title: providers }, P).authority;

  it('an authoritative source wins against a newer non-authoritative one', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'Authoritative', { provider: 'alpha', observed_at: T1 }),
      c('a2', 'Newer', { provider: 'beta', observed_at: T3 }),
    ], P, authFor(['alpha']));
    expect(d.apply).toEqual([
      { attribute: 'job_title', value: 'Authoritative', assertionId: 'a1', reason: 'authoritative_source' },
    ]);
  });

  it('authority NARROWS the field: a source disagreeing with itself falls to recency within it', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'Old-self', { provider: 'alpha', observed_at: T1 }),
      c('a2', 'New-self', { provider: 'alpha', observed_at: T2 }),
      c('a3', 'Newest-outsider', { provider: 'beta', observed_at: T3 }),
    ], P, authFor(['alpha']));
    // The outsider is newest overall and still loses: recency ran inside alpha.
    expect(d.apply[0]).toMatchObject({ value: 'New-self', assertionId: 'a2', reason: 'newest_observation' });
  });

  it('an authoritative source that has said NOTHING is silent, not decisive', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'One', { provider: 'beta', observed_at: T1 }),
      c('a2', 'Two', { provider: 'gamma', observed_at: T2 }),
    ], P, authFor(['alpha']));
    expect(d.apply[0]).toMatchObject({ value: 'Two', reason: 'newest_observation' });
  });

  it('is per attribute: authority over one attribute says nothing about another', () => {
    const authority = buildAttributeAuthority('person', { job_title: ['alpha'] }, P).authority;
    const d = decideCanonicalUpdates({ job_title: null, city: null }, [
      c('a1', 'Alpha-title', { provider: 'alpha', observed_at: T1 }, 'job_title'),
      c('a2', 'Beta-title', { provider: 'beta', observed_at: T3 }, 'job_title'),
      c('a3', 'Alpha-city', { provider: 'alpha', observed_at: T1 }, 'city'),
      c('a4', 'Beta-city', { provider: 'beta', observed_at: T3 }, 'city'),
    ], P, authority);
    expect(d.apply).toEqual([
      { attribute: 'city', value: 'Beta-city', assertionId: 'a4', reason: 'newest_observation' },
      { attribute: 'job_title', value: 'Alpha-title', assertionId: 'a1', reason: 'authoritative_source' },
    ]);
  });

  it('matches a provider key case-insensitively, because provider is free text', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'Won', { provider: '  ALPHA ', observed_at: T1 }),
      c('a2', 'Lost', { provider: 'beta', observed_at: T3 }),
    ], P, authFor(['Alpha']));
    expect(d.apply[0]).toMatchObject({ value: 'Won', reason: 'authoritative_source' });
  });

  it('an empty declaration is source-neutral, which is todays ratified state', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'One', { provider: 'alpha', observed_at: T1 }),
      c('a2', 'Two', { provider: 'beta', observed_at: T2 }),
    ], P, noAttributeAuthority('person'));
    expect(d.apply[0]).toMatchObject({ reason: 'newest_observation' });
  });

  it('omitting the declaration behaves exactly like an empty one', () => {
    const rows = [c('a1', 'One', { observed_at: T1 }), c('a2', 'Two', { observed_at: T2 })];
    expect(decideCanonicalUpdates({ job_title: null }, rows, P))
      .toEqual(decideCanonicalUpdates({ job_title: null }, rows, P, noAttributeAuthority('person')));
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the authority declaration itself', () => {
  it('names no provider in code, and a tenant that declared nothing is source-neutral', async () => {
    // O-1 still holds: nothing is seeded, so a tenant which has made no
    // declaration resolves empty and arbitration falls through to D-1/D-2.
    // O-7's deferral is what b1b.2 lifted -- a tenant MAY now declare manual
    // authority -- but nothing declares it on their behalf.
    declarations.rows = [];
    const person = await resolveAttributeAuthority('11111111-1111-4111-8111-111111111111', 'person');
    const account = await resolveAttributeAuthority('11111111-1111-4111-8111-111111111111', 'account');
    const relationship = await resolveAttributeAuthority('11111111-1111-4111-8111-111111111111', 'relationship');
    expect(person.byAttribute).toEqual({});
    expect(account.byAttribute).toEqual({});
    expect(relationship.byAttribute).toEqual({});
    expect(ATTRIBUTE_AUTHORITY_VERSION).toMatch(/^b1b\./);
  });

  it('a declaration takes effect through the resolver, and only for its own scope', async () => {
    declarations.rows = [{
      organizationId: '11111111-1111-4111-8111-111111111111',
      entityType: 'person', attribute: 'job_title', providers: ['alpha'],
      declaredByUserId: null, updatedAt: null,
    }];
    const person = await resolveAttributeAuthority('11111111-1111-4111-8111-111111111111', 'person');
    expect(authoritativeProvidersFor(person, 'job_title')).toEqual(['alpha']);
    // The stub answers every scope with the same row; the resolver still only
    // admits attributes the REQUESTED scope actually has, so an account
    // declaration cannot be fabricated out of a person one.
    const account = await resolveAttributeAuthority('11111111-1111-4111-8111-111111111111', 'account');
    expect(authoritativeProvidersFor(account, 'job_title')).toEqual([]);
    declarations.rows = [];
  });

  it('a stored-but-EMPTY declaration is source-neutral, not "nothing may win"', async () => {
    declarations.rows = [{
      organizationId: '11111111-1111-4111-8111-111111111111',
      entityType: 'person', attribute: 'job_title', providers: [],
      declaredByUserId: null, updatedAt: null,
    }];
    const person = await resolveAttributeAuthority('11111111-1111-4111-8111-111111111111', 'person');
    expect(person.byAttribute).toEqual({});

    // And arbitration still applies D-1 to the ordinary candidates.
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'VP', { observed_at: T1 }), c('a2', 'CRO', { observed_at: T2 }),
    ], P, person);
    expect(d.apply[0]).toMatchObject({ value: 'CRO', reason: 'newest_observation' });
    declarations.rows = [];
  });

  it('refuses to resolve without a tenant — authority is never global', async () => {
    await expect(resolveAttributeAuthority('', 'person')).rejects.toThrow(/organizationId is required/);
    await expect(resolveAttributeAuthority('   ', 'account')).rejects.toThrow(/organizationId is required/);
  });

  it('rejects a declaration over an attribute the surface does not have', () => {
    const { authority, rejected } = buildAttributeAuthority(
      'person', { job_title: ['alpha'], primary_email: ['alpha'], nonsense: ['alpha'] }, P);
    expect(Object.keys(authority.byAttribute)).toEqual(['job_title']);
    expect(rejected.sort()).toEqual(['nonsense', 'primary_email']);
  });

  it('rejects a declaration that names no usable provider', () => {
    const { authority, rejected } = buildAttributeAuthority('person', { job_title: ['', '  '] }, P);
    expect(authority.byAttribute).toEqual({});
    expect(rejected).toEqual(['job_title']);
  });

  it('de-duplicates and normalises provider keys', () => {
    const { authority } = buildAttributeAuthority('account', { industry: ['A', 'a', ' A '] }, ACCOUNT_ATTRIBUTE_COLUMNS);
    expect(authority.byAttribute.industry).toEqual(['a']);
    expect(authoritativeProvidersFor(authority, 'industry')).toEqual(['a']);
    expect(authoritativeProvidersFor(authority, 'city')).toEqual([]);
    expect(authoritativeProvidersFor(null, 'city')).toEqual([]);
    expect(normalizeProviderKey(null)).toBe('');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('D-4 — the canonical value is derived, and the unattested incumbent is protected', () => {
  it('re-arbitrates an attested incumbent when a newer observation disagrees', () => {
    const d = decideCanonicalUpdates({ job_title: 'Held' }, [
      c('a1', 'Held', { observed_at: T1 }),
      c('a2', 'Newer', { observed_at: T2 }),
    ], P);
    expect(d.apply).toEqual([
      { attribute: 'job_title', value: 'Newer', assertionId: 'a2', reason: 'newest_observation' },
    ]);
  });

  it('never overwrites an incumbent that no live assertion attests', () => {
    const d = decideCanonicalUpdates({ job_title: 'Legacy' }, [
      c('a1', 'Newer', { observed_at: T2 }),
    ], P);
    expect(d.apply).toEqual([]);
    expect(d.withhold).toEqual([{ attribute: 'job_title', reason: 'unattested_incumbent' }]);
  });

  it('protects an unattested incumbent even when the evidence is unanimous', () => {
    const d = decideCanonicalUpdates({ job_title: 'Legacy' }, [
      c('a1', 'Agreed', { observed_at: T1 }), c('a2', 'Agreed', { observed_at: T2 }),
    ], P);
    expect(d.withhold).toEqual([{ attribute: 'job_title', reason: 'unattested_incumbent' }]);
  });

  it('attests a NUMERIC canonical value through its string form', () => {
    // employee_count is numeric in the spine and text in an assertion.
    const d = decideCanonicalUpdates({ employee_count: 5000 }, [
      c('a1', '5000', { observed_at: T1 }, 'employee_count'),
      c('a2', '6200', { observed_at: T2 }, 'employee_count'),
    ], ACCOUNT_ATTRIBUTE_COLUMNS);
    expect(d.apply).toEqual([
      { attribute: 'employee_count', value: '6200', assertionId: 'a2', reason: 'newest_observation' },
    ]);
  });

  it('refuses to attest a STRUCTURED canonical value by string coincidence', () => {
    const d = decideCanonicalUpdates({ technologies: { a: 1 } }, [
      c('a1', '[object Object]', { observed_at: T1 }, 'technologies'),
    ], ACCOUNT_ATTRIBUTE_COLUMNS);
    expect(d.withhold).toEqual([{ attribute: 'technologies', reason: 'unattested_incumbent' }]);
  });

  it('writes nothing when the incumbent is already the winner — idempotent', () => {
    const rows = [c('a1', 'Held', { observed_at: T1 }), c('a2', 'Held', { observed_at: T2 })];
    const d = decideCanonicalUpdates({ job_title: 'Held' }, rows, P);
    expect(d.apply).toEqual([]);
    expect(d.withhold).toEqual([]);
    // And running it again is identical — nothing accumulates.
    expect(decideCanonicalUpdates({ job_title: 'Held' }, rows, P)).toEqual(d);
  });

  it('the retired reason is no longer emitted by any path', () => {
    const everything = [
      decideCanonicalUpdates({ job_title: 'X' }, [c('a1', 'Y', { observed_at: T1 })], P),
      decideCanonicalUpdates({ job_title: 'X' }, [c('a1', 'X', { observed_at: T1 }), c('a2', 'Y', { observed_at: T2 })], P),
      decideCanonicalUpdates({ job_title: null }, [c('a1', 'Y')], P),
    ];
    for (const d of everything) {
      expect(d.withhold.map((w) => w.reason)).not.toContain('canonical_value_already_set');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('contested is RAW disagreement — the question WS-7 asks', () => {
  it('reports a disagreement that recency RESOLVED', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'One', { observed_at: T1 }), c('a2', 'Two', { observed_at: T2 }),
    ], P);
    expect(d.apply).toHaveLength(1);        // arbitration resolved it
    expect(d.withhold).toEqual([]);         // so it is NOT withheld
    expect(d.contested).toEqual(['job_title']);  // and it is STILL a disagreement
  });

  it('reports nothing contested when the sources agree', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [c('a1', 'Same'), c('a2', 'Same')], P);
    expect(d.contested).toEqual([]);
  });

  it('is unaffected by authority: a declaration does not make sources agree', () => {
    const authority = buildAttributeAuthority('person', { job_title: ['alpha'] }, P).authority;
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'Alpha-says', { provider: 'alpha', observed_at: T1 }),
      c('a2', 'Beta-says', { provider: 'beta', observed_at: T2 }),
    ], P, authority);
    expect(d.apply[0]).toMatchObject({ reason: 'authoritative_source' });
    expect(d.contested).toEqual(['job_title']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('determinism — identical inputs, identical outputs, whatever the row order', () => {
  const rows = [
    c('a3', 'Three', { observed_at: T1, confidence: 0.3 }),
    c('a1', 'One', { observed_at: T3, confidence: 0.1 }),
    c('a2', 'Two', { observed_at: T2, confidence: 0.2 }),
    c('a4', 'One', { observed_at: T3, confidence: 0.9 }, 'city'),
    c('a5', 'Five', { observed_at: T1 }, 'city'),
  ];

  it('is invariant under permutation of the candidate list', () => {
    const base = decideCanonicalUpdates({ job_title: null, city: null }, rows, P);
    const permutations = [
      [...rows].reverse(),
      [rows[2], rows[4], rows[0], rows[3], rows[1]],
      [rows[1], rows[0], rows[3], rows[2], rows[4]],
    ];
    for (const perm of permutations) {
      expect(decideCanonicalUpdates({ job_title: null, city: null }, perm, P)).toEqual(base);
    }
  });

  it('stamps the same assertion every time when several carry the winning value', () => {
    // Three assertions agree on the value; exactly one must be recorded as the
    // one that became canonical, chosen by a stated rule rather than row order.
    const agreeing = [
      c('zzz', 'Agreed', { observed_at: T1, confidence: 0.5 }),
      c('aaa', 'Agreed', { observed_at: T3, confidence: 0.5 }),
      c('mmm', 'Agreed', { observed_at: T3, confidence: 0.9 }),
    ];
    const first = decideCanonicalUpdates({ job_title: null }, agreeing, P);
    expect(first.apply[0].assertionId).toBe('mmm');   // newest, then most confident
    expect(decideCanonicalUpdates({ job_title: null }, [...agreeing].reverse(), P)).toEqual(first);
  });

  it('falls back to the lowest id as a total order, so a full tie is still stable', () => {
    const tied = [
      c('b', 'Agreed', { observed_at: T2, confidence: 0.5 }),
      c('a', 'Agreed', { observed_at: T2, confidence: 0.5 }),
    ];
    expect(decideCanonicalUpdates({ job_title: null }, tied, P).apply[0].assertionId).toBe('a');
    expect(decideCanonicalUpdates({ job_title: null }, [...tied].reverse(), P).apply[0].assertionId).toBe('a');
  });

  it('sorts its outputs by attribute, so the result reads the same every run', () => {
    const d = decideCanonicalUpdates({ city: null, department: null, job_title: 'Legacy' }, [
      c('a1', 'J', { observed_at: T1 }, 'job_title'),
      c('a2', 'C', { observed_at: T1 }, 'city'),
      c('a3', 'D', { observed_at: T1 }, 'department'),
    ], P);
    expect(d.apply.map((a) => a.attribute)).toEqual(['city', 'department']);
    expect(d.withhold.map((w) => w.attribute)).toEqual(['job_title']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the writable surface, unchanged from LI-2', () => {
  it('ignores an attribute outside the surface, whatever a declaration says', () => {
    const { authority } = buildAttributeAuthority('person', { job_title: ['alpha'] }, P);
    const d = decideCanonicalUpdates({ primary_email: null, company_id: null }, [
      c('a1', 'x@y.test', { observed_at: T1 }, 'primary_email'),
      c('a2', 'other-tenant', { observed_at: T1 }, 'company_id'),
    ], P, authority);
    expect(d.apply).toEqual([]);
    expect(d.withhold).toEqual([]);
    expect(d.contested).toEqual([]);
  });

  it('treats a blank normalized value as no value at all', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', '   ', { observed_at: T2 }), c('a2', 'Real', { observed_at: T1 }),
    ], P);
    // The blank is not a candidate, so this is uncontested rather than contested.
    expect(d.apply).toEqual([
      { attribute: 'job_title', value: 'Real', assertionId: 'a2', reason: 'single_uncontested_assertion' },
    ]);
    expect(d.contested).toEqual([]);
  });

  it('never writes a blank value even when it is the only assertion', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [c('a1', '', { observed_at: T2 })], P);
    expect(d.apply).toEqual([]);
  });

  it('ignores a null normalized value, as LI-2 did', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [c('a1', null, { observed_at: T2 })], P);
    expect(d.apply).toEqual([]);
  });

  it('a person attribute cannot be written to an account', () => {
    const d = decideCanonicalUpdates({ timezone: null }, [
      c('a1', 'Europe/London', { observed_at: T1 }, 'timezone'),
    ], ACCOUNT_ATTRIBUTE_COLUMNS);
    expect(d.apply).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('candidacy and attestation read the same evidence for different purposes', () => {
  it('a superseded assertion cannot WIN, however new it is', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'Withdrawn', { observed_at: T3, superseded_at: T3 }),
      c('a2', 'Standing', { observed_at: T1 }),
    ], P);
    expect(d.apply).toEqual([
      { attribute: 'job_title', value: 'Standing', assertionId: 'a2', reason: 'single_uncontested_assertion' },
    ]);
  });

  it('a superseded assertion DOES attest, so a withdrawn value cannot freeze canonical', () => {
    // The flip-flop: canonical holds 'B' because arbitration wrote it, the source
    // has since withdrawn 'B' and returned to 'A'. Canonical must follow.
    const d = decideCanonicalUpdates({ job_title: 'B' }, [
      c('a1', 'A', { observed_at: T3 }),
      c('a2', 'B', { observed_at: T2, superseded_at: T3 }),
    ], P);
    expect(d.apply).toEqual([
      { attribute: 'job_title', value: 'A', assertionId: 'a1', reason: 'single_uncontested_assertion' },
    ]);
    expect(d.withhold).toEqual([]);
  });

  it('a value NO assertion has ever carried is still protected', () => {
    const d = decideCanonicalUpdates({ job_title: 'NeverAsserted' }, [
      c('a1', 'A', { observed_at: T3 }),
      c('a2', 'B', { observed_at: T2, superseded_at: T3 }),
    ], P);
    expect(d.apply).toEqual([]);
    expect(d.withhold).toEqual([{ attribute: 'job_title', reason: 'unattested_incumbent' }]);
  });

  it('counts only LIVE claims as contested — a withdrawn claim is not a disagreement', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [
      c('a1', 'Standing', { observed_at: T1 }),
      c('a2', 'Withdrawn', { observed_at: T2, superseded_at: T3 }),
    ], P);
    expect(d.contested).toEqual([]);
    expect(d.apply[0]).toMatchObject({ reason: 'single_uncontested_assertion' });
  });

  it('an absent superseded_at means live, so WS-7s narrower rows behave unchanged', () => {
    const withField = decideCanonicalUpdates({ job_title: null },
      [c('a1', 'X', { observed_at: T1, superseded_at: null })], P);
    const without = decideCanonicalUpdates({ job_title: null },
      [{ id: 'a1', attribute: 'job_title', normalized_value: 'X', observed_at: T1 }], P);
    expect(without).toEqual(withField);
  });
});
