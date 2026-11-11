/**
 * P0 CONTACT GOVERNANCE — PART 2. Per-read database time, and restrictive
 * aggregation of the per-read verdicts.
 *
 * WHAT THESE TESTS ARE FOR, precisely: the anchored loader makes TWO PostgREST
 * requests when a caller holds both a person and a target, and PostgREST serves
 * one transaction per request. There is therefore no single instant that
 * describes both responses, and picking one would be picking a fail-open
 * direction. These pin the alternative: each response is judged against the
 * instant it arrived with, and the verdicts combine in the restrictive
 * direction only.
 *
 * EVERY ASSERTION IS ABOUT A DECISION, not about a comparison. A test that only
 * checked which instant was passed could pass while the verdict was wrong.
 *
 * Fixtures are in the DATABASE's rendering — `+00:00`, never `Z`, and no
 * fractional part on a whole second — because that is what PostgREST actually
 * returns. See the grammar note in contactGovernance.ts.
 *
 * Runs against a double of the `ownedDbTable` seam. Real PostgREST, real
 * constraints and the real computed field are proven separately, by
 * backend/tests/integration/piP0ContactGovernanceReadAt.test.ts.
 */

type Row = Record<string, unknown>;
type Filter = [kind: string, column: string, value: unknown];

/**
 * A double that behaves like PostgREST in the one way that matters here: ONE
 * transaction timestamp per REQUEST, carried on every row of that request's
 * response. The instants are handed out from a queue, so a test can make the
 * two requests return deliberately different ones.
 */
const db = {
  rows: [] as Row[],
  /** The select column list of each request, in order. */
  selects: [] as string[],
  /** The filters of each request, in order. */
  requests: [] as Filter[][],
  /** Instants handed out per request, in order. */
  instants: [] as string[],
  /** 1-indexed request numbers that must fail. */
  failRequests: [] as number[],
  /** When set, the Nth request's rows carry DIFFERENT read_at values. */
  disagreeOnRequest: null as number | null,
  /** When set, the Nth request's rows carry no read_at at all. */
  omitReadAtOnRequest: null as number | null,
  count: 0,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const filters: Filter[] = [];
    let select = '';

    const exec = async (): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      db.count += 1;
      const n = db.count;
      db.selects.push(select);
      db.requests.push([...filters]);

      if (db.failRequests.includes(n)) {
        return { data: null, error: { message: `request ${n} failed` } };
      }

      const match = (r: Row): boolean =>
        filters.every(([kind, col, val]) => {
          if (kind === 'eq') return r[col] === val;
          if (kind === 'is') return (r[col] ?? null) === val;
          if (kind === 'in') return Array.isArray(val) && (val as unknown[]).includes(r[col] ?? null);
          return true;
        });

      const instant = db.instants[n - 1] ?? '2026-11-08T10:00:00+00:00';
      const found = db.rows.filter(match).map((r, i) => {
        if (db.omitReadAtOnRequest === n) return { ...r };
        if (db.disagreeOnRequest === n) {
          return { ...r, read_at: i === 0 ? instant : '2026-11-08T10:00:01+00:00' };
        }
        return { ...r, read_at: instant };
      });
      return { data: found, error: null };
    };

    const b: Record<string, unknown> = {
      select: (cols: string) => { select = cols; return b; },
      eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return b; },
      is: (c: string, v: unknown) => { filters.push(['is', c, v]); return b; },
      in: (c: string, v: unknown) => { filters.push(['in', c, v]); return b; },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => exec().then(resolve, reject),
    };
    void table;
    return b;
  },
}));

import { mayContact, type GovernanceRecord, type MayContactResult } from '../../services/prospectIdentity/contactGovernance';
import { loadGovernanceRecords, loadTenantGovernanceRecords, type GovernanceRead } from '../../services/prospectIdentity/contactGovernanceRepository';
import { evaluateGovernanceReads as evaluateGovernanceReadsRaw } from '../../services/prospectIdentity/contactGovernanceAggregation';

// The truth-table cases below model a CONSISTENT producer: its flat `records` count equals the rows
// carried by its successful reads. The inconsistent-producer branch is tested by name further down.
const evaluateGovernanceReads = (
  reads: Parameters<typeof evaluateGovernanceReadsRaw>[0],
  base: Parameters<typeof evaluateGovernanceReadsRaw>[1],
) => evaluateGovernanceReadsRaw(reads, base, (reads ?? []).reduce((n, r) => n + (r.ok ? r.records.length : 0), 0));

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const PERSON = '33333333-3333-4333-8333-333333333333';
const TARGET = 'ada@example.test';

/** The instant request 1 returns, and the LATER instant request 2 returns. */
const T1 = '2026-11-08T10:00:00+00:00';
const T2 = '2026-11-08T10:00:05+00:00';

const base = {
  organizationId: ORG,
  personId: PERSON,
  targetNormalized: TARGET,
  channel: 'email',
};

const record = (over: Partial<GovernanceRecord> & { id: string }): GovernanceRecord => ({
  organizationId: ORG,
  personId: null,
  targetNormalized: null,
  channel: 'email',
  governanceType: 'unsubscribe',
  effectiveFrom: '2020-01-01T00:00:00+00:00',
  effectiveUntil: null,
  revokedAt: null,
  purposeScope: null,
  ...over,
});

const read = (over: Partial<GovernanceRead> & { anchor: GovernanceRead['anchor'] }): GovernanceRead => ({
  ok: true,
  records: [],
  readAt: null,
  ...over,
});

/** An in-force unsubscribe on the person. Band 4. */
const personBlock = record({ id: 'gov-person', personId: PERSON, governanceType: 'unsubscribe' });
/** An in-force permanent DNC on the target. Band 3 — stricter than the above. */
const targetDnc = record({ id: 'gov-target', targetNormalized: TARGET, channel: '*', governanceType: 'dnc_permanent' });
/** Matches the anchor, but does not start until AFTER both test instants. */
const notYet = record({ id: 'gov-future', personId: PERSON, effectiveFrom: '2030-01-01T00:00:00+00:00' });

const dbRow = (r: GovernanceRecord): Row => ({
  id: r.id,
  organization_id: r.organizationId,
  person_id: r.personId,
  target_normalized: r.targetNormalized,
  channel: r.channel,
  governance_type: r.governanceType,
  effective_from: r.effectiveFrom,
  effective_until: r.effectiveUntil,
  revoked_at: r.revokedAt,
  purpose_scope: r.purposeScope ?? null,
});

beforeEach(() => {
  db.rows = [];
  db.selects = [];
  db.requests = [];
  db.instants = [];
  db.failRequests = [];
  db.disagreeOnRequest = null;
  db.omitReadAtOnRequest = null;
  db.count = 0;
});

// ════════════════════════════════════════════════════════════════════════════
describe('P0-2 §5 — the aggregation truth table, on the repository result codes', () => {
  // Each row of the owner's table, expressed in the verdict vocabulary that
  // actually exists: `allowed` / `blocked` / `deferred` and `ok: false` for
  // indeterminate. No new status value is introduced anywhere.

  it('Allow + Allow → allowed', () => {
    const r = evaluateGovernanceReads([
      read({ anchor: 'person', records: [notYet], readAt: T1 }),
      read({ anchor: 'target', records: [notYet], readAt: T2 }),
    ], base);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.verdict.decision).toBe('allowed');
  });

  it('Allow + Restrict → blocked, and the restriction is the verdict', () => {
    const r = evaluateGovernanceReads([
      read({ anchor: 'person', records: [notYet], readAt: T1 }),
      read({ anchor: 'target', records: [targetDnc], readAt: T2 }),
    ], base);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.verdict.decision).toBe('blocked');
    expect(r.ok === true && r.verdict.recordId).toBe('gov-target');
  });

  it('Restrict + Allow → blocked (the permissive read does not override)', () => {
    const r = evaluateGovernanceReads([
      read({ anchor: 'person', records: [personBlock], readAt: T1 }),
      read({ anchor: 'target', records: [notYet], readAt: T2 }),
    ], base);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.verdict.decision).toBe('blocked');
    expect(r.ok === true && r.verdict.recordId).toBe('gov-person');
  });

  it('Restrict + Restrict → the stricter band wins, and BOTH reasons survive', () => {
    const r = evaluateGovernanceReads([
      read({ anchor: 'person', records: [personBlock], readAt: T1 }),
      read({ anchor: 'target', records: [targetDnc], readAt: T2 }),
    ], base);
    expect(r.ok).toBe(true);
    // dnc_permanent is band 3; unsubscribe is band 4.
    expect(r.ok === true && r.verdict.gate).toBe(3);
    expect(r.ok === true && r.verdict.reason).toBe('blocked_by_dnc_permanent');
    // The one that did NOT win is still reported, with its own reason.
    const reasons = r.reads.map((e) => e.verdict?.reason);
    expect(reasons).toContain('blocked_by_dnc_permanent');
    expect(reasons).toContain('blocked_by_unsubscribe');
  });

  it('Allow + Unavailable → fail closed', () => {
    const r = evaluateGovernanceReads([
      read({ anchor: 'person', records: [notYet], readAt: T1 }),
      read({ anchor: 'target', ok: false, error: 'boom' }),
    ], base);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('indeterminate');
    expect(r.ok === false && r.error).toContain('target');
  });

  it('Unavailable + Allow → fail closed (ordering cannot rescue it)', () => {
    const r = evaluateGovernanceReads([
      read({ anchor: 'person', ok: false, error: 'boom' }),
      read({ anchor: 'target', records: [notYet], readAt: T2 }),
    ], base);
    expect(r.ok).toBe(false);
  });

  it('Empty successful + Allow → allowed', () => {
    const r = evaluateGovernanceReads([
      read({ anchor: 'person', records: [], readAt: null }),
      read({ anchor: 'target', records: [notYet], readAt: T2 }),
    ], base);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.verdict.decision).toBe('allowed');
  });

  it('Empty successful + Restrict → blocked (an empty read erases nothing)', () => {
    const r = evaluateGovernanceReads([
      read({ anchor: 'person', records: [], readAt: null }),
      read({ anchor: 'target', records: [targetDnc], readAt: T2 }),
    ], base);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.verdict.decision).toBe('blocked');
    expect(r.ok === true && r.verdict.recordId).toBe('gov-target');
  });

  it('Empty successful + Unavailable → fail closed', () => {
    const r = evaluateGovernanceReads([
      read({ anchor: 'person', records: [], readAt: null }),
      read({ anchor: 'target', ok: false, error: 'boom' }),
    ], base);
    expect(r.ok).toBe(false);
  });

  it('Indeterminate + Allow → fail closed, where indeterminate is rows with NO instant', () => {
    const r = evaluateGovernanceReads([
      read({ anchor: 'person', records: [personBlock], readAt: null }),
      read({ anchor: 'target', records: [notYet], readAt: T2 }),
    ], base);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('without a database read instant');
  });

  it('a deferment is not outvoted by an allow', () => {
    const deferred = record({
      id: 'gov-deferred', personId: PERSON, governanceType: 'deferred',
      effectiveUntil: '2030-01-01T00:00:00+00:00',
    });
    const r = evaluateGovernanceReads([
      read({ anchor: 'person', records: [deferred], readAt: T1 }),
      read({ anchor: 'target', records: [notYet], readAt: T2 }),
    ], base);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.verdict.decision).toBe('deferred');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('P0-2 §5.6 — the combined decision does not depend on input ordering', () => {
  const pairs: Array<[string, GovernanceRead[]]> = [
    ['restrict + allow', [
      read({ anchor: 'person', records: [personBlock], readAt: T1 }),
      read({ anchor: 'target', records: [notYet], readAt: T2 }),
    ]],
    ['restrict + restrict', [
      read({ anchor: 'person', records: [personBlock], readAt: T1 }),
      read({ anchor: 'target', records: [targetDnc], readAt: T2 }),
    ]],
    ['empty + restrict', [
      read({ anchor: 'person', records: [], readAt: null }),
      read({ anchor: 'target', records: [targetDnc], readAt: T2 }),
    ]],
    ['allow + allow', [
      read({ anchor: 'person', records: [notYet], readAt: T1 }),
      read({ anchor: 'target', records: [notYet], readAt: T2 }),
    ]],
  ];

  for (const [label, reads] of pairs) {
    it(`${label}: forward and reversed agree field for field`, () => {
      const forward = evaluateGovernanceReads(reads, base);
      const reversed = evaluateGovernanceReads([...reads].reverse(), base);
      expect(forward.ok).toBe(reversed.ok);
      expect(forward.ok === true && forward.verdict).toEqual(reversed.ok === true && reversed.verdict);
    });
  }

  it('two verdicts in the SAME band still resolve identically either way', () => {
    // unsubscribe and complaint are both band 4, so the band cannot decide and
    // only the deterministic tiebreak can.
    const a = record({ id: 'gov-a', personId: PERSON, governanceType: 'unsubscribe' });
    const b = record({ id: 'gov-b', targetNormalized: TARGET, governanceType: 'complaint' });
    const forward = evaluateGovernanceReads([
      read({ anchor: 'person', records: [a], readAt: T1 }),
      read({ anchor: 'target', records: [b], readAt: T2 }),
    ], base);
    const reversed = evaluateGovernanceReads([
      read({ anchor: 'target', records: [b], readAt: T2 }),
      read({ anchor: 'person', records: [a], readAt: T1 }),
    ], base);
    expect(forward.ok === true && forward.verdict).toEqual(reversed.ok === true && reversed.verdict);
    expect(forward.ok === true && forward.verdict.gate).toBe(4);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('P0-2 §4 — an unreported or unusable instant is never an allow', () => {
  it('`reads` undefined fails closed — it is NOT read as "no reads"', () => {
    const r = evaluateGovernanceReads(undefined, base);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('not reported');
  });

  it('an EMPTY reads array is allowed, because nothing was asked and nothing could apply', () => {
    const r = evaluateGovernanceReads([], base);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.verdict.decision).toBe('allowed');
    expect(r.ok === true && r.verdict.reason).toBe('no_governance_record_applies');
  });

  it('a FAILED read is not empty success, even when it returned an empty array', () => {
    const r = evaluateGovernanceReads(
      [read({ anchor: 'person', ok: false, records: [], error: 'connection reset' })],
      base,
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('connection reset');
  });

  it('rows with no instant fail closed EVEN WHEN the records would have allowed', () => {
    // The records do not match the anchor at all, so at any instant the verdict
    // would be `allowed`. It still must not be returned: the instant is missing,
    // and that is a state we cannot decide from.
    const unrelated = record({ id: 'gov-unrelated', targetNormalized: 'someone@else.test' });
    const r = evaluateGovernanceReads(
      [read({ anchor: 'target', records: [unrelated], readAt: null })],
      base,
    );
    expect(r.ok).toBe(false);
  });

  it('the instant handed to an empty-record evaluation cannot change its outcome', () => {
    // Pins the inertness that NO_RECORDS_INSTANT depends on, rather than
    // assuming it. If a future change starts reading `now` for an empty record
    // set, this fails here instead of silently depending on an empty string.
    for (const now of ['', '2020-01-01T00:00:00+00:00', '2030-01-01T00:00:00Z', 'not-a-timestamp']) {
      const v = mayContact({ ...base, now, records: [] });
      expect(v.decision).toBe('allowed');
      expect(v.reason).toBe('no_governance_record_applies');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('P0-2 §8 — each read is judged at the instant ITS OWN rows came back with', () => {
  it('the two anchored reads return two DIFFERENT instants, and each is used once', async () => {
    db.instants = [T1, T2];
    db.rows = [dbRow(personBlock), dbRow(targetDnc)];

    const loaded = await loadGovernanceRecords({ organizationId: ORG, personId: PERSON, target: TARGET, channel: 'email' });
    expect(loaded.ok).toBe(true);
    expect(loaded.reads).toHaveLength(2);

    const person = loaded.reads!.find((x) => x.anchor === 'person')!;
    const target = loaded.reads!.find((x) => x.anchor === 'target')!;

    // Each read carries its OWN instant, and they are not the same value.
    expect(person.readAt).toBe(T1);
    expect(target.readAt).toBe(T2);
    expect(person.readAt).not.toBe(target.readAt);

    // Each read carries only ITS OWN rows.
    expect(person.records.map((r) => r.id)).toEqual(['gov-person']);
    expect(target.records.map((r) => r.id)).toEqual(['gov-target']);
  });

  it('the person read is evaluated at the person instant, the target read at the target instant', async () => {
    // Each record lapses at exactly the OTHER read's instant, so swapping the
    // instants flips both verdicts. That makes the mapping observable in the
    // DECISION rather than only in a recorded field.
    db.instants = [T1, T2];
    const personDeferment = record({
      id: 'gov-person', personId: PERSON, governanceType: 'deferred',
      // Still running at T1, already lapsed by T2.
      effectiveUntil: '2026-11-08T10:00:02+00:00',
    });
    const targetDeferment = record({
      id: 'gov-target', targetNormalized: TARGET, governanceType: 'deferred',
      // Not started at T1, running at T2.
      effectiveFrom: '2026-11-08T10:00:03+00:00',
      effectiveUntil: '2026-11-08T10:00:09+00:00',
    });
    db.rows = [dbRow(personDeferment), dbRow(targetDeferment)];

    const loaded = await loadGovernanceRecords({ organizationId: ORG, personId: PERSON, target: TARGET, channel: 'email' });
    const r = evaluateGovernanceReads(loaded.reads, base);

    expect(r.ok).toBe(true);
    const person = r.reads.find((x) => x.anchor === 'person')!;
    const target = r.reads.find((x) => x.anchor === 'target')!;
    // At T1 the person deferment is live; at T2 the target deferment is live.
    expect(person.verdict?.decision).toBe('deferred');
    expect(person.verdict?.recordId).toBe('gov-person');
    expect(target.verdict?.decision).toBe('deferred');
    expect(target.verdict?.recordId).toBe('gov-target');

    // THE NEGATIVE CONTROL. Had either read been judged at the other's instant,
    // that read would have returned `allowed` — so the two assertions above
    // cannot both hold under a swap.
    expect(mayContact({ ...base, now: T2, records: [personDeferment] }).decision).toBe('allowed');
    expect(mayContact({ ...base, now: T1, records: [targetDeferment] }).decision).toBe('allowed');
  });

  it('every row of ONE request carries that request’s instant', async () => {
    db.instants = [T1, T2];
    const second = record({ id: 'gov-person-2', personId: PERSON, governanceType: 'complaint' });
    db.rows = [dbRow(personBlock), dbRow(second), dbRow(targetDnc)];

    const loaded = await loadGovernanceRecords({ organizationId: ORG, personId: PERSON, target: TARGET, channel: 'email' });
    const person = loaded.reads!.find((x) => x.anchor === 'person')!;
    expect(person.records).toHaveLength(2);
    expect(person.readAt).toBe(T1);
  });

  it('rows that DISAGREE on their instant are indeterminate, not a coin flip', async () => {
    db.instants = [T1, T2];
    db.disagreeOnRequest = 1;
    const second = record({ id: 'gov-person-2', personId: PERSON, governanceType: 'complaint' });
    db.rows = [dbRow(personBlock), dbRow(second)];

    const loaded = await loadGovernanceRecords({ organizationId: ORG, personId: PERSON, target: TARGET, channel: 'email' });
    const person = loaded.reads!.find((x) => x.anchor === 'person')!;
    expect(person.readAt).toBeNull();
    expect(person.records).toHaveLength(2);
    expect(evaluateGovernanceReads(loaded.reads, base).ok).toBe(false);
  });

  it('a response WITHOUT the computed field is indeterminate for its non-empty read', async () => {
    db.instants = [T1, T2];
    db.omitReadAtOnRequest = 2;
    db.rows = [dbRow(personBlock), dbRow(targetDnc)];

    const loaded = await loadGovernanceRecords({ organizationId: ORG, personId: PERSON, target: TARGET, channel: 'email' });
    expect(loaded.reads!.find((x) => x.anchor === 'person')!.readAt).toBe(T1);
    expect(loaded.reads!.find((x) => x.anchor === 'target')!.readAt).toBeNull();
    expect(evaluateGovernanceReads(loaded.reads, base).ok).toBe(false);
  });

  it('an EMPTY read needs no instant and reports none', async () => {
    db.instants = [T1, T2];
    db.rows = [dbRow(targetDnc)];   // nothing anchored to the person

    const loaded = await loadGovernanceRecords({ organizationId: ORG, personId: PERSON, target: TARGET, channel: 'email' });
    const person = loaded.reads!.find((x) => x.anchor === 'person')!;
    expect(person.records).toEqual([]);
    expect(person.readAt).toBeNull();
    // And it is still neutral rather than indeterminate.
    const r = evaluateGovernanceReads(loaded.reads, base);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.verdict.recordId).toBe('gov-target');
  });

  it('a FAILED second request fails the decision closed although the first allowed', async () => {
    db.instants = [T1, T2];
    db.failRequests = [2];
    db.rows = [dbRow(notYet)];

    const loaded = await loadGovernanceRecords({ organizationId: ORG, personId: PERSON, target: TARGET, channel: 'email' });
    expect(loaded.ok).toBe(false);
    expect(evaluateGovernanceReads(loaded.reads, base).ok).toBe(false);
  });

  it('one anchor means ONE request and one instant', async () => {
    db.instants = [T1];
    db.rows = [dbRow(targetDnc)];

    const loaded = await loadGovernanceRecords({ organizationId: ORG, personId: null, target: TARGET, channel: 'email' });
    expect(db.count).toBe(1);
    expect(loaded.reads).toHaveLength(1);
    expect(loaded.reads![0].anchor).toBe('target');
    expect(loaded.reads![0].readAt).toBe(T1);
  });

  it('NO anchor means NO request, and no instant is invented', async () => {
    const loaded = await loadGovernanceRecords({ organizationId: ORG, personId: null, target: null, channel: 'email' });
    expect(db.count).toBe(0);
    expect(loaded.reads).toEqual([]);
    expect(evaluateGovernanceReads(loaded.reads, base).ok).toBe(true);
  });

  it('the tenant loader reports its single read with its own instant', async () => {
    db.instants = [T1];
    db.rows = [dbRow(targetDnc)];

    const loaded = await loadTenantGovernanceRecords(ORG, ['email']);
    expect(loaded.ok).toBe(true);
    expect(loaded.reads).toHaveLength(1);
    expect(loaded.reads![0].anchor).toBe('tenant');
    expect(loaded.reads![0].readAt).toBe(T1);
  });

  it('the tenant loader reports a FAILED read rather than an empty success', async () => {
    db.failRequests = [1];
    const loaded = await loadTenantGovernanceRecords(ORG, ['email']);
    expect(loaded.ok).toBe(false);
    expect(loaded.reads![0]).toMatchObject({ anchor: 'tenant', ok: false, readAt: null });
    expect(loaded.reads![0].records).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('P0-2 §6 — the query shape changed by exactly one column', () => {
  // The column list as it stood BEFORE this change, written out so that any
  // other addition, removal or reordering fails here.
  const BEFORE = 'id, organization_id, person_id, target_normalized, channel, '
    + 'governance_type, effective_from, effective_until, revoked_at, purpose_scope';

  it('both anchored reads select the previous columns plus `read_at`, and nothing else', async () => {
    db.instants = [T1, T2];
    await loadGovernanceRecords({ organizationId: ORG, personId: PERSON, target: TARGET, channel: 'email' });
    expect(db.selects).toHaveLength(2);
    for (const select of db.selects) expect(select).toBe(`${BEFORE}, read_at`);
  });

  it('the tenant read does the same', async () => {
    await loadTenantGovernanceRecords(ORG, ['email']);
    expect(db.selects).toEqual([`${BEFORE}, read_at`]);
  });

  it('the anchor-specific and tenant filters are all still there, tenant first', async () => {
    db.instants = [T1, T2];
    await loadGovernanceRecords({ organizationId: ORG, personId: PERSON, target: TARGET, channel: 'email' });

    const [first, second] = db.requests;
    // TENANT FIRST on both, which is the repository's stated invariant.
    expect(first[0]).toEqual(['eq', 'organization_id', ORG]);
    expect(second[0]).toEqual(['eq', 'organization_id', ORG]);
    // Each read keeps its OWN anchor predicate, and only its own.
    expect(first).toContainEqual(['eq', 'person_id', PERSON]);
    expect(first).not.toContainEqual(['eq', 'target_normalized', TARGET]);
    expect(second).toContainEqual(['eq', 'target_normalized', TARGET]);
    expect(second).not.toContainEqual(['eq', 'person_id', PERSON]);
    // And the revocation and channel predicates are untouched.
    for (const req of db.requests) {
      expect(req).toContainEqual(['is', 'revoked_at', null]);
      expect(req).toContainEqual(['in', 'channel', ['email', '*']]);
    }
  });

  it('no `or` was introduced — the two narrow reads are still two reads', async () => {
    db.instants = [T1, T2];
    await loadGovernanceRecords({ organizationId: ORG, personId: PERSON, target: TARGET, channel: 'email' });
    expect(db.count).toBe(2);
    for (const req of db.requests) {
      expect(req.map(([kind]) => kind)).not.toContain('or');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('P0-2 — tenant isolation survives per-read evaluation', () => {
  it('another tenant’s row is dropped from the read it arrived in', async () => {
    db.instants = [T1, T2];
    // The double honours the org filter, so force the case the repository's
    // defence-in-depth exists for: a row that reached the client anyway.
    db.rows = [{ ...dbRow(personBlock), organization_id: OTHER_ORG }];

    const loaded = await loadGovernanceRecords({ organizationId: ORG, personId: PERSON, target: TARGET, channel: 'email' });
    for (const r of loaded.reads!) expect(r.records).toEqual([]);
    expect(loaded.records).toEqual([]);
  });

  it('a cross-tenant row cannot block, and cannot be laundered through the instant either', () => {
    const foreign = { ...personBlock, organizationId: OTHER_ORG };
    const r = evaluateGovernanceReads(
      [read({ anchor: 'person', records: [foreign], readAt: T1 })],
      base,
    );
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.verdict.decision).toBe('allowed');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('P0-2 — the aggregator adds no authority of its own', () => {
  it('every combined verdict is a verdict `mayContact` itself returned', () => {
    const r = evaluateGovernanceReads([
      read({ anchor: 'person', records: [personBlock], readAt: T1 }),
      read({ anchor: 'target', records: [targetDnc], readAt: T2 }),
    ], base);
    expect(r.ok).toBe(true);
    const direct: MayContactResult = mayContact({ ...base, now: T2, records: [targetDnc] });
    expect(r.ok === true && r.verdict).toEqual(direct);
  });

  it('it introduces no decision value outside the evaluator’s vocabulary', () => {
    const cases: GovernanceRead[][] = [
      [read({ anchor: 'person', records: [personBlock], readAt: T1 })],
      [read({ anchor: 'person', records: [notYet], readAt: T1 })],
      [read({ anchor: 'person', records: [], readAt: null })],
      [],
    ];
    for (const reads of cases) {
      const r = evaluateGovernanceReads(reads, base);
      expect(r.ok).toBe(true);
      expect(['allowed', 'blocked', 'deferred']).toContain(r.ok === true && r.verdict.decision);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('A2 (virality-05) — reads: [] is "nothing applied" ONLY when the producer returned no rows', () => {
  it('reads: [] with producedRecordCount 0 → ok (nothing could apply; unchanged behaviour)', () => {
    const r = evaluateGovernanceReadsRaw([], base, 0);
    expect(r.ok).toBe(true);
  });

  it('reads: [] with producedRecordCount 3 → indeterminate (rows exist, no read instant reported)', () => {
    const r = evaluateGovernanceReadsRaw([], base, 3);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/returned 3 record\(s\) but reported no read/);
  });

  it('reads: undefined stays indeterminate whatever the count (unchanged)', () => {
    expect(evaluateGovernanceReadsRaw(undefined, base, 0).ok).toBe(false);
    expect(evaluateGovernanceReadsRaw(undefined, base, 5).ok).toBe(false);
  });

  it('non-empty reads are judged on their own rows; the count never decides a verdict', () => {
    const reads = [read({ anchor: 'person', records: [], readAt: T1 })];
    // a count that disagrees with the reads does not change a non-empty evaluation
    expect(evaluateGovernanceReadsRaw(reads, base, 0)).toEqual(evaluateGovernanceReadsRaw(reads, base, 7));
  });
});
