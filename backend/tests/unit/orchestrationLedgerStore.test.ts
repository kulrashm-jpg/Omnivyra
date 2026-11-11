/**
 * orchestrationLedgerStore: the ledger lives in company_profiles.report_settings (a SHARED JSONB
 * column). A failed read used to become `{}`, and the next write replaced the WHOLE column with only the
 * ledger, wiping every other setting (e9, 2026-11-12: BLOCKING data loss).
 */
const reads: Array<{ data: unknown; error: unknown }> = [];
const writes: unknown[] = [];
const rpcCalls: Array<Record<string, unknown>> = [];
// The stored row the key merge applies to (null = no company_profiles row).
let stored: { report_settings: unknown } | null = { report_settings: {} };
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => reads.shift() ?? { data: null, error: null } }) }),
      update: (u: unknown) => { writes.push(u); throw new Error('whole-column update of report_settings is not allowed'); },
    }),
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      rpcCalls.push(args);
      return jest.requireActual('../helpers/reportSettingsRpcFake').applyMerge(stored, args);
    },
  },
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { readTasks, upsertTasks, OrchestrationLedgerUnavailableError } from '../../services/orchestration/orchestrationLedgerStore';

const task = (id: string) => ({ id, state: 'PENDING', priority: 1 }) as any;
beforeEach(() => { reads.length = 0; writes.length = 0; rpcCalls.length = 0; stored = { report_settings: {} }; });

test('a FAILED read: upsertTasks returns false and writes NOTHING (the column is not replaced)', async () => {
  reads.push({ data: null, error: { code: '57014', message: 'statement timeout' } });
  expect(await upsertTasks('org1', [task('t1')])).toBe(false);
  expect(writes).toHaveLength(0);
  expect(rpcCalls).toHaveLength(0);
});

test('a readable column: the write keeps every sibling key and merges tasks by id', async () => {
  stored = { report_settings: { brand_voice: 'warm', orchestration_tasks: [task('t0')] } };
  reads.push({ data: stored, error: null });
  expect(await upsertTasks('org1', [task('t1')])).toBe(true);
  // ONE server-side key merge carrying ONLY orchestration_tasks; never a whole-column update.
  expect(writes).toHaveLength(0);
  expect(rpcCalls).toHaveLength(1);
  expect(Object.keys(rpcCalls[0].p_patch as object)).toEqual(['orchestration_tasks']);
  const rs = stored!.report_settings as Record<string, unknown>;
  expect(rs.brand_voice).toBe('warm');
  expect((rs.orchestration_tasks as Array<{ id: string }>).map((t) => t.id).sort()).toEqual(['t0', 't1']);
});

test('an absent row is still an empty ledger (not an error)', async () => {
  reads.push({ data: null, error: null });
  expect(await readTasks('org1')).toEqual([]);
});

test('readTasks THROWS on a failed read: an unreadable ledger is not an empty one', async () => {
  reads.push({ data: null, error: { code: '57014', message: 'statement timeout' } });
  await expect(readTasks('org1')).rejects.toBeInstanceOf(OrchestrationLedgerUnavailableError);
});

test('a write that matches no company_profiles row is reported as not written', async () => {
  reads.push({ data: { report_settings: {} }, error: null });
  stored = null; // the merge updates 0 rows
  expect(await upsertTasks('org1', [task('t1')])).toBe(false);
});

test('a key written by ANOTHER writer between our read and our write survives (no lost update)', async () => {
  // Our read sees only the ledger; by the time we write, another writer has landed website_fingerprint.
  reads.push({ data: { report_settings: { orchestration_tasks: [] } }, error: null });
  stored = { report_settings: { orchestration_tasks: [], website_fingerprint: { hash: 'h' } } };
  expect(await upsertTasks('org1', [task('t1')])).toBe(true);
  const rs = stored!.report_settings as Record<string, unknown>;
  expect(rs.website_fingerprint).toEqual({ hash: 'h' });
  expect((rs.orchestration_tasks as Array<{ id: string }>).map((t) => t.id)).toEqual(['t1']);
});
