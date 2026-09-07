/**
 * A7 — retry SELECTION, after reconciliation with the mainline A7 seams.
 *
 * WHAT CHANGED, AND WHY THESE TESTS CHANGED WITH IT. An earlier version of this
 * module decided eligibility, re-planned, and called `executePlannedField`. All
 * three now belong to modules on `main` — `decideEnrichmentAction`,
 * `consumeEnrichmentWork` and `makeProductionEnrichmentPorts` — so the
 * assertions that held those responsibilities here have MOVED to the layer that
 * owns them, rather than being dropped:
 *
 *   "unknown never retries"        → A7D's suite, and the integration suite
 *   "a future horizon waits"       → A7D's suite, and the integration suite
 *   "terminal does not reschedule" → A7D's suite, and the integration suite
 *
 * What is proven HERE is what selection still owns: it asks for one tenant, it
 * stays bounded, it assembles a work item faithfully from the candidate, it
 * forwards the lease and the production ports without touching them, and it
 * reaches for nothing else. A selector that quietly grew a judgement of its own
 * would show up as a second decision layer, which is exactly what the
 * reconciliation removed.
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => { throw new Error('no production table in this suite'); },
}));

import {
  runRetryCycle, retryOneCandidate,
  RETRY_BATCH_SIZE, RETRY_LEASE_TTL_MS,
  type RetryConsumerPorts,
} from '../../services/enrichment/retryConsumer';
import type { RetryCandidateRow } from '../../services/enrichment/retryCandidates';
import type { ConsumeEnrichmentWorkResult } from '../../services/enrichment/consumeEnrichmentWork';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const PERSON = '55555555-5555-4555-8555-555555555555';
const NOW = '2026-09-07T12:00:00.000Z';
const DUE = '2026-09-07T11:00:00.000Z';
const WORKER = 'pi-retry-worker-1';

const candidate = (over: Partial<RetryCandidateRow> = {}): RetryCandidateRow => ({
  attemptId: 'att-1', organizationId: ORG, subject: 'account', entityId: ACCOUNT,
  providerKey: 'clearbit', requestedAttributes: ['employee_count'], attemptNumber: 1,
  correlationId: 'corr-a7', outcome: 'rate_limited', executionStatus: 'completed',
  providerCallState: 'called', completedAt: DUE, nextRetryAt: DUE,
  ...over,
} as RetryCandidateRow);

const ACCOUNT_ROW = { id: ACCOUNT, status: 'active', domain_normalized: 'northwind.test' };
const PERSON_ROW = { id: PERSON, status: 'active', primary_email: 'a@northwind.test', full_name: 'A Buyer' };

const decided = (over: Partial<ConsumeEnrichmentWorkResult> = {}): ConsumeEnrichmentWorkResult => ({
  decision: 'RETRY_PROVIDER', reason: 'transient outcome is eligible after retry horizon',
  executed: true,
  result: { result: { outcome: 'enriched' }, attemptId: 'att-2', attemptNumber: 2 },
  ...over,
} as ConsumeEnrichmentWorkResult);

/** The production port set, doubled, recording order and arguments. */
function harness(over: Partial<RetryConsumerPorts> = {}, rows: RetryCandidateRow[] = [candidate()]) {
  const calls: string[] = [];
  const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const consumed: Array<Record<string, unknown>> = [];
  const PORTS = { marker: 'production-ports' } as never;
  const ports: RetryConsumerPorts = {
    listCandidates: async (i) => { calls.push(`list:${i.organizationId}:${i.limit}`); return rows; },
    loadEntity: async (i) => {
      calls.push(`entity:${i.subject}:${i.entityId}`);
      return (i.subject === 'person' ? PERSON_ROW : ACCOUNT_ROW) as never;
    },
    freshEvidenceCovers: async () => { calls.push('fresh'); return false; },
    sourceReadiness: async () => {
      calls.push('readiness');
      return { credentialAvailable: true, sourceOperational: true };
    },
    enrichmentPorts: () => { calls.push('ports'); return PORTS; },
    consume: async (i) => {
      calls.push('consume');
      consumed.push(i as unknown as Record<string, unknown>);
      return decided();
    },
    emit: (event, fields) => { events.push({ event, fields: fields as Record<string, unknown> }); },
    ...over,
  };
  return { ports, calls, events, consumed, PORTS, names: () => events.map((e) => e.event) };
}

const run = (h: ReturnType<typeof harness>, c = candidate(), now = NOW) =>
  retryOneCandidate(c, h.ports, { workerId: WORKER, now });

// ── selection ────────────────────────────────────────────────────────────────

describe('A7 — selection is tenant-scoped and bounded', () => {
  it('asks for one tenant, bounded, at the caller\'s instant', async () => {
    const h = harness();
    await runRetryCycle({ organizationId: ORG, workerId: WORKER, now: NOW }, h.ports);
    expect(h.calls[0]).toBe(`list:${ORG}:${RETRY_BATCH_SIZE}`);
  });

  it('never exceeds the batch size, however large a batch is asked for', async () => {
    const h = harness();
    await runRetryCycle({ organizationId: ORG, workerId: WORKER, now: NOW, batchSize: 10_000 }, h.ports);
    expect(h.calls[0]).toBe(`list:${ORG}:${RETRY_BATCH_SIZE}`);
  });

  it('refuses a cycle with no tenant, and one with no worker identity', async () => {
    const h = harness();
    await expect(runRetryCycle({ organizationId: '  ', workerId: WORKER, now: NOW }, h.ports))
      .rejects.toThrow(/organizationId is required/);
    // A lease has an owner. A nameless worker cannot hold one.
    await expect(runRetryCycle({ organizationId: ORG, workerId: '  ', now: NOW }, h.ports))
      .rejects.toThrow(/workerId is required/);
    expect(h.calls).toEqual([]);
  });
});

// ── work-item assembly ───────────────────────────────────────────────────────

describe('A7 — the work item is assembled faithfully from the candidate', () => {
  it('carries the tenant, subject, entity, provider and attribute set VERBATIM', async () => {
    const h = harness();
    await run(h);
    expect(h.consumed[0].workItem).toEqual({
      organizationId: ORG, subject: 'account', entityId: ACCOUNT,
      providerId: 'clearbit', requestedAttributes: ['employee_count'],
      selectors: { domain: 'northwind.test' },
    });
  });

  it('the attribute set is neither widened, narrowed nor re-sorted', async () => {
    const h = harness();
    const attrs = ['founded_year', 'employee_count'];
    await run(h, candidate({ requestedAttributes: attrs }));
    // A4Y: the set IS the work item's identity, so the consumer must read the
    // same history the attempt belongs to.
    expect((h.consumed[0].workItem as { requestedAttributes: string[] }).requestedAttributes)
      .toEqual(attrs);
  });

  it('derives selectors through the existing canonical helper', async () => {
    const h = harness();
    await run(h, candidate({ subject: 'person', entityId: PERSON }));
    expect((h.consumed[0].workItem as { selectors: unknown }).selectors)
      .toEqual({ email: 'a@northwind.test', name: 'A Buyer' });
  });

  it('refuses when the canonical entity cannot be read in this tenant', async () => {
    const h = harness({ loadEntity: async () => null });
    const out = await run(h);
    expect(out).toMatchObject({ handed: false, skip: 'entity_unreadable' });
    expect(h.calls).not.toContain('consume');
  });

  it('refuses when the entity holds nothing a provider could search on', async () => {
    const h = harness({ loadEntity: async () => ({ id: ACCOUNT, status: 'active' }) as never });
    const out = await run(h);
    expect(out).toMatchObject({ handed: false, skip: 'selector_missing' });
    expect(h.calls).not.toContain('consume');
  });
});

// ── forwarding ───────────────────────────────────────────────────────────────

describe('A7 — the lease and the production ports are forwarded untouched', () => {
  it('passes a lease carrying THIS worker and an explicit TTL', async () => {
    const h = harness();
    await run(h);
    expect(h.consumed[0].lease).toEqual({ claimedBy: WORKER, ttlMs: RETRY_LEASE_TTL_MS });
  });

  it('forwards the production port set as the SAME object it was given', async () => {
    // Identity, not shape: A7A's whole contract is that the real singletons
    // travel through. A selector that rebuilt or spread the set could drop
    // suppression and still typecheck.
    const h = harness();
    await run(h);
    expect(h.consumed[0].ports).toBe(h.PORTS);
  });

  it('carries the failed attempt\'s correlation id rather than starting a new trace', async () => {
    const h = harness();
    await run(h);
    expect(h.consumed[0].correlationId).toBe('corr-a7');
  });

  it('reports the ambient facts it was told, and invents none', async () => {
    const h = harness({
      freshEvidenceCovers: async () => true,
      sourceReadiness: async () => ({ credentialAvailable: false, sourceOperational: false }),
    });
    await run(h);
    expect(h.consumed[0]).toMatchObject({
      freshEvidenceCoversRequest: true,
      credentialAvailable: false,
      sourceOperational: false,
    });
  });

  it('never supplies a retry horizon — that is the provider\'s, via the attempt', async () => {
    const h = harness();
    await run(h);
    const sent = JSON.stringify(h.consumed[0]);
    expect(sent).not.toContain('nextRetryAt');
    expect(sent).not.toContain('retryAfterAt');
    expect(sent).not.toContain('abandonedBefore');
  });
});

// ── the decision belongs to A7D, and is only reported here ───────────────────

describe('A7 — every judgement about a work item comes back from the consumer', () => {
  it.each([
    ['NO_ACTION', false],
    ['WAIT', false],
    ['TERMINAL', false],
    ['OPERATOR_REVIEW', false],
    ['RETRY_PROVIDER', true],
  ] as const)('reports %s without second-guessing it', async (decision, executed) => {
    const h = harness({
      consume: async () => decided({ decision, executed, result: undefined } as never),
    });
    const out = await run(h);
    expect(out.handed).toBe(true);
    expect((out as { outcome: { decision: string } }).outcome.decision).toBe(decision);
    // The selector hands over every candidate it can assemble; it does not
    // pre-empt a decision it no longer owns — `handed` is true for all five.
    expect(h.names()).toContain('decision');
  });

  it('a lost claim is reported as the consumer\'s refusal, not as a failure', async () => {
    const h = harness({
      consume: async () => decided({ executed: false, refusal: 'claim_lost', result: undefined } as never),
    });
    const out = await run(h);
    expect(out.handed).toBe(true);
    expect(h.names()).toContain('claim_lost');
  });

  it('an unrecordable attempt is reported as such — A4J fail-closed, surfaced', async () => {
    const h = harness({
      consume: async () => decided({
        executed: false, refusal: 'attempt_not_recorded', result: undefined,
      } as never),
    });
    await run(h);
    expect(h.names()).toContain('attempt_not_recorded');
  });

  it('the summary counts A7D\'s verdicts, and the selector\'s own refusals separately', async () => {
    let first = true;
    const h = harness({
      loadEntity: async () => (first ? (first = false, ACCOUNT_ROW) : null) as never,
      consume: async () => decided({ decision: 'WAIT', executed: false, result: undefined } as never),
    }, [candidate({ attemptId: 'a' }), candidate({ attemptId: 'b' })]);
    const summary = await runRetryCycle({ organizationId: ORG, workerId: WORKER, now: NOW }, h.ports);
    expect(summary).toMatchObject({
      organizationId: ORG, workerId: WORKER, discovered: 2, handed: 1, executed: 0,
      decisions: { WAIT: 1 }, skipped: { entity_unreadable: 1 },
    });
  });
});

// ── capability surface ───────────────────────────────────────────────────────

describe('A7 — the selector can reach nothing but its declared ports', () => {
  it('the order is: discover → entity → facts → ports → consume', async () => {
    const h = harness();
    await runRetryCycle({ organizationId: ORG, workerId: WORKER, now: NOW }, h.ports);
    expect(h.calls).toEqual([
      `list:${ORG}:${RETRY_BATCH_SIZE}`,
      `entity:account:${ACCOUNT}`,
      'fresh', 'readiness', 'ports', 'consume',
    ]);
  });

  it('reaches for NOTHING outside the seven declared ports', async () => {
    // A proxy answers the question that matters — what did the selector ASK
    // for — so a selector that grew an adapter, a credential resolver or a cost
    // port and used it fails here, whether or not the harness supplies one.
    const h = harness();
    const ALLOWED = new Set([
      'listCandidates', 'loadEntity', 'freshEvidenceCovers', 'sourceReadiness',
      'enrichmentPorts', 'consume', 'emit',
    ]);
    const reached: string[] = [];
    const guarded = new Proxy(h.ports as unknown as Record<string, unknown>, {
      get(target, prop) {
        const name = String(prop);
        if (name === 'then') return (target as Record<string, unknown>).then;
        reached.push(name);
        if (!ALLOWED.has(name)) {
          throw new Error(`the retry selector reached for an undeclared capability: ${name}`);
        }
        return (target as Record<string, unknown>)[name];
      },
    }) as unknown as RetryConsumerPorts;

    const summary = await runRetryCycle({ organizationId: ORG, workerId: WORKER, now: NOW }, guarded);
    expect(summary.handed).toBe(1);
    expect(new Set(reached)).toEqual(ALLOWED);
  });
});

// ── observability ────────────────────────────────────────────────────────────

describe('A7 — a cycle is reconstructable from its events', () => {
  it('emits the lifecycle, and no event carries a secret-shaped field', async () => {
    const h = harness();
    await runRetryCycle({ organizationId: ORG, workerId: WORKER, now: NOW }, h.ports);
    expect(h.names()).toEqual(expect.arrayContaining([
      'candidate_discovered', 'work_item_handed', 'decision', 'executed', 'cycle_complete',
    ]));
    for (const { fields } of h.events) {
      const json = JSON.stringify(fields).toLowerCase();
      for (const forbidden of ['api_key', 'apikey', 'credential', 'secret', 'token', 'password']) {
        expect(json).not.toContain(forbidden);
      }
    }
  });
});
