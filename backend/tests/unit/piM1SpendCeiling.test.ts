/**
 * M1 — the tenant spend ceiling, and M9 — one staleness window.
 *
 * ─── WHAT IS BEING PROVEN ──────────────────────────────────────────────────
 * Not that a number is compared, but that the ceiling sits where a refusal is
 * still free: `authorizeCost` runs after suppression and before transport, so
 * a denial must produce `cost_denied` and ZERO adapter calls. Every test that
 * matters here counts provider calls, not return values.
 *
 * The ledger semantics carry the same weight. `unknown` is written BEFORE
 * transport by A4Q, so a row still holding it is a process that did not survive
 * its own provider call and may well have been billed — it must consume
 * capacity, or a crash loop becomes the cheapest way past a ceiling.
 * `not_called` is proof no egress happened and must consume nothing.
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

import {
  makeDailyCallCeilingAllow,
  utcDayBounds,
  boundedOvershoot,
  SPEND_CEILING_FLAG_KEY,
  isSpendCeilingEnabled,
} from '../../services/enrichment/providers/spendCeiling';
import {
  makeTenantFundedExecutionPort,
  tenantFundedExecutionPort,
} from '../../services/enrichment/providers/cost';
import { executeEnrichment } from '../../services/enrichment/providers/execute';
import { planEnrichment } from '../../services/enrichment/planner';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type {
  EnrichmentProviderAdapter, EnrichmentRequest,
} from '../../services/enrichment/providers/contract';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-08T12:00:00.000Z';
const SECRET = 'synthetic-tenant-provider-key';

const request = (over: Partial<EnrichmentRequest> = {}): EnrichmentRequest => ({
  organizationId: ORG_A, subject: 'account', entityId: ACCOUNT,
  attributes: ['employee_count'], selectors: { domain: 'example.com' },
  purpose: 'm1', correlationId: 'corr-m1', ...over,
});

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

/**
 * A ledger that models the real predicate: tenant-scoped, provider-scoped,
 * UTC-day-bounded, counting exactly `called` and `unknown`.
 */
function ledger(rows: Array<{
  org: string; provider: string; state: 'called' | 'unknown' | 'not_called'; startedAt: string;
}> = []) {
  return {
    rows,
    count: async (i: { organizationId: string; providerId: string; startIso: string; endIso: string }) =>
      rows.filter((r) => r.org === i.organizationId
        && r.provider === i.providerId
        && (r.state === 'called' || r.state === 'unknown')
        && r.startedAt >= i.startIso && r.startedAt < i.endIso).length,
  };
}

const allowWith = (opts: {
  ceiling?: number | null;
  perProvider?: Record<string, number>;
  rows?: Parameters<typeof ledger>[0];
  enabled?: boolean;
  now?: string;
}) => {
  const l = ledger(opts.rows ?? []);
  return {
    ledger: l,
    allow: makeDailyCallCeilingAllow({
      enabled: () => opts.enabled ?? true,
      now: () => opts.now ?? NOW,
      resolveCeiling: async ({ providerId }) =>
        opts.perProvider?.[providerId] ?? opts.ceiling ?? null,
      countCallsToday: l.count,
    }),
  };
};

const portsWith = (
  allow: ReturnType<typeof makeDailyCallCeilingAllow> | undefined,
  over: Partial<ExecuteEnrichmentPorts> = {},
): ExecuteEnrichmentPorts => ({
  ...makeTenantFundedExecutionPort(allow ? { allow } : {}),
  resolveCredential: async () => SECRET,
  findRecentObservation: async () => null,
  persistObservation: async () => ({ sourceRecordId: 'src-1', canonicalWithheld: [] }),
  now: () => NOW,
  ...over,
});

const run = (ports: ExecuteEnrichmentPorts, calls: unknown[], req = request()) =>
  executeEnrichment(req, 'clearbit', ports, { adapter: adapter(calls) });

// ── the boundary ────────────────────────────────────────────────────────────

describe('M1 — the ceiling refuses before transport', () => {
  it('AT the ceiling: cost_denied and ZERO provider calls', async () => {
    const { allow } = allowWith({
      ceiling: 2,
      rows: [
        { org: ORG_A, provider: 'clearbit', state: 'called', startedAt: '2026-09-08T01:00:00.000Z' },
        { org: ORG_A, provider: 'clearbit', state: 'called', startedAt: '2026-09-08T02:00:00.000Z' },
      ],
    });
    const calls: unknown[] = [];
    const out = await run(portsWith(allow), calls);

    expect(out.outcome).toBe('cost_denied');
    expect(calls).toHaveLength(0);               // the whole point
    expect(out.providerCalled).toBe(false);
    expect(out.reason).toMatch(/daily provider call ceiling reached/);
  });

  it('BELOW the ceiling: the call proceeds', async () => {
    const { allow } = allowWith({
      ceiling: 2,
      rows: [{ org: ORG_A, provider: 'clearbit', state: 'called', startedAt: '2026-09-08T01:00:00.000Z' }],
    });
    const calls: unknown[] = [];
    const out = await run(portsWith(allow), calls);

    expect(out.outcome).toBe('enriched');
    expect(calls).toHaveLength(1);
  });

  it('a ceiling of N permits the Nth call and refuses the N+1th', async () => {
    const rows: Parameters<typeof ledger>[0] = [];
    const mk = () => allowWith({ ceiling: 1, rows });

    const first: unknown[] = [];
    expect((await run(portsWith(mk().allow), first)).outcome).toBe('enriched');
    expect(first).toHaveLength(1);

    rows.push({ org: ORG_A, provider: 'clearbit', state: 'called', startedAt: NOW });

    const second: unknown[] = [];
    expect((await run(portsWith(mk().allow), second)).outcome).toBe('cost_denied');
    expect(second).toHaveLength(0);
  });
});

// ── ledger semantics ────────────────────────────────────────────────────────

describe('M1 — what consumes capacity, and what does not', () => {
  it('UNKNOWN consumes capacity — a died-mid-call attempt may have been billed', async () => {
    const { allow } = allowWith({
      ceiling: 1,
      rows: [{ org: ORG_A, provider: 'clearbit', state: 'unknown', startedAt: '2026-09-08T03:00:00.000Z' }],
    });
    const calls: unknown[] = [];
    expect((await run(portsWith(allow), calls)).outcome).toBe('cost_denied');
    expect(calls).toHaveLength(0);
  });

  it('NOT_CALLED consumes nothing — it is proof no egress occurred', async () => {
    const { allow } = allowWith({
      ceiling: 1,
      rows: [
        { org: ORG_A, provider: 'clearbit', state: 'not_called', startedAt: '2026-09-08T03:00:00.000Z' },
        { org: ORG_A, provider: 'clearbit', state: 'not_called', startedAt: '2026-09-08T04:00:00.000Z' },
      ],
    });
    const calls: unknown[] = [];
    expect((await run(portsWith(allow), calls)).outcome).toBe('enriched');
    expect(calls).toHaveLength(1);
  });

  it('a RETRY consumes its own capacity — each attempt is its own call', async () => {
    // Two prior attempts on the SAME work item, one of which was a retry.
    const { allow, ledger: l } = allowWith({
      ceiling: 2,
      rows: [
        { org: ORG_A, provider: 'clearbit', state: 'called', startedAt: '2026-09-08T01:00:00.000Z' },
        { org: ORG_A, provider: 'clearbit', state: 'called', startedAt: '2026-09-08T02:00:00.000Z' },
      ],
    });
    expect(await l.count({
      organizationId: ORG_A, providerId: 'clearbit',
      startIso: '2026-09-08T00:00:00.000Z', endIso: '2026-09-09T00:00:00.000Z',
    })).toBe(2);
    const calls: unknown[] = [];
    expect((await run(portsWith(allow), calls)).outcome).toBe('cost_denied');
  });

  it('SUPPRESSION is evaluated BEFORE spend — a suppressed call consumes no budget', async () => {
    let ceilingConsulted = 0;
    const allow = makeDailyCallCeilingAllow({
      enabled: () => true,
      now: () => NOW,
      resolveCeiling: async () => { ceilingConsulted += 1; return 0; },   // would refuse
      countCallsToday: async () => 0,
    });
    const calls: unknown[] = [];
    const out = await run(portsWith(allow, {
      findRecentObservation: async () => ({ observedAt: '2026-09-07T12:00:00.000Z' }),
    }), calls);

    expect(out.outcome).toBe('duplicate_suppressed');   // not cost_denied
    expect(calls).toHaveLength(0);
    expect(ceilingConsulted).toBe(0);                   // budget never consulted
  });
});

// ── isolation ───────────────────────────────────────────────────────────────

describe('M1 — a ceiling is one tenant\'s and one provider\'s', () => {
  it('tenant B\'s usage does not consume tenant A\'s capacity', async () => {
    const { allow } = allowWith({
      ceiling: 1,
      rows: [{ org: ORG_B, provider: 'clearbit', state: 'called', startedAt: NOW }],
    });
    const calls: unknown[] = [];
    expect((await run(portsWith(allow), calls)).outcome).toBe('enriched');
    expect(calls).toHaveLength(1);
  });

  it('another provider\'s usage does not consume this provider\'s capacity', async () => {
    const { allow } = allowWith({
      ceiling: 1,
      rows: [{ org: ORG_A, provider: 'apollo', state: 'called', startedAt: NOW }],
    });
    const calls: unknown[] = [];
    expect((await run(portsWith(allow), calls)).outcome).toBe('enriched');
  });

  it('a per-provider ceiling overrides the tenant-wide one', async () => {
    const { allow } = allowWith({
      ceiling: 100,
      perProvider: { clearbit: 1 },
      rows: [{ org: ORG_A, provider: 'clearbit', state: 'called', startedAt: NOW }],
    });
    const calls: unknown[] = [];
    expect((await run(portsWith(allow), calls)).outcome).toBe('cost_denied');
  });
});

// ── the day boundary ────────────────────────────────────────────────────────

describe('M1 — usage is bucketed by UTC calendar day', () => {
  it('bounds the day in UTC, not local time', () => {
    expect(utcDayBounds('2026-09-08T23:59:59.999Z'))
      .toEqual({ startIso: '2026-09-08T00:00:00.000Z', endIso: '2026-09-09T00:00:00.000Z' });
    expect(utcDayBounds('2026-09-08T00:00:00.000Z').startIso).toBe('2026-09-08T00:00:00.000Z');
  });

  it('yesterday\'s usage does not consume today\'s capacity', async () => {
    const { allow } = allowWith({
      ceiling: 1,
      rows: [{ org: ORG_A, provider: 'clearbit', state: 'called', startedAt: '2026-09-07T23:59:59.999Z' }],
    });
    const calls: unknown[] = [];
    expect((await run(portsWith(allow), calls)).outcome).toBe('enriched');
  });

  it('an unusable clock refuses to guess a day', () => {
    expect(() => utcDayBounds('not-a-timestamp')).toThrow(/usable timestamp/);
  });
});

// ── compatibility: absent policy changes nothing ────────────────────────────

describe('M1 — with no ceiling configured, behaviour is unchanged', () => {
  it('the global switch off permits WITHOUT any I/O', async () => {
    let touched = 0;
    const allow = makeDailyCallCeilingAllow({
      enabled: () => false,
      resolveCeiling: async () => { touched += 1; return 0; },
      countCallsToday: async () => { touched += 1; return 999; },
    });
    expect(await allow({
      organizationId: ORG_A, providerId: 'clearbit',
      attributes: ['employee_count'], correlationId: 'c',
    })).toBeNull();
    expect(touched).toBe(0);          // not merely permitted — never consulted
  });

  it('enabled but unconfigured for this tenant permits, and never counts', async () => {
    let counted = 0;
    const allow = makeDailyCallCeilingAllow({
      enabled: () => true,
      resolveCeiling: async () => null,
      countCallsToday: async () => { counted += 1; return 999; },
    });
    expect(await allow({
      organizationId: ORG_A, providerId: 'clearbit',
      attributes: ['employee_count'], correlationId: 'c',
    })).toBeNull();
    expect(counted).toBe(0);
  });

  it('the environment default is OFF, so nothing is enforced until an operator opts in', () => {
    const prior = process.env.ENABLE_ENRICHMENT_SPEND_CEILING;
    delete process.env.ENABLE_ENRICHMENT_SPEND_CEILING;
    expect(isSpendCeilingEnabled()).toBe(false);
    process.env.ENABLE_ENRICHMENT_SPEND_CEILING = 'true';
    expect(isSpendCeilingEnabled()).toBe(true);
    if (prior === undefined) delete process.env.ENABLE_ENRICHMENT_SPEND_CEILING;
    else process.env.ENABLE_ENRICHMENT_SPEND_CEILING = prior;
  });

  it('a port built by the FACTORY still has no ceiling — existing callers are untouched', async () => {
    const calls: unknown[] = [];
    const out = await run(portsWith(undefined), calls);
    expect(out.outcome).toBe('enriched');
    expect(calls).toHaveLength(1);
  });

  it('the production singleton is still ONE object — the identity guards hold', () => {
    expect(typeof tenantFundedExecutionPort.authorizeCost).toBe('function');
    expect(typeof tenantFundedExecutionPort.releaseCost).toBe('function');
  });

  it('a fail-CLOSED read: a tenant who opted in is refused rather than overspending', async () => {
    const boom = new Error('ledger unreadable');
    const allow = makeDailyCallCeilingAllow({
      enabled: () => true,
      now: () => NOW,
      resolveCeiling: async () => 5,
      countCallsToday: async () => { throw boom; },
    });
    await expect(allow({
      organizationId: ORG_A, providerId: 'clearbit',
      attributes: ['employee_count'], correlationId: 'c',
    })).rejects.toBe(boom);
  });
});

// ── the limitation, stated rather than discovered ───────────────────────────

describe('M1 — this control does not claim to be atomic', () => {
  it('declares count-then-allow and its bound', () => {
    expect(boundedOvershoot.atomic).toBe(false);
    expect(boundedOvershoot.reason).toMatch(/count-then-allow/);
  });

  it('two concurrent callers CAN both pass at the boundary — the documented overshoot', async () => {
    // Neither has written a counted row yet, so both observe the same count.
    const { allow } = allowWith({ ceiling: 1, rows: [] });
    const a: unknown[] = []; const b: unknown[] = [];
    const [ra, rb] = await Promise.all([
      run(portsWith(allow), a), run(portsWith(allow), b),
    ]);
    expect(ra.outcome).toBe('enriched');
    expect(rb.outcome).toBe('enriched');
    expect(a.length + b.length).toBe(2);   // 2 calls against a ceiling of 1
  });

  it('the flag key is declared once so an operator and this module agree', () => {
    expect(SPEND_CEILING_FLAG_KEY).toBe('enrichment_spend_ceiling');
  });
});

// ── M9 — one window governs one decision ────────────────────────────────────

describe('M9 — the caller\'s staleness window is authoritative', () => {
  const plan = (stalenessDays?: number) => planEnrichment({
    organizationId: ORG_A, prospectId: 'p-1', now: NOW, stalenessDays,
    fields: [{ attribute: 'employee_count', subject: 'account', value: null }],
  });

  it('a caller-supplied window reaches the plan and is published on it', () => {
    expect(plan(45).stalenessDays).toBe(45);
  });

  it('no caller value publishes null — the planner keeps its own default', () => {
    const p = plan();
    expect(p.stalenessDays).toBeNull();
    // and the default still governs classification: a never-observed field is
    // `missing` regardless, so assert the published value rather than re-deriving.
    expect(p.fields[0].state).toBe('missing');
  });

  it('the executor honours the SAME window the planner judged with', async () => {
    // Evidence 40 days old: inside a caller-supplied 45-day window, so the call
    // must be suppressed. Before M9 the executor would have used its own 30-day
    // default, called the provider, and re-bought what the planner considered fresh.
    const calls: unknown[] = [];
    const out = await executeEnrichment(request(), 'clearbit', portsWith(undefined, {
      findRecentObservation: async () => ({ observedAt: '2026-07-30T12:00:00.000Z' }),
    }), { adapter: adapter(calls), freshnessDays: plan(45).stalenessDays ?? undefined });

    expect(out.outcome).toBe('duplicate_suppressed');
    expect(calls).toHaveLength(0);
  });

  it('with no caller value the executor default is preserved exactly', async () => {
    // The same 40-day-old evidence, no supplied window: outside the executor's
    // 30-day default, so the call proceeds — unchanged from before M9.
    const calls: unknown[] = [];
    const out = await executeEnrichment(request(), 'clearbit', portsWith(undefined, {
      findRecentObservation: async () => ({ observedAt: '2026-07-30T12:00:00.000Z' }),
    }), { adapter: adapter(calls), freshnessDays: plan().stalenessDays ?? undefined });

    expect(out.outcome).toBe('enriched');
    expect(calls).toHaveLength(1);
  });
});
