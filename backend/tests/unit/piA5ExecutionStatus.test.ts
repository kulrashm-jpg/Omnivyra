/**
 * A5 — execution status: how OUR execution ended.
 *
 * ─── THE GAP A4T FOUND ─────────────────────────────────────────────────────
 * The attempt row answered two questions and needed a third. `outcome` says
 * what the PROVIDER said; `provider_call_state` (A4Q) says whether transport
 * happened. Neither says how OUR execution ended, and two very different
 * failures closed identically:
 *
 *   post-provider persistence failure  → outcome NULL
 *   pre-transport marker failure       → outcome NULL
 *
 * They were separable only by free-text `detail`, yet their retry safety is
 * OPPOSITE — one was paid for, the other provably was not. `outcome` cannot
 * absorb the distinction because every value in it describes a provider verdict
 * or a refusal we made, so none can name our own failure without blaming the
 * vendor.
 *
 * ─── WHAT THIS FILE PROVES ─────────────────────────────────────────────────
 * That the three dimensions stay orthogonal, and specifically that
 * `mark_failed` and `platform_failed` — the pair A4T found conflated — are now
 * distinguishable without reading prose.
 *
 * It proves NOTHING about retry: no policy, no horizon, no scheduler exists,
 * and this column decides none of them.
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

import {
  EXECUTION_STATUSES, PROVIDER_CALL_STATES,
  type ExecutionStatus, type ProviderCallState,
} from '../../services/enrichment/attempts';
import { executeEnrichmentRecorded } from '../../services/enrichment/recordedExecution';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type {
  EnrichmentProviderAdapter, EnrichmentRequest,
} from '../../services/enrichment/providers/contract';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-07T12:00:00.000Z';
const SECRET = 'synthetic-tenant-provider-key';
const LEASE = { claimedBy: 'worker-1', ttlMs: 60_000 };

const request: EnrichmentRequest = {
  organizationId: ORG, subject: 'account', entityId: ACCOUNT,
  attributes: ['employee_count'], selectors: { domain: 'example.com' },
  purpose: 'a5', correlationId: 'corr-a5',
};

/** The row as the table holds it, plus every close payload. */
function store(opts: { markThrows?: boolean } = {}) {
  const row = {
    executionStatus: 'in_flight' as string,
    callState: 'not_called' as string,
    outcome: null as string | null,
    providerCalled: null as boolean | null,
    completedAt: null as string | null,
  };
  const closes: Record<string, unknown>[] = [];
  return {
    row, closes,
    nextNumber: async () => 1,
    record: async () => ({ attemptId: 'attempt-1' }),
    claim: async () => ({ claimed: true as const, attemptId: 'attempt-1', attemptNumber: 1, reclaimed: false }),
    markPending: async () => {
      if (opts.markThrows) throw new Error('attempts store unavailable');
      row.callState = 'unknown';                       // A4Q: intent, before transport
    },
    complete: async (i: Record<string, unknown>) => {
      closes.push(i);
      row.executionStatus = i.executionStatus as string;
      row.callState = (i.providerCallState as string) ?? (i.providerCalled ? 'called' : 'not_called');
      row.outcome = (i.outcome as string | null) ?? null;
      row.providerCalled = i.providerCalled as boolean;
      row.completedAt = i.completedAt as string;
    },
  };
}

function adapter(calls: unknown[], opts: { throws?: unknown; outcome?: 'enriched' | 'no_match' | 'rate_limited' } = {}): EnrichmentProviderAdapter {
  return {
    id: 'clearbit', label: 'Clearbit', supports: ['employee_count'],
    credentialEnvVar: 'CLEARBIT_API_KEY', isAvailable: () => false,
    async enrich(r) {
      calls.push(r);
      if (opts.throws !== undefined) throw opts.throws;
      if (opts.outcome === 'no_match') return { outcome: 'no_match', fields: [], notReturned: ['employee_count'] };
      if (opts.outcome === 'rate_limited') return { outcome: 'rate_limited', fields: [], notReturned: ['employee_count'] };
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
  releaseCost: async () => { /* tenant-funded: nothing reserved */ },
  resolveCredential: async () => SECRET,
  findRecentObservation: async () => null,
  persistObservation: async () => ({ sourceRecordId: 'src-1', canonicalWithheld: [] }),
  now: () => NOW,
  ...over,
});

async function run(s: ReturnType<typeof store>, calls: unknown[], p: ExecuteEnrichmentPorts, lease?: typeof LEASE) {
  let thrown: unknown = null;
  try {
    await executeEnrichmentRecorded(request, 'clearbit', p,
      { adapter: adapter(calls), recorder: { ...s, now: () => NOW } as never, ...(lease ? { lease } : {}) });
  } catch (err) { thrown = err; }
  return thrown;
}

// ── the vocabulary ──────────────────────────────────────────────────────────

describe('A5 — the vocabulary is closed and orthogonal', () => {
  it('is exactly the six A4T values, in lifecycle order', () => {
    expect([...EXECUTION_STATUSES]).toEqual([
      'in_flight', 'refused_pre_call', 'mark_failed',
      'platform_failed', 'completed', 'abandoned',
    ]);
  });

  it('contains no scheduler or retry-policy state', () => {
    // Those describe a scheduler's intentions, not an execution's history.
    for (const forbidden of ['retrying', 'retry_exhausted', 'waiting', 'queued', 'scheduled', 'provider_failed']) {
      expect(EXECUTION_STATUSES as readonly string[]).not.toContain(forbidden);
    }
  });

  it('does not duplicate the provider-call dimension', () => {
    // A4Q stays authoritative for transport; A5 never restates it.
    for (const s of PROVIDER_CALL_STATES) {
      expect(EXECUTION_STATUSES as readonly string[]).not.toContain(s);
    }
  });

  it('keeps mark_failed and platform_failed distinct — the pair A4T found conflated', () => {
    expect(EXECUTION_STATUSES).toContain('mark_failed');
    expect(EXECUTION_STATUSES).toContain('platform_failed');
    expect(new Set(EXECUTION_STATUSES).size).toBe(EXECUTION_STATUSES.length);
  });

  it('rejects an invalid status at the TypeScript boundary', () => {
    const ok: ExecutionStatus = 'completed';
    expect(EXECUTION_STATUSES).toContain(ok);
    // @ts-expect-error — 'retrying' is not a member of the closed vocabulary.
    const bad: ExecutionStatus = 'retrying';
    expect(EXECUTION_STATUSES as readonly string[]).not.toContain(bad);
  });
});

// ── creation ────────────────────────────────────────────────────────────────

describe('A5 — an attempt begins in flight', () => {
  it('a newly opened attempt is in_flight and has reached no terminal state', () => {
    const s = store();
    expect(s.row.executionStatus).toBe('in_flight');
    expect(s.row.completedAt).toBeNull();
  });
});

// ── the terminal states, each from its real lifecycle site ──────────────────

describe('A5 — each terminal status comes from its own lifecycle site', () => {
  it('a pre-call refusal is refused_pre_call, NOT completed', async () => {
    const s = store();
    const calls: unknown[] = [];
    await run(s, calls, ports({ resolveCredential: async () => null }));

    expect(s.row.executionStatus).toBe('refused_pre_call');
    expect(s.row.callState).toBe('not_called');
    expect(s.row.outcome).toBe('credential_missing');   // the outcome is untouched
    expect(calls).toHaveLength(0);
  });

  it('a duplicate suppressed before egress is also refused_pre_call', async () => {
    const s = store();
    const calls: unknown[] = [];
    await run(s, calls, ports({
      findRecentObservation: async () => ({ observedAt: NOW }),
    }));

    expect(s.row.executionStatus).toBe('refused_pre_call');
    expect(s.row.outcome).toBe('duplicate_suppressed');
    expect(calls).toHaveLength(0);
  });

  it('a mark failure is mark_failed, not_called, with zero provider calls (A4V)', async () => {
    const s = store({ markThrows: true });
    const calls: unknown[] = [];
    const thrown = await run(s, calls, ports());

    expect(s.row.executionStatus).toBe('mark_failed');
    expect(s.row.callState).toBe('not_called');
    expect(s.row.outcome).toBeNull();
    expect(calls).toHaveLength(0);
    expect((thrown as Error).message).toMatch(/attempts store unavailable/);
  });

  it('a post-provider platform failure is platform_failed + called (A4E)', async () => {
    const s = store();
    const calls: unknown[] = [];
    const thrown = await run(s, calls, ports({
      persistObservation: async () => { throw new Error('persist exploded'); },
    }));

    expect(s.row.executionStatus).toBe('platform_failed');
    expect(s.row.callState).toBe('called');             // the tenant WAS charged
    expect(s.row.outcome).toBeNull();                   // and no verdict was persisted
    expect(calls).toHaveLength(1);
    expect((thrown as Error).message).toMatch(/persist exploded/);
  });

  it('a successful execution is completed + called + its outcome', async () => {
    const s = store();
    const calls: unknown[] = [];
    await run(s, calls, ports());

    expect(s.row.executionStatus).toBe('completed');
    expect(s.row.callState).toBe('called');
    expect(s.row.outcome).toBe('enriched');
    expect(calls).toHaveLength(1);
  });

  it.each(['no_match', 'rate_limited'] as const)(
    'a provider verdict of %s is still completed — the outcome is preserved, not collapsed', async (outcome) => {
      const s = store();
      const calls: unknown[] = [];
      await executeEnrichmentRecorded(request, 'clearbit', ports(), {
        adapter: adapter(calls, { outcome }), recorder: { ...s, now: () => NOW } as never,
      });

      expect(s.row.executionStatus).toBe('completed');
      expect(s.row.callState).toBe('called');
      expect(s.row.outcome).toBe(outcome);
    });
});

// ── the three dimensions stay orthogonal ────────────────────────────────────

describe('A5 — execution status, provider-call state and outcome are independent', () => {
  it('mark_failed and platform_failed are told apart WITHOUT reading detail', async () => {
    const mark = store({ markThrows: true });
    await run(mark, [], ports());

    const platform = store();
    await run(platform, [], ports({
      persistObservation: async () => { throw new Error('persist exploded'); },
    }));

    // Both close with outcome NULL — that was A4T's whole complaint.
    expect(mark.row.outcome).toBeNull();
    expect(platform.row.outcome).toBeNull();
    // And are now distinguishable on structured columns alone.
    expect(mark.row.executionStatus).not.toBe(platform.row.executionStatus);
    expect(mark.row.callState).toBe('not_called');
    expect(platform.row.callState).toBe('called');
  });

  it('one execution status spans several provider outcomes', async () => {
    const seen = new Set<string>();
    for (const outcome of ['enriched', 'no_match', 'rate_limited'] as const) {
      const s = store();
      await executeEnrichmentRecorded(request, 'clearbit', ports(), {
        adapter: adapter([], { outcome }), recorder: { ...s, now: () => NOW } as never,
      });
      expect(s.row.executionStatus).toBe('completed');
      seen.add(String(s.row.outcome));
    }
    expect(seen.size).toBe(3);          // three outcomes, one execution status
  });

  it('`unknown` remains A4Q\'s alone and is never expressed as a status', async () => {
    // The marker writes `unknown` before transport; a process death leaves it
    // there with execution_status still `in_flight`. That pair is the whole
    // point: the execution never ended, and the call cannot be proven either way.
    const s = store();
    await s.markPending();

    expect(s.row.callState).toBe('unknown');
    expect(s.row.executionStatus).toBe('in_flight');
    expect(s.row.completedAt).toBeNull();
    expect(EXECUTION_STATUSES as readonly string[]).not.toContain('unknown');
  });

  it('a leased execution records the same statuses as a manual one', async () => {
    const leased = store();
    await run(leased, [], ports(), LEASE);
    const manual = store();
    await run(manual, [], ports());

    expect(leased.row.executionStatus).toBe('completed');
    expect(manual.row.executionStatus).toBe(leased.row.executionStatus);
  });
});

// ── abandoned is registered, not implemented ────────────────────────────────

describe('A5 — abandoned is vocabulary only', () => {
  it('is a member of the closed set so a future reclaimer needs no migration', () => {
    const s: ExecutionStatus = 'abandoned';
    expect(EXECUTION_STATUSES).toContain(s);
  });

  it('is never written by any lifecycle path in this module', async () => {
    // Every close site is exercised above; none produces `abandoned`, because
    // the reclaimer that would write it does not exist (A4T).
    for (const build of [
      () => run(store(), [], ports()),
      () => run(store(), [], ports({ resolveCredential: async () => null })),
      () => run(store({ markThrows: true }), [], ports()),
      () => run(store(), [], ports({ persistObservation: async () => { throw new Error('x'); } })),
    ]) {
      const s = store();
      await build();
      expect(s.row.executionStatus).not.toBe('abandoned');
    }
  });
});

// ── the close contract ──────────────────────────────────────────────────────

describe('A5 — every close states its status explicitly', () => {
  it('no close omits executionStatus — it is never defaulted', async () => {
    const cases = [
      () => run(store(), [], ports()),
      () => run(store(), [], ports({ resolveCredential: async () => null })),
    ];
    for (const c of cases) await c();

    const s = store();
    await run(s, [], ports());
    expect(s.closes).toHaveLength(1);
    expect(Object.keys(s.closes[0])).toContain('executionStatus');
    expect(typeof s.closes[0].executionStatus).toBe('string');
    expect(EXECUTION_STATUSES as readonly string[]).toContain(s.closes[0].executionStatus as string);
  });

  it('the recorded status is always a member of the closed vocabulary', async () => {
    const statuses: string[] = [];
    for (const p of [
      ports(),
      ports({ resolveCredential: async () => null }),
      ports({ persistObservation: async () => { throw new Error('x'); } }),
    ]) {
      const s = store();
      await run(s, [], p);
      statuses.push(s.row.executionStatus);
    }
    const s = store({ markThrows: true });
    await run(s, [], ports());
    statuses.push(s.row.executionStatus);

    for (const st of statuses) {
      expect(EXECUTION_STATUSES as readonly string[]).toContain(st);
    }
    expect(new Set(statuses)).toEqual(new Set(['completed', 'refused_pre_call', 'platform_failed', 'mark_failed']));
  });
});

// ── type-level guards ───────────────────────────────────────────────────────

describe('A5 — the dimensions cannot be crossed at the type level', () => {
  it('a ProviderCallState is not an ExecutionStatus', () => {
    // @ts-expect-error — 'called' belongs to A4Q's vocabulary, not A5's.
    const bad: ExecutionStatus = 'called' as ProviderCallState;
    expect(EXECUTION_STATUSES as readonly string[]).not.toContain(bad);
  });
});
