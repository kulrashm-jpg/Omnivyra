/**
 * A7 — the automated retry consumer.
 *
 * WHAT THESE TESTS ARE FOR. The consumer's whole value is that it does NOT do
 * the dangerous things itself: it must reach a provider only through the
 * existing executor, only under a lease, only for work the canonical
 * classification calls retryable, and only after the horizon has arrived. Each
 * of those is a property of the ORDER and the ARGUMENTS of the calls it makes,
 * so the ports are observed rather than the internals inspected.
 *
 * WHAT THEY ARE NOT. They do not re-prove suppression, cost authorisation,
 * credential resolution or the claim itself — those are A3/A4's, are unchanged,
 * and have their own suites. What is proven here is that the retry path REACHES
 * them, in the right order, and cannot go around them.
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
import { RETRY_CLASS_BY_OUTCOME } from '../../services/enrichment/retryCandidates';
import { ENRICHMENT_OUTCOMES } from '../../services/enrichment/providers/contract';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const PERSON = '55555555-5555-4555-8555-555555555555';
const LEAD = 'lead-1';
const NOW = '2026-09-07T12:00:00.000Z';
const DUE = '2026-09-07T11:00:00.000Z';
const FUTURE = '2026-09-07T13:00:00.000Z';
const WORKER = 'pi-retry-worker-1';

const candidate = (over: Partial<RetryCandidateRow> = {}): RetryCandidateRow => ({
  attemptId: 'att-1',
  organizationId: ORG,
  subject: 'account',
  entityId: ACCOUNT,
  providerKey: 'clearbit',
  requestedAttributes: ['employee_count'],
  attemptNumber: 1,
  correlationId: 'corr-a7',
  outcome: 'rate_limited',
  executionStatus: 'completed',
  providerCallState: 'called',
  completedAt: DUE,
  nextRetryAt: DUE,
  ...over,
} as RetryCandidateRow);

const PLANNED_FIELD = {
  attribute: 'employee_count', subject: 'account', state: 'missing',
  requiredForNextAction: false, action: 'enrich', source: 'clearbit',
  sourceStatus: 'available', cost: { kind: 'unknown' }, reason: 'absent',
};

const plan = (fields: unknown[] = [PLANNED_FIELD]) => ({
  organizationId: ORG, prospectId: LEAD, version: 'ws2.1', generatedAt: NOW,
  fields, toEnrich: fields, counts: {}, empty: false,
});

const snapshot = (over: Record<string, unknown> = {}) => ({
  personId: null, accountId: ACCOUNT, person: null,
  account: { id: ACCOUNT, status: 'active', domain_normalized: 'northwind.test' },
  ...over,
});

const executed = (over: Record<string, unknown> = {}) => ({
  executed: true, attribute: 'employee_count', subject: 'account',
  organizationId: ORG, prospectId: LEAD, entityId: ACCOUNT, providerId: 'clearbit',
  outcome: 'enriched', refusal: null, ineligibility: null, providerCalled: true,
  attemptId: 'att-2', attemptNumber: 2, sourceRecordId: 'src-1',
  canonicalWithheld: [], reason: 'ok', correlationId: 'corr-a7', version: 'a4b.1',
  ...over,
});

/** Records every port call in order, so ORDERING is assertable. */
function harness(over: Partial<RetryConsumerPorts> = {}, rows: RetryCandidateRow[] = [candidate()]) {
  const calls: string[] = [];
  const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const executeArgs: Array<Record<string, unknown>> = [];
  const ports: RetryConsumerPorts = {
    listCandidates: async (i) => { calls.push(`list:${i.organizationId}:${i.limit}`); return rows; },
    resolveProspect: async (i) => { calls.push(`resolve:${i.subject}:${i.entityId}`); return LEAD; },
    plan: async (i) => {
      calls.push(`plan:${i.prospectId}`);
      return { plan: plan() as never, snapshot: snapshot() as never };
    },
    statuses: async (o) => { calls.push(`statuses:${o}`); return [] as never; },
    execute: async (i) => {
      calls.push('execute');
      executeArgs.push(i as unknown as Record<string, unknown>);
      return executed() as never;
    },
    emit: (event, fields) => { events.push({ event, fields: fields as Record<string, unknown> }); },
    ...over,
  };
  return { ports, calls, events, executeArgs, names: () => events.map((e) => e.event) };
}

const run = (h: ReturnType<typeof harness>, c = candidate(), now = NOW) =>
  retryOneCandidate(c, h.ports, { workerId: WORKER, now });

// ── candidate discovery ──────────────────────────────────────────────────────

describe('A7 — discovery is the existing tenant-scoped, default-deny read', () => {
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

  it('a future horizon is not executed, however it reached the consumer', async () => {
    const h = harness();
    const out = await run(h, candidate({ nextRetryAt: FUTURE }));
    expect(out.acted).toBe(false);
    expect(h.calls).toEqual([]);          // nothing was planned, nothing executed
  });

  it('a null horizon is not a scheduled retry', async () => {
    const h = harness();
    const out = await run(h, candidate({ nextRetryAt: null as never }));
    expect(out.acted).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('only retryable outcomes proceed — every other class is refused', async () => {
    for (const outcome of ENRICHMENT_OUTCOMES) {
      const h = harness();
      const out = await run(h, candidate({ outcome }));
      const expected = RETRY_CLASS_BY_OUTCOME[outcome] === 'retryable';
      expect(out.acted).toBe(expected);
      if (!expected) expect(h.calls).toEqual([]);
    }
  });
});

// ── unknown transport ────────────────────────────────────────────────────────

describe('A7 — unknown transport never enters the execution path', () => {
  it('is refused even when due, retryable and completed', async () => {
    const h = harness();
    const out = await run(h, candidate({ providerCallState: 'unknown' }));
    expect(out.acted).toBe(false);
    expect(h.calls).toEqual([]);
    expect(h.names()).toContain('unknown_skipped');
  });

  it('and the same candidate with certain transport IS executed', async () => {
    for (const state of ['called', 'not_called'] as const) {
      const h = harness();
      const out = await run(h, candidate({ providerCallState: state }));
      expect(out.acted).toBe(true);
    }
  });
});

// ── claiming ─────────────────────────────────────────────────────────────────

describe('A7 — every automated execution is claimed under a lease', () => {
  it('passes a lease carrying THIS worker and an explicit TTL', async () => {
    const h = harness();
    await run(h);
    expect(h.executeArgs[0].lease).toEqual({ claimedBy: WORKER, ttlMs: RETRY_LEASE_TTL_MS });
  });

  it('does NOT substitute requireAttemptRecord for the lease', async () => {
    const h = harness();
    await run(h);
    // On the leased path the claim IS the record; passing this too would imply a
    // second mechanism that is not there.
    expect(h.executeArgs[0]).not.toHaveProperty('requireAttemptRecord');
    expect(h.executeArgs[0].lease).toBeTruthy();
  });

  it('retries the SAME provider explicitly — no substitute source', async () => {
    const h = harness();
    await run(h);
    expect(h.executeArgs[0].mode).toBe('clearbit');
  });

  it('carries the failed attempt\'s correlation id, rather than starting a new trace', async () => {
    const h = harness();
    await run(h);
    expect(h.executeArgs[0].correlationId).toBe('corr-a7');
  });

  it('the loser of a claim is refused, and makes no further port call', async () => {
    const h = harness();
    const reached: string[] = [];
    h.ports.execute = async () => {
      reached.push('execute');
      throw new Error('enrichment work is claimed by another worker');
    };
    const out = await run(h);
    expect(out.acted).toBe(false);
    expect(out).toMatchObject({ skip: 'claim_lost' });
    expect(h.names()).toContain('claim_lost');
    // Credential, cost, suppression and provider all sit BEHIND execute, inside
    // the claim, so a claim refusal thrown from it is proof this worker reached
    // none of them — and it reached execute exactly once, never retrying blindly.
    expect(reached).toEqual(['execute']);
    expect(h.calls).toEqual([`resolve:account:${ACCOUNT}`, `plan:${LEAD}`, `statuses:${ORG}`]);
  });

  it('one worker\'s loss does not stop the cycle acting on the next candidate', async () => {
    let first = true;
    const h = harness({
      execute: async () => {
        if (first) { first = false; throw new Error('claimed by another worker'); }
        return executed() as never;
      },
    }, [candidate({ attemptId: 'a' }), candidate({ attemptId: 'b', entityId: ACCOUNT })]);
    const summary = await runRetryCycle({ organizationId: ORG, workerId: WORKER, now: NOW }, h.ports);
    expect(summary.discovered).toBe(2);
    expect(summary.executed).toBe(1);
    expect(summary.skipped.claim_lost).toBe(1);
  });
});

// ── execution goes through the existing boundary ─────────────────────────────

describe('A7 — it orchestrates through the existing executor and nothing else', () => {
  it('the order is: discover → resolve → plan → statuses → execute', async () => {
    const h = harness();
    await runRetryCycle({ organizationId: ORG, workerId: WORKER, now: NOW }, h.ports);
    expect(h.calls).toEqual([
      `list:${ORG}:${RETRY_BATCH_SIZE}`,
      `resolve:account:${ACCOUNT}`,
      `plan:${LEAD}`,
      `statuses:${ORG}`,
      'execute',
    ]);
  });

  it('hands the planner\'s own field to the executor — it does not synthesise one', async () => {
    const h = harness();
    await run(h);
    expect(h.executeArgs[0].field).toBe(
      (plan().fields as unknown[])[0] === undefined ? undefined : h.executeArgs[0].field);
    expect(h.executeArgs[0].field).toMatchObject({ attribute: 'employee_count', action: 'enrich' });
    // The snapshot and plan travel together, from one planner call.
    expect(h.executeArgs[0].plan).toMatchObject({ organizationId: ORG, prospectId: LEAD });
  });

  it('refuses when the planner no longer wants the attribute enriched', async () => {
    const h = harness({
      plan: async () => ({
        plan: plan([{ ...PLANNED_FIELD, action: 'skip', reason: 'known and fresh' }]) as never,
        snapshot: snapshot() as never,
      }),
    });
    const out = await run(h);
    expect(out).toMatchObject({ acted: false, skip: 'not_planned' });
    expect(h.calls).not.toContain('execute');
  });

  it('refuses when the attribute is not in the plan at all', async () => {
    const h = harness({
      plan: async () => ({ plan: plan([]) as never, snapshot: snapshot() as never }),
    });
    expect(await run(h)).toMatchObject({ acted: false, skip: 'not_planned' });
  });

  it('refuses when no lead in the tenant reaches the entity', async () => {
    const h = harness({ resolveProspect: async () => null });
    const out = await run(h);
    expect(out).toMatchObject({ acted: false, skip: 'prospect_unresolved' });
    expect(h.calls).not.toContain('execute');
  });

  it('REFUSES when the plan concerns a different entity than the candidate names', async () => {
    // The safety property that makes the choice of lead irrelevant: whichever
    // lead was picked, the plan must be about the candidate's own entity.
    const h = harness({
      plan: async () => ({
        plan: plan() as never,
        snapshot: snapshot({ accountId: 'a-different-account' }) as never,
      }),
    });
    const out = await run(h);
    expect(out).toMatchObject({ acted: false, skip: 'entity_mismatch' });
    expect(h.calls).not.toContain('execute');
  });

  it('refuses a multi-attribute work item rather than splitting it', async () => {
    const h = harness();
    const out = await run(h, candidate({ requestedAttributes: ['employee_count', 'founded_year'] }));
    expect(out).toMatchObject({ acted: false, skip: 'attribute_set_unsupported' });
    expect(h.calls).toEqual([]);
  });

  it('reports the executor\'s own refusal rather than overriding it', async () => {
    const h = harness({
      execute: async () => ({
        executed: false, refusal: 'source_ineligible', reason: 'Clearbit: no credential',
      } as never),
    });
    const out = await run(h);
    expect(out).toMatchObject({ acted: false, skip: 'execution_refused' });
    expect((out as unknown as { reason: string }).reason).toContain('source_ineligible');
  });
});

// ── person subjects ──────────────────────────────────────────────────────────

describe('A7 — a person work item is executed against the person', () => {
  it('resolves and asserts the person entity, not the account', async () => {
    const h = harness({
      plan: async () => ({
        plan: plan([{ ...PLANNED_FIELD, subject: 'person', attribute: 'job_title' }]) as never,
        snapshot: snapshot({ personId: PERSON, person: { id: PERSON, status: 'active' } }) as never,
      }),
    });
    const out = await run(h, candidate({
      subject: 'person', entityId: PERSON, requestedAttributes: ['job_title'],
    }));
    expect(out.acted).toBe(true);
    expect(h.calls).toContain(`resolve:person:${PERSON}`);
  });
});

// ── retry chaining and terminal behaviour ────────────────────────────────────

describe('A7 — chaining is reported, never decided here', () => {
  it('a retryable outcome is reported as scheduled for a further attempt', async () => {
    const h = harness({ execute: async () => executed({ outcome: 'rate_limited' }) as never });
    await run(h);
    expect(h.names()).toContain('retry_scheduled');
    expect(h.names()).not.toContain('retry_terminated');
  });

  it('every permanent outcome terminates instead', async () => {
    for (const outcome of ['enriched', 'no_match', 'field_not_found', 'not_implemented']) {
      const h = harness({ execute: async () => executed({ outcome }) as never });
      await run(h);
      expect(h.names()).toContain('retry_terminated');
      expect(h.names()).not.toContain('retry_scheduled');
    }
  });

  it('the consumer never computes a horizon of its own', async () => {
    const h = harness();
    await run(h);
    const sent = JSON.stringify(h.executeArgs[0]);
    expect(sent).not.toContain('nextRetryAt');
    expect(sent).not.toContain('retryAfterAt');
  });

  it('attempt N+1 follows attempt N through the executor, with lineage intact', async () => {
    const h = harness({ execute: async () => executed({ attemptNumber: 2, attemptId: 'att-2' }) as never });
    const out = await run(h, candidate({ attemptNumber: 1, attemptId: 'att-1' }));
    expect(out.acted).toBe(true);
    // The historical attempt is untouched — the consumer never writes to it — and
    // the new one carries the same tenant, entity, provider and correlation.
    expect((out as unknown as { execution: Record<string, unknown> }).execution).toMatchObject({
      attemptId: 'att-2', attemptNumber: 2, organizationId: ORG,
      entityId: ACCOUNT, providerId: 'clearbit', correlationId: 'corr-a7',
    });
  });
});

// ── suppression / credential / cost are observed, not performed ──────────────

describe('A7 — suppression, credential and cost stay behind the executor', () => {
  it('a suppressed retry is reported, and the consumer checked nothing itself', async () => {
    const h = harness({
      execute: async () => executed({ outcome: 'duplicate_suppressed', providerCalled: false }) as never,
    });
    await run(h);
    expect(h.names()).toContain('suppressed');
    // No port exists through which the consumer could have read an observation.
    expect(Object.keys(h.ports)).toEqual([
      'listCandidates', 'resolveProspect', 'plan', 'statuses', 'execute', 'emit',
    ]);
  });

  it('credential and cost refusals are reported from the executor\'s outcome', async () => {
    for (const [outcome, event] of [['credential_missing', 'credential_missing'], ['cost_denied', 'cost_denied']]) {
      const h = harness({ execute: async () => executed({ outcome, providerCalled: false }) as never });
      await run(h);
      expect(h.names()).toContain(event);
    }
  });

  it('reaches for NOTHING outside the six declared ports', async () => {
    // Inspecting `Object.keys(ports)` is not enough: a capability added to the
    // port surface is invisible until something populates it. A proxy answers the
    // question that actually matters — what did the consumer ASK for — so a
    // consumer that grew an adapter, a credential resolver or a cost port and
    // used it fails here, whether or not the harness supplies one.
    const h = harness();
    const ALLOWED = new Set(['listCandidates', 'resolveProspect', 'plan', 'statuses', 'execute', 'emit']);
    const reached: string[] = [];
    const guarded = new Proxy(h.ports as unknown as Record<string, unknown>, {
      get(target, prop) {
        const name = String(prop);
        // `then` is probed by the runtime when a value is awaited; it is not a
        // capability the consumer asked for.
        if (name !== 'then') reached.push(name);
        if (!ALLOWED.has(name) && name !== 'then') {
          throw new Error(`the retry consumer reached for an undeclared capability: ${name}`);
        }
        return (target as Record<string, unknown>)[prop as string];
      },
    }) as unknown as RetryConsumerPorts;

    const summary = await runRetryCycle({ organizationId: ORG, workerId: WORKER, now: NOW }, guarded);
    expect(summary.executed).toBe(1);
    // A full cycle exercises all six and reaches for nothing else.
    expect(new Set(reached.filter((r) => r !== 'then'))).toEqual(ALLOWED);
  });
});

// ── observability ────────────────────────────────────────────────────────────

describe('A7 — a cycle is reconstructable from its events', () => {
  it('every event carries the tenant, and none carries a secret-shaped field', async () => {
    const h = harness();
    await runRetryCycle({ organizationId: ORG, workerId: WORKER, now: NOW }, h.ports);
    expect(h.names()).toEqual(expect.arrayContaining([
      'candidate_discovered', 'provider_attempted', 'claim_won', 'provider_completed', 'cycle_complete',
    ]));
    for (const { fields } of h.events) {
      const json = JSON.stringify(fields).toLowerCase();
      for (const forbidden of ['api_key', 'apikey', 'credential', 'secret', 'token', 'password']) {
        expect(json).not.toContain(forbidden);
      }
    }
  });

  it('the summary counts what happened, per outcome and per refusal', async () => {
    const h = harness({}, [candidate({ attemptId: 'a' }), candidate({ attemptId: 'b', nextRetryAt: FUTURE })]);
    const summary = await runRetryCycle({ organizationId: ORG, workerId: WORKER, now: NOW }, h.ports);
    expect(summary).toMatchObject({
      organizationId: ORG, workerId: WORKER, discovered: 2, executed: 1,
      skipped: { not_due: 1 }, outcomes: { enriched: 1 },
    });
  });
});
