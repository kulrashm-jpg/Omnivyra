/**
 * AUDIT-WRITER FIX (e9 BLOCKING; C86: logAuditEvent had NEVER landed a row in prod).
 *
 * The fake is faithful to Postgres where it matters: a multi-row INSERT is ALL-OR-NOTHING, and a non-UUID string in
 * a uuid column (company_id / user_id / record_ids) fails the whole statement with 22P02. Rows carrying
 * metadata.poison fail with a data error (23514); rows carrying metadata.transient fail with a non-data error
 * (no SQLSTATE - a network failure) until metadata.transient flushes have passed.
 *
 * Proven: (1) 'SYSTEM' / 'unknown' / '' ids land as NULL with the raw value kept; (2) one poison row + N good rows ->
 * the N land, the poison is dead-lettered (logged + counted) and NOT requeued; (3) a transient failure is retried at
 * most MAX_ROW_ATTEMPTS times, then dead-lettered; (4) a transient failure that recovers lands with no dead letter;
 * (5) every write error is surfaced (logger.error + counter).
 */
type Row = Record<string, any>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mockDb: { landed: Row[]; calls: number; flushNo: number } = { landed: [], calls: 0, flushNo: 0 };

function pgReject(row: Row): { code?: string; message: string } | null {
  for (const col of ['company_id', 'user_id']) {
    if (row[col] != null && !UUID_RE.test(String(row[col]))) return { code: '22P02', message: `invalid input syntax for type uuid: "${row[col]}"` };
  }
  if (Array.isArray(row.record_ids) && row.record_ids.some((r: unknown) => !UUID_RE.test(String(r)))) {
    return { code: '22P02', message: 'invalid input syntax for type uuid' };
  }
  if (row.metadata?.poison) return { code: '23514', message: 'new row violates check constraint' };
  if (row.metadata?.transient && mockDb.flushNo <= row.metadata.transient) return { message: 'fetch failed' };
  return null;
}

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => ({
    insert: async (rows: Row | Row[]) => {
      mockDb.calls += 1;
      const list = Array.isArray(rows) ? rows : [rows];
      for (const r of list) { const e = pgReject(r); if (e) return { data: null, error: e }; } // all-or-nothing
      mockDb.landed.push(...list.map((r) => ({ ...r })));
      return { data: null, error: null };
    },
  }),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../../config', () => ({ config: {} }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../observability', () => ({ recordRawCounter: jest.fn() }));

import { logAuditEvent, flushAuditQueue, MAX_ROW_ATTEMPTS } from '../../services/auditLoggingService';
import { logger } from '../../services/logger';
import { recordRawCounter } from '../../observability';

const CO = '11111111-1111-4111-8111-111111111111';
const US = '22222222-2222-4222-8222-222222222222';
const errorsNamed = (name: string) => (logger.error as jest.Mock).mock.calls.filter((c: any[]) => c[0] === name);
async function flush() { mockDb.flushNo += 1; await flushAuditQueue(); }
async function drain() { for (let i = 0; i < MAX_ROW_ATTEMPTS + 2; i++) await flush(); }

beforeAll(() => { jest.useFakeTimers(); });
afterAll(() => { jest.clearAllTimers(); jest.useRealTimers(); });
beforeEach(async () => {
  await drain();
  mockDb.landed = []; mockDb.calls = 0; mockDb.flushNo = 0;
  (logger.error as jest.Mock).mockClear(); (recordRawCounter as jest.Mock).mockClear();
});

const ev = (over: Record<string, unknown> = {}) => ({
  operation: 'INSERT' as const, table: 'social_publish_rejected', companyId: CO, userId: US, success: false, ...over,
});

it('CONTROL: valid rows land in one batch, no error surfaced', async () => {
  for (let i = 0; i < 3; i++) await logAuditEvent(ev({ metadata: { i } }));
  await flush();
  expect(mockDb.landed).toHaveLength(3);
  expect(mockDb.calls).toBe(1);
  expect(errorsNamed('audit_log_write_failed')).toEqual([]);
});

it.each([
  ['SYSTEM company', { companyId: 'SYSTEM' }, { company_id: null, raw_company_id: 'SYSTEM' }],
  ["'unknown' user", { userId: 'unknown' }, { user_id: null, raw_user_id: 'unknown' }],
  ["'' company", { companyId: '' }, { company_id: null }],
  ["'system:dispatch-recovery' user", { userId: 'system:dispatch-recovery' }, { user_id: null, raw_user_id: 'system:dispatch-recovery' }],
])('VALUES: a non-UUID %s lands as NULL with the raw value kept in metadata', async (_n, over, expected) => {
  await logAuditEvent(ev(over));
  await flush();
  expect(mockDb.landed).toHaveLength(1);
  const row = mockDb.landed[0];
  if ('company_id' in expected) expect(row.company_id).toBeNull();
  if ('user_id' in expected) expect(row.user_id).toBeNull();
  if ('raw_company_id' in expected) expect(row.metadata.raw_company_id).toBe(expected.raw_company_id);
  if ('raw_user_id' in expected) expect(row.metadata.raw_user_id).toBe(expected.raw_user_id);
  expect(errorsNamed('audit_log_dead_letter')).toEqual([]);
});

it('VALUES: record_ids keeps the UUIDs and moves non-UUIDs to metadata', async () => {
  await logAuditEvent(ev({ recordIds: [CO, 'campaign-1'] }));
  await flush();
  expect(mockDb.landed[0].record_ids).toEqual([CO]);
  expect(mockDb.landed[0].metadata.raw_record_ids).toEqual(['campaign-1']);
});

it('ISOLATION: 1 poison row + 5 good rows -> the 5 land, the poison is dead-lettered (logged + counted), not requeued', async () => {
  await logAuditEvent(ev({ metadata: { n: 1 } }));
  await logAuditEvent(ev({ metadata: { n: 2 } }));
  await logAuditEvent(ev({ metadata: { poison: true } }));
  await logAuditEvent(ev({ metadata: { n: 3 } }));
  await logAuditEvent(ev({ metadata: { n: 4 } }));
  await logAuditEvent(ev({ metadata: { n: 5 } }));
  await flush();
  expect(mockDb.landed.map((r) => r.metadata.n)).toEqual([1, 2, 3, 4, 5]);
  const dl = errorsNamed('audit_log_dead_letter');
  expect(dl).toHaveLength(1);
  expect(dl[0][1]).toMatchObject({ reason: 'data_error', code: '23514', table_name: 'social_publish_rejected' });
  expect(recordRawCounter).toHaveBeenCalledWith('audit_log_dead_lettered', 1, { reason: 'data_error' });
  // the batch failure itself was surfaced, not swallowed
  expect(errorsNamed('audit_log_write_failed')[0][1]).toMatchObject({ stage: 'batch', count: 6 });
  expect(recordRawCounter).toHaveBeenCalledWith('audit_log_write_failed', 1, { stage: 'batch' });
  // not requeued: later flushes write nothing more
  const calls = mockDb.calls;
  await flush(); await flush();
  expect(mockDb.calls).toBe(calls);
  expect(mockDb.landed).toHaveLength(5);
});

it('BOUND: a row that keeps failing transiently is retried at most MAX_ROW_ATTEMPTS times, then dead-lettered', async () => {
  await logAuditEvent(ev({ metadata: { transient: 99 } }));
  await drain();
  const dl = errorsNamed('audit_log_dead_letter');
  expect(dl).toHaveLength(1);
  expect(dl[0][1]).toMatchObject({ reason: 'retry_exhausted', attempts: MAX_ROW_ATTEMPTS });
  expect(mockDb.landed).toEqual([]);
  // each attempt = one batch insert + one row insert; nothing after the dead letter
  expect(mockDb.calls).toBe(2 * MAX_ROW_ATTEMPTS);
});

it('BOUND CONTROL: a transient failure that recovers on the next flush lands - no dead letter', async () => {
  await logAuditEvent(ev({ metadata: { transient: 1 } }));
  await flush(); // fails (flush 1)
  expect(mockDb.landed).toEqual([]);
  await flush(); // recovers (flush 2)
  expect(mockDb.landed).toHaveLength(1);
  expect(errorsNamed('audit_log_dead_letter')).toEqual([]);
});

it('a requeued transient row schedules its own retry (it does not wait for the next event)', async () => {
  await logAuditEvent(ev({ metadata: { transient: 1 } }));
  await flush();
  expect(jest.getTimerCount()).toBeGreaterThan(0);
  mockDb.flushNo += 1;
  await jest.runOnlyPendingTimersAsync();
  expect(mockDb.landed).toHaveLength(1);
});
