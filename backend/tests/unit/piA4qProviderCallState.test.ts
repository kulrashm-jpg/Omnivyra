/**
 * A4Q — three-valued provider-call state (B3).
 *
 * The boolean `provider_called` has two values for a question with three
 * answers. A4E made it truthful whenever the process SURVIVES: the recorder
 * observes entry into `enrich()` and writes the answer on completion. But
 * nothing runs after a process dies, so a worker killed between transport and
 * completion left the row holding its insert-time `false` — asserting that no
 * call was made when the tenant's provider had been paid. A4N then made that
 * row RECOVERABLE, which turned the ambiguity into a hazard: a reclaimer
 * reading `provider_called = false` would conclude it is safe to call again.
 *
 * The fix is not a cleverer inference — after a process death there is nothing
 * left to infer from. `outcome` is null for both "never asked" and "died
 * mid-call"; `completed_at` is null for both "in flight" and "abandoned"; the
 * row's existence proves only that an attempt began. So the intent to call is
 * PERSISTED BEFORE the call, and overwritten by the proven answer after. A row
 * still holding `unknown` is exactly a process that did not survive its own
 * provider call.
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

import {
  PROVIDER_CALL_STATES, markProviderCallPending,
  type ProviderCallState,
} from '../../services/enrichment/attempts';
import { executeEnrichmentRecorded } from '../../services/enrichment/recordedExecution';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type {
  EnrichmentProviderAdapter, EnrichmentRequest,
} from '../../services/enrichment/providers/contract';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-06T12:00:00.000Z';
const SECRET = 'synthetic-tenant-provider-key';

const request: EnrichmentRequest = {
  organizationId: ORG, subject: 'account', entityId: ACCOUNT,
  attributes: ['employee_count'], selectors: { domain: 'example.com' },
  purpose: 'a4q', correlationId: 'corr-a4q',
};

/**
 * A store that behaves like the row: it starts at `not_called`, the pre-transport
 * marker moves it to `unknown`, and completion overwrites it. Killing the
 * "process" simply means never running the completion — which is exactly what a
 * dead worker does.
 */
function store() {
  const row: { state: ProviderCallState; completedAt: string | null; providerCalled: boolean | null } = {
    state: 'not_called', completedAt: null, providerCalled: null,
  };
  const marks: string[] = [];
  return {
    row,
    marks,
    nextNumber: async () => 1,
    record: async () => ({ attemptId: 'attempt-1' }),
    markPending: async (i: { attemptId: string }) => {
      marks.push(i.attemptId);
      if (row.completedAt) return;             // never re-opens a completed row
      row.state = 'unknown';
    },
    complete: async (i: { providerCallState?: ProviderCallState; providerCalled: boolean; completedAt: string }) => {
      row.state = i.providerCallState ?? (i.providerCalled ? 'called' : 'not_called');
      row.providerCalled = i.providerCalled;
      row.completedAt = i.completedAt;
    },
  };
}

function adapter(calls: unknown[], opts: { throws?: unknown; outcome?: 'enriched' | 'no_match' } = {}): EnrichmentProviderAdapter {
  return {
    id: 'clearbit', label: 'Clearbit', supports: ['employee_count'],
    credentialEnvVar: 'CLEARBIT_API_KEY', isAvailable: () => false,
    async enrich(r) {
      calls.push(r);
      if (opts.throws !== undefined) throw opts.throws;
      if (opts.outcome === 'no_match') return { outcome: 'no_match', fields: [], notReturned: ['employee_count'] };
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

const recorder = (s: ReturnType<typeof store>) => ({ ...s, now: () => NOW });
const LEASE = { claimedBy: 'worker-1', ttlMs: 60_000 };

// ── the vocabulary ──────────────────────────────────────────────────────────

describe('A4Q — the vocabulary says what can be proven', () => {
  it('is exactly three values', () => {
    expect([...PROVIDER_CALL_STATES]).toEqual(['not_called', 'called', 'unknown']);
  });

  it('the pre-transport marker refuses a tenant-less or attempt-less write', async () => {
    await expect(markProviderCallPending({ organizationId: '  ', attemptId: 'a' }))
      .rejects.toThrow(/organizationId is required/);
    await expect(markProviderCallPending({ organizationId: ORG, attemptId: ' ' }))
      .rejects.toThrow(/attemptId is required/);
  });
});

// ── the three states, each proven ───────────────────────────────────────────

describe('A4Q — every state reflects what the system can prove', () => {
  it('a refusal BEFORE transport ends at not_called, and never marks pending', async () => {
    const s = store();
    const calls: unknown[] = [];
    const out = await executeEnrichmentRecorded(request, 'clearbit',
      ports({ resolveCredential: async () => null }),
      { adapter: adapter(calls), recorder: recorder(s) as never });

    expect(out.result.outcome).toBe('credential_missing');
    expect(calls).toHaveLength(0);
    expect(s.marks).toHaveLength(0);            // transport was never approached
    expect(s.row.state).toBe('not_called');
  });

  it('duplicate suppression ends at not_called', async () => {
    const s = store();
    const calls: unknown[] = [];
    await executeEnrichmentRecorded(request, 'clearbit',
      ports({ findRecentObservation: async () => ({ observedAt: '2026-09-05T00:00:00.000Z' }) }),
      { adapter: adapter(calls), recorder: recorder(s) as never });

    expect(calls).toHaveLength(0);
    expect(s.marks).toHaveLength(0);
    expect(s.row.state).toBe('not_called');
  });

  it('a completed call ends at called', async () => {
    const s = store();
    const calls: unknown[] = [];
    const out = await executeEnrichmentRecorded(request, 'clearbit', ports(),
      { adapter: adapter(calls), recorder: recorder(s) as never });

    expect(out.result.outcome).toBe('enriched');
    expect(calls).toHaveLength(1);
    expect(s.marks).toHaveLength(1);            // marked BEFORE the call
    expect(s.row.state).toBe('called');
  });

  it('a provider failure after transport still ends at called', async () => {
    const s = store();
    const calls: unknown[] = [];
    await executeEnrichmentRecorded(request, 'clearbit', ports(),
      { adapter: adapter(calls, { outcome: 'no_match' }), recorder: recorder(s) as never });
    expect(s.row.state).toBe('called');
  });

  it('a transport throw still ends at called — the process survived to say so', async () => {
    const s = store();
    const calls: unknown[] = [];
    await executeEnrichmentRecorded(request, 'clearbit', ports(),
      { adapter: adapter(calls, { throws: new Error('socket timed out') }), recorder: recorder(s) as never });
    expect(s.row.state).toBe('called');
  });

  it('A4E: persistence failure after the call ends at called, not unknown', async () => {
    const s = store();
    const calls: unknown[] = [];
    await expect(executeEnrichmentRecorded(request, 'clearbit',
      ports({ persistObservation: async () => { throw new Error('source_records insert failed'); } }),
      { adapter: adapter(calls), recorder: recorder(s) as never }))
      .rejects.toThrow('source_records insert failed');

    expect(calls).toHaveLength(1);
    expect(s.row.state).toBe('called');         // provable — this code ran
    expect(s.row.providerCalled).toBe(true);
  });
});

// ── THE B3 CASE ─────────────────────────────────────────────────────────────

describe('A4Q — B3: a process that dies around the call leaves unknown', () => {
  it('the row says unknown, NOT not_called, when completion never runs', async () => {
    const s = store();
    const calls: unknown[] = [];

    // The dead worker: transport is entered, and nothing afterwards ever runs.
    // Modelled by an adapter that never returns and a completion never reached.
    const dying: EnrichmentProviderAdapter = {
      ...adapter(calls),
      enrich: async (r) => { calls.push(r); throw Object.assign(new Error('process killed'), { fatal: true }); },
    };

    // Simulate the kill: run only up to transport, then abandon.
    await s.record();
    await s.markPending({ attemptId: 'attempt-1' });
    await dying.enrich({ ...request, credential: SECRET }).catch(() => { /* the process is gone */ });

    // Completion NEVER runs. This is the whole point.
    expect(s.row.completedAt).toBeNull();
    expect(s.row.state).toBe('unknown');
    expect(s.row.state).not.toBe('not_called');
  });

  it('the marker is written BEFORE transport, so ordering makes unknown provable', async () => {
    const order: string[] = [];
    const s = store();
    const marking = {
      ...recorder(s),
      markPending: async (i: { attemptId: string }) => { order.push('mark'); await s.markPending(i); },
    };
    const tracing: EnrichmentProviderAdapter = {
      ...adapter([]),
      enrich: async () => {
        order.push('transport');
        return { outcome: 'enriched', notReturned: [], fields: [{ attribute: 'employee_count', subject: 'account', value: 1, observedAt: null, confidence: null, providerInferred: false }] };
      },
    };
    await executeEnrichmentRecorded(request, 'clearbit', ports(),
      { adapter: tracing, recorder: marking as never });

    expect(order).toEqual(['mark', 'transport']);
  });

  it('a reclaimer can tell "paid but unrecorded" from "never called"', () => {
    // The distinction B3 exists to preserve, stated as the read a retry loop
    // would perform. `provider_called = false` covers BOTH; only the state
    // separates them, and only one of them is safe to retry.
    const abandoned = { providerCalled: false, providerCallState: 'unknown' as ProviderCallState };
    const neverCalled = { providerCalled: false, providerCallState: 'not_called' as ProviderCallState };

    expect(abandoned.providerCalled).toBe(neverCalled.providerCalled);        // indistinguishable
    expect(abandoned.providerCallState).not.toBe(neverCalled.providerCallState);  // distinguishable
    const safeToRetry = (s: ProviderCallState) => s === 'not_called';
    expect(safeToRetry(neverCalled.providerCallState)).toBe(true);
    expect(safeToRetry(abandoned.providerCallState)).toBe(false);
  });
});

// ── the marker's own failure policy ─────────────────────────────────────────

describe('A4Q — the marker fails closed for automated callers only', () => {
  it('a leased execution does NOT call the provider if the mark cannot be written', async () => {
    const s = store();
    const calls: unknown[] = [];
    const broken = {
      ...recorder(s),
      markPending: async () => { throw new Error('call-state mark failed'); },
      claim: async () => ({ claimed: true, attemptId: 'attempt-1', attemptNumber: 1, reclaimed: false }),
    };
    await expect(executeEnrichmentRecorded(request, 'clearbit', ports(), {
      adapter: adapter(calls), recorder: broken as never, lease: LEASE,
    })).rejects.toThrow('call-state mark failed');

    // Proceeding would recreate exactly the ambiguity B3 removes.
    expect(calls).toHaveLength(0);
  });

  it('the manual path keeps A4A fail-open — the tenant still gets their work', async () => {
    const s = store();
    const calls: unknown[] = [];
    const broken = { ...recorder(s), markPending: async () => { throw new Error('mark failed'); } };
    const out = await executeEnrichmentRecorded(request, 'clearbit', ports(),
      { adapter: adapter(calls), recorder: broken as never });

    expect(out.result.outcome).toBe('enriched');
    expect(calls).toHaveLength(1);
  });
});

// ── nothing else changed ────────────────────────────────────────────────────

describe('A4Q — the boolean and its consumers are untouched', () => {
  it('provider_called keeps its exact meaning on every path', async () => {
    const called = store();
    await executeEnrichmentRecorded(request, 'clearbit', ports(),
      { adapter: adapter([]), recorder: recorder(called) as never });
    expect(called.row.providerCalled).toBe(true);

    const notCalled = store();
    await executeEnrichmentRecorded(request, 'clearbit',
      ports({ resolveCredential: async () => null }),
      { adapter: adapter([]), recorder: recorder(notCalled) as never });
    expect(notCalled.row.providerCalled).toBe(false);
  });

  it('no scheduler, queue, cron, retry metadata or execution-status taxonomy was added', () => {
    const code = (rel: string): string =>
      require('fs').readFileSync(require('path').join(__dirname, '../..', rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const rel of ['services/enrichment/attempts.ts', 'services/enrichment/recordedExecution.ts']) {
      const src = code(rel);
      expect(src).not.toMatch(/setInterval|setTimeout|node-cron|new Queue|new Worker|\.schedule\(/);
      expect(src).not.toMatch(/next_retry_at|retry_class|prior_attempt_id|retry_policy_version|execution_status/);
    }
  });
});
