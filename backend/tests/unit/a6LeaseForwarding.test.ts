/**
 * A6C — the lease reaches the claim through `executePlannedField`.
 *
 * WHAT WAS MISSING. `executeEnrichmentRecorded` has always accepted
 * `options.lease` and `claimEnrichmentWork` has always performed the atomic
 * claim, but `executePlannedField` forwarded four options and not that one.
 * Every production caller reaches enrichment through the plan, so every one of
 * them could only ever run UNLEASED, governed by `requireAttemptRecord` alone.
 *
 * WHY THE WEAKER GUARANTEE IS NOT ENOUGH FOR AN AUTOMATED CALLER.
 * `requireAttemptRecord` guarantees no provider call happens WITHOUT an attempt
 * row: the loser of a race is refused before egress, which is the right answer
 * for a user-initiated request where a person sees the error. It does not
 * prevent the race, and it says nothing about a process that dies mid-flight —
 * the row stays open with no lease and, absent a cutoff, nobody may take it.
 * A lease answers both: exactly one worker proceeds, and expiry makes abandoned
 * work reclaimable.
 *
 * WHAT THIS SUITE PROVES, AND HOW. It drives the REAL
 * `executeEnrichmentRecorded` and the REAL `claimEnrichmentWork` through
 * `executePlannedField`, against the same fake store A4N uses — which enforces
 * both deployed indexes and rejects with SQLSTATE 23505 exactly as PostgreSQL
 * does. These are therefore behavioural claims about the plan route, not
 * assertions that an object was handed to a mock: delete the forwarding line
 * and the race and reclaim tests fail, because the claim is never reached.
 *
 * Scope: forwarding only. The claim itself, the lease semantics and the
 * reclaim path are A4N's and A4U's, and are untouched here.
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => { throw new Error('no production table in this suite'); },
}));

import { executePlannedField } from '../../services/enrichment/execution';
import { claimEnrichmentWork } from '../../services/enrichment/attempts';
import { getSource } from '../../services/enrichment/providers/sources';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type { EnrichmentProviderAdapter } from '../../services/enrichment/providers/contract';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-06T12:00:00.000Z';
/** An hour on: past a one-minute lease. */
const LATER = '2026-09-06T13:00:00.000Z';
const SECRET = 'synthetic-tenant-provider-key';

// ── a store that enforces the real indexes (A4N's, unchanged) ───────────────

interface Row {
  id: string; org: string; entity: string; provider: string; n: number;
  claimedBy: string | null; claimedUntil: string | null; completedAt: string | null;
}

/**
 * Enforces BOTH deployed constraints:
 *   - `(org, entity, provider, attempt_number)`            — A4A numbering
 *   - `(org, entity, provider) WHERE completed_at IS NULL` — A4N live slot
 * and rejects with SQLSTATE 23505, exactly as PostgreSQL does.
 */
function store() {
  const rows: Row[] = [];
  const dup = () => Object.assign(
    new Error('duplicate key value violates unique constraint'), { code: '23505' });

  const record = async (i: {
    organizationId: string; entityId: string; providerId: string;
    attemptNumber: number; claimedBy?: string; claimedUntil?: string;
  }) => {
    const same = (r: Row) => r.org === i.organizationId && r.entity === i.entityId
      && r.provider === i.providerId;
    if (rows.some((r) => same(r) && r.n === i.attemptNumber)) throw dup();
    if (rows.some((r) => same(r) && r.completedAt === null)) throw dup();   // the live index
    const row: Row = {
      id: `attempt-${rows.length + 1}`, org: i.organizationId, entity: i.entityId,
      provider: i.providerId, n: i.attemptNumber,
      claimedBy: i.claimedBy ?? null, claimedUntil: i.claimedUntil ?? null, completedAt: null,
    };
    rows.push(row);
    return { attemptId: row.id };
  };

  /** The conditional UPDATE: expiry is re-checked in the predicate. */
  const reclaim = async (i: {
    organizationId: string; entityId: string; providerId: string;
    claimedBy: string; claimedUntil: string; now: string;
  }) => {
    const hit = rows.find((r) => r.org === i.organizationId && r.entity === i.entityId
      && r.provider === i.providerId && r.completedAt === null
      && r.claimedUntil !== null && Date.parse(r.claimedUntil) < Date.parse(i.now));
    if (!hit) return null;
    hit.claimedBy = i.claimedBy;
    hit.claimedUntil = i.claimedUntil;
    return { attemptId: hit.id, attemptNumber: hit.n };
  };

  const nextNumber = async (i: { organizationId: string; entityId: string; providerId: string }) => {
    const mine = rows.filter((r) => r.org === i.organizationId && r.entity === i.entityId
      && r.provider === i.providerId);
    return mine.length ? Math.max(...mine.map((r) => r.n)) + 1 : 1;
  };

  const complete = async (i: { attemptId: string }) => {
    const hit = rows.find((r) => r.id === i.attemptId);
    if (hit) hit.completedAt = NOW;             // leaves the live index
  };

  return { rows, record, reclaim, nextNumber, complete };
}

/** The recorder port set, wired to one store. `now` is per-worker on purpose. */
const recorder = (s: ReturnType<typeof store>, now: string = NOW) => ({
  now: () => now,
  nextNumber: s.nextNumber,
  record: s.record,
  complete: s.complete,
  markPending: async () => { /* proven in piA4qProviderCallState */ },
  claim: (i: Record<string, unknown>) => claimEnrichmentWork({
    ...i, ports: { record: s.record as never, reclaim: s.reclaim as never },
  } as never),
});

function adapter(calls: unknown[]): EnrichmentProviderAdapter {
  return {
    id: 'clearbit', label: 'Clearbit', supports: ['employee_count'],
    credentialEnvVar: 'CLEARBIT_API_KEY', isAvailable: () => false,
    async enrich(r) {
      calls.push(r);
      return {
        outcome: 'enriched', notReturned: [],
        fields: [{
          attribute: 'employee_count', subject: 'account', value: 240,
          observedAt: null, confidence: null, providerInferred: false,
        }],
      };
    },
  };
}

const ports = (over: Partial<ExecuteEnrichmentPorts> = {}): ExecuteEnrichmentPorts => ({
  authorizeCost: async () => ({ authorized: true, holdId: null, cost: { kind: 'unknown' } }),
  releaseCost: async () => { /* tenant-funded: nothing is reserved */ },
  resolveCredential: async () => SECRET,
  findRecentObservation: async () => null,
  persistObservation: async () => ({ sourceRecordId: 'src-1', canonicalWithheld: [] }),
  now: () => NOW,
  ...over,
});

// ── the plan-route fixtures ─────────────────────────────────────────────────

const PLAN = {
  version: 'test.1', organizationId: ORG, prospectId: 'prospect-1',
  toEnrich: [], fields: [], planned: [],
};
const FIELD = {
  attribute: 'employee_count', subject: 'account' as const, action: 'enrich' as const,
  source: 'clearbit', state: 'missing', reason: 'absent', requiredForNextAction: false,
  sourceStatus: 'available', cost: { kind: 'unknown' },
};
const SNAPSHOT = {
  personId: null, accountId: ACCOUNT, person: null,
  // `active` is required: the executor refuses `entity_not_active` for anything
  // else, and that gate sits upstream of the claim.
  account: { id: ACCOUNT, status: 'active', domain_normalized: 'northwind.test' },
};
// A `SourceStatus` IS the real descriptor plus its live state, so the real
// descriptor is used. A hand-written stub carries no `capabilities` and is
// refused by source selection long before the claim — and one that invented
// them could claim a capability Clearbit does not have.
const STATUSES = [{
  ...(getSource('clearbit') as NonNullable<ReturnType<typeof getSource>>),
  connectionState: 'connected', usable: true, stateReason: 'ok',
}];

const LEASE = { claimedBy: 'retry-worker-1', ttlMs: 60_000 };

const run = (over: Record<string, unknown> = {}, p: ExecuteEnrichmentPorts = ports()) =>
  executePlannedField({
    plan: PLAN as never, field: FIELD as never, snapshot: SNAPSHOT as never,
    statuses: STATUSES as never, correlationId: 'corr-a6c', ...over,
  } as never, p as never);

describe('A6C — a leased plan execution claims the work item', () => {
  it('one worker wins: two racing leased executions ⇒ ONE claim and ONE provider call', async () => {
    const s = store();
    const calls: unknown[] = [];
    const both = await Promise.allSettled([
      run({ adapter: adapter(calls), recorder: recorder(s), lease: LEASE }),
      run({ adapter: adapter(calls), recorder: recorder(s), lease: { ...LEASE, claimedBy: 'retry-worker-2' } }),
    ]);

    expect(calls).toHaveLength(1);
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    // The loser is REFUSED, not silently answered from the winner's result.
    const loser = both.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(loser.reason)).toMatch(/claim/i);
    // One row for the work item — the loser never got a second attempt number.
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].claimedBy).toBeTruthy();
  });

  it('the loser performs zero transport and never resolves a credential or a cost', async () => {
    const s = store();
    const calls: unknown[] = [];
    const spent: string[] = [];
    // The winner takes the slot and then dies mid-flight: its recorder never
    // completes the row, so its lease is still LIVE and unexpired below.
    const holdOpen = { ...recorder(s), complete: async () => { /* died mid-flight */ } };
    await run({ adapter: adapter(calls), recorder: holdOpen, lease: LEASE });
    calls.length = 0;

    const watched = ports({
      resolveCredential: async () => { spent.push('credential'); return SECRET; },
      authorizeCost: async () => {
        spent.push('cost');
        return { authorized: true, holdId: null, cost: { kind: 'unknown' } };
      },
    });
    await expect(run({
      adapter: adapter(calls), recorder: recorder(s),
      lease: { ...LEASE, claimedBy: 'retry-worker-2' },
    }, watched)).rejects.toThrow();

    expect(calls).toHaveLength(0);
    expect(spent).toEqual([]);
  });

  it('an expired lease is reclaimable: the abandoned work item can be taken again', async () => {
    const s = store();
    const calls: unknown[] = [];
    // Worker 1 claims and dies mid-flight: the row stays open, leased to 12:01.
    await claimEnrichmentWork({
      organizationId: ORG, subject: 'account', entityId: ACCOUNT, providerId: 'clearbit',
      requestedAttributes: ['employee_count'], correlationId: 'corr-a6c',
      attemptNumber: 1, startedAt: NOW,
      claimedBy: 'retry-worker-1', claimedUntil: '2026-09-06T12:01:00.000Z',
      ports: { record: s.record as never, reclaim: s.reclaim as never },
    } as never);
    expect(s.rows).toHaveLength(1);

    // An hour later a second worker runs the same planned field.
    const out = await run({
      adapter: adapter(calls), recorder: recorder(s, LATER),
      lease: { claimedBy: 'retry-worker-2', ttlMs: 60_000 },
    }) as { executed: boolean; outcome: string };

    expect(out.executed).toBe(true);
    expect(out.outcome).toBe('enriched');
    expect(calls).toHaveLength(1);
    // Taken over, not duplicated: still one row, now owned by worker 2.
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].claimedBy).toBe('retry-worker-2');
  });
});

describe('A6C — omitting the lease leaves the existing route exactly as it was', () => {
  it('an unleased plan execution writes no lease columns', async () => {
    const s = store();
    const calls: unknown[] = [];
    await run({ adapter: adapter(calls), recorder: recorder(s), requireAttemptRecord: true });
    expect(calls).toHaveLength(1);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].claimedBy).toBeNull();
    expect(s.rows[0].claimedUntil).toBeNull();
  });

  it('and is therefore NOT protected from the race — which is why the lease exists', async () => {
    const s = store();
    const calls: unknown[] = [];
    // A4A: the unleased path fails OPEN. Both workers reach the provider and
    // the second one's attempt row is lost to the live index. That behaviour is
    // preserved unchanged; the leased tests above are what replaces it.
    await Promise.all([
      run({ adapter: adapter(calls), recorder: recorder(s) }),
      run({ adapter: adapter(calls), recorder: recorder(s) }),
    ]);
    expect(calls).toHaveLength(2);
  });

  it('a caller that requires a record still fails closed when it cannot get one', async () => {
    const s = store();
    const calls: unknown[] = [];
    // Hold the live slot with a foreign open row, so recording is refused.
    await s.record({ organizationId: ORG, entityId: ACCOUNT, providerId: 'clearbit', attemptNumber: 99 });
    await expect(run({
      adapter: adapter(calls), recorder: recorder(s), requireAttemptRecord: true,
    })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('A6C — the claim it enables is the existing one, with no new locking', () => {
  it('claimEnrichmentWork still refuses a claim with no owner or no expiry', async () => {
    // The lease option is only a carrier; the guarantees live in the claim,
    // which validates its own inputs exactly as it did before.
    await expect(claimEnrichmentWork({
      organizationId: ORG, subject: 'account', entityId: ACCOUNT, providerId: 'clearbit',
      requestedAttributes: ['employee_count'], correlationId: 'c', attemptNumber: 1,
      startedAt: NOW, claimedBy: '  ', claimedUntil: '2026-09-06T12:01:00.000Z',
    } as never)).rejects.toThrow(/claimedBy is required/);

    await expect(claimEnrichmentWork({
      organizationId: ORG, subject: 'account', entityId: ACCOUNT, providerId: 'clearbit',
      requestedAttributes: ['employee_count'], correlationId: 'c', attemptNumber: 1,
      startedAt: NOW, claimedBy: 'w', claimedUntil: '',
    } as never)).rejects.toThrow(/claimedUntil is required/);
  });
});
