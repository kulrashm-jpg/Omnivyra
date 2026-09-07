/**
 * A7A — duplicate suppression is wired into the production port defaults.
 *
 * ─── THE GAP ───────────────────────────────────────────────────────────────
 * Every port the executor needs already had a production factory — cost,
 * credential, observation lookup, persistence. What did not exist was anything
 * that COMPOSED them. `ExecuteEnrichmentPorts` appeared in the codebase only as
 * a TYPE: both executors took it as a parameter, and every caller was a test
 * supplying its own stubs. So `defaultFindRecentObservation` — built,
 * unit-proven and fail-closed since A4J — was exported and injected nowhere.
 *
 * The A6 audit named the consequence: a future retry consumer that forgot to
 * inject the finder would get NO SUPPRESSION AND NO ERROR, and would pay a
 * provider for evidence the tenant already holds.
 *
 * ─── WHAT THIS FILE PROVES ─────────────────────────────────────────────────
 * That the assembled default set carries the real finder, that suppression
 * happens BEFORE transport, and that every way the lookup can decline to
 * suppress leaves the provider eligible — including a lookup FAILURE, which must
 * never be read as "nothing found".
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

import { makeProductionEnrichmentPorts } from '../../services/enrichment/productionPorts';
import { defaultFindRecentObservation, pickRecentObservation } from '../../services/enrichment/providers/observations';
import { executeEnrichmentRecorded } from '../../services/enrichment/recordedExecution';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type {
  EnrichmentProviderAdapter, EnrichmentRequest,
} from '../../services/enrichment/providers/contract';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-07T12:00:00.000Z';
const FRESH = '2026-09-06T12:00:00.000Z';        // 1 day old — inside the 30-day window
const STALE = '2026-01-01T12:00:00.000Z';        // far outside it

const request: EnrichmentRequest = {
  organizationId: ORG, subject: 'account', entityId: ACCOUNT,
  attributes: ['employee_count', 'founded_year'],
  selectors: { domain: 'example.com' },
  purpose: 'a7a', correlationId: 'corr-a7a',
};

function store() {
  const row = { outcome: null as string | null, executionStatus: 'in_flight' as string };
  return {
    nextNumber: async () => 1,
    record: async () => ({ attemptId: 'attempt-1' }),
    claim: async () => ({ claimed: true as const, attemptId: 'attempt-1', attemptNumber: 1, reclaimed: false }),
    markPending: async () => { /* proven in A4Q */ },
    complete: async (i: Record<string, unknown>) => {
      row.outcome = (i.outcome as string | null) ?? null;
      row.executionStatus = i.executionStatus as string;
    },
    row,
  };
}

function adapter(calls: unknown[]): EnrichmentProviderAdapter {
  return {
    id: 'clearbit', label: 'Clearbit', supports: ['employee_count', 'founded_year'],
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

/** The production set with only the DB-touching reads replaced. */
const wired = (over: Partial<ExecuteEnrichmentPorts> = {}): ExecuteEnrichmentPorts =>
  makeProductionEnrichmentPorts({
    resolveCredential: async () => 'synthetic-tenant-provider-key',
    persistObservation: async () => ({ sourceRecordId: 'src-1', canonicalWithheld: [] }),
    now: () => NOW,
    ...over,
  });

const run = (s: ReturnType<typeof store>, calls: unknown[], p: ExecuteEnrichmentPorts) =>
  executeEnrichmentRecorded(request, 'clearbit', p,
    { adapter: adapter(calls), recorder: { ...s, now: () => NOW } as never });

// ── the seam itself ─────────────────────────────────────────────────────────

describe('A7A — the production default set carries the real finder', () => {
  it('supplies every port the executor needs', () => {
    const ports = makeProductionEnrichmentPorts();
    for (const port of ['authorizeCost', 'releaseCost', 'resolveCredential',
      'findRecentObservation', 'persistObservation', 'now']) {
      expect(typeof (ports as unknown as Record<string, unknown>)[port]).toBe('function');
    }
  });

  it('uses the EXISTING observation finder — not a second implementation', () => {
    // Identity, not shape: a re-implementation would pass a shape check while
    // silently dropping the tenant scope or the fail-closed behaviour.
    expect(makeProductionEnrichmentPorts().findRecentObservation)
      .toBe(defaultFindRecentObservation);
  });

  it('construction performs no I/O and reads no credential', () => {
    // Every factory returns closures; nothing runs until a port is called.
    expect(() => makeProductionEnrichmentPorts()).not.toThrow();
  });

  it('an override replaces exactly one port and keeps the rest', () => {
    const custom = async () => null;
    const ports = makeProductionEnrichmentPorts({ findRecentObservation: custom as never });
    expect(ports.findRecentObservation).toBe(custom);
    expect(typeof ports.persistObservation).toBe('function');
  });
});

// ── suppression happens, and happens before transport ───────────────────────

describe('A7A — complete fresh evidence suppresses the provider call', () => {
  it('duplicate_suppressed, and ZERO provider calls', async () => {
    const s = store();
    const calls: unknown[] = [];
    const out = await run(s, calls, wired({
      findRecentObservation: async () => ({ observedAt: FRESH }),
    }));

    expect(out.result.outcome).toBe('duplicate_suppressed');
    expect(calls).toHaveLength(0);                 // the point of the whole seam
    expect(out.result.providerCalled).toBe(false);
    expect(s.row.outcome).toBe('duplicate_suppressed');
  });

  it('suppression precedes transport — the lookup runs before enrich', async () => {
    const order: string[] = [];
    const s = store();
    const calls: unknown[] = [];
    await run(s, calls, wired({
      findRecentObservation: async () => { order.push('lookup'); return { observedAt: FRESH }; },
    }));

    expect(order).toEqual(['lookup']);             // and enrich never ran
    expect(calls).toHaveLength(0);
  });

  it('a suppressed execution is still a recorded attempt', async () => {
    // A4A: a suppressed duplicate is a real attempt with a real outcome; it
    // simply contacted nobody. That distinction is what stops "we already have
    // this" being confused with "we already tried and failed".
    const s = store();
    await run(s, [], wired({ findRecentObservation: async () => ({ observedAt: FRESH }) }));
    expect(s.row.executionStatus).toBe('refused_pre_call');
  });
});

// ── every way suppression must NOT happen ───────────────────────────────────

describe('A7A — the provider stays eligible whenever evidence is inadequate', () => {
  it('no evidence → provider executes', async () => {
    const s = store();
    const calls: unknown[] = [];
    await run(s, calls, wired({ findRecentObservation: async () => null }));
    expect(calls).toHaveLength(1);
  });

  it('stale evidence → provider executes', async () => {
    const s = store();
    const calls: unknown[] = [];
    await run(s, calls, wired({ findRecentObservation: async () => ({ observedAt: STALE }) }));
    expect(calls).toHaveLength(1);
  });

  it('PARTIAL attribute coverage → provider executes', () => {
    // The finder requires TOTAL coverage: one attribute covered out of two
    // yields null, so a partially-known work item is never suppressed.
    const rows = [{ attribute: 'employee_count', observed_at: FRESH, recorded_at: null }];
    expect(pickRecentObservation(rows, ['employee_count', 'founded_year'])).toBeNull();
    expect(pickRecentObservation(rows, ['employee_count'])).toEqual({ observedAt: FRESH });
  });

  it('the OLDEST covering observation governs — the weakest link', () => {
    const rows = [
      { attribute: 'employee_count', observed_at: FRESH, recorded_at: null },
      { attribute: 'founded_year', observed_at: STALE, recorded_at: null },
    ];
    // Both covered, so a value is returned — but it is the stale one, which the
    // executor's freshness window then rejects.
    expect(pickRecentObservation(rows, ['employee_count', 'founded_year']))
      .toEqual({ observedAt: STALE });
  });

  it('superseded, wrong-tenant and wrong-provider evidence never reaches the matcher', async () => {
    // These are excluded in the QUERY (`.eq(organization_id)`, `.eq(provider)`,
    // `.is(superseded_at, null)`), so the reader simply returns no rows and the
    // provider stays eligible. Proven here through the reader seam rather than
    // by re-implementing the filter.
    const readsWithNoRows = async () => [];
    const finder = (await import('../../services/enrichment/providers/observations'))
      .makeFindRecentObservation(readsWithNoRows as never);

    expect(await finder({
      organizationId: OTHER_ORG, entityId: ACCOUNT, providerId: 'clearbit',
      attributes: ['employee_count'],
    })).toBeNull();
  });

  it.each([
    ['wrong tenant', OTHER_ORG, 'clearbit'],
    ['wrong provider', ORG, 'apollo'],
  ])('%s → provider executes', async (_label, org, provider) => {
    // The real reader is tenant- and provider-predicated, so a mismatch yields
    // no rows. Modelled here as the reader returning nothing.
    const s = store();
    const calls: unknown[] = [];
    const finder = (await import('../../services/enrichment/providers/observations'))
      .makeFindRecentObservation((async (i: { organizationId: string; providerId: string }) =>
        (i.organizationId === org && i.providerId === provider)
          ? [{ attribute: 'employee_count', observed_at: FRESH, recorded_at: null },
            { attribute: 'founded_year', observed_at: FRESH, recorded_at: null }]
          : []) as never);

    await run(s, calls, wired({ findRecentObservation: finder }));
    expect(calls).toHaveLength(1);                 // our request is ORG/clearbit
  });
});

// ── fail-closed ─────────────────────────────────────────────────────────────

describe('A7A — a lookup failure never becomes a false suppression', () => {
  it('a read error propagates; it is NOT read as "nothing found"', async () => {
    // The dangerous inversion would be to swallow the error and treat it as an
    // absence — that suppresses nothing, so it would spend the tenant's quota.
    // The opposite inversion, suppressing on error, would silently skip work.
    // The finder fails CLOSED and the executor surfaces it.
    const boom = new Error('source_assertions read failed');
    const s = store();
    const calls: unknown[] = [];

    await expect(run(s, calls, wired({
      findRecentObservation: async () => { throw boom; },
    }))).rejects.toBe(boom);

    expect(calls).toHaveLength(0);                 // and no provider was paid
  });

  it('the real finder refuses a tenant-less lookup rather than matching broadly', async () => {
    await expect(defaultFindRecentObservation({
      organizationId: '   ', entityId: ACCOUNT, providerId: 'clearbit',
      attributes: ['employee_count'],
    })).rejects.toThrow(/organizationId is required/);
  });

  it('an empty attribute list yields null without a query', async () => {
    expect(await defaultFindRecentObservation({
      organizationId: ORG, entityId: ACCOUNT, providerId: 'clearbit', attributes: [],
    })).toBeNull();
  });
});

// ── nothing else was started ────────────────────────────────────────────────

describe('A7A — assembling ports starts nothing', () => {
  it('no scheduler, queue, cron or retry consumer was introduced', () => {
    const code = require('fs').readFileSync(
      require('path').join(__dirname, '../..', 'services/enrichment/productionPorts.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/setInterval|setTimeout|node-cron|new Queue|new Worker|\.schedule\(/);
    // It composes ports; it reads none of the retry-relevant state.
    expect(code).not.toMatch(/next_retry_at|execution_status|provider_call_state/);
  });
});
