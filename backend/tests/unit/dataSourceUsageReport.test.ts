/**
 * "Data sources & usage": the report over the three existing ledgers.
 */
const reads: Array<{ table: string; eqs: Array<[string, unknown]>; cols: string }> = [];
let tables: Record<string, { data?: unknown; error?: unknown }> = {};
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const rec = { table, eqs: [] as Array<[string, unknown]>, cols: '' };
    reads.push(rec);
    const chain: Record<string, unknown> = {};
    chain.select = (c: string) => { rec.cols = c; return chain; };
    chain.eq = (k: string, v: unknown) => { rec.eqs.push([k, v]); return chain; };
    chain.in = () => chain; chain.gte = () => chain; chain.lt = () => chain; chain.order = () => chain;
    chain.limit = async () => tables[table] ?? { data: [], error: null };
    chain.then = (f: (v: unknown) => unknown) => Promise.resolve(tables[table] ?? { data: [], error: null }).then(f);
    return chain;
  },
}));
import { buildUsageReport, aggregateUsage, toEvent, usageWindow, USAGE_ROW_CAP } from '../../services/prospectUsage/usageReport';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const W = { from: '2026-11-01T00:00:00.000Z', to: '2026-11-11T00:00:00.000Z' };
const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';

beforeEach(() => {
  reads.length = 0;
  tables = {
    prospect_enrichment_attempts: { data: [
      { id: 'e1', provider_key: 'apollo', started_at: '2026-11-10T10:00:00Z', outcome: 'enriched', funding: 'platform', provider_cost_units: 1, credits_charged: 18, initiated_by: U1 },
      { id: 'e2', provider_key: 'apollo', started_at: '2026-11-10T11:00:00Z', outcome: null, funding: 'platform', provider_cost_units: 1, credits_charged: 0, initiated_by: U1 },
      { id: 'e3', provider_key: 'apollo', started_at: '2026-11-09T09:00:00Z', outcome: 'no_match', funding: 'tenant', provider_cost_units: null, credits_charged: 0, initiated_by: null },
    ], error: null },
    prospect_discovery_attempts: { data: [
      { id: 'd1', provider_key: 'apollo', started_at: '2026-11-09T08:00:00Z', execution_status: 'completed', provider_cost_units: 2, funding: 'tenant', credits_charged: 0, initiated_by: U2,
        results_observed: 10, results_ingested: 6, results_skipped_duplicate: 3, results_held_for_review: 1 },
    ], error: null },
    prospect_capture_runs: { data: [
      { command_id: 'cmd-1', provider: 'linkedin_sales_navigator', created_at: '2026-11-08T12:00:00Z', status: 'complete', initiated_by: U2, received: 5, created: 3, updated: 1, duplicates_parked: 1 },
    ], error: null },
    user_company_roles: { data: [{ user_id: U1 }], error: null },   // U2 is no longer an active member
    users: { data: [{ id: U1, name: 'Asha', email: 'a@x.test' }], error: null },
  };
});

it('reads every ledger TENANT-SCOPED and only counts and ids', async () => {
  await buildUsageReport(ORG, W);
  for (const t of ['prospect_enrichment_attempts', 'prospect_discovery_attempts', 'prospect_capture_runs']) {
    const r = reads.find((x) => x.table === t)!;
    expect(r.eqs).toContainEqual(['organization_id', ORG]);
    expect(r.cols).not.toMatch(/raw|payload|email|name|detail/);
  }
});

it('totals: vendor units (reconcilable), credits, and the value received', async () => {
  const r = await buildUsageReport(ORG, W);
  expect(r.ledgers).toEqual({ enrichment: 'ok', discovery: 'ok', capture: 'ok' });
  expect(r.totals).toMatchObject({
    runs: 5, vendorUnits: 4, vendorUnitsUnknownRuns: 1, creditsCharged: 18,
    leadsReceived: 15, leadsAdded: 1 + 6 + 3, leadsUpdated: 1, heldForReview: 1, skippedDuplicates: 3 + 1,
  });
});

it('the paid-not-stored row still counts its vendor unit with 0 credits', async () => {
  const r = await buildUsageReport(ORG, W);
  const e2 = r.runs.find((x) => x.runId === 'e2')!;
  expect(e2).toMatchObject({ vendorUnits: 1, creditsCharged: 0, outcome: null });
});

it('per source, per user (active members named; others "Former member"; system), per day', async () => {
  const r = await buildUsageReport(ORG, W);
  expect(r.bySource.map((s) => `${s.kind}:${s.source}:${s.runs}`).sort())
    .toEqual(['capture:linkedin_sales_navigator:1', 'discovery:apollo:1', 'enrichment:apollo:3']);
  const users = Object.fromEntries(r.byUser.map((u) => [u.label, u.runs]));
  expect(users).toEqual({ Asha: 2, 'Former member': 2, 'Automatic (system)': 1 });
  expect(r.byDay.map((d) => d.day)).toEqual(['2026-11-08', '2026-11-09', '2026-11-10']);
  expect(r.runs[0].runId).toBe('e2');   // newest first
});

it('a ledger that cannot be read (before the usage migration) is UNAVAILABLE, never zero', async () => {
  tables.prospect_enrichment_attempts = { data: null, error: { code: '42703', message: 'column funding does not exist' } };
  const r = await buildUsageReport(ORG, W);
  expect(r.ledgers.enrichment).toBe('unavailable');
  expect(r.ledgers.discovery).toBe('ok');
  expect(r.bySource.some((s) => s.kind === 'enrichment')).toBe(false);
});

it('a null-error, non-array answer is not an answer either', async () => {
  tables.prospect_capture_runs = { data: null, error: null };
  expect((await buildUsageReport(ORG, W)).ledgers.capture).toBe('unavailable');
});

it('over the row cap -> truncated (and capped)', async () => {
  tables.prospect_capture_runs = { data: Array.from({ length: USAGE_ROW_CAP + 1 }, (_, i) => ({ command_id: `c${i}`, provider: 'linkedin_sales_navigator', created_at: '2026-11-08T12:00:00Z', status: 'complete', received: 1, created: 1, updated: 0, duplicates_parked: 0 })), error: null };
  const r = await buildUsageReport(ORG, W);
  expect(r.ledgers.capture).toBe('truncated');
  expect(r.bySource.find((s) => s.kind === 'capture')!.runs).toBe(USAGE_ROW_CAP);
});

it('window: default 30 days; refuses inverted, invalid or longer than 92 days', () => {
  const now = new Date('2026-11-10T00:00:00Z');
  expect(usageWindow(undefined, undefined, now)).toEqual({ from: '2026-10-11T00:00:00.000Z', to: '2026-11-10T00:00:00.000Z' });
  expect(usageWindow('2026-11-10T00:00:00Z', '2026-11-01T00:00:00Z', now)).toBeNull();
  expect(usageWindow('nope', undefined, now)).toBeNull();
  expect(usageWindow('2026-01-01T00:00:00Z', '2026-11-01T00:00:00Z', now)).toBeNull();
});

it('refuses a report without a tenant', async () => {
  await expect(buildUsageReport('', W)).rejects.toThrow();
});

it('pure aggregation is order-independent', () => {
  const ev = [toEvent('capture', { command_id: 'a', provider: 'linkedin_sales_navigator', created_at: '2026-11-01T00:00:00Z', received: 2, created: 2 }),
    toEvent('enrichment', { id: 'b', provider_key: 'apollo', started_at: '2026-11-02T00:00:00Z', outcome: 'enriched', provider_cost_units: 1 })];
  const l = { enrichment: 'ok', discovery: 'ok', capture: 'ok' } as const;
  expect(aggregateUsage(ev, new Map(), W, l)).toEqual(aggregateUsage([...ev].reverse(), new Map(), W, l));
});
