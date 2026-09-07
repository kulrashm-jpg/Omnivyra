/**
 * A7 — the retry consumer against the REAL executor and the REAL claim.
 *
 * The consumer's own suite observes ports. That proves it asks for the right
 * things in the right order, and nothing more: a port double will answer
 * whatever it is told to. This suite removes the doubles from the dangerous
 * half — `executePlannedField`, `executeEnrichmentRecorded`, `executeEnrichment`
 * and `claimEnrichmentWork` are all the real functions here — and drives them
 * against the same fake store A4N uses, which enforces both deployed indexes and
 * rejects with SQLSTATE 23505 exactly as PostgreSQL does.
 *
 * So the claims below are about what the SCHEDULER actually causes:
 *   - two workers on one work item ⇒ ONE provider call, ONE executable attempt;
 *   - the loser resolves no credential and authorises no cost;
 *   - an expired lease is reclaimed, without a duplicate attempt or call;
 *   - suppression still precedes cost and provider on the retry path;
 *   - the retry chain N → N+1 runs end to end, with the horizon coming from the
 *     provider rather than from the scheduler.
 *
 * SECRETS: all synthetic. No credential, no network, no real provider call.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => { throw new Error('no production table in this suite'); },
}));

import { runRetryCycle, type RetryConsumerPorts } from '../../services/enrichment/retryConsumer';
import type { RetryCandidateRow } from '../../services/enrichment/retryCandidates';
import { executePlannedField } from '../../services/enrichment/execution';
import { claimEnrichmentWork } from '../../services/enrichment/attempts';
import { getSource } from '../../services/enrichment/providers/sources';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type { EnrichmentProviderAdapter } from '../../services/enrichment/providers/contract';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const LEAD = 'lead-1';
const NOW = '2026-09-07T12:00:00.000Z';
const DUE = '2026-09-07T11:00:00.000Z';
/** An hour on: past a two-minute lease. */
const LATER = '2026-09-07T13:00:00.000Z';
const SECRET = 'synthetic-tenant-provider-key';

// ── the store that enforces the real indexes (A4N's, unchanged) ─────────────

interface Row {
  id: string; org: string; entity: string; provider: string; n: number;
  claimedBy: string | null; claimedUntil: string | null; completedAt: string | null;
}

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
    if (hit) hit.completedAt = NOW;
  };

  return { rows, record, reclaim, nextNumber, complete };
}

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

/** Records every provider call, and what the adapter was asked for. */
function adapter(calls: unknown[], outcome = 'enriched'): EnrichmentProviderAdapter {
  return {
    id: 'clearbit', label: 'Clearbit', supports: ['employee_count'],
    credentialEnvVar: 'CLEARBIT_API_KEY', isAvailable: () => false,
    async enrich(r) {
      calls.push(r);
      if (outcome !== 'enriched') {
        return { outcome, notReturned: ['employee_count'], fields: [], detail: 'synthetic' } as never;
      }
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

/** Production-shaped ports, each one instrumented so ORDER is observable. */
const ports = (trace: string[], over: Partial<ExecuteEnrichmentPorts> = {}): ExecuteEnrichmentPorts => ({
  authorizeCost: async () => {
    trace.push('cost');
    return { authorized: true, holdId: null, cost: { kind: 'unknown' } };
  },
  releaseCost: async () => { /* tenant-funded: nothing is reserved */ },
  resolveCredential: async () => { trace.push('credential'); return SECRET; },
  findRecentObservation: async () => { trace.push('suppression'); return null; },
  persistObservation: async () => {
    trace.push('persist');
    return { sourceRecordId: 'src-1', canonicalWithheld: [] };
  },
  now: () => NOW,
  ...over,
});

const PLANNED_FIELD = {
  attribute: 'employee_count', subject: 'account', state: 'missing',
  requiredForNextAction: false, action: 'enrich', source: 'clearbit',
  sourceStatus: 'available', cost: { kind: 'unknown' }, reason: 'absent',
};
const PLAN = {
  organizationId: ORG, prospectId: LEAD, version: 'ws2.1', generatedAt: NOW,
  fields: [PLANNED_FIELD], toEnrich: [PLANNED_FIELD], counts: {}, empty: false,
};
const SNAPSHOT = {
  personId: null, accountId: ACCOUNT, person: null,
  account: { id: ACCOUNT, status: 'active', domain_normalized: 'northwind.test' },
};
const STATUSES = [{
  ...(getSource('clearbit') as NonNullable<ReturnType<typeof getSource>>),
  connectionState: 'connected', usable: true, stateReason: 'ok',
}];

const CANDIDATE: RetryCandidateRow = {
  attemptId: 'att-1', organizationId: ORG, subject: 'account', entityId: ACCOUNT,
  providerKey: 'clearbit', requestedAttributes: ['employee_count'], attemptNumber: 1,
  correlationId: 'corr-a7', outcome: 'rate_limited', executionStatus: 'completed',
  providerCallState: 'called', completedAt: DUE, nextRetryAt: DUE,
} as RetryCandidateRow;

/**
 * Consumer ports whose `execute` is the REAL `executePlannedField`, bound to the
 * real recorder and the real claim. Only the database and the provider are fake.
 */
function realPorts(input: {
  s: ReturnType<typeof store>;
  calls: unknown[];
  trace: string[];
  now?: string;
  outcome?: string;
  executePorts?: ExecuteEnrichmentPorts;
}): RetryConsumerPorts {
  return {
    listCandidates: async () => [CANDIDATE],
    resolveProspect: async () => LEAD,
    plan: async () => ({ plan: PLAN as never, snapshot: SNAPSHOT as never }),
    statuses: async () => STATUSES as never,
    execute: (i) => executePlannedField({
      ...i,
      adapter: adapter(input.calls, input.outcome ?? 'enriched'),
      recorder: recorder(input.s, input.now ?? NOW),
    } as never, (input.executePorts ?? ports(input.trace)) as never) as never,
    emit: () => { /* asserted in the consumer suite */ },
  };
}

const cycle = (p: RetryConsumerPorts, workerId: string, now = NOW) =>
  runRetryCycle({ organizationId: ORG, workerId, now }, p);

// ── concurrency ──────────────────────────────────────────────────────────────

describe('A7 — two scheduler workers on one work item', () => {
  it('produce ONE provider call and ONE executable attempt', async () => {
    const s = store();
    const calls: unknown[] = [];
    const trace: string[] = [];
    const [a, b] = await Promise.all([
      cycle(realPorts({ s, calls, trace }), 'worker-A'),
      cycle(realPorts({ s, calls, trace }), 'worker-B'),
    ]);

    expect(calls).toHaveLength(1);
    expect(a.executed + b.executed).toBe(1);
    // The loser recorded a refusal, not a failure.
    expect((a.skipped.claim_lost ?? 0) + (b.skipped.claim_lost ?? 0)).toBe(1);
    // One live row for the work item — no second attempt number was taken.
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].claimedBy).toBeTruthy();
  });

  it('the loser resolves NO credential and authorises NO cost', async () => {
    const s = store();
    const calls: unknown[] = [];
    const winnerTrace: string[] = [];
    // The winner claims and dies mid-flight, so its lease is still live below.
    const holdOpen = { ...recorder(s), complete: async () => { /* died */ } };
    await runRetryCycle({ organizationId: ORG, workerId: 'worker-A', now: NOW }, {
      ...realPorts({ s, calls, trace: winnerTrace }),
      execute: (i) => executePlannedField({
        ...i, adapter: adapter(calls), recorder: holdOpen,
      } as never, ports(winnerTrace) as never) as never,
    });
    calls.length = 0;

    const loserTrace: string[] = [];
    const summary = await cycle(realPorts({ s, calls, trace: loserTrace }), 'worker-B');

    expect(summary.executed).toBe(0);
    expect(summary.skipped.claim_lost).toBe(1);
    expect(calls).toHaveLength(0);
    // Nothing downstream of the claim ran for the loser — the claim is the gate.
    expect(loserTrace).toEqual([]);
  });

  it('an expired lease is reclaimed by the next worker, with no duplicate', async () => {
    const s = store();
    const calls: unknown[] = [];
    // Worker A claims at 12:00 with a 2-minute lease and never completes.
    await claimEnrichmentWork({
      organizationId: ORG, subject: 'account', entityId: ACCOUNT, providerId: 'clearbit',
      requestedAttributes: ['employee_count'], correlationId: 'corr-a7',
      attemptNumber: 1, startedAt: NOW,
      claimedBy: 'worker-A', claimedUntil: '2026-09-07T12:02:00.000Z',
      ports: { record: s.record as never, reclaim: s.reclaim as never },
    } as never);
    expect(s.rows).toHaveLength(1);

    const trace: string[] = [];
    const summary = await cycle(
      realPorts({ s, calls, trace, now: LATER }), 'worker-B', LATER);

    expect(summary.executed).toBe(1);
    expect(calls).toHaveLength(1);
    // Taken over, not duplicated.
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].claimedBy).toBe('worker-B');
  });
});

// ── the safety ordering survives the retry path ──────────────────────────────

describe('A7 — a retry passes every control, in the established order', () => {
  it('claim → credential → suppression → cost → provider → persist', async () => {
    const s = store();
    const calls: unknown[] = [];
    const trace: string[] = [];
    const summary = await cycle(realPorts({ s, calls, trace }), 'worker-A');

    expect(summary.executed).toBe(1);
    expect(trace).toEqual(['credential', 'suppression', 'cost', 'persist']);
    // The claim precedes all of them: the attempt row exists before the first.
    expect(s.rows[0].claimedBy).toBe('worker-A');
    expect(calls).toHaveLength(1);
  });

  it('a retry that is now a duplicate is suppressed BEFORE cost and provider', async () => {
    const s = store();
    const calls: unknown[] = [];
    const trace: string[] = [];
    const summary = await cycle({
      ...realPorts({
        s, calls, trace,
        executePorts: ports(trace, {
          findRecentObservation: async () => {
            trace.push('suppression');
            return { sourceRecordId: 'src-existing', observedAt: NOW } as never;
          },
        }),
      }),
    }, 'worker-A');

    expect(summary.outcomes.duplicate_suppressed).toBe(1);
    expect(calls).toHaveLength(0);                    // no provider call
    expect(trace).toEqual(['credential', 'suppression']);
    expect(trace).not.toContain('cost');              // and nothing was authorised
  });

  it('a cost refusal stops the retry before the provider', async () => {
    const s = store();
    const calls: unknown[] = [];
    const trace: string[] = [];
    const summary = await cycle({
      ...realPorts({
        s, calls, trace,
        executePorts: ports(trace, {
          authorizeCost: async () => {
            trace.push('cost');
            return { authorized: false, holdId: null, cost: { kind: 'unknown' }, reason: 'no budget' } as never;
          },
        }),
      }),
    }, 'worker-A');

    expect(summary.outcomes.cost_denied).toBe(1);
    expect(calls).toHaveLength(0);
    expect(trace).toEqual(['credential', 'suppression', 'cost']);
  });
});

// ── chaining ─────────────────────────────────────────────────────────────────

describe('A7 — attempt N to attempt N+1', () => {
  it('a retryable outcome closes the attempt and leaves the chain open', async () => {
    const s = store();
    const calls: unknown[] = [];
    const trace: string[] = [];
    const summary = await cycle(
      realPorts({ s, calls, trace, outcome: 'rate_limited' }), 'worker-A');

    expect(summary.outcomes.rate_limited).toBe(1);
    // The attempt finished, so the live slot is free for the next one.
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].completedAt).not.toBeNull();
  });

  it('the next cycle takes attempt N+1 on the freed work item', async () => {
    const s = store();
    const calls: unknown[] = [];
    const trace: string[] = [];
    await cycle(realPorts({ s, calls, trace, outcome: 'rate_limited' }), 'worker-A');
    await cycle(realPorts({ s, calls, trace }), 'worker-A');

    expect(calls).toHaveLength(2);
    expect(s.rows).toHaveLength(2);
    // Append-only: attempt 1 is untouched history, attempt 2 is the new execution.
    expect(s.rows.map((r) => r.n)).toEqual([1, 2]);
    expect(s.rows[0].completedAt).not.toBeNull();
  });

  it('the scheduler never supplies a horizon — only the provider can', async () => {
    const s = store();
    const calls: unknown[] = [];
    const trace: string[] = [];
    await cycle(realPorts({ s, calls, trace }), 'worker-A');
    // What reached the adapter is the enrichment request, and it carries no
    // retry instruction of any kind.
    const request = JSON.stringify(calls[0]);
    expect(request).not.toContain('retry');
    expect(request).not.toContain('nextRetryAt');
  });
});
