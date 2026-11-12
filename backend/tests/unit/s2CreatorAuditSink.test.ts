/**
 * S2 (e1, 83 ruling 4) - allow-list entry creator-audit-append-only-sink. creatorAuditTrailService's flush()
 * inserts a batch that mixes tenants and NULL-company system entries. The entry claims: flush only INSERTS (never
 * reads, updates or deletes creator_audit_log) and every row keeps its OWN company_id.
 */
export {};
const mockOps: Array<{ table: string; op: string; rows?: unknown }> = [];
function mockTable(table: string) {
  const rec = (op: string, rows?: unknown) => { mockOps.push({ table, op, rows }); return b; };
  const b: any = {
    insert: (rows: unknown) => rec('insert', rows),
    upsert: (rows: unknown) => rec('upsert', rows),
    select: () => rec('select'),
    update: () => rec('update'),
    delete: () => rec('delete'),
    eq: () => b, in: () => b, order: () => b, limit: () => b,
    then: (ok: any, ko: any) => Promise.resolve({ data: null, error: null }).then(ok, ko),
  };
  return b;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../services/creatorOperationalTelemetryService', () => ({ getCurrentTrace: () => null }));
/* eslint-disable @typescript-eslint/no-var-requires */
const audit = require('../../services/creatorAuditTrailService');
/* eslint-enable @typescript-eslint/no-var-requires */
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
beforeEach(() => { mockOps.length = 0; audit.__resetCreatorAuditTrailForTests(); });

it('flush only inserts, and each row keeps its own company', async () => {
  audit.recordAuditEntry({ action: 'upload_completed', companyId: A, dailyPlanId: 'plan-a' });
  audit.recordAuditEntry({ action: 'upload_completed', companyId: B, dailyPlanId: 'plan-b' });
  audit.recordAuditEntry({ action: 'integrity_scan' });
  await audit.flushCreatorAuditTrail();
  expect(mockOps.map((o) => `${o.table}:${o.op}`)).toEqual(['creator_audit_log:insert']);
  const rows = mockOps[0].rows as Array<{ company_id: string | null; daily_plan_id: string | null }>;
  expect(rows.map((r) => [r.daily_plan_id, r.company_id])).toEqual([['plan-a', A], ['plan-b', B], [null, null]]);
});
