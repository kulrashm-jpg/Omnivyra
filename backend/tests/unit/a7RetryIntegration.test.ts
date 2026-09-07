/**
 * A7 — the reconciled retry path, end to end, with the doubles removed from the
 * dangerous half.
 *
 * The selector's own suite observes ports, which proves it asks for the right
 * things and nothing more. This suite removes the doubles from everything below
 * it: `consumeEnrichmentWork`, `decideEnrichmentAction`, `executeEnrichmentRecorded`,
 * `executeEnrichment` and `claimEnrichmentWork` are all the REAL functions here,
 * driven against the same fake store A4N uses — which enforces both deployed
 * indexes and rejects with SQLSTATE 23505 exactly as PostgreSQL does.
 *
 * So every claim below is about what the SCHEDULER actually causes once it is
 * wired to the mainline seams:
 *
 *   - the decision layer, not the scheduler, decides;
 *   - `unknown` transport reaches a human, never a provider;
 *   - a horizon that has not arrived waits;
 *   - a terminal outcome stops;
 *   - two workers on one item produce ONE provider call and ONE attempt;
 *   - the loser resolves no credential and authorises no cost;
 *   - an abandoned attempt is ADOPTED rather than duplicated;
 *   - suppression still precedes cost, and cost still precedes the provider.
 *
 * SECRETS: all synthetic. No credential, no network, no real provider call.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => { throw new Error('no production table in this suite'); },
}));

import { runRetryCycle, type RetryConsumerPorts } from '../../services/enrichment/retryConsumer';
import type { RetryCandidateRow } from '../../services/enrichment/retryCandidates';
import { consumeEnrichmentWork } from '../../services/enrichment/consumeEnrichmentWork';
import { claimEnrichmentWork, type EnrichmentAttemptRow } from '../../services/enrichment/attempts';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type { EnrichmentProviderAdapter } from '../../services/enrichment/providers/contract';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-07T12:00:00.000Z';
const DUE = '2026-09-07T11:00:00.000Z';
const FUTURE = '2026-09-07T13:00:00.000Z';
const LATER = '2026-09-07T14:00:00.000Z';
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

/** Production-shaped enrichment ports, instrumented so ORDER is observable. */
const enrichPorts = (trace: string[], over: Partial<ExecuteEnrichmentPorts> = {}): ExecuteEnrichmentPorts => ({
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

const attempt = (over: Partial<EnrichmentAttemptRow> = {}): EnrichmentAttemptRow => ({
  id: 'att-1', organizationId: ORG, subject: 'account', entityId: ACCOUNT,
  providerKey: 'clearbit', attemptNumber: 1, correlationId: 'corr-a7',
  outcome: 'rate_limited', providerCalled: true, providerCallState: 'called',
  executionStatus: 'completed', sourceRecordId: null,
  startedAt: DUE, completedAt: DUE, claimedBy: null, claimedUntil: null,
  nextRetryAt: DUE, requestedAttributes: ['employee_count'],
  ...over,
} as EnrichmentAttemptRow);

const CANDIDATE: RetryCandidateRow = {
  attemptId: 'att-1', organizationId: ORG, subject: 'account', entityId: ACCOUNT,
  providerKey: 'clearbit', requestedAttributes: ['employee_count'], attemptNumber: 1,
  correlationId: 'corr-a7', outcome: 'rate_limited', executionStatus: 'completed',
  providerCallState: 'called', completedAt: DUE, nextRetryAt: DUE,
} as RetryCandidateRow;

const cycle = (p: RetryConsumerPorts, workerId: string, now = NOW) =>
  runRetryCycle({ organizationId: ORG, workerId, now }, p);

/** The full real chain: real consumer + real decision + real recorded seam. */
function chain(input: {
  s: ReturnType<typeof store>;
  calls: unknown[];
  trace: string[];
  latest?: EnrichmentAttemptRow | null;
  now?: string;
  outcome?: string;
  fresh?: boolean;
  ports?: ExecuteEnrichmentPorts;
  recorder?: unknown;
}): RetryConsumerPorts {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { executeEnrichmentRecorded } = require('../../services/enrichment/recordedExecution');
  const latest = input.latest === undefined ? attempt() : input.latest;
  return {
    listCandidates: async () => [CANDIDATE],
    loadEntity: async () => ({ id: ACCOUNT, status: 'active', domain_normalized: 'northwind.test' }),
    freshEvidenceCovers: async () => input.fresh ?? false,
    sourceReadiness: async () => ({ credentialAvailable: true, sourceOperational: true }),
    enrichmentPorts: () => input.ports ?? enrichPorts(input.trace),
    consume: (i) => consumeEnrichmentWork({
      ...i,
      deps: {
        list: async () => (latest ? [latest] : []) as never,
        execute: ((req: never, providerId: never, ports: never, options: never) =>
          executeEnrichmentRecorded(req, providerId, ports, {
            ...(options as object),
            adapter: adapter(input.calls, input.outcome ?? 'enriched'),
            recorder: input.recorder ?? recorder(input.s, input.now ?? NOW),
          })) as never,
      },
    } as never) as never,
    emit: () => { /* asserted in the selector suite */ },
  };
}

// ── the decision layer decides, and it is the real one ──────────────────────

describe('A7 — the mainline decision layer governs the retry path', () => {
  it('a due transient outcome is executed', async () => {
    const s = store(); const calls: unknown[] = []; const trace: string[] = [];
    const summary = await cycle(chain({ s, calls, trace }), 'worker-A');
    expect(summary.decisions).toEqual({ RETRY_PROVIDER: 1 });
    expect(summary.executed).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('a horizon that has NOT arrived waits, and calls no provider', async () => {
    const s = store(); const calls: unknown[] = []; const trace: string[] = [];
    const summary = await cycle(
      chain({ s, calls, trace, latest: attempt({ nextRetryAt: FUTURE }) }), 'worker-A');
    expect(summary.decisions).toEqual({ WAIT: 1 });
    expect(calls).toHaveLength(0);
    expect(s.rows).toHaveLength(0);
  });

  it('UNKNOWN transport reaches a human, never a provider', async () => {
    const s = store(); const calls: unknown[] = []; const trace: string[] = [];
    const summary = await cycle(
      chain({ s, calls, trace, latest: attempt({ providerCallState: 'unknown' }) }), 'worker-A');
    expect(summary.decisions).toEqual({ OPERATOR_REVIEW: 1 });
    expect(calls).toHaveLength(0);
    expect(trace).toEqual([]);
  });

  it('a terminal provider outcome stops', async () => {
    for (const outcome of ['no_match', 'field_not_found', 'provider_declined'] as const) {
      const s = store(); const calls: unknown[] = []; const trace: string[] = [];
      const summary = await cycle(
        chain({ s, calls, trace, latest: attempt({ outcome, nextRetryAt: null }) }), 'worker-A');
      expect(summary.decisions).toEqual({ TERMINAL: 1 });
      expect(calls).toHaveLength(0);
    }
  });

  it('fresh evidence means NO_ACTION — nothing is paid for twice', async () => {
    const s = store(); const calls: unknown[] = []; const trace: string[] = [];
    const summary = await cycle(chain({ s, calls, trace, fresh: true }), 'worker-A');
    expect(summary.decisions).toEqual({ NO_ACTION: 1 });
    expect(calls).toHaveLength(0);
  });

  it('a live lease belonging to someone else waits', async () => {
    const s = store(); const calls: unknown[] = []; const trace: string[] = [];
    const summary = await cycle(chain({
      s, calls, trace,
      latest: attempt({ completedAt: null, claimedBy: 'other', claimedUntil: FUTURE }),
    }), 'worker-A');
    expect(summary.decisions).toEqual({ WAIT: 1 });
    expect(calls).toHaveLength(0);
  });
});

// ── concurrency ─────────────────────────────────────────────────────────────

describe('A7 — two scheduler workers on one work item', () => {
  it('produce ONE provider call and ONE attempt', async () => {
    const s = store();
    const calls: unknown[] = [];
    const trace: string[] = [];
    const [a, b] = await Promise.all([
      cycle(chain({ s, calls, trace }), 'worker-A'),
      cycle(chain({ s, calls, trace }), 'worker-B'),
    ]);

    expect(calls).toHaveLength(1);
    expect(a.executed + b.executed).toBe(1);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].claimedBy).toBeTruthy();
  });

  it('the loser resolves NO credential and authorises NO cost', async () => {
    const s = store();
    const calls: unknown[] = [];
    // The winner claims and dies mid-flight, so its lease is still live below.
    const holdOpen = { ...recorder(s), complete: async () => { /* died */ } };
    await cycle(chain({ s, calls, trace: [], recorder: holdOpen }), 'worker-A');
    calls.length = 0;

    const loserTrace: string[] = [];
    const summary = await cycle(chain({
      s, calls, trace: loserTrace,
      // The loser sees the winner's live, unexpired lease.
      latest: attempt({ completedAt: null, claimedBy: 'worker-A', claimedUntil: FUTURE }),
    }), 'worker-B');

    expect(summary.executed).toBe(0);
    expect(calls).toHaveLength(0);
    expect(loserTrace).toEqual([]);
  });

  it('an abandoned attempt is ADOPTED, not duplicated', async () => {
    const s = store();
    const calls: unknown[] = [];
    // Worker A claims at 12:00 with a short lease and never completes.
    await claimEnrichmentWork({
      organizationId: ORG, subject: 'account', entityId: ACCOUNT, providerId: 'clearbit',
      requestedAttributes: ['employee_count'], correlationId: 'corr-a7',
      attemptNumber: 1, startedAt: NOW,
      claimedBy: 'worker-A', claimedUntil: '2026-09-07T12:02:00.000Z',
      ports: { record: s.record as never, reclaim: s.reclaim as never },
    } as never);
    expect(s.rows).toHaveLength(1);

    // Two hours later the decision sees an expired, provably UNCALLED attempt.
    const summary = await cycle(chain({
      s, calls, trace: [], now: LATER,
      latest: attempt({
        completedAt: null, executionStatus: 'in_flight', providerCallState: 'not_called',
        outcome: null, providerCalled: false,
        claimedBy: 'worker-A', claimedUntil: '2026-09-07T12:02:00.000Z',
      }),
    }), 'worker-B', LATER);

    expect(summary.decisions).toEqual({ RETRY_PROVIDER: 1 });
    expect(summary.executed).toBe(1);
    expect(calls).toHaveLength(1);
    // Adopted through the claim: still ONE row, now owned by worker B.
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].claimedBy).toBe('worker-B');
  });
});

// ── safety ordering ─────────────────────────────────────────────────────────

describe('A7 — a retry passes every control, in the established order', () => {
  it('claim → credential → suppression → cost → provider → persist', async () => {
    const s = store(); const calls: unknown[] = []; const trace: string[] = [];
    const summary = await cycle(chain({ s, calls, trace }), 'worker-A');

    expect(summary.executed).toBe(1);
    expect(trace).toEqual(['credential', 'suppression', 'cost', 'persist']);
    // The claim precedes all of them: the attempt row exists, owned, first.
    expect(s.rows[0].claimedBy).toBe('worker-A');
  });

  it('a retry that is now a duplicate is suppressed BEFORE cost and provider', async () => {
    const s = store(); const calls: unknown[] = []; const trace: string[] = [];
    const summary = await cycle(chain({
      s, calls, trace,
      ports: enrichPorts(trace, {
        findRecentObservation: async () => {
          trace.push('suppression');
          return { observedAt: NOW } as never;
        },
      }),
    }), 'worker-A');

    expect(summary.executed).toBe(1);           // the attempt ran and was recorded
    expect(calls).toHaveLength(0);              // but no provider was contacted
    expect(trace).toEqual(['credential', 'suppression']);
    expect(trace).not.toContain('cost');
  });

  it('a cost refusal stops the retry before the provider', async () => {
    const s = store(); const calls: unknown[] = []; const trace: string[] = [];
    await cycle(chain({
      s, calls, trace,
      ports: enrichPorts(trace, {
        authorizeCost: async () => {
          trace.push('cost');
          return { authorized: false, holdId: null, cost: { kind: 'unknown' }, reason: 'no budget' } as never;
        },
      }),
    }), 'worker-A');

    expect(calls).toHaveLength(0);
    expect(trace).toEqual(['credential', 'suppression', 'cost']);
  });
});

// ── chaining ────────────────────────────────────────────────────────────────

describe('A7 — attempt N to attempt N+1', () => {
  it('a retryable outcome closes the attempt and frees the work item', async () => {
    const s = store(); const calls: unknown[] = []; const trace: string[] = [];
    await cycle(chain({ s, calls, trace, outcome: 'rate_limited' }), 'worker-A');
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].completedAt).not.toBeNull();
  });

  it('the next cycle takes attempt N+1, append-only', async () => {
    const s = store(); const calls: unknown[] = []; const trace: string[] = [];
    await cycle(chain({ s, calls, trace, outcome: 'rate_limited' }), 'worker-A');
    await cycle(chain({ s, calls, trace }), 'worker-A');

    expect(calls).toHaveLength(2);
    expect(s.rows).toHaveLength(2);
    // Attempt 1 is untouched history; attempt 2 is the new execution.
    expect(s.rows.map((r) => r.n)).toEqual([1, 2]);
    expect(s.rows[0].completedAt).not.toBeNull();
  });

  it('the scheduler never supplies a horizon — only the provider can', async () => {
    const s = store(); const calls: unknown[] = []; const trace: string[] = [];
    await cycle(chain({ s, calls, trace }), 'worker-A');
    // What reached the adapter carries no horizon of any kind. The `purpose`
    // string does say "retry" — it describes why the call is being made, which
    // is lineage, not an instruction — so the assertion names the horizon
    // FIELDS rather than matching the word.
    const request = calls[0] as Record<string, unknown>;
    for (const field of ['retryAfterAt', 'nextRetryAt', 'next_retry_at', 'abandonedBefore', 'backoff']) {
      expect(request).not.toHaveProperty(field);
    }
    expect(Object.keys(request).sort()).toEqual([
      'attributes', 'correlationId', 'credential', 'entityId',
      'organizationId', 'purpose', 'selectors', 'subject',
    ]);
  });
});
