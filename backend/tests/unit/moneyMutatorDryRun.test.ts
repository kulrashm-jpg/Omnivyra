/**
 * MONEY mutators: report-only first run (2026-11-12, e9 ruling) + read errors.
 *
 * reconcileDurableMonetizationReservations decides per stale hold whether to
 * CONFIRM (a charge), release or quarantine it; reapOrphanHolds releases
 * orphan holds and runs that reconciler first. Neither may be enabled before a
 * report-only run the owner has reviewed, so:
 *  - dryRun computes every decision and writes NOTHING (no confirm, no release,
 *    no RPC, no stamp, no ops event);
 *  - the reaper's dry run excludes holds the preflight WOULD settle;
 *  - a failed read is never "no sibling" / "artifact missing": the hold is
 *    counted failed and nothing is settled or stamped.
 */
export {};
type Res = { data?: unknown; error: { message: string } | null };
type Row = Record<string, unknown>;

const H = (id: string, ref: string, refId: string): Row => ({
  id, organization_id: 'o1', free_delta: -5, paid_delta: 0, incentive_delta: 0,
  idempotency_key: `k-${id}:hold`, reference_type: ref, reference_id: refId, performed_by: 'u1',
  created_at: '2026-11-11T00:00:00Z', metadata: {},
});
// h1: completed report -> confirm; h2: failed report -> release; h3: no artifact -> quarantine; h4: legacy key -> unrecognized
const HOLDS: Row[] = [
  H('h1', 'reports.snapshot', 'r-done'),
  H('h2', 'reports.snapshot', 'r-failed'),
  H('h3', 'reports.snapshot', 'r-missing'),
  { ...H('h4', 'orphan', 'x'), idempotency_key: 'legacy-key' },
];
const REPORTS: Record<string, Row> = {
  'r-done': { id: 'r-done', status: 'completed', data: { ok: 1 } },
  'r-failed': { id: 'r-failed', status: 'failed', data: null },
};

type Ctx = { table: string; op: string; filters: Record<string, unknown>; inCol: string | null };
let mockFail: { table?: string; op?: string } = {};
let mockFailWhen: ((c: Ctx) => boolean) | null = null;
const mockWrites: string[] = [];
const mockSettlements: string[] = [];
const mockRpc: string[] = [];
const mockOps: string[] = [];

function mockBuilder(table: string) {
  let op = 'select';
  const filters: Record<string, unknown> = {};
  let inCol: string | null = null;
  const b: any = {};
  const result = (): Res => {
    if (mockFail.table === table && (mockFail.op ?? 'select') === op) return { data: null, error: { message: 'down' } };
    if (mockFailWhen?.({ table, op, filters, inCol })) return { data: null, error: { message: 'down' } };
    if (op !== 'select') return { data: null, error: null };
    if (table === 'credit_transactions' && filters.execution_phase === 'hold') return { data: HOLDS, error: null };
    if (table === 'reports') return { data: REPORTS[String(filters.id)] ?? null, error: null };
    return { data: null, error: null };
  };
  for (const m of ['select', 'lt', 'gt', 'gte', 'order', 'limit']) b[m] = () => b;
  b.in = (c: string) => { inCol = c; return b; };
  b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
  b.update = () => { op = 'update'; mockWrites.push(`${table}:update`); return b; };
  b.maybeSingle = async () => {
    const r = result();
    return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data };
  };
  b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockBuilder(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockBuilder(t) } }));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('../../services/monetizationOpsService', () => ({
  recordMonetizationOperationalEvent: async (e: { eventName: string }) => { mockOps.push(e.eventName); },
}));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: async () => undefined }));
jest.mock('../../services/creditExecutionService', () => ({
  confirmCreditReservation: async (h: { holdTransactionId: string }) => { mockSettlements.push(`confirm:${h.holdTransactionId}`); return { status: 'confirmed' }; },
  releaseCreditReservation: async (h: { holdTransactionId: string }) => { mockSettlements.push(`release:${h.holdTransactionId}`); return { status: 'released' }; },
}));
jest.mock('../../repositories/creditExecutionRepository', () => ({
  callCreditReservation: async (a: { parentId: string }) => { mockRpc.push(a.parentId); return { error: null }; },
}));

import { reconcileDurableMonetizationReservations } from '../../services/monetizationReservationReconciliationService';
import { reapOrphanHolds } from '../../services/creditOrphanHoldReaper';

beforeEach(() => { mockFail = {}; mockFailWhen = null; mockWrites.length = 0; mockSettlements.length = 0; mockRpc.length = 0; mockOps.length = 0; });

describe('monetization reservation reconciler', () => {
  it('dryRun: every decision computed and returned - and NOTHING written', async () => {
    const r = await reconcileDurableMonetizationReservations({ dryRun: true });
    expect(r.dryRun).toBe(true);
    const byHold = Object.fromEntries(r.actions.map((a) => [a.holdId, a.decision]));
    expect(byHold).toMatchObject({ h1: 'confirm', h2: 'release', h3: 'quarantine', h4: 'quarantine' });
    expect(r).toMatchObject({ confirmed: 1, released: 1, quarantined: 2 });
    expect(mockSettlements).toEqual([]);
    expect(mockWrites).toEqual([]);
    expect(mockOps).toEqual([]);
  });

  it('dry and real runs reach the SAME decision for every hold, including the unbuildable-handle quarantine (one decideHold, 05)', async () => {
    const dry = await reconcileDurableMonetizationReservations({ dryRun: true });
    const real = await reconcileDurableMonetizationReservations();
    const m = (r: typeof dry) => Object.fromEntries(r.actions.map((x) => [x.holdId, x.decision]));
    expect(m(real)).toEqual(m(dry));
    expect(m(dry).h4).toBe('quarantine'); // legacy key: handle cannot be built
  });

  it('control: the real run settles exactly what the dry run predicted', async () => {
    await reconcileDurableMonetizationReservations();
    expect(mockSettlements.sort()).toEqual(['confirm:h1', 'release:h2']);
  });

  it('terminal-sibling read error -> every canonical hold FAILED; nothing confirmed, released or stamped', async () => {
    // fail only the sibling probes (by parent id, and by confirm/release key)
    mockFailWhen = (c) => c.table === 'credit_transactions' && c.filters.execution_phase !== 'hold'
      && ('parent_transaction_id' in c.filters || c.inCol === 'idempotency_key');
    const r = await reconcileDurableMonetizationReservations();
    expect(r.actions.filter((a) => ['h1', 'h2', 'h3'].includes(a.holdId)).every((a) => /terminal_sibling_read_failed/.test(a.reason))).toBe(true);
    expect(r.failed).toBe(3);
    expect(mockSettlements).toEqual([]);
    // NO ledger UPDATE at all (2026-11-12): the immutability trigger refuses it in
    // prod; decisions are recorded as operational events instead.
    expect(mockWrites).toEqual([]);
  });

  it('classification read error -> FAILED, never "artifact missing" quarantine-stamped', async () => {
    mockFail = { table: 'reports', op: 'select' };
    const r = await reconcileDurableMonetizationReservations();
    expect(r.actions.filter((a) => ['h1', 'h2', 'h3'].includes(a.holdId)).every((a) => /classify_report_read_failed/.test(a.reason))).toBe(true);
    expect(mockSettlements).toEqual([]);
    // NO ledger UPDATE at all (2026-11-12) - h4's quarantine is an ops event.
    expect(mockWrites).toEqual([]);
    expect(mockOps).toContain('monetization.reservation_quarantined');
  });
});

describe('orphan hold reaper', () => {
  it('dryRun: no RPC, no settlement, no ops event; preflight-decided holds excluded; preflight decisions returned', async () => {
    const r = await reapOrphanHolds({ dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(mockRpc).toEqual([]);
    expect(mockSettlements).toEqual([]);
    expect(mockOps).toEqual([]);
    expect(mockWrites).toEqual([]);
    // h1/h2/h3/h4 are all decided (non-skip) by the preflight -> the reaper itself would release none of them
    expect(r.skippedByPreflight).toBe(4);
    expect(r.released).toBe(0);
    expect(r.preflight).toMatchObject({ dryRun: true, confirmed: 1, released: 1 });
  });

  it('sibling read error in a REAL run -> never released (the read failure is counted)', async () => {
    const realHolds = HOLDS.splice(0, HOLDS.length, H('h9', 'orphan', 'x'));
    try {
      mockFailWhen = (c) => c.table === 'credit_transactions' && c.inCol === 'idempotency_key' && !('parent_transaction_id' in c.filters);
      const r = await reapOrphanHolds();
      expect(mockRpc).toEqual([]);
      expect(r.released).toBe(0);
      expect(r.failed + (r.preflight?.failed ?? 0)).toBeGreaterThanOrEqual(1);
    } finally {
      HOLDS.splice(0, HOLDS.length, ...realHolds);
    }
  });

  // 2026-11-12: the quarantine used to be honoured only through a metadata stamp
  // UPDATE that the prod ledger trigger refuses - so a REAL run released a hold
  // the preflight had just QUARANTINED. The reaper now excludes it.
  it('a hold the preflight QUARANTINED is NOT released by the reaper in a real run', async () => {
    const realHolds = HOLDS.splice(0, HOLDS.length, H('h9', 'orphan', 'x'));
    try {
      const r = await reapOrphanHolds();
      expect(r.preflight?.actions.find((a) => a.holdId === 'h9')?.decision).toBe('quarantine');
      expect(mockRpc).toEqual([]);
      expect(r.released).toBe(0);
      expect(r.skippedByPreflight).toBe(1);
    } finally {
      HOLDS.splice(0, HOLDS.length, ...realHolds);
    }
  });

  it('control: an orphan the preflight RELEASES is released exactly once (by the preflight), never again by the reaper', async () => {
    const realHolds = HOLDS.splice(0, HOLDS.length, H('h9', 'reports.snapshot', 'r-failed'));
    try {
      const r = await reapOrphanHolds();
      expect(mockSettlements).toEqual(['release:h9']);
      expect(mockRpc).toEqual([]);
      expect(r.released).toBe(0);
    } finally {
      HOLDS.splice(0, HOLDS.length, ...realHolds);
    }
  });
});
