/**
 * Billing Schema Verification — Phase G tests
 *
 * Covers the shared prober + every consumer of it:
 *   - missing-table detection (PostgREST schema-cache + 42P01 signatures)
 *   - present detection (no error, and non-fatal RLS/perm error → present)
 *   - read-only RPC live-probe vs mutating-RPC inference from sibling table
 *   - opaque trigger/index inference + verifySql passthrough
 *   - partial-migration detection (same migration: some present, some gone)
 *   - migration dependency ORDER is fixed (20260663 → 64 → 65)
 *   - bootstrap validator: caches, classifies, 503 guard on critical-missing
 *   - /api/admin/billing/health: RBAC, healthy 200, degraded 503, shape
 *
 * The prober talks to PostgREST only via supabase.from(...).select(head)
 * and supabase.rpc(...). We drive it with a configurable fake whose
 * per-object behaviour each test sets, so we exercise the real
 * interpretation logic (looksMissing, severity rollup, inference).
 */

type ProbeBehaviour =
  | { kind: 'present' }
  | { kind: 'missing'; message: string; code?: string }
  | { kind: 'nonfatal'; message: string };

const fakeDb: {
  tables: Map<string, ProbeBehaviour>;
  rpcs: Map<string, ProbeBehaviour>;
  throwOnProbe: boolean;
} = { tables: new Map(), rpcs: new Map(), throwOnProbe: false };

function behaviourToResult(b: ProbeBehaviour | undefined) {
  if (!b || b.kind === 'present') return { data: [], error: null };
  if (b.kind === 'missing') {
    return { data: null, error: { message: b.message, code: b.code } };
  }
  return { data: null, error: { message: b.message } }; // nonfatal
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (name: string) => {
      if (fakeDb.throwOnProbe) throw new Error('ECONNREFUSED probe');
      const result = Promise.resolve(behaviourToResult(fakeDb.tables.get(name)));
      const chain: Record<string, unknown> = {
        select: () => chain,
        limit: () => result,
        then: (r: (v: unknown) => unknown) => result.then(r),
      };
      return chain;
    },
    rpc: (name: string) => {
      if (fakeDb.throwOnProbe) throw new Error('ECONNREFUSED probe');
      return Promise.resolve(behaviourToResult(fakeDb.rpcs.get(name)));
    },
  },
}));

jest.mock('../../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../services/requestAccessService', () => ({
  requireAuthenticatedInternalUser: jest.fn(),
}));
jest.mock('../../services/billing/financeRbacService', () => ({
  isFinanceAuditor: jest.fn(),
}));

import * as schemaSpec from '../../services/billing/bootstrap/billingSchemaSpec';
import {
  BILLING_TABLES,
  BILLING_RPCS,
  BILLING_OPAQUE,
  probeTable,
  probeRpc,
  buildBillingSchemaReport,
} from '../../services/billing/bootstrap/billingSchemaSpec';
import {
  validateBillingBootstrap,
  assertBillingSchemaReady,
  resetBillingBootstrapCache,
} from '../../services/billing/bootstrap/billingBootstrapValidator';
import healthHandler from '../../../pages/api/admin/billing/health';
import * as access from '../../services/requestAccessService';
import * as rbac from '../../services/billing/financeRbacService';

type AnyMock = jest.Mock;

/** Mark every billing object present. */
function allPresent(): void {
  fakeDb.tables.clear();
  fakeDb.rpcs.clear();
  fakeDb.throwOnProbe = false;
  for (const t of BILLING_TABLES) fakeDb.tables.set(t.name, { kind: 'present' });
  for (const r of BILLING_RPCS) fakeDb.rpcs.set(r.name, { kind: 'present' });
}

function makeRes() {
  const res: { status: jest.Mock; json: jest.Mock } = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  allPresent();
  resetBillingBootstrapCache();
});

// ── Prober: missing-table detection ────────────────────────────────────────

describe('probeTable — missing-object signatures', () => {
  const spec = BILLING_TABLES.find(t => t.name === 'credit_action_approvals')!;

  it('PostgREST schema-cache miss → missing', async () => {
    fakeDb.tables.set(spec.name, {
      kind: 'missing',
      message: "Could not find the table 'public.credit_action_approvals' in the schema cache",
      code: 'PGRST205',
    });
    const r = await probeTable(spec);
    expect(r.status).toBe('missing');
    expect(r.severity).toBe('critical');
  });

  it('postgres 42P01 "does not exist" → missing', async () => {
    fakeDb.tables.set(spec.name, {
      kind: 'missing',
      message: 'relation "credit_action_approvals" does not exist',
      code: '42P01',
    });
    expect((await probeTable(spec)).status).toBe('missing');
  });

  it('present when no error', async () => {
    fakeDb.tables.set(spec.name, { kind: 'present' });
    expect((await probeTable(spec)).status).toBe('present');
  });

  it('non-fatal RLS/permission error → present (object resolved)', async () => {
    fakeDb.tables.set(spec.name, {
      kind: 'nonfatal',
      message: 'permission denied for table credit_action_approvals',
    });
    const r = await probeTable(spec);
    expect(r.status).toBe('present');
    expect(r.detail).toMatch(/probe_non_fatal/);
  });
});

// ── Prober: RPC verification ───────────────────────────────────────────────

describe('probeRpc — read-only live-probe vs mutating inference', () => {
  it('read-only RPC is live-probed', async () => {
    const fx = BILLING_RPCS.find(r => r.name === 'lookup_fx_rate')!;
    fakeDb.rpcs.set('lookup_fx_rate', {
      kind: 'missing',
      message: 'Could not find the function public.lookup_fx_rate',
      code: 'PGRST202',
    });
    expect((await probeRpc(fx, new Map())).status).toBe('missing');
  });

  it('mutating RPC is NOT called — inferred present from sibling critical table', async () => {
    const sign = BILLING_RPCS.find(r => r.name === 'sign_credit_action_approval')!;
    const rpcSpy = jest.spyOn(
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../../db/supabaseClient').supabase as { rpc: (n: string) => unknown },
      'rpc',
    );
    const statuses = new Map([['credit_action_approvals', 'present' as const]]);
    const r = await probeRpc(sign, statuses);
    expect(r.status).toBe('present');
    expect(r.detail).toMatch(/not live-probed/);
    expect(rpcSpy).not.toHaveBeenCalled();
    rpcSpy.mockRestore();
  });

  it('mutating RPC inferred MISSING when sibling table missing', async () => {
    const sign = BILLING_RPCS.find(r => r.name === 'sign_credit_action_approval')!;
    const statuses = new Map([['credit_action_approvals', 'missing' as const]]);
    expect((await probeRpc(sign, statuses)).status).toBe('missing');
  });
});

// ── Prober: trigger/index inference + report rollup ────────────────────────

describe('buildBillingSchemaReport — rollup, opaque inference, partial detect', () => {
  it('all present → overall ok, opaque triggers inferred present', async () => {
    const report = await buildBillingSchemaReport();
    expect(report.overall).toBe('ok');
    expect(report.counts.missing).toBe(0);
    expect(report.opaque.length).toBe(BILLING_OPAQUE.length);
    expect(report.opaque.every(o => o.status === 'present')).toBe(true);
    // verifySql is passed through verbatim for the operator.
    expect(report.opaque[0].verifySql).toMatch(/information_schema|pg_indexes/);
  });

  it('critical table missing → overall critical_missing + opaque follows', async () => {
    fakeDb.tables.set('credit_action_approvals', {
      kind: 'missing',
      message: 'schema cache',
      code: 'PGRST205',
    });
    const report = await buildBillingSchemaReport();
    expect(report.overall).toBe('critical_missing');
    expect(report.criticalMissing.some(r => r.object === 'credit_action_approvals')).toBe(true);
    // Triggers inferred from that table now read missing (no false green).
    const inferred = report.opaque.find(o => o.name.includes('immutability'));
    expect(inferred?.status).toBe('missing');
  });

  it('only a non-critical (medium) table missing → degraded, not critical', async () => {
    fakeDb.tables.set('invoices', { kind: 'missing', message: 'does not exist', code: '42P01' });
    const report = await buildBillingSchemaReport();
    expect(report.overall).toBe('degraded');
    expect(report.criticalMissing.length).toBe(0);
  });

  it('partial-migration: same migration has present AND missing objects', async () => {
    // 20260663 has many objects; knock out one, keep the rest present.
    fakeDb.tables.set('job_execution_registry', {
      kind: 'missing',
      message: 'does not exist',
      code: '42P01',
    });
    const report = await buildBillingSchemaReport();
    const for63 = report.results.filter(r => r.migration === '20260663');
    expect(for63.some(r => r.status === 'present')).toBe(true);
    expect(for63.some(r => r.status === 'missing')).toBe(true);
  });
});

// ── Migration dependency order is fixed ────────────────────────────────────

describe('billing migration order', () => {
  it('migrations referenced by spec are exactly the 3 in dependency order', () => {
    const migs = Array.from(
      new Set([...BILLING_TABLES, ...BILLING_RPCS, ...BILLING_OPAQUE].map(o => o.migration)),
    ).sort();
    expect(migs).toEqual(['20260663', '20260664', '20260665']);
  });
});

// ── Bootstrap validator ────────────────────────────────────────────────────

describe('billingBootstrapValidator', () => {
  it('caches: second call does not re-probe', async () => {
    const a = await validateBillingBootstrap();
    expect(a.ok).toBe(true);
    fakeDb.tables.set('credit_action_approvals', { kind: 'missing', message: 'gone', code: '42P01' });
    const b = await validateBillingBootstrap();
    expect(b).toBe(a); // same cached object — no re-probe
  });

  it('critical missing → ok:false, remediation names migrations', async () => {
    fakeDb.tables.set('credit_action_approvals', {
      kind: 'missing',
      message: 'schema cache',
      code: 'PGRST205',
    });
    const r = await validateBillingBootstrap();
    expect(r.ok).toBe(false);
    expect(r.overall).toBe('critical_missing');
    expect(r.remediation).toMatch(/20260663/);
  });

  it('assertBillingSchemaReady → 503 BILLING_SCHEMA_NOT_READY on critical missing', async () => {
    fakeDb.tables.set('billing_operations', {
      kind: 'missing',
      message: 'does not exist',
      code: '42P01',
    });
    const g = await assertBillingSchemaReady();
    expect(g.ready).toBe(false);
    if (!g.ready) {
      expect(g.status).toBe(503);
      expect(g.body.code).toBe('BILLING_SCHEMA_NOT_READY');
    }
  });

  it('assertBillingSchemaReady → ready when all present', async () => {
    expect((await assertBillingSchemaReady()).ready).toBe(true);
  });

  it('per-probe connection refusal → degraded, ok:false, never crashes nor false-alarms critical', async () => {
    // probeTable swallows the throw into status:'error'; the report is
    // degraded (errors present) but NOT critical_missing (a refused
    // connection must not masquerade as "schema gone").
    fakeDb.throwOnProbe = true;
    const r = await validateBillingBootstrap();
    expect(r.ok).toBe(false);
    expect(r.overall).toBe('degraded');
    expect(r.criticalMissing).toEqual([]);
  });

  it('hard probe build failure → probe_unavailable (does not crash boot)', async () => {
    const spy = jest
      .spyOn(schemaSpec, 'buildBillingSchemaReport')
      .mockRejectedValueOnce(new Error('ECONNREFUSED 5432'));
    const r = await validateBillingBootstrap();
    expect(r.ok).toBe(false);
    expect(r.overall).toBe('probe_unavailable');
    expect(r.remediation).toMatch(/DB connectivity/i);
    spy.mockRestore();
  });
});

// ── Health endpoint ────────────────────────────────────────────────────────

describe('/api/admin/billing/health', () => {
  beforeEach(() => {
    (access.requireAuthenticatedInternalUser as AnyMock).mockResolvedValue({ id: 'u1' });
    (rbac.isFinanceAuditor as AnyMock).mockResolvedValue(true);
  });

  it('405 on non-GET', async () => {
    const res = makeRes();
    await healthHandler({ method: 'POST' } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('403 when not FINANCE_AUDITOR', async () => {
    (rbac.isFinanceAuditor as AnyMock).mockResolvedValueOnce(false);
    const res = makeRes();
    await healthHandler({ method: 'GET' } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('200 + healthy + all readiness green when schema fully present', async () => {
    const res = makeRes();
    await healthHandler({ method: 'GET' } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as AnyMock).mock.calls[0][0];
    expect(body.status.overall).toBe('ok');
    expect(body.status.healthy).toBe(true);
    expect(body.missingObjects).toEqual([]);
    expect(body.readiness.reconciliation.ready).toBe(true);
    expect(body.readiness.approvals.ready).toBe(true);
    expect(body.readiness.postgrest.ready).toBe(true);
    expect(body.readiness.rollout.ready).toBe(true);
    expect(body.migrations.every((m: { state: string }) => m.state === 'applied')).toBe(true);
  });

  it('503 + critical_missing + approval/rollout NOT ready when approval table gone', async () => {
    fakeDb.tables.set('credit_action_approvals', {
      kind: 'missing',
      message: "Could not find the table 'public.credit_action_approvals' in the schema cache",
      code: 'PGRST205',
    });
    const res = makeRes();
    await healthHandler({ method: 'GET' } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(503);
    const body = (res.json as AnyMock).mock.calls[0][0];
    expect(body.status.overall).toBe('critical_missing');
    expect(body.readiness.approvals.ready).toBe(false);
    expect(body.readiness.approvals.missing).toContain('credit_action_approvals');
    expect(body.readiness.rollout.ready).toBe(false);
    // schema-cache miss → PostgREST remediation says reload, not migrate.
    expect(body.readiness.postgrest.schemaCacheMissCount).toBeGreaterThan(0);
    expect(body.readiness.postgrest.remediation).toMatch(/reload/i);
  });

  it('distinguishes genuinely-unmigrated (42P01) from cache miss', async () => {
    fakeDb.tables.set('credit_action_approvals', {
      kind: 'missing',
      message: 'relation "credit_action_approvals" does not exist',
      code: '42P01',
    });
    const res = makeRes();
    await healthHandler({ method: 'GET' } as any, res as any);
    const body = (res.json as AnyMock).mock.calls[0][0];
    expect(body.readiness.postgrest.genuinelyMissingCount).toBeGreaterThan(0);
    expect(body.readiness.postgrest.remediation).toMatch(/npm run db:push|migrat/i);
  });

  it('partial migration surfaces as state=partial for that migration', async () => {
    fakeDb.tables.set('job_execution_registry', {
      kind: 'missing',
      message: 'does not exist',
      code: '42P01',
    });
    const res = makeRes();
    await healthHandler({ method: 'GET' } as any, res as any);
    const body = (res.json as AnyMock).mock.calls[0][0];
    const m63 = body.migrations.find((m: { migration: string }) => m.migration === '20260663');
    expect(m63.state).toBe('partial');
  });

  it('503 degraded when DB connection refused on every probe', async () => {
    fakeDb.throwOnProbe = true;
    const res = makeRes();
    await healthHandler({ method: 'GET' } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(503);
    const body = (res.json as AnyMock).mock.calls[0][0];
    expect(body.status.overall).toBe('degraded');
    expect(body.status.healthy).toBe(false);
  });

  it('503 probe_unavailable when the report build throws hard', async () => {
    const spy = jest
      .spyOn(schemaSpec, 'buildBillingSchemaReport')
      .mockRejectedValueOnce(new Error('ECONNREFUSED 5432'));
    const res = makeRes();
    await healthHandler({ method: 'GET' } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(503);
    const body = (res.json as AnyMock).mock.calls[0][0];
    expect(body.status.overall).toBe('probe_unavailable');
    spy.mockRestore();
  });
});
