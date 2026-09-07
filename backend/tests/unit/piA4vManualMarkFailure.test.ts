/**
 * A4V — the pre-transport mark fails CLOSED on every path, leased or manual.
 *
 * ─── THE DEFECT ────────────────────────────────────────────────────────────
 * A4Q persists the intent to call (`provider_call_state = 'unknown'`) BEFORE
 * transport, so a process that dies around the call leaves a row that says so.
 * The fail-closed handling of a FAILED mark was gated on `options.lease`:
 *
 *     if (options.lease) { markFailure = err; throw err; }
 *
 * so on the manual/unleased path a mark failure was swallowed and execution
 * continued into `adapter.enrich`. Reproduced before the fix: the manual path
 * reached the provider with the row still asserting `not_called`. If the process
 * then died mid-call, the row's claim that no provider was contacted became
 * permanent, and recovery could never distinguish "never called" from "called"
 * — the exact ambiguity B3 exists to remove, reintroduced off-lease.
 *
 * ─── WHY THE OLD REASONING DID NOT HOLD ────────────────────────────────────
 * The gate rested on A4A's fail-open posture for user-initiated work. But
 * A4A's fail-open is about a MISSING attempt row — no row, nothing to misread,
 * and A4J's `requireAttemptRecord` lets a caller demand one. This is the
 * opposite case: the row EXISTS and we failed to move it to `unknown`. A manual
 * call spends exactly the same tenant quota as a leased one, so it earns exactly
 * the same guarantee.
 *
 * The invariant, now unconditional:
 *
 *     no durable `unknown`  ⇒  no provider transport
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

import { executeEnrichmentRecorded } from '../../services/enrichment/recordedExecution';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type {
  EnrichmentProviderAdapter, EnrichmentRequest,
} from '../../services/enrichment/providers/contract';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-06T12:00:00.000Z';
const SECRET = 'synthetic-tenant-provider-key';
const LEASE = { claimedBy: 'worker-1', ttlMs: 60_000 };

/** A storage fault, distinguishable from anything a provider could say. */
class AttemptStoreDown extends Error {
  constructor() { super('attempts store unavailable: mark could not be persisted'); }
}

const request: EnrichmentRequest = {
  organizationId: ORG, subject: 'account', entityId: ACCOUNT,
  attributes: ['employee_count'], selectors: { domain: 'example.com' },
  purpose: 'a4v', correlationId: 'corr-a4v',
};

/** The row, plus a record of every close so write scope is assertable. */
function store(opts: { markThrows?: boolean } = {}) {
  const row = { state: 'not_called' as string, completedAt: null as string | null, providerCalled: null as boolean | null };
  const closes: Record<string, unknown>[] = [];
  const marks: string[] = [];
  return {
    row, closes, marks,
    nextNumber: async () => 1,
    record: async () => ({ attemptId: 'attempt-1' }),
    // A4N's atomic claim. Stubbed so the leased path never reaches the real
    // writer — without it the executor falls through to the live database.
    claim: async () => ({ claimed: true as const, attemptId: 'attempt-1', attemptNumber: 1, reclaimed: false }),
    markPending: async (i: { attemptId: string }) => {
      marks.push(i.attemptId);
      if (opts.markThrows) throw new AttemptStoreDown();
      row.state = 'unknown';
    },
    complete: async (i: Record<string, unknown>) => {
      closes.push(i);
      row.state = (i.providerCallState as string) ?? (i.providerCalled ? 'called' : 'not_called');
      row.providerCalled = i.providerCalled as boolean;
      row.completedAt = i.completedAt as string;
    },
  };
}

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

/** Counts every port interaction, so "nothing happened after" is provable. */
function countingPorts() {
  const counts = { credential: 0, cost: 0, release: 0, observation: 0, persist: 0 };
  const ports: ExecuteEnrichmentPorts = {
    resolveCredential: async () => { counts.credential += 1; return SECRET; },
    authorizeCost: async () => { counts.cost += 1; return { authorized: true, holdId: null, cost: { kind: 'unknown' } }; },
    releaseCost: async () => { counts.release += 1; },
    findRecentObservation: async () => { counts.observation += 1; return null; },
    persistObservation: async () => { counts.persist += 1; return { sourceRecordId: 'src-1', canonicalWithheld: [] }; },
    now: () => NOW,
  };
  return { ports, counts };
}

const recorder = (s: ReturnType<typeof store>) => ({ ...s, now: () => NOW } as never);

/** Run one execution, capturing whatever it throws. */
async function run(s: ReturnType<typeof store>, calls: unknown[], p: ExecuteEnrichmentPorts, lease?: typeof LEASE) {
  let thrown: unknown = null;
  let result: unknown = null;
  try {
    result = await executeEnrichmentRecorded(request, 'clearbit', p,
      { adapter: adapter(calls), recorder: recorder(s), ...(lease ? { lease } : {}) });
  } catch (err) { thrown = err; }
  return { thrown, result };
}

// ── the mark succeeds: both paths may execute ───────────────────────────────

describe('A4V — a successful mark permits transport on both paths', () => {
  it('leased + mark succeeds → the provider may execute', async () => {
    const s = store();
    const calls: unknown[] = [];
    const { ports } = countingPorts();
    const { thrown } = await run(s, calls, ports, LEASE);

    expect(thrown).toBeNull();
    expect(calls).toHaveLength(1);
    expect(s.marks).toEqual(['attempt-1']);
    expect(s.row.state).toBe('called');
  });

  it('manual + mark succeeds → the provider may execute (unchanged behaviour)', async () => {
    const s = store();
    const calls: unknown[] = [];
    const { ports } = countingPorts();
    const { thrown } = await run(s, calls, ports);

    expect(thrown).toBeNull();
    expect(calls).toHaveLength(1);
    expect(s.marks).toEqual(['attempt-1']);
    expect(s.row.state).toBe('called');
  });
});

// ── the mark fails: neither path may execute ────────────────────────────────

describe('A4V — a failed mark forbids transport on both paths', () => {
  it('leased + mark fails → ZERO provider calls', async () => {
    const s = store({ markThrows: true });
    const calls: unknown[] = [];
    const { ports } = countingPorts();
    const { thrown } = await run(s, calls, ports, LEASE);

    expect(calls).toHaveLength(0);
    expect(thrown).toBeInstanceOf(AttemptStoreDown);
  });

  it('manual + mark fails → ZERO provider calls (THE FIX)', async () => {
    // Before A4V this reached the provider: the row said `not_called` while the
    // tenant's quota was spent, and a death here made that lie permanent.
    const s = store({ markThrows: true });
    const calls: unknown[] = [];
    const { ports } = countingPorts();
    const { thrown } = await run(s, calls, ports);

    expect(calls).toHaveLength(0);
    expect(thrown).toBeInstanceOf(AttemptStoreDown);
  });

  it.each([['manual', undefined], ['leased', LEASE]] as const)(
    '%s: the ORIGINAL storage error is preserved, not replaced', async (_label, lease) => {
      const s = store({ markThrows: true });
      const calls: unknown[] = [];
      const { ports } = countingPorts();
      const { thrown } = await run(s, calls, ports, lease as typeof LEASE | undefined);

      expect(thrown).toBeInstanceOf(AttemptStoreDown);
      expect((thrown as Error).message).toMatch(/attempts store unavailable/);
    });

  it.each([['manual', undefined], ['leased', LEASE]] as const)(
    '%s: a storage failure NEVER becomes provider_unavailable', async (_label, lease) => {
      const s = store({ markThrows: true });
      const calls: unknown[] = [];
      const { ports } = countingPorts();
      const { thrown, result } = await run(s, calls, ports, lease as typeof LEASE | undefined);

      // Our fault must not be reported as the vendor's. The executor's own
      // catch would have classified this as `provider_unavailable`; the stash
      // and re-throw exist precisely so that verdict never escapes.
      expect(result).toBeNull();
      expect(String((thrown as Error).message)).not.toMatch(/provider_unavailable/i);
      const closed = s.closes.at(-1)!;
      expect(closed.outcome).toBeNull();
      expect(closed.detail).toMatch(/could not be recorded before transport/);
    });

  it.each([['manual', undefined], ['leased', LEASE]] as const)(
    '%s: the attempt closes as not_called — what actually happened', async (_label, lease) => {
      const s = store({ markThrows: true });
      const calls: unknown[] = [];
      const { ports } = countingPorts();
      await run(s, calls, ports, lease as typeof LEASE | undefined);

      expect(s.row.state).toBe('not_called');
      expect(s.row.providerCalled).toBe(false);
      expect(s.row.completedAt).toBe(NOW);
      const closed = s.closes.at(-1)!;
      expect(closed.providerCallState).toBe('not_called');
      expect(closed.providerCalled).toBe(false);
    });
});

// ── nothing proceeds after the failure ──────────────────────────────────────

describe('A4V — no further work is attempted after a failed mark', () => {
  it.each([['manual', undefined], ['leased', LEASE]] as const)(
    '%s: no adapter transport occurs', async (_label, lease) => {
      const s = store({ markThrows: true });
      const calls: unknown[] = [];
      const { ports } = countingPorts();
      await run(s, calls, ports, lease as typeof LEASE | undefined);
      expect(calls).toHaveLength(0);
    });

  it.each([['manual', undefined], ['leased', LEASE]] as const)(
    '%s: credential resolution is not repeated after the failure', async (_label, lease) => {
      const s = store({ markThrows: true });
      const calls: unknown[] = [];
      const { ports, counts } = countingPorts();
      await run(s, calls, ports, lease as typeof LEASE | undefined);

      // Credential resolution precedes the mark, so it happens exactly once and
      // must NOT happen again — a retry loop here would re-read the tenant's
      // credential for a call that is never going to be made.
      expect(counts.credential).toBe(1);
    });

  it.each([['manual', undefined], ['leased', LEASE]] as const)(
    '%s: cost authorization is not repeated after the failure', async (_label, lease) => {
      const s = store({ markThrows: true });
      const calls: unknown[] = [];
      const { ports, counts } = countingPorts();
      await run(s, calls, ports, lease as typeof LEASE | undefined);
      expect(counts.cost).toBe(1);
    });

  it.each([['manual', undefined], ['leased', LEASE]] as const)(
    '%s: no observation is persisted', async (_label, lease) => {
      const s = store({ markThrows: true });
      const calls: unknown[] = [];
      const { ports, counts } = countingPorts();
      await run(s, calls, ports, lease as typeof LEASE | undefined);
      expect(counts.persist).toBe(0);
    });

  it('the attempt is closed exactly once', async () => {
    const s = store({ markThrows: true });
    const calls: unknown[] = [];
    const { ports } = countingPorts();
    await run(s, calls, ports);
    expect(s.closes).toHaveLength(1);
  });
});

// ── neighbouring contracts are untouched ────────────────────────────────────

describe('A4V — A4E and A4N semantics are unchanged', () => {
  it('A4E: a post-provider failure still closes as called, not not_called', async () => {
    const s = store();
    const calls: unknown[] = [];
    const { ports } = countingPorts();
    // The provider succeeds; persistence afterwards throws.
    const failing: ExecuteEnrichmentPorts = {
      ...ports, persistObservation: async () => { throw new Error('persist exploded'); },
    };
    const { thrown } = await run(s, calls, failing);

    expect(calls).toHaveLength(1);                 // the provider WAS paid
    expect(thrown).toBeInstanceOf(Error);
    expect(s.row.state).toBe('called');            // and the row says so
    expect(s.closes.at(-1)!.outcome).toBeNull();   // no fabricated verdict
  });

  it('A4N: a refusal before transport still never marks pending', async () => {
    const s = store();
    const calls: unknown[] = [];
    const { ports } = countingPorts();
    const noCredential: ExecuteEnrichmentPorts = { ...ports, resolveCredential: async () => null };
    const { thrown } = await run(s, calls, noCredential, LEASE);

    expect(thrown).toBeNull();
    expect(calls).toHaveLength(0);
    expect(s.marks).toHaveLength(0);               // transport never approached
    expect(s.row.state).toBe('not_called');
  });
});
