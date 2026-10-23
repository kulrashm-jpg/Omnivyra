/**
 * O-3 — the duplicate-suppression read is SUBJECT-AWARE.
 *
 * `readAssertions` matched the entity against EITHER canonical leg, because the
 * port carried no subject. The lead orchestrator writes a person assertion with
 * BOTH legs set (`orchestrator.ts` passes `personId` AND `accountId` on the
 * person pass, and the boundary stores `account_id` unconditionally), and the
 * person and account attribute surfaces overlap on `country_code`, `region` and
 * `city`. So an employee's own city, from the same provider, could answer an
 * ACCOUNT request and return `duplicate_suppressed` for company enrichment that
 * had never happened — losing the company attribute rather than over-spending.
 *
 * The naive fix is the dangerous one: filtering to `entity_type = 'account'`
 * unconditionally would strip PERSON suppression entirely and buy a provider
 * call on every person enrichment. Case 4 below exists to make that impossible
 * to ship by accident.
 *
 * These tests are QUERY-LEVEL, which no existing suite is: the two suppression
 * suites inject a reader stub and assert only what reaches that seam, so the
 * five real predicates were never executed. This file runs the real
 * `defaultFindRecentObservation` — and therefore the real `readAssertions` —
 * against a database double that records every predicate as sent.
 */

type Row = Record<string, unknown>;

const db = {
  rows: [] as Row[],
  /** Every statement issued, with the predicates it carried. */
  calls: [] as Array<{
    table: string;
    eq: Array<[string, unknown]>;
    in: Array<[string, unknown[]]>;
    is: Array<[string, unknown]>;
    or: string[];
  }>,
  error: null as { message: string } | null,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const call = { table, eq: [] as Array<[string, unknown]>, in: [] as Array<[string, unknown[]]>, is: [] as Array<[string, unknown]>, or: [] as string[] };
    const run = async () => {
      await Promise.resolve();
      db.calls.push(call);
      if (db.error) return { data: null, error: db.error };
      const matched = db.rows.filter((r) =>
        call.eq.every(([c, v]) => r[c] === v)
        && call.in.every(([c, vs]) => vs.indexOf(r[c]) !== -1)
        && call.is.every(([c, v]) => (r[c] ?? null) === v)
        // `or` is implemented FAITHFULLY (match if any `col.eq.value` term
        // matches) rather than as a no-op. If it matched nothing, a
        // subject-blind reader would return no rows and the isolation cases
        // below would pass for the wrong reason — the double would be hiding
        // the very defect they exist to catch.
        && call.or.every((expr) => expr.split(',').some((term) => {
          const m = /^([a-z_]+)\.eq\.(.+)$/.exec(term.trim());
          return m ? r[m[1]] === m[2] : false;
        })));
      return { data: matched, error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (c: string, v: unknown) => { call.eq.push([c, v]); return api; },
      in: (c: string, vs: unknown[]) => { call.in.push([c, vs]); return api; },
      is: (c: string, v: unknown) => { call.is.push([c, v]); return api; },
      or: (expr: string) => { call.or.push(expr); return api; },
      order: () => api,
      limit: () => run(),
      single: () => run(),
      maybeSingle: () => run(),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
    };
    return api;
  },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { defaultFindRecentObservation } = require('../../services/enrichment/providers/observations');
/* eslint-enable @typescript-eslint/no-var-requires */

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
/** Both must be real uuids — `readAssertions` validates the id it filters on. */
const ACC = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222222';
const FRESH = '2026-10-01T00:00:00.000Z';
const PROVIDER = 'clearbit';

/**
 * A person-scoped assertion that ALSO carries the account leg — the shape the
 * lead orchestrator writes, and the one this change exists to exclude from
 * account suppression. `entity_type` stays 'person' because that is what
 * declares the subject; the account leg does not change whose claim it is.
 */
const personAssertion = (over: Row = {}): Row => ({
  organization_id: ORG_A, entity_type: 'person', person_id: P1, account_id: ACC,
  attribute: 'city', observed_at: FRESH, recorded_at: FRESH,
  provider: PROVIDER, superseded_at: null, ...over,
});

/** An account-scoped assertion. `person_id` is NULL by `entity_coherent`. */
const accountAssertion = (over: Row = {}): Row => ({
  organization_id: ORG_A, entity_type: 'account', person_id: null, account_id: ACC,
  attribute: 'city', observed_at: FRESH, recorded_at: FRESH,
  provider: PROVIDER, superseded_at: null, ...over,
});

const find = (over: Row = {}) => defaultFindRecentObservation({
  organizationId: ORG_A, subject: 'account', entityId: ACC,
  providerId: PROVIDER, attributes: ['city'], ...over,
} as never);

const assertionCall = () => db.calls.filter((c) => c.table === 'source_assertions')[0];

beforeEach(() => { db.rows = []; db.calls = []; db.error = null; });

describe('O-3 — the suppression query names its subject', () => {
  it('1. an ACCOUNT lookup filters entity_type and account_id, with no OR', async () => {
    await find({ subject: 'account', entityId: ACC });

    const call = assertionCall();
    expect(call.eq).toEqual(expect.arrayContaining([
      ['organization_id', ORG_A], ['provider', PROVIDER],
      ['entity_type', 'account'], ['account_id', ACC],
    ]));
    expect(call.or).toEqual([]);                       // no subject-ambiguous predicate
    expect(call.eq.map(([c]) => c)).not.toContain('person_id');
  });

  it('2. a PERSON lookup filters entity_type and person_id, with no OR', async () => {
    await find({ subject: 'person', entityId: P1 });

    const call = assertionCall();
    expect(call.eq).toEqual(expect.arrayContaining([
      ['organization_id', ORG_A], ['provider', PROVIDER],
      ['entity_type', 'person'], ['person_id', P1],
    ]));
    expect(call.or).toEqual([]);
    expect(call.eq.map(([c]) => c)).not.toContain('account_id');
  });

  it('retains the attribute and live-evidence predicates for both subjects', async () => {
    await find({ subject: 'account', entityId: ACC, attributes: ['city', 'region'] });
    expect(assertionCall().in).toEqual([['attribute', ['city', 'region']]]);
    expect(assertionCall().is).toEqual([['superseded_at', null]]);

    db.calls = [];
    await find({ subject: 'person', entityId: P1, attributes: ['city', 'region'] });
    expect(assertionCall().in).toEqual([['attribute', ['city', 'region']]]);
    expect(assertionCall().is).toEqual([['superseded_at', null]]);
  });
});

describe('O-3 — person evidence never suppresses account enrichment', () => {
  it('3. a dual-leg person assertion does NOT satisfy an account request', async () => {
    db.rows = [personAssertion()];
    expect(await find({ subject: 'account', entityId: ACC })).toBeNull();
  });

  it('4. the SAME assertion still satisfies a person request — suppression preserved', async () => {
    // The guard against the naive fix: an unconditional account filter would
    // strip person suppression and buy a provider call on every person.
    db.rows = [personAssertion()];
    expect(await find({ subject: 'person', entityId: P1 })).toEqual({ observedAt: FRESH });
  });

  it('5. account-scoped evidence still satisfies an account request', async () => {
    db.rows = [accountAssertion()];
    expect(await find({ subject: 'account', entityId: ACC })).toEqual({ observedAt: FRESH });
  });

  it('an account request is answered by account evidence even when a person row is present', async () => {
    db.rows = [personAssertion({ observed_at: '2026-10-05T00:00:00.000Z' }), accountAssertion()];
    expect(await find({ subject: 'account', entityId: ACC })).toEqual({ observedAt: FRESH });
  });

  it('another person at the same account cannot satisfy this person\'s request', async () => {
    db.rows = [personAssertion({ person_id: '33333333-3333-4333-8333-333333333333' })];
    expect(await find({ subject: 'person', entityId: P1 })).toBeNull();
  });
});

describe('O-3 — the pre-existing gates are unchanged', () => {
  it('6. another tenant\'s evidence never suppresses', async () => {
    db.rows = [accountAssertion({ organization_id: ORG_B })];
    expect(await find({ subject: 'account', entityId: ACC })).toBeNull();
  });

  it('7. another provider\'s evidence never suppresses', async () => {
    db.rows = [accountAssertion({ provider: 'apollo' })];
    expect(await find({ subject: 'account', entityId: ACC })).toBeNull();
  });

  it('8. superseded evidence never suppresses, for either subject', async () => {
    db.rows = [
      accountAssertion({ superseded_at: FRESH }),
      personAssertion({ superseded_at: FRESH }),
    ];
    expect(await find({ subject: 'account', entityId: ACC })).toBeNull();
    expect(await find({ subject: 'person', entityId: P1 })).toBeNull();
  });

  it('an attribute with no evidence blocks suppression for the whole set', async () => {
    db.rows = [accountAssertion({ attribute: 'city' })];
    expect(await find({ subject: 'account', entityId: ACC, attributes: ['city', 'region'] })).toBeNull();
  });
});

describe('O-3 — it fails CLOSED', () => {
  it.each([
    ['a missing subject', undefined],
    ['an empty subject', ''],
    ['an unknown subject', 'relationship'],
    ['a non-string subject', 7],
  ])('9. %s is refused BEFORE any query is issued', async (_label, subject) => {
    db.rows = [accountAssertion()];
    await expect(find({ subject, entityId: ACC })).rejects.toThrow(/subject must be/);
    expect(db.calls).toEqual([]);                      // nothing reached the database
  });

  it('refuses an entityId that is not a canonical uuid, before any query', async () => {
    await expect(find({ subject: 'account', entityId: 'not-a-uuid' }))
      .rejects.toThrow(/entityId must be a canonical uuid/);
    expect(db.calls).toEqual([]);
  });

  it('10. a read error propagates rather than reading as "nothing found"', async () => {
    db.error = { message: 'permission denied' };
    await expect(find({ subject: 'account', entityId: ACC }))
      .rejects.toThrow(/source_assertions read failed: permission denied/);
  });

  it('still refuses a tenant-less lookup, and still answers an empty attribute list', async () => {
    await expect(find({ organizationId: '   ' })).rejects.toThrow(/organizationId is required/);
    expect(await find({ attributes: [] })).toBeNull();
    expect(db.calls).toEqual([]);
  });
});

// Module scope: keeps this file's top-level names from colliding with other test files under tsc.
export {};
