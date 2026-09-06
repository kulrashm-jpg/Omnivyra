/**
 * A4Y — the requested attribute set is part of enrichment work-item identity.
 *
 * A4T Blocker 3. A4N made the database the concurrency arbiter and keyed it on
 * (tenant, entity, provider). The attribute set was not in that key, so asking
 * one provider for `employee_count` and asking it for `founded_year` about the
 * same account were treated as ONE work item. Three live consequences:
 *
 *   1. the second set was rejected outright while the first was open;
 *   2. the A4A attempt-number index has the same gap, so distinguishing sets in
 *      the live index alone would still collide both at attempt 1;
 *   3. reclaim carried no attribute predicate, so a worker executing
 *      `[founded_year]` could TAKE OVER an abandoned attempt whose row said
 *      `[employee_count]` — leaving a record that misreports what was asked.
 *
 * (3) is the sharp one: a refusal is visible, silent misattribution is not.
 *
 * This file models the deployed table faithfully — both unique index families,
 * the canonical CHECK, and the reclaim predicate with PostgreSQL's real NULL
 * semantics — and drives the REAL `recordAttempt`, `claimEnrichmentWork`,
 * `reclaimExpiredAttempt` and `nextAttemptNumber` through it.
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

interface Row {
  id: string;
  organization_id: string;
  person_id: string | null;
  account_id: string | null;
  provider_key: string;
  requested_attributes: string[];
  attempt_number: number;
  correlation_id: string;
  claimed_by: string | null;
  claimed_until: string | null;
  started_at: string;
  completed_at: string | null;
  provider_call_state: string;
  provider_called: boolean;
  outcome: string | null;
  source_record_id: string | null;
  attributes_returned: string[] | null;
}

const rows: Row[] = [];
/** Every write payload the table received, so write SCOPE is assertable. */
const writes: { op: 'insert' | 'update'; payload: Record<string, unknown> }[] = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    // The real column is `text[]`; equality is order-, duplicate- and
    // whitespace-sensitive, which is exactly why canonical form exists.
    const literal = (v: string[]): string =>
      v.length ? `{${v.map((e) => `"${e.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}` : '{}';
    const isCanonical = (v: unknown): boolean => {
      if (!Array.isArray(v)) return false;
      if (v.some((e) => typeof e !== 'string' || e === '' || e.trim() !== e)) return false;
      const deduped = [...new Set(v as string[])];
      const sorted = [...deduped].sort();
      return deduped.length === v.length && sorted.every((e, i) => e === (v as string[])[i]);
    };

    const preds: ((r: Row) => boolean)[] = [];
    let mode: 'select' | 'insert' | 'update' = 'select';
    let payload: Record<string, unknown> = {};
    let limit = 1000;

    const err = (code: string, message: string) => Object.assign(new Error(message), { code });
    const q: Record<string, unknown> = {};

    q.insert = (p: Record<string, unknown>) => { mode = 'insert'; payload = p; return q; };
    q.update = (p: Record<string, unknown>) => { mode = 'update'; payload = p; return q; };
    q.select = () => q;
    q.eq = (col: string, val: unknown) => { preds.push((r) => (r as never as Record<string, unknown>)[col] === val); return q; };
    q.is = (col: string, val: unknown) => { preds.push((r) => (r as never as Record<string, unknown>)[col] === val); return q; };
    q.lt = (col: string, val: string) => {
      // PostgreSQL: a comparison against NULL yields NULL → NOT MATCHED.
      preds.push((r) => {
        const held = (r as never as Record<string, unknown>)[col] as string | null;
        return held !== null && Date.parse(held) < Date.parse(val);
      });
      return q;
    };
    q.filter = (col: string, op: string, val: string) => {
      preds.push((r) => op === 'eq' && literal((r as never as Record<string, unknown>)[col] as string[]) === val);
      return q;
    };
    q.or = (expr: string) => {
      // Only the shape A4U composes: expired lease, OR unleased-and-stale.
      const now = /claimed_until\.lt\.([^,]+)/.exec(expr)?.[1];
      const before = /started_at\.lt\.([^)]+)\)/.exec(expr)?.[1];
      preds.push((r) => (
        (r.claimed_until !== null && now !== undefined && Date.parse(r.claimed_until) < Date.parse(now))
        || (r.claimed_until === null && before !== undefined && Date.parse(r.started_at) < Date.parse(before))
      ));
      return q;
    };
    q.order = () => q;
    q.limit = (n: number) => { limit = n; return q; };

    const insert = () => {
      const attrs = payload.requested_attributes as string[];
      // The DB-enforced canonical CHECK.
      if (!isCanonical(attrs)) {
        throw err('23514', 'violates check constraint "prospect_enrichment_attempts_attributes_canonical"');
      }
      const leg = (r: Row) => (payload.person_id ? r.person_id : r.account_id);
      const entity = (payload.person_id ?? payload.account_id) as string;
      const sameWorkItem = (r: Row) => r.organization_id === payload.organization_id
        && leg(r) === entity
        && r.provider_key === payload.provider_key
        && literal(r.requested_attributes) === literal(attrs);
      // A4N live index — one OPEN attempt per work item.
      if (rows.some((r) => sameWorkItem(r) && r.completed_at === null)) {
        throw err('23505', 'duplicate key value violates unique constraint "..._live"');
      }
      // A4A attempt-number index — now scoped to the work item too.
      if (rows.some((r) => sameWorkItem(r) && r.attempt_number === payload.attempt_number)) {
        throw err('23505', 'duplicate key value violates unique constraint "..._unique"');
      }
      const row: Row = {
        id: `attempt-${rows.length + 1}`,
        person_id: null, account_id: null, completed_at: null,
        claimed_by: null, claimed_until: null,
        provider_call_state: 'not_called', provider_called: false,
        outcome: null, source_record_id: null, attributes_returned: null,
        ...(payload as unknown as Row),
      };
      rows.push(row);
      writes.push({ op: 'insert', payload });
      return row.id;
    };

    q.single = async () => {
      try { return { data: { id: insert() }, error: null }; } catch (e) { throw e; }
    };
    q.then = (resolve: (v: unknown) => unknown) => {
      if (mode === 'update') {
        const hit = rows.filter((r) => preds.every((p) => p(r)));
        hit.forEach((r) => Object.assign(r, payload));
        writes.push({ op: 'update', payload });
        return Promise.resolve({ data: hit.map((r) => ({ id: r.id, attempt_number: r.attempt_number })), error: null }).then(resolve);
      }
      const out = rows.filter((r) => preds.every((p) => p(r)))
        .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
      return Promise.resolve({ data: out.slice(0, limit), error: null }).then(resolve);
    };
    return q;
  },
}));

import {
  canonicalAttributeSet, isCanonicalAttributeSet, compareUtf8Bytes,
  toPgTextArrayLiteral, NonCanonicalAttributeError,
} from '../../services/enrichment/attributeSet';
import {
  recordAttempt, claimEnrichmentWork, reclaimExpiredAttempt,
  nextAttemptNumber, listAttempts,
} from '../../services/enrichment/attempts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const PERSON = '44444444-4444-4444-8444-444444444444';
const PROVIDER = 'clearbit';

const SET_A = ['employee_count'];
const SET_B = ['founded_year'];
const SET_AB = ['employee_count', 'founded_year'];

const STARTED_OLD = '2026-09-06T10:00:00.000Z';
const NOW = '2026-09-06T12:00:00.000Z';
const CUTOFF = '2026-09-06T11:30:00.000Z';
const LEASE_EXPIRED = '2026-09-06T11:00:00.000Z';
const LEASE_ACTIVE = '2026-09-06T12:05:00.000Z';
const NEW_LEASE = '2026-09-06T12:01:00.000Z';

beforeEach(() => { rows.length = 0; writes.length = 0; });

const open = (over: Record<string, unknown> = {}) => recordAttempt({
  organizationId: ORG_A, subject: 'account', entityId: ACCOUNT, providerId: PROVIDER,
  requestedAttributes: SET_A, correlationId: 'corr-1', attemptNumber: 1,
  startedAt: STARTED_OLD, ...over,
} as never);

const claim = (over: Record<string, unknown> = {}) => claimEnrichmentWork({
  organizationId: ORG_A, subject: 'account', entityId: ACCOUNT, providerId: PROVIDER,
  requestedAttributes: SET_A, correlationId: 'corr-c', attemptNumber: 1,
  startedAt: NOW, claimedBy: 'worker-1', claimedUntil: LEASE_ACTIVE, ...over,
} as never);

const reclaim = (over: Record<string, unknown> = {}) => reclaimExpiredAttempt({
  organizationId: ORG_A, subject: 'account', entityId: ACCOUNT, providerId: PROVIDER,
  requestedAttributes: SET_A, claimedBy: 'worker-2', claimedUntil: NEW_LEASE, now: NOW,
  ...over,
} as never);

// ── §9 normalisation matrix ────────────────────────────────────────────────

describe('A4Y — canonical attribute set', () => {
  it('both orderings collapse to ONE canonical set', () => {
    expect(canonicalAttributeSet(['employee_count', 'founded_year']))
      .toEqual(canonicalAttributeSet(['founded_year', 'employee_count']));
    expect(canonicalAttributeSet(['founded_year', 'employee_count']))
      .toEqual(['employee_count', 'founded_year']);
  });

  it('duplicates collapse deterministically', () => {
    expect(canonicalAttributeSet(['employee_count', 'employee_count'])).toEqual(['employee_count']);
  });

  it('a whitespace-padded attribute is REJECTED, never repaired', () => {
    expect(() => canonicalAttributeSet([' employee_count ']))
      .toThrow(NonCanonicalAttributeError);
    // The critical half: it must not silently become the valid key.
    expect(() => canonicalAttributeSet([' employee_count '])).toThrow(/whitespace/);
  });

  it('an empty attribute is rejected', () => {
    expect(() => canonicalAttributeSet([''])).toThrow(NonCanonicalAttributeError);
  });

  it('the empty set stays an empty array, never null', () => {
    expect(canonicalAttributeSet([])).toEqual([]);
    expect(canonicalAttributeSet([])).not.toBeNull();
  });

  it('non-string and non-array input is refused at the TypeScript boundary', () => {
    expect(() => canonicalAttributeSet([1 as never])).toThrow(NonCanonicalAttributeError);
    expect(() => canonicalAttributeSet([null as never])).toThrow(NonCanonicalAttributeError);
    expect(() => canonicalAttributeSet([undefined as never])).toThrow(NonCanonicalAttributeError);
    expect(() => canonicalAttributeSet(['ok', {} as never])).toThrow(NonCanonicalAttributeError);
    expect(() => canonicalAttributeSet('employee_count' as never)).toThrow(NonCanonicalAttributeError);
    expect(() => canonicalAttributeSet(null as never)).toThrow(NonCanonicalAttributeError);
  });

  it('no case folding, and no vocabulary knowledge', () => {
    // Case is preserved: 'Employee_Count' is a DIFFERENT string, and whether it
    // is a real attribute is the capability layer's question, not this one's.
    expect(canonicalAttributeSet(['Employee_Count'])).toEqual(['Employee_Count']);
    expect(canonicalAttributeSet(['not_a_real_attribute'])).toEqual(['not_a_real_attribute']);
  });

  it('sorts by UTF-8 byte order, matching COLLATE "C"', () => {
    // '_' is 0x5F and 'a' is 0x61, so '_x' precedes 'ax' in both halves.
    expect(canonicalAttributeSet(['ax', '_x'])).toEqual(['_x', 'ax']);
    expect(compareUtf8Bytes('_x', 'ax')).toBeLessThan(0);
    expect(compareUtf8Bytes('employee_count', 'founded_year')).toBeLessThan(0);
    expect(compareUtf8Bytes('a', 'a')).toBe(0);
    // Byte order and UTF-16 code-unit order diverge here; bytes must win.
    expect(compareUtf8Bytes('０', '\u{1F600}')).toBeLessThan(0);
  });

  it('isCanonicalAttributeSet recognises exactly the storable forms', () => {
    expect(isCanonicalAttributeSet(['employee_count', 'founded_year'])).toBe(true);
    expect(isCanonicalAttributeSet([])).toBe(true);
    expect(isCanonicalAttributeSet(['founded_year', 'employee_count'])).toBe(false);
    expect(isCanonicalAttributeSet(['a', 'a'])).toBe(false);
    expect(isCanonicalAttributeSet([' a '])).toBe(false);
  });

  it('renders a PostgreSQL array literal that survives commas and quotes', () => {
    expect(toPgTextArrayLiteral([])).toBe('{}');
    expect(toPgTextArrayLiteral(['employee_count', 'founded_year']))
      .toBe('{"employee_count","founded_year"}');
    expect(toPgTextArrayLiteral(['a,b'])).toBe('{"a,b"}');
    expect(toPgTextArrayLiteral(['a"b'])).toBe('{"a\\"b"}');
    expect(toPgTextArrayLiteral(['a\\b'])).toBe('{"a\\\\b"}');
  });
});

// ── §5 recordAttempt stores canonical form only ────────────────────────────

describe('A4Y — recordAttempt persists one representation', () => {
  it('the two orderings produce the SAME stored identity', async () => {
    await open({ requestedAttributes: ['employee_count', 'founded_year'] });
    rows.length = 0;
    await open({ requestedAttributes: ['founded_year', 'employee_count'] });
    expect(rows[0].requested_attributes).toEqual(['employee_count', 'founded_year']);
  });

  it('duplicates collapse before insert', async () => {
    await open({ requestedAttributes: ['employee_count', 'employee_count'] });
    expect(rows[0].requested_attributes).toEqual(['employee_count']);
  });

  it('a padded attribute is refused, and NOTHING is written', async () => {
    await expect(open({ requestedAttributes: [' employee_count '] }))
      .rejects.toThrow(NonCanonicalAttributeError);
    expect(rows).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it('the database refuses a non-canonical row even if the writer did not', async () => {
    // Proves the CHECK is load-bearing rather than decorative: a writer that
    // skipped canonicalisation is rejected by the table, not admitted.
    const { ownedDbTable } = require('../../db/writeOwner');
    await expect(
      ownedDbTable('prospect_enrichment_attempts').insert({
        organization_id: ORG_A, account_id: ACCOUNT, provider_key: PROVIDER,
        requested_attributes: ['founded_year', 'employee_count'],   // unsorted
        attempt_number: 1, correlation_id: 'c', started_at: STARTED_OLD,
      }).select('id').single(),
    ).rejects.toMatchObject({ code: '23514' });
    expect(rows).toHaveLength(0);
  });
});

// ── §8 identity case matrix ────────────────────────────────────────────────

describe('A4Y — work-item identity matrix', () => {
  it('Case A — same tenant/entity/provider/set: ONE active attempt', async () => {
    const first = await claim();
    const second = await claim({ claimedBy: 'worker-2' });
    expect(first).toMatchObject({ claimed: true });
    // The loser is refused: the holder's lease is still active.
    expect(second).toMatchObject({ claimed: false, reason: 'held_by_another_worker' });
    expect(rows.filter((r) => r.completed_at === null)).toHaveLength(1);
  });

  it('Case B — same tenant/entity/provider, DIFFERENT sets: TWO active attempts', async () => {
    const a = await claim({ requestedAttributes: SET_A });
    const b = await claim({ requestedAttributes: SET_B, claimedBy: 'worker-2' });
    expect(a).toMatchObject({ claimed: true });
    expect(b).toMatchObject({ claimed: true });          // the defect: was refused
    expect(rows.filter((r) => r.completed_at === null)).toHaveLength(2);
  });

  it('Case B — a superset is a different work item too', async () => {
    await claim({ requestedAttributes: SET_A });
    const superset = await claim({ requestedAttributes: SET_AB, claimedBy: 'worker-2' });
    expect(superset).toMatchObject({ claimed: true });
    expect(rows.filter((r) => r.completed_at === null)).toHaveLength(2);
  });

  it('Case B — but the SAME set in a different ORDER is the same work item', async () => {
    await claim({ requestedAttributes: ['employee_count', 'founded_year'] });
    const same = await claim({ requestedAttributes: ['founded_year', 'employee_count'], claimedBy: 'w2' });
    expect(same).toMatchObject({ claimed: false });
    expect(rows.filter((r) => r.completed_at === null)).toHaveLength(1);
  });

  it('Case C — different tenants, same entity/provider/set: both proceed', async () => {
    const a = await claim({ organizationId: ORG_A });
    const b = await claim({ organizationId: ORG_B, claimedBy: 'worker-2' });
    expect(a).toMatchObject({ claimed: true });
    expect(b).toMatchObject({ claimed: true });
    expect(rows).toHaveLength(2);
  });

  it('Case D — person vs account, same tenant/provider/set: no collision', async () => {
    const acct = await claim({ subject: 'account', entityId: ACCOUNT });
    const pers = await claim({ subject: 'person', entityId: PERSON, claimedBy: 'worker-2' });
    expect(acct).toMatchObject({ claimed: true });
    expect(pers).toMatchObject({ claimed: true });
    expect(rows).toHaveLength(2);
    expect(rows[0].account_id).toBe(ACCOUNT);
    expect(rows[1].person_id).toBe(PERSON);
  });
});

// ── §10 reclaim matrix ─────────────────────────────────────────────────────

describe('A4Y — reclaim takes over the SAME work item or none', () => {
  const abandoned = async (attrs: string[], over: Record<string, unknown> = {}) => {
    await open({ requestedAttributes: attrs, ...over });
    rows[rows.length - 1].claimed_until = LEASE_EXPIRED;
    rows[rows.length - 1].claimed_by = 'dead-worker';
  };

  it('same canonical set → reclaim succeeds', async () => {
    await abandoned(SET_A);
    expect(await reclaim({ requestedAttributes: SET_A })).not.toBeNull();
    expect(rows[0].claimed_by).toBe('worker-2');
  });

  it('same values in a different input order → reclaim succeeds', async () => {
    await abandoned(['employee_count', 'founded_year']);
    expect(await reclaim({ requestedAttributes: ['founded_year', 'employee_count'] })).not.toBeNull();
  });

  it('a DIFFERENT set → refused (the cross-work-item steal)', async () => {
    await abandoned(SET_A);
    expect(await reclaim({ requestedAttributes: SET_B })).toBeNull();
    expect(rows[0].claimed_by).toBe('dead-worker');       // untouched
  });

  it('a SUBSET → refused', async () => {
    await abandoned(SET_AB);
    expect(await reclaim({ requestedAttributes: SET_A })).toBeNull();
  });

  it('a SUPERSET → refused', async () => {
    await abandoned(SET_A);
    expect(await reclaim({ requestedAttributes: SET_AB })).toBeNull();
  });

  it('a different provider → refused', async () => {
    await abandoned(SET_A);
    expect(await reclaim({ providerId: 'other-provider' })).toBeNull();
  });

  it('a different tenant → refused', async () => {
    await abandoned(SET_A);
    expect(await reclaim({ organizationId: ORG_B })).toBeNull();
  });

  it('person cannot reclaim an account attempt of the same set', async () => {
    await abandoned(SET_A);
    expect(await reclaim({ subject: 'person', entityId: PERSON })).toBeNull();
  });

  it('a completed attempt is never reclaimed', async () => {
    await abandoned(SET_A);
    rows[0].completed_at = NOW;
    expect(await reclaim({ requestedAttributes: SET_A })).toBeNull();
  });

  it('A4U stale-unleased recovery still works, and only for the same set', async () => {
    await open({ requestedAttributes: SET_A });          // unleased, started old
    expect(await reclaim({ requestedAttributes: SET_B, abandonedBefore: CUTOFF })).toBeNull();
    expect(await reclaim({ requestedAttributes: SET_A, abandonedBefore: CUTOFF })).not.toBeNull();
  });

  it('A4U: an ACTIVE unleased execution is still not taken merely for lacking a lease', async () => {
    await open({ requestedAttributes: SET_A, startedAt: '2026-09-06T11:59:00.000Z' });
    expect(await reclaim({ requestedAttributes: SET_A, abandonedBefore: CUTOFF })).toBeNull();
  });

  it('B3 — every provider-call state survives reclaim unchanged', async () => {
    for (const state of ['not_called', 'called', 'unknown']) {
      rows.length = 0;
      await abandoned(SET_A);
      rows[0].provider_call_state = state;
      rows[0].provider_called = state === 'called';
      rows[0].outcome = state === 'called' ? 'no_match' : null;
      await reclaim({ requestedAttributes: SET_A });
      expect(rows[0].provider_call_state).toBe(state);
      expect(rows[0].provider_called).toBe(state === 'called');
      expect(rows[0].outcome).toBe(state === 'called' ? 'no_match' : null);
    }
  });

  it('`unknown` is never downgraded to not_called', async () => {
    await abandoned(SET_A);
    rows[0].provider_call_state = 'unknown';
    await reclaim({ requestedAttributes: SET_A });
    expect(rows[0].provider_call_state).not.toBe('not_called');
    expect(rows[0].provider_call_state).toBe('unknown');
  });

  it('reclaim writes ONLY ownership — the question asked is immutable', async () => {
    await abandoned(SET_AB);
    rows[0].correlation_id = 'corr-original';
    await reclaim({ requestedAttributes: SET_AB });
    const update = writes.filter((w) => w.op === 'update').pop()!;
    expect(Object.keys(update.payload).sort()).toEqual(['claimed_by', 'claimed_until']);
    // requested_attributes above all: reclaim moves ownership, not the question.
    expect(rows[0].requested_attributes).toEqual(SET_AB);
    expect(rows[0].correlation_id).toBe('corr-original');
    expect(rows[0].attempt_number).toBe(1);
    expect(rows[0].started_at).toBe(STARTED_OLD);
  });
});

// ── §11 retry / attempt-number matrix ──────────────────────────────────────

describe('A4Y — attempt numbers are per work item', () => {
  const complete = () => { rows[rows.length - 1].completed_at = NOW; };

  it('set A and set B each start at attempt 1', async () => {
    expect(await nextAttemptNumber({
      organizationId: ORG_A, subject: 'account', entityId: ACCOUNT,
      providerId: PROVIDER, requestedAttributes: SET_A,
    })).toBe(1);
    await open({ requestedAttributes: SET_A, attemptNumber: 1 });
    complete();
    expect(await nextAttemptNumber({
      organizationId: ORG_A, subject: 'account', entityId: ACCOUNT,
      providerId: PROVIDER, requestedAttributes: SET_B,
    })).toBe(1);                                   // NOT 2 — a different work item
  });

  it('a retry of the same set increments', async () => {
    await open({ requestedAttributes: SET_A, attemptNumber: 1 });
    complete();
    expect(await nextAttemptNumber({
      organizationId: ORG_A, subject: 'account', entityId: ACCOUNT,
      providerId: PROVIDER, requestedAttributes: SET_A,
    })).toBe(2);
  });

  it('all four histories coexist: A#1, A#2, B#1, B#2', async () => {
    for (const attrs of [SET_A, SET_B]) {
      await open({ requestedAttributes: attrs, attemptNumber: 1, startedAt: STARTED_OLD });
      complete();
      await open({ requestedAttributes: attrs, attemptNumber: 2, startedAt: NOW });
      complete();
    }
    expect(rows).toHaveLength(4);
    const key = rows.map((r) => `${r.requested_attributes.join('+')}#${r.attempt_number}`).sort();
    expect(key).toEqual([
      'employee_count#1', 'employee_count#2', 'founded_year#1', 'founded_year#2',
    ]);
  });

  it('the same set cannot reuse an attempt number', async () => {
    await open({ requestedAttributes: SET_A, attemptNumber: 1 });
    complete();
    await expect(open({ requestedAttributes: SET_A, attemptNumber: 1 }))
      .rejects.toMatchObject({ code: '23505' });
  });

  it('listAttempts narrows to one work item, and is unchanged when not asked to', async () => {
    await open({ requestedAttributes: SET_A, attemptNumber: 1 });
    complete();
    await open({ requestedAttributes: SET_B, attemptNumber: 1 });
    complete();
    const scoped = await listAttempts({
      organizationId: ORG_A, subject: 'account', entityId: ACCOUNT,
      providerId: PROVIDER, requestedAttributes: SET_A,
    });
    const all = await listAttempts({
      organizationId: ORG_A, subject: 'account', entityId: ACCOUNT, providerId: PROVIDER,
    });
    expect(scoped).toHaveLength(1);
    expect(all).toHaveLength(2);
  });
});

// ── concurrency, end to end ────────────────────────────────────────────────

describe('A4Y — concurrency is preserved per work item', () => {
  it('two concurrent set-A workers: exactly one wins', async () => {
    const out = await Promise.all([
      claim({ requestedAttributes: SET_A, claimedBy: 'w1' }),
      claim({ requestedAttributes: SET_A, claimedBy: 'w2' }),
    ]);
    expect(out.filter((o) => (o as { claimed: boolean }).claimed)).toHaveLength(1);
  });

  it('two concurrent set-B workers: exactly one wins', async () => {
    const out = await Promise.all([
      claim({ requestedAttributes: SET_B, claimedBy: 'w1' }),
      claim({ requestedAttributes: SET_B, claimedBy: 'w2' }),
    ]);
    expect(out.filter((o) => (o as { claimed: boolean }).claimed)).toHaveLength(1);
  });

  it('a set-A and a set-B worker concurrently: BOTH win their own claim', async () => {
    const out = await Promise.all([
      claim({ requestedAttributes: SET_A, claimedBy: 'w1' }),
      claim({ requestedAttributes: SET_B, claimedBy: 'w2' }),
    ]);
    expect(out.filter((o) => (o as { claimed: boolean }).claimed)).toHaveLength(2);
  });
});
