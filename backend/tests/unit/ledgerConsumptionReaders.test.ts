/**
 * MONEY (e9, 2026-11-12, BLOCKING): every consumption reader counts the
 * token-priced settlements (execution_phase 'confirm_partial') as well as plain
 * confirms, and never counts a release (including a guarded partial confirm's
 * own `<key>:remainder` row), a hold or a grant.
 *
 * ONE fixture ledger, ONE faithful fake: the fake stores rows and APPLIES every
 * filter (eq / in / gte / lte / gt / lt / limit), and inserts persist - it is
 * never kinder than the database. Each reader gets its own test; the last test
 * pins that they all agree with the ledger (cross-reader consistency).
 */
export {};

type Row = Record<string, any>;
const mockTables: Record<string, Row[]> = {};

function mockFrom(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let limitN: number | null = null;
  let inserted: Row[] | null = null;
  const rows = () => {
    if (inserted) return inserted;
    const out = (mockTables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    return limitN === null ? out : out.slice(0, limitN);
  };
  const b: any = {
    select: () => b,
    order: () => b,
    range: () => b,
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return b; },
    in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b; },
    gte: (c: string, v: any) => { filters.push((r) => r[c] >= v); return b; },
    gt: (c: string, v: any) => { filters.push((r) => r[c] > v); return b; },
    lte: (c: string, v: any) => { filters.push((r) => r[c] <= v); return b; },
    lt: (c: string, v: any) => { filters.push((r) => r[c] < v); return b; },
    is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; },
    limit: (n: number) => { limitN = n; return b; },
    insert: (v: Row | Row[]) => {
      const list = (Array.isArray(v) ? v : [v]).map((r, i) => ({ id: r.id ?? `${table}-${(mockTables[table] ?? []).length + i + 1}`, ...r }));
      (mockTables[table] = mockTables[table] ?? []).push(...list);
      inserted = list;
      return b;
    },
    upsert: (v: Row) => b.insert(v),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (ok: any, ko: any) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok, ko),
  };
  return b;
}

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockFrom(t), rpc: jest.fn(async () => ({ data: null, error: null })) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockFrom(t), ownedDbRpc: jest.fn(async () => ({ data: null, error: null })) }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/billing/billingMetrics', () => ({ incrCounter: jest.fn() }));
jest.mock('../../services/billing/billingAuditEmitter', () => ({ emitAnomaly: jest.fn(), emitFinancialAudit: jest.fn(async () => undefined) }));
jest.mock('../../services/monetizationOpsService', () => ({ recordMonetizationOperationalEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/billing/exports/auditManifestService', () => ({ recordExportManifest: jest.fn(async () => ({ id: 'm1' })) }));

import { forecastUsage } from '../../services/billing/contracts/usageForecastingService';
import { takeUsageSnapshot } from '../../services/billing/payments/usageAggregationService';
import { prepareDraftInvoice } from '../../services/billing/payments/invoicePreparationService';
import { exportCompanyUsage, exportReservationLifecycle } from '../../services/billing/exports/ledgerExportService';
import { runOrphanUsageReconciliation } from '../../services/billing/jobs/orphanUsageReconciliationJob';
import { aggregateCreditPhases } from '../../services/billing/economicAccountingService';
import { getWeeklyConsumption } from '../../services/creditAlertService';
import { wasRecentlyRun } from '../../services/creditDeductionService';
import { auditMonetizationInvariants } from '../../services/monetizationReservationReconciliationService';
import { CONSUMPTION_PHASES } from '../../services/billing/ledgerPhases';

const ORG = '0c0c0c0c-0000-4000-8000-000000000001';
const OTHER = '0c0c0c0c-0000-4000-8000-000000000002';
const NOW = Date.now();
const at = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const PERIOD = { periodStart: new Date(NOW - 2 * 86400_000).toISOString(), periodEnd: new Date(NOW + 86400_000).toISOString() };

/** The fixture: 10 consumed by a plain confirm + 12 by a partial confirm = 22. */
const EXPECTED_CONSUMED = 22;
function seed() {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  const tx = (r: Row): Row => ({ organization_id: ORG, usd_equivalent: null, reference_id: null, metadata: null, free_delta: 0, paid_delta: 0, incentive_delta: 0, ...r });
  mockTables.credit_transactions = [
    tx({ id: 'g1', execution_phase: 'grant', idempotency_key: 'g:grant', credits_delta: 100, free_delta: 100, reference_type: 'grant', created_at: at(60) }),
    tx({ id: 'h1', execution_phase: 'hold', idempotency_key: 'a:hold', credits_delta: -10, free_delta: -10, reference_type: 'content_basic', created_at: at(30) }),
    tx({ id: 'c1', execution_phase: 'confirm', idempotency_key: 'a:confirm', parent_transaction_id: 'h1', credits_delta: -10, free_delta: -10, usd_equivalent: 0.1, reference_type: 'content_basic', created_at: at(29) }),
    tx({ id: 'h2', execution_phase: 'hold', idempotency_key: 'b:hold', credits_delta: -20, free_delta: -20, reference_type: 'llm_chat', created_at: at(20) }),
    tx({ id: 'p2', execution_phase: 'confirm_partial', idempotency_key: 'b:confirm', parent_transaction_id: 'h2', credits_delta: -12, free_delta: -12, usd_equivalent: 0.2, reference_type: 'llm_chat', created_at: at(19) }),
    tx({ id: 'r2', execution_phase: 'release', idempotency_key: 'b:confirm:remainder', parent_transaction_id: 'h2', credits_delta: 8, free_delta: 8, transaction_type: 'refund', reference_type: 'llm_chat', created_at: at(19) }),
    tx({ id: 'h3', execution_phase: 'hold', idempotency_key: 'c:hold', credits_delta: -5, free_delta: -5, reference_type: 'content_basic', created_at: at(10) }),
    tx({ id: 'r3', execution_phase: 'release', idempotency_key: 'c:release', parent_transaction_id: 'h3', credits_delta: 5, free_delta: 5, reference_type: 'content_basic', created_at: at(9) }),
    // another org's partial confirm: never counted for ORG
    tx({ id: 'x1', organization_id: OTHER, execution_phase: 'confirm_partial', idempotency_key: 'x:confirm', credits_delta: -99, free_delta: -99, reference_type: 'llm_chat', created_at: at(5) }),
  ];
  mockTables.organization_credits = [{ organization_id: ORG, reserved_free: 0, reserved_paid: 0, reserved_incentive: 0 }];
}
beforeEach(seed);

const ledgerConsumed = () => mockTables.credit_transactions
  .filter((r) => r.organization_id === ORG && (CONSUMPTION_PHASES as readonly string[]).includes(r.execution_phase))
  .reduce((s, r) => s + Math.abs(r.credits_delta), 0);

describe('each consumption reader counts confirm_partial and nothing else', () => {
  it('forecastUsage: observed credits include the partial confirm', async () => {
    const f = await forecastUsage({ organizationId: ORG, ...PERIOD });
    expect(f?.observedCredits).toBe(EXPECTED_CONSUMED);
  });

  it('takeUsageSnapshot (the frozen billing basis): total and per-action include the partial confirm', async () => {
    const s = await takeUsageSnapshot({ organizationId: ORG, ...PERIOD });
    expect(s.ok).toBe(true);
    expect(s.totalCredits).toBe(EXPECTED_CONSUMED);
    expect(s.byAction.llm_chat).toMatchObject({ credits: 12, count: 1 });
  });

  it('prepareDraftInvoice: line items bill the partial confirm (credits and usd)', async () => {
    const inv = await prepareDraftInvoice({ organizationId: ORG, ...PERIOD, preparedBy: 'admin' });
    expect(inv).not.toBeNull();
    expect(inv!.lineItems.reduce((s, li) => s + li.quantity, 0)).toBe(EXPECTED_CONSUMED);
    expect(inv!.lineItems.find((li) => li.referenceType === 'llm_chat')).toMatchObject({ quantity: 12, subtotal: 0.2 });
  });

  it('exportCompanyUsage: exports both consumption rows, never the remainder / release / hold', async () => {
    const r = await exportCompanyUsage({ format: 'json' as any, requestedBy: 'admin', organizationId: ORG });
    expect(r.rowCount).toBe(2);
    expect(r.body).toContain('confirm_partial');
    expect(r.body).not.toContain('b:confirm:remainder');
  });

  it('exportReservationLifecycle: includes the partial confirm and its remainder row', async () => {
    const r = await exportReservationLifecycle({ format: 'json' as any, requestedBy: 'admin', organizationId: ORG });
    expect(r.rowCount).toBe(7); // 3 holds, confirm, partial, remainder, release
  });

  it('getWeeklyConsumption (velocity alerts): includes the partial confirm', async () => {
    await expect(getWeeklyConsumption(ORG)).resolves.toBe(EXPECTED_CONSUMED);
  });

  it('wasRecentlyRun (smart-mode dedup): a token-priced action settled by a partial confirm counts as run', async () => {
    await expect(wasRecentlyRun(ORG, 'llm_chat' as any, 3600)).resolves.toBe(true);
  });

  it('runOrphanUsageReconciliation: a usage event matched only by a partial confirm is NOT an orphan', async () => {
    mockTables.credit_transactions = mockTables.credit_transactions.filter((r) => r.id !== 'c1' && r.id !== 'r3');
    mockTables.usage_events = [{ id: 'e1', organization_id: ORG, operation: 'llm_chat', cost_usd: 0.2, created_at: at(18) }];
    const r = await runOrphanUsageReconciliation({ windowMinutes: 60 });
    expect(r.scanned ?? 1).toBeGreaterThan(0);
    expect(r.orphanCount).toBe(0);
  });

  it('aggregateCreditPhases (economic ledger): partial confirm is CONFIRMED; the remainder is RELEASED', () => {
    const m = aggregateCreditPhases(mockTables.credit_transactions.filter((r) => r.organization_id === ORG) as any);
    expect(m.get(`${ORG}|llm_chat`)).toEqual({ reserved: 20, confirmed: 12, released: 8 });
  });

  it('auditMonetizationInvariants (LIVE-body shape, no remainder row): a partial-confirmed hold is SETTLED and its charge is a confirmed row', async () => {
    // The live partial confirm writes NO remainder row, so only reading the
    // 'confirm_partial' phase can settle hold h2.
    mockTables.credit_transactions = mockTables.credit_transactions
      .filter((r) => r.id !== 'r2')
      .map((r) => (r.id === 'p2' ? { ...r, reference_id: 'ref-2' } : r));
    mockTables.unified_transactions = [{ id: 'ut2', organization_id: ORG, reference_type: 'llm_chat', reference_id: 'ref-2', action_key: 'llm_chat', created_at: at(19) }];
    const rep: any = await auditMonetizationInvariants({ staleHoldSeconds: 1 });
    expect(rep.reserved_balance_mismatches).toEqual([]);           // h2 is not an "active hold"
    expect(rep.orphan_unified_transactions).toEqual([]);           // ut2 is matched by the partial confirm
  });
});

it('CROSS-READER CONSISTENCY: every reader agrees with the ledger (sum of consumption rows)', async () => {
  expect(ledgerConsumed()).toBe(EXPECTED_CONSUMED);
  const forecast = (await forecastUsage({ organizationId: ORG, ...PERIOD }))!.observedCredits;
  const weekly = await getWeeklyConsumption(ORG);
  const exported = JSON.parse((await exportCompanyUsage({ format: 'json' as any, requestedBy: 'a', organizationId: ORG })).body)
    .reduce((s: number, r: Row) => s + Math.abs(r.credits_delta), 0);
  const econ = aggregateCreditPhases(mockTables.credit_transactions.filter((r) => r.organization_id === ORG) as any);
  const econConfirmed = [...econ.values()].reduce((s, a) => s + a.confirmed, 0);
  const snapshot = (await takeUsageSnapshot({ organizationId: ORG, ...PERIOD })).totalCredits;
  const invoiced = (await prepareDraftInvoice({ organizationId: ORG, ...PERIOD, preparedBy: 'a' }))!.lineItems.reduce((s, li) => s + li.quantity, 0);
  expect({ forecast, weekly, exported, econConfirmed, snapshot, invoiced }).toEqual({
    forecast: EXPECTED_CONSUMED, weekly: EXPECTED_CONSUMED, exported: EXPECTED_CONSUMED,
    econConfirmed: EXPECTED_CONSUMED, snapshot: EXPECTED_CONSUMED, invoiced: EXPECTED_CONSUMED,
  });
});

// The static pin (no reader filters consumption by 'confirm' alone) lives in
// ledgerConsumptionStatic.test.ts - a plain fs scan, kept out of this mocked suite.
