/**
 * A4E — an attempt is closed truthfully even when execution throws.
 *
 * G1, found by the A4C audit: `executeEnrichment` can throw AFTER
 * `adapter.enrich` has already succeeded — `persistObservation` is not guarded,
 * and neither is `releaseCost`. `recordedExecution` called it without a
 * try/catch, so the exception propagated, `completeAttempt` never ran, and the
 * row stayed open still carrying its insert-time `provider_called: false`.
 *
 * The tenant's provider had been contacted and their quota spent, and the only
 * record of it said otherwise. A retry loop reading that row would conclude no
 * call was made and spend the quota again — which is the exact harm A4A exists
 * to prevent, so the recorder was failing at its one job in the one case that
 * matters most.
 *
 * ─── WHY THE FIX OBSERVES TRANSPORT RATHER THAN INFERRING IT ──────────────
 * When the executor throws there is no result to read `providerCalled` from,
 * and the exception cannot say whether egress happened — a persistence failure
 * and a pre-credential failure both arrive as a thrown Error. Guessing from the
 * message would make "how many paid calls did this tenant make" depend on
 * string matching. So the recorder wraps the adapter and learns the truth from
 * the one event that defines it: `enrich()` being entered.
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

import {
  executeEnrichmentRecorded,
} from '../../services/enrichment/recordedExecution';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type {
  EnrichmentProviderAdapter, EnrichmentRequest, ProviderResponse,
} from '../../services/enrichment/providers/contract';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = 'acct-1';
const NOW = '2026-09-06T00:00:00.000Z';
const SECRET = 'synthetic-tenant-provider-key';

const request: EnrichmentRequest = {
  organizationId: ORG, subject: 'account', entityId: ACCOUNT,
  attributes: ['employee_count'], selectors: { domain: 'example.com' },
  purpose: 'a4e', correlationId: 'corr-a4e',
};

interface Harness {
  ports: ExecuteEnrichmentPorts;
  adapter: EnrichmentProviderAdapter;
  recorder: Record<string, unknown>;
  calls: unknown[];
  opened: Record<string, unknown>[];
  closed: Record<string, unknown>[];
}

function harness(opts: {
  credential?: string | null;
  response?: ProviderResponse;
  adapterThrows?: unknown;
  persistThrows?: unknown;
  releaseThrows?: unknown;
  recent?: { observedAt: string } | null;
  recordThrows?: boolean;
} = {}): Harness {
  const calls: unknown[] = [];
  const opened: Record<string, unknown>[] = [];
  const closed: Record<string, unknown>[] = [];

  const adapter: EnrichmentProviderAdapter = {
    id: 'clearbit', label: 'Clearbit', supports: ['employee_count'],
    credentialEnvVar: 'CLEARBIT_API_KEY',
    isAvailable: () => false,
    async enrich(r) {
      calls.push(r);
      if (opts.adapterThrows !== undefined) throw opts.adapterThrows;
      return opts.response ?? {
        outcome: 'enriched', notReturned: [],
        fields: [{
          attribute: 'employee_count', subject: 'account', value: 240,
          observedAt: null, confidence: null, providerInferred: false,
        }],
      };
    },
  };

  const ports: ExecuteEnrichmentPorts = {
    async authorizeCost() { return { authorized: true, holdId: null, cost: { kind: 'unknown' } }; },
    async releaseCost() { if (opts.releaseThrows !== undefined) throw opts.releaseThrows; },
    async resolveCredential() { return opts.credential === undefined ? SECRET : opts.credential; },
    async findRecentObservation() { return opts.recent ?? null; },
    async persistObservation() {
      if (opts.persistThrows !== undefined) throw opts.persistThrows;
      return { sourceRecordId: 'src-1', canonicalWithheld: [] };
    },
    now: () => NOW,
  };

  const recorder = {
    now: () => NOW,
    nextNumber: async () => 1,
    record: async (i: unknown) => {
      if (opts.recordThrows) throw new Error('attempt insert exploded');
      opened.push(i as Record<string, unknown>);
      return { attemptId: 'attempt-1' };
    },
    complete: async (i: unknown) => { closed.push(i as Record<string, unknown>); },
  };

  return { ports, adapter, recorder, calls, opened, closed };
}

const run = (hz: Harness) => executeEnrichmentRecorded(
  request, 'clearbit', hz.ports, { adapter: hz.adapter, recorder: hz.recorder as never },
);

// ── 1. existing success is unchanged ────────────────────────────────────────

describe('A4E — an execution that succeeds is still recorded as before', () => {
  it('1. provider called, persistence succeeded, attempt terminal', async () => {
    const hz = harness();
    const out = await run(hz);

    expect(out.result.outcome).toBe('enriched');
    expect(hz.calls).toHaveLength(1);
    expect(hz.closed).toHaveLength(1);
    expect(hz.closed[0]).toMatchObject({
      attemptId: 'attempt-1', outcome: 'enriched',
      providerCalled: true, sourceRecordId: 'src-1', completedAt: NOW,
    });
  });
});

// ── 2. refusal before any provider call ─────────────────────────────────────

describe('A4E — a pre-call refusal records no provider call', () => {
  it('2. credential_missing: provider_called stays false, and nobody is contacted', async () => {
    const hz = harness({ credential: null });
    const out = await run(hz);

    expect(out.result.outcome).toBe('credential_missing');
    expect(hz.calls).toHaveLength(0);
    expect(hz.closed[0]).toMatchObject({ outcome: 'credential_missing', providerCalled: false });
    expect(hz.closed[0].completedAt).toBe(NOW);
  });

  it('duplicate_suppressed is a real attempt that contacted nobody', async () => {
    const hz = harness({ recent: { observedAt: '2026-09-04T00:00:00.000Z' } });
    const out = await run(hz);

    expect(out.result.outcome).toBe('duplicate_suppressed');
    expect(hz.calls).toHaveLength(0);
    expect(hz.closed[0]).toMatchObject({ outcome: 'duplicate_suppressed', providerCalled: false });
  });
});

// ── 3. provider was reached and failed ──────────────────────────────────────

describe('A4E — a provider failure after transport keeps provider_called true', () => {
  it('3. a classified provider failure records the call that produced it', async () => {
    const hz = harness({ response: { outcome: 'no_match', fields: [], notReturned: ['employee_count'] } });
    const out = await run(hz);

    expect(out.result.outcome).toBe('no_match');
    expect(hz.calls).toHaveLength(1);
    expect(hz.closed[0]).toMatchObject({ outcome: 'no_match', providerCalled: true });
  });

  it('a thrown transport error is classified, and still counted as a call', async () => {
    const hz = harness({ adapterThrows: new Error('socket timed out') });
    const out = await run(hz);

    expect(out.result.outcome).toBe('timeout');
    expect(hz.closed[0]).toMatchObject({ outcome: 'timeout', providerCalled: true });
  });
});

// ── 4. G1 ───────────────────────────────────────────────────────────────────

describe('A4E — G1: persistence fails AFTER the provider was paid', () => {
  it('4. the attempt is closed with provider_called TRUE, and the error survives', async () => {
    const boom = new Error('source_records insert failed');
    const hz = harness({ persistThrows: boom });

    await expect(run(hz)).rejects.toThrow('source_records insert failed');

    // the provider WAS contacted — exactly once
    expect(hz.calls).toHaveLength(1);

    // and the record says so, instead of the insert-time default
    expect(hz.closed).toHaveLength(1);
    expect(hz.closed[0].providerCalled).toBe(true);

    // the attempt is terminal, not left open
    expect(hz.closed[0].completedAt).toBe(NOW);

    // and the failure is described rather than dressed up as a provider verdict
    expect(String(hz.closed[0].detail)).toContain('source_records insert failed');
    expect(hz.closed[0].outcome).toBeNull();
  });

  it('the same holds when releaseCost throws after a provider call', async () => {
    const hz = harness({
      response: { outcome: 'no_match', fields: [], notReturned: [] },
      releaseThrows: new Error('cost release failed'),
    });

    await expect(run(hz)).rejects.toThrow('cost release failed');
    expect(hz.calls).toHaveLength(1);
    expect(hz.closed[0].providerCalled).toBe(true);
    expect(hz.closed[0].completedAt).toBe(NOW);
  });

  it('a throw BEFORE any provider call records provider_called false', async () => {
    // Credential resolution throwing is our failure, not the vendor's, and no
    // egress happened. The recorder must not over-report a call.
    const hz = harness();
    const ports: ExecuteEnrichmentPorts = {
      ...hz.ports,
      async resolveCredential() { throw new Error('credential store unreachable'); },
    };

    await expect(executeEnrichmentRecorded(
      request, 'clearbit', ports, { adapter: hz.adapter, recorder: hz.recorder as never },
    )).rejects.toThrow('credential store unreachable');

    expect(hz.calls).toHaveLength(0);
    expect(hz.closed[0].providerCalled).toBe(false);
    expect(hz.closed[0].completedAt).toBe(NOW);
  });
});

// ── 5. no duplicate call ────────────────────────────────────────────────────

describe('A4E — closing the attempt never re-executes anything', () => {
  it('5. the provider is called exactly once across a G1 failure', async () => {
    const hz = harness({ persistThrows: new Error('persist failed') });
    await expect(run(hz)).rejects.toThrow('persist failed');
    expect(hz.calls).toHaveLength(1);
  });

  it('a failure to CLOSE the attempt does not re-execute or mask the original error', async () => {
    const hz = harness({ persistThrows: new Error('persist failed') });
    const recorder = { ...hz.recorder, complete: async () => { throw new Error('close failed'); } };

    // The ORIGINAL error propagates, not the recorder's.
    await expect(executeEnrichmentRecorded(
      request, 'clearbit', hz.ports, { adapter: hz.adapter, recorder: recorder as never },
    )).rejects.toThrow('persist failed');
    expect(hz.calls).toHaveLength(1);
  });
});

// ── 6. A4A's recording-failure behaviour is preserved ───────────────────────

describe('A4E — A4A behaviour is unchanged', () => {
  it('6. a failure to OPEN the attempt still lets the enrichment proceed', async () => {
    const hz = harness({ recordThrows: true });
    const out = await run(hz);

    expect(out.result.outcome).toBe('enriched');   // the work still happened
    expect(out.attemptId).toBeNull();              // and the gap is visible
    expect(hz.calls).toHaveLength(1);              // exactly one execution
    expect(hz.closed).toHaveLength(0);             // nothing to close
  });

  it('an open failure followed by an execution throw records nothing and still throws', async () => {
    const hz = harness({ recordThrows: true, persistThrows: new Error('persist failed') });
    await expect(run(hz)).rejects.toThrow('persist failed');
    expect(hz.closed).toHaveLength(0);
    expect(hz.calls).toHaveLength(1);
  });
});

// ── retry safety: the four states stay distinguishable ──────────────────────

describe('A4E — a future retry loop can still tell the four states apart', () => {
  it('never attempted vs attempted-and-failed vs persisted vs suppressed', async () => {
    const persisted = harness();
    await run(persisted);
    expect(persisted.closed[0]).toMatchObject({ providerCalled: true, outcome: 'enriched', sourceRecordId: 'src-1' });

    const suppressed = harness({ recent: { observedAt: '2026-09-04T00:00:00.000Z' } });
    await run(suppressed);
    expect(suppressed.closed[0]).toMatchObject({ providerCalled: false, outcome: 'duplicate_suppressed' });

    const neverCalled = harness({ credential: null });
    await run(neverCalled);
    expect(neverCalled.closed[0]).toMatchObject({ providerCalled: false, outcome: 'credential_missing' });

    const calledThenFailed = harness({ persistThrows: new Error('persist failed') });
    await expect(run(calledThenFailed)).rejects.toThrow();
    expect(calledThenFailed.closed[0]).toMatchObject({ providerCalled: true, outcome: null });
    expect(calledThenFailed.closed[0].completedAt).toBe(NOW);

    // The load-bearing distinction: the paid-but-unpersisted attempt is NOT
    // indistinguishable from the one that never reached the provider.
    expect(calledThenFailed.closed[0].providerCalled)
      .not.toBe(neverCalled.closed[0].providerCalled);
  });
});
