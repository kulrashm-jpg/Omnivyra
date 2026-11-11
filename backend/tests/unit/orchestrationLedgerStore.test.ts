/**
 * orchestrationLedgerStore: the ledger lives in company_profiles.report_settings (a SHARED JSONB
 * column). A failed read used to become `{}`, and the next write replaced the WHOLE column with only the
 * ledger, wiping every other setting (e9, 2026-11-12: BLOCKING data loss).
 */
const reads: Array<{ data: unknown; error: unknown }> = [];
const writes: unknown[] = [];
let writeRows: unknown[] = [{ company_id: 'org1' }];
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => reads.shift() ?? { data: null, error: null } }) }),
      update: (u: unknown) => { writes.push(u); return { eq: () => ({ select: async () => ({ data: writeRows, error: null }) }) }; },
    }),
  },
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { readTasks, upsertTasks, OrchestrationLedgerUnavailableError } from '../../services/orchestration/orchestrationLedgerStore';

const task = (id: string) => ({ id, state: 'PENDING', priority: 1 }) as any;
beforeEach(() => { reads.length = 0; writes.length = 0; writeRows = [{ company_id: 'org1' }]; });

test('a FAILED read: upsertTasks returns false and writes NOTHING (the column is not replaced)', async () => {
  reads.push({ data: null, error: { code: '57014', message: 'statement timeout' } });
  expect(await upsertTasks('org1', [task('t1')])).toBe(false);
  expect(writes).toHaveLength(0);
});

test('a readable column: the write keeps every sibling key and merges tasks by id', async () => {
  reads.push({ data: { report_settings: { brand_voice: 'warm', orchestration_tasks: [task('t0')] } }, error: null });
  expect(await upsertTasks('org1', [task('t1')])).toBe(true);
  const rs = (writes[0] as { report_settings: Record<string, unknown> }).report_settings;
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
  writeRows = [];
  expect(await upsertTasks('org1', [task('t1')])).toBe(false);
});
