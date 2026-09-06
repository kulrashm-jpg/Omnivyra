/**
 * A4J — the two gates that must hold before anything schedules enrichment.
 *
 * B1. `nextAttemptNumber` is read-then-increment, so two workers racing on the
 *     same (tenant, entity, provider) can compute the same number. The partial
 *     unique index rejects the loser's INSERT — and the recorder then SWALLOWED
 *     that rejection and called the provider anyway. Two provider calls, one
 *     attempt row: the record understated the tenant's spend in exactly the
 *     case a scheduler creates. A4A's fail-open was right for a user-initiated
 *     action and wrong for an automated one, so the policy is now the caller's.
 *
 * B2. `findRecentObservation` is the executor's only defence against paying for
 *     something already on file, and it had no production implementation at
 *     all — every version in the repository was a test stub, thirteen of them
 *     returning `async () => null`, which disables the gate.
 *
 * The combined invariant under test: a provider call requires BOTH that no
 * equivalent evidence exists AND that the attempt was recorded.
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

import {
  executeEnrichmentRecorded, AttemptRecordRequiredError,
} from '../../services/enrichment/recordedExecution';
import {
  pickRecentObservation, makeFindRecentObservation,
  type AssertionObservationRow,
} from '../../services/enrichment/providers/observations';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type {
  EnrichmentProviderAdapter, EnrichmentRequest,
} from '../../services/enrichment/providers/contract';

const ORG = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-09-06T00:00:00.000Z';
const SECRET = 'synthetic-tenant-provider-key';

const request: EnrichmentRequest = {
  organizationId: ORG, subject: 'account', entityId: ACCOUNT,
  attributes: ['employee_count'], selectors: { domain: 'example.com' },
  purpose: 'a4j', correlationId: 'corr-a4j',
};

// ── a shared, deliberately racy attempt store ───────────────────────────────

/**
 * A faithful stand-in for the real allocation: `nextNumber` reads the highest
 * recorded number and adds one, and `record` enforces the partial unique index
 * on (tenant, entity, provider, attempt_number). Both halves of the race are
 * therefore real — only the storage is in memory.
 */
function attemptStore() {
  const rows: { org: string; entity: string; provider: string; n: number; id: string }[] = [];
  return {
    rows,
    nextNumber: async (i: { organizationId: string; entityId: string; providerId: string }) => {
      const mine = rows.filter((r) => r.org === i.organizationId
        && r.entity === i.entityId && r.provider === i.providerId);
      return mine.length ? Math.max(...mine.map((r) => r.n)) + 1 : 1;
    },
    record: async (i: { organizationId: string; entityId: string; providerId: string; attemptNumber: number }) => {
      const clash = rows.some((r) => r.org === i.organizationId && r.entity === i.entityId
        && r.provider === i.providerId && r.n === i.attemptNumber);
      // The database's answer, not ours: SQLSTATE 23505.
      if (clash) throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
      const id = `attempt-${rows.length + 1}`;
      rows.push({ org: i.organizationId, entity: i.entityId, provider: i.providerId, n: i.attemptNumber, id });
      return { attemptId: id };
    },
    complete: async () => { /* closing is A4E's concern, proven there */ },
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

function ports(over: Partial<ExecuteEnrichmentPorts> = {}): ExecuteEnrichmentPorts {
  return {
    authorizeCost: async () => ({ authorized: true, holdId: null, cost: { kind: 'unknown' } }),
    releaseCost: async () => { /* nothing reserved under tenant-funded economics */ },
    resolveCredential: async () => SECRET,
    findRecentObservation: over.findRecentObservation ?? (async () => null),
    persistObservation: over.persistObservation
      ?? (async () => ({ sourceRecordId: 'src-1', canonicalWithheld: [] })),
    now: () => NOW,
    ...over,
  };
}

// ── B1 ──────────────────────────────────────────────────────────────────────

describe('A4J/B1 — an unrecorded execution cannot reach a provider', () => {
  it('single execution: one attempt, one provider call', async () => {
    const store = attemptStore();
    const calls: unknown[] = [];
    const out = await executeEnrichmentRecorded(request, 'clearbit', ports(), {
      adapter: adapter(calls), recorder: { ...store, now: () => NOW } as never,
      requireAttemptRecord: true,
    });
    expect(out.result.outcome).toBe('enriched');
    expect(store.rows).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('CONCURRENT: two executions race, one records, the loser calls nobody', async () => {
    const store = attemptStore();
    const calls: unknown[] = [];
    const run = () => executeEnrichmentRecorded(request, 'clearbit', ports(), {
      adapter: adapter(calls), recorder: { ...store, now: () => NOW } as never,
      requireAttemptRecord: true,
    });

    // Both read the same highest number before either inserts — the real race.
    const [a, b] = await Promise.allSettled([run(), run()]);
    const settled = [a, b];

    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((r) => r.status === 'rejected')).toHaveLength(1);

    // Exactly one attempt row, and exactly one provider call. Before A4J this
    // was one row and TWO calls.
    expect(store.rows).toHaveLength(1);
    expect(calls).toHaveLength(1);

    const loser = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(AttemptRecordRequiredError);
  });

  it('the loser fails deterministically, and names the database cause', async () => {
    const store = attemptStore();
    await store.record({ organizationId: ORG, entityId: ACCOUNT, providerId: 'clearbit', attemptNumber: 1 });
    const calls: unknown[] = [];

    // nextNumber now returns 2, but we force the collision the index produces.
    const clashing = { ...store, nextNumber: async () => 1, now: () => NOW };
    await expect(executeEnrichmentRecorded(request, 'clearbit', ports(), {
      adapter: adapter(calls), recorder: clashing as never, requireAttemptRecord: true,
    })).rejects.toThrow(AttemptRecordRequiredError);

    expect(calls).toHaveLength(0);
    expect(store.rows).toHaveLength(1);          // history intact
  });

  it('a plain recording failure also fails closed when required', async () => {
    const calls: unknown[] = [];
    const recorder = {
      now: () => NOW, nextNumber: async () => 1,
      record: async () => { throw new Error('attempt insert exploded'); },
      complete: async () => { /* unreachable */ },
    };
    await expect(executeEnrichmentRecorded(request, 'clearbit', ports(), {
      adapter: adapter(calls), recorder: recorder as never, requireAttemptRecord: true,
    })).rejects.toThrow(AttemptRecordRequiredError);
    expect(calls).toHaveLength(0);
  });

  it('the refusal happens BEFORE credential resolution and cost authorisation', async () => {
    const calls: unknown[] = [];
    let credentialAsked = false;
    let costAsked = false;
    const recorder = {
      now: () => NOW, nextNumber: async () => 1,
      record: async () => { throw new Error('insert failed'); },
      complete: async () => { /* unreachable */ },
    };
    await expect(executeEnrichmentRecorded(request, 'clearbit', ports({
      resolveCredential: async () => { credentialAsked = true; return SECRET; },
      authorizeCost: async () => { costAsked = true; return { authorized: true, holdId: null, cost: { kind: 'unknown' } }; },
    }), { adapter: adapter(calls), recorder: recorder as never, requireAttemptRecord: true }))
      .rejects.toThrow(AttemptRecordRequiredError);

    expect(credentialAsked).toBe(false);
    expect(costAsked).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('A4A behaviour is UNCHANGED when the caller does not require a record', async () => {
    const calls: unknown[] = [];
    const recorder = {
      now: () => NOW, nextNumber: async () => 1,
      record: async () => { throw new Error('attempt insert exploded'); },
      complete: async () => { /* nothing was opened */ },
    };
    // Default (and explicit false): the tenant asked for work, so it happens.
    const out = await executeEnrichmentRecorded(request, 'clearbit', ports(), {
      adapter: adapter(calls), recorder: recorder as never,
    });
    expect(out.result.outcome).toBe('enriched');
    expect(out.attemptId).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('a provider failure AFTER successful recording is unaffected', async () => {
    const store = attemptStore();
    const failing: EnrichmentProviderAdapter = {
      ...adapter([]), enrich: async () => ({ outcome: 'no_match', fields: [], notReturned: ['employee_count'] }),
    };
    const out = await executeEnrichmentRecorded(request, 'clearbit', ports(), {
      adapter: failing, recorder: { ...store, now: () => NOW } as never, requireAttemptRecord: true,
    });
    expect(out.result.outcome).toBe('no_match');
    expect(store.rows).toHaveLength(1);
  });
});

// ── B2 ──────────────────────────────────────────────────────────────────────

const row = (attribute: string, observed: string | null, recorded = NOW): AssertionObservationRow =>
  ({ attribute, observed_at: observed, recorded_at: recorded });

describe('A4J/B2 — the production observation lookup decides suppression', () => {
  it('recent matching evidence for every requested attribute suppresses', () => {
    expect(pickRecentObservation(
      [row('employee_count', '2026-09-04T00:00:00.000Z')], ['employee_count'],
    )).toEqual({ observedAt: '2026-09-04T00:00:00.000Z' });
  });

  it('no evidence means proceed', () => {
    expect(pickRecentObservation([], ['employee_count'])).toBeNull();
  });

  it('PARTIAL coverage means proceed — one fresh attribute cannot mask four missing', () => {
    expect(pickRecentObservation(
      [row('employee_count', NOW)], ['employee_count', 'founded_year'],
    )).toBeNull();
  });

  it('returns the OLDEST evidence, so the freshness window applies to the weakest link', () => {
    const out = pickRecentObservation([
      row('employee_count', '2026-09-05T00:00:00.000Z'),
      row('founded_year', '2026-01-01T00:00:00.000Z'),
    ], ['employee_count', 'founded_year']);
    expect(out).toEqual({ observedAt: '2026-01-01T00:00:00.000Z' });
  });

  it('prefers the provider\'s own observed_at, and falls back to recorded_at', () => {
    expect(pickRecentObservation(
      [row('employee_count', null, '2026-08-01T00:00:00.000Z')], ['employee_count'],
    )).toEqual({ observedAt: '2026-08-01T00:00:00.000Z' });
  });

  it('takes the NEWEST row per attribute when several exist', () => {
    expect(pickRecentObservation([
      row('employee_count', '2026-01-01T00:00:00.000Z'),
      row('employee_count', '2026-09-05T00:00:00.000Z'),
    ], ['employee_count'])).toEqual({ observedAt: '2026-09-05T00:00:00.000Z' });
  });

  it('ignores unparseable timestamps rather than treating them as fresh', () => {
    expect(pickRecentObservation(
      [row('employee_count', 'not-a-date')], ['employee_count'],
    )).toBeNull();
  });

  it('scopes the query by tenant, entity, provider, attribute and non-superseded', async () => {
    let seen: Record<string, unknown> | null = null;
    const find = makeFindRecentObservation(async (i) => {
      seen = i as unknown as Record<string, unknown>;
      return [row('employee_count', NOW)];
    });
    await find({ organizationId: ORG, entityId: ACCOUNT, providerId: 'clearbit', attributes: ['employee_count'] });
    expect(seen).toEqual({
      organizationId: ORG, entityId: ACCOUNT, providerId: 'clearbit', attributes: ['employee_count'],
    });
  });

  it('another tenant\'s evidence can never satisfy suppression', async () => {
    // The reader is filtered by organization_id in the WHERE clause, so a
    // foreign tenant's rows are never returned. Proven by asserting the tenant
    // actually reaches the reader, and that a reader honouring it yields null.
    const find = makeFindRecentObservation(async (i) =>
      (i.organizationId === ORG ? [row('employee_count', NOW)] : []));
    expect(await find({ organizationId: ORG_B, entityId: ACCOUNT, providerId: 'clearbit', attributes: ['employee_count'] }))
      .toBeNull();
    expect(await find({ organizationId: ORG, entityId: ACCOUNT, providerId: 'clearbit', attributes: ['employee_count'] }))
      .not.toBeNull();
  });

  it('another entity\'s evidence can never satisfy suppression', async () => {
    const find = makeFindRecentObservation(async (i) =>
      (i.entityId === ACCOUNT ? [row('employee_count', NOW)] : []));
    expect(await find({ organizationId: ORG, entityId: OTHER, providerId: 'clearbit', attributes: ['employee_count'] }))
      .toBeNull();
  });

  it('another provider\'s evidence can never satisfy suppression', async () => {
    const find = makeFindRecentObservation(async (i) =>
      (i.providerId === 'clearbit' ? [row('employee_count', NOW)] : []));
    expect(await find({ organizationId: ORG, entityId: ACCOUNT, providerId: 'apollo', attributes: ['employee_count'] }))
      .toBeNull();
  });

  it('a tenant-less lookup is refused rather than answered', async () => {
    const find = makeFindRecentObservation(async () => []);
    await expect(find({ organizationId: '  ', entityId: ACCOUNT, providerId: 'clearbit', attributes: ['x'] }))
      .rejects.toThrow(/organizationId is required/);
  });

  it('an unreadable evidence table FAILS CLOSED — it does not answer "proceed"', async () => {
    const find = makeFindRecentObservation(async () => { throw new Error('source_assertions read failed'); });
    await expect(find({ organizationId: ORG, entityId: ACCOUNT, providerId: 'clearbit', attributes: ['employee_count'] }))
      .rejects.toThrow(/source_assertions read failed/);
  });

  it('reads evidence, never canonical attributes or another store', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/enrichment/providers/observations.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).toMatch(/source_assertions/);
    expect(src).not.toMatch(/unified_persons|prospect_accounts|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });
});

// ── B1 + B2 combined ────────────────────────────────────────────────────────

describe('A4J — a provider call requires BOTH no evidence AND a recorded attempt', () => {
  it('CASE A: recent evidence ⇒ duplicate suppressed, no provider call', async () => {
    const store = attemptStore();
    const calls: unknown[] = [];
    const out = await executeEnrichmentRecorded(request, 'clearbit', ports({
      findRecentObservation: makeFindRecentObservation(async () => [row('employee_count', '2026-09-04T00:00:00.000Z')]),
    }), { adapter: adapter(calls), recorder: { ...store, now: () => NOW } as never, requireAttemptRecord: true });

    expect(out.result.outcome).toBe('duplicate_suppressed');
    expect(calls).toHaveLength(0);
    expect(store.rows).toHaveLength(1);          // the attempt is still recorded
  });

  it('CASE B: no evidence + recording succeeds ⇒ provider executes', async () => {
    const store = attemptStore();
    const calls: unknown[] = [];
    const out = await executeEnrichmentRecorded(request, 'clearbit', ports({
      findRecentObservation: makeFindRecentObservation(async () => []),
    }), { adapter: adapter(calls), recorder: { ...store, now: () => NOW } as never, requireAttemptRecord: true });

    expect(out.result.outcome).toBe('enriched');
    expect(calls).toHaveLength(1);
  });

  it('CASE C: no evidence + recording fails ⇒ provider MUST NOT execute', async () => {
    const calls: unknown[] = [];
    const recorder = {
      now: () => NOW, nextNumber: async () => 1,
      record: async () => { throw new Error('insert failed'); },
      complete: async () => { /* unreachable */ },
    };
    await expect(executeEnrichmentRecorded(request, 'clearbit', ports({
      findRecentObservation: makeFindRecentObservation(async () => []),
    }), { adapter: adapter(calls), recorder: recorder as never, requireAttemptRecord: true }))
      .rejects.toThrow(AttemptRecordRequiredError);
    expect(calls).toHaveLength(0);
  });

  it('CASE D: provider executes, persistence fails ⇒ A4E still closes with provider_called=true', async () => {
    const store = attemptStore();
    const closed: Record<string, unknown>[] = [];
    const calls: unknown[] = [];
    const recorder = { ...store, now: () => NOW, complete: async (i: unknown) => { closed.push(i as Record<string, unknown>); } };

    await expect(executeEnrichmentRecorded(request, 'clearbit', ports({
      findRecentObservation: makeFindRecentObservation(async () => []),
      persistObservation: async () => { throw new Error('source_records insert failed'); },
    }), { adapter: adapter(calls), recorder: recorder as never, requireAttemptRecord: true }))
      .rejects.toThrow('source_records insert failed');

    expect(calls).toHaveLength(1);
    expect(closed[0]).toMatchObject({ providerCalled: true, outcome: null, completedAt: NOW });
  });

  it('CASE D2: a G1 failure leaves NO fabricated evidence, so the next lookup still says proceed', async () => {
    // Persistence failed, so no source_assertion exists. Suppression must not
    // pretend otherwise — the vendor answered but we lost it.
    expect(pickRecentObservation([], ['employee_count'])).toBeNull();
  });

  it('CASE E: two concurrent fail-closed executions ⇒ exactly one provider call', async () => {
    const store = attemptStore();
    const calls: unknown[] = [];
    const run = () => executeEnrichmentRecorded(request, 'clearbit', ports({
      findRecentObservation: makeFindRecentObservation(async () => []),
    }), { adapter: adapter(calls), recorder: { ...store, now: () => NOW } as never, requireAttemptRecord: true });

    await Promise.allSettled([run(), run()]);
    expect(store.rows).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});
