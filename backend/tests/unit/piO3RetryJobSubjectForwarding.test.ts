/**
 * O-3 (retry path) — `freshEvidenceCovers` FORWARDS the subject.
 *
 * The subject was already on this port's input (`retryConsumer.ts` declares it
 * and supplies `candidate.subject`), but `productionRetryPorts` destructured
 * around it and never passed it to `defaultFindRecentObservation`. The lookup
 * therefore matched EITHER canonical leg, so an employee's own evidence could
 * report fresh ACCOUNT coverage — and `decideEnrichmentAction` answers
 * `NO_ACTION` ("fresh evidence already covers requested attributes") on that
 * report, dropping a company retry that had never run.
 *
 * This is a separate file rather than an addition to `a7RetryJob.test.ts` on
 * purpose: that suite mocks `ownedDbTable` to THROW, because its whole subject
 * is that the job touches no production table unless deliberately enabled.
 * Giving it a working database double would weaken that guarantee. So the real
 * `productionRetryPorts().freshEvidenceCovers` is exercised here instead,
 * against a double that records the predicates as sent.
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../services/logger', () => ({
  logger: {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  },
}));

type Row = Record<string, unknown>;

const db = {
  rows: [] as Row[],
  calls: [] as Array<{
    table: string;
    eq: Array<[string, unknown]>;
    in: Array<[string, unknown[]]>;
    is: Array<[string, unknown]>;
    or: string[];
  }>,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const call = { table, eq: [] as Array<[string, unknown]>, in: [] as Array<[string, unknown[]]>, is: [] as Array<[string, unknown]>, or: [] as string[] };
    const run = async () => {
      await Promise.resolve();
      db.calls.push(call);
      const matched = db.rows.filter((r) =>
        call.eq.every(([c, v]) => r[c] === v)
        && call.in.every(([c, vs]) => vs.indexOf(r[c]) !== -1)
        && call.is.every(([c, v]) => (r[c] ?? null) === v)
        // Faithful `or`, not a no-op: a no-op would make the isolation cases
        // below pass for the wrong reason against the pre-change code.
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

import { productionRetryPorts } from '../../jobs/prospectRetryJob';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ACC = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222222';
const PROVIDER = 'clearbit';
/** 9 days before NOW, so it is inside the 30-day freshness window. */
const FRESH = '2026-10-01T00:00:00.000Z';
const NOW = '2026-10-10T00:00:00.000Z';

/** The lead orchestrator's shape: a person assertion carrying the account leg. */
const personAssertion = (over: Row = {}): Row => ({
  organization_id: ORG, entity_type: 'person', person_id: P1, account_id: ACC,
  attribute: 'city', observed_at: FRESH, recorded_at: FRESH,
  provider: PROVIDER, superseded_at: null, ...over,
});

const accountAssertion = (over: Row = {}): Row => ({
  organization_id: ORG, entity_type: 'account', person_id: null, account_id: ACC,
  attribute: 'city', observed_at: FRESH, recorded_at: FRESH,
  provider: PROVIDER, superseded_at: null, ...over,
});

const covers = (subject: 'person' | 'account', entityId: string) =>
  productionRetryPorts().freshEvidenceCovers({
    organizationId: ORG, subject, entityId,
    providerId: PROVIDER, attributes: ['city'], now: NOW,
  });

const assertionCall = () => db.calls.filter((c) => c.table === 'source_assertions')[0];

beforeEach(() => { db.rows = []; db.calls = []; });

describe('O-3 — the retry job forwards the subject to the suppression lookup', () => {
  it('an ACCOUNT candidate asks about account-scoped evidence', async () => {
    await covers('account', ACC);

    expect(assertionCall().eq).toEqual(expect.arrayContaining([
      ['organization_id', ORG], ['provider', PROVIDER],
      ['entity_type', 'account'], ['account_id', ACC],
    ]));
    expect(assertionCall().or).toEqual([]);
  });

  it('a PERSON candidate asks about person-scoped evidence', async () => {
    await covers('person', P1);

    expect(assertionCall().eq).toEqual(expect.arrayContaining([
      ['organization_id', ORG], ['provider', PROVIDER],
      ['entity_type', 'person'], ['person_id', P1],
    ]));
    expect(assertionCall().or).toEqual([]);
  });
});

describe('O-3 — an employee cannot make a company retry look already covered', () => {
  it('a dual-leg person assertion does NOT report fresh account coverage', async () => {
    // Before the fix this returned true, and `decideEnrichmentAction` turns
    // that into NO_ACTION — the company retry is dropped.
    db.rows = [personAssertion()];
    expect(await covers('account', ACC)).toBe(false);
  });

  it('the SAME assertion DOES report fresh person coverage — retry suppression preserved', async () => {
    // The guard against the naive fix: filtering to account evidence outright
    // would make every person retry look uncovered and re-call the provider.
    db.rows = [personAssertion()];
    expect(await covers('person', P1)).toBe(true);
  });

  it('account-scoped evidence still reports fresh account coverage', async () => {
    db.rows = [accountAssertion()];
    expect(await covers('account', ACC)).toBe(true);
  });

  it('stale account evidence still reports NO coverage', async () => {
    db.rows = [accountAssertion({ observed_at: '2026-01-01T00:00:00.000Z', recorded_at: '2026-01-01T00:00:00.000Z' })];
    expect(await covers('account', ACC)).toBe(false);
  });
});
