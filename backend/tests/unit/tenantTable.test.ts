/**
 * tenantTable / tenantChildTable / tenantRpc (tenant-seam S1). The writeOwner double is HOSTILE: any builder
 * method the seam calls that the test did not expect throws, so an extra or missing call cannot pass silently.
 */
const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
let parentRow: unknown = { id: 'p-1' };
let parentError: unknown = null;

function builder(table: string): any {
  const record = (op: string) => (...args: unknown[]) => { calls.push({ table, op, args }); return b; };
  const b: any = new Proxy({}, {
    get(_t, prop: string) {
      if (['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'or'].includes(prop)) return record(prop);
      if (prop === 'maybeSingle') return async () => { calls.push({ table, op: 'maybeSingle', args: [] }); return { data: parentRow, error: parentError }; };
      if (prop === 'then') return undefined;
      throw new Error(`hostile double: unexpected builder member ${String(prop)}`);
    },
  });
  return b;
}
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => builder(t),
  ownedDbRpc: (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return Promise.resolve({ data: null, error: null }); },
}));

import { tenantTable, tenantChildTable, tenantOrPlatformTable, resolveTenantOfRow, tenantRpc, tenantContextFor, systemTenantContext, TenantSeamError, type TenantContext } from '../../db/tenantTable';
import { TENANT_TABLES, TENANT_CHILD_TABLES } from '../../db/tenantTables';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ctxA = tenantContextFor({ userId: 'user-1' }, A);

beforeEach(() => { calls.length = 0; rpcCalls.length = 0; parentRow = { id: 'p-1' }; parentError = null; });

describe('tenant context', () => {
  it('requires an authenticated principal and a uuid company', () => {
    expect(() => tenantContextFor({ userId: null }, A)).toThrow(/TENANT_CONTEXT_MISSING/);
    expect(() => tenantContextFor({ userId: 'u' }, 'not-a-uuid')).toThrow(/TENANT_CONTEXT_MISSING/);
    expect(() => systemTenantContext(A, '')).toThrow(/TENANT_CONTEXT_MISSING/);
    expect(systemTenantContext(A, 'cron fan-out').origin).toBe('system');
  });
  it('tenantTable without a context fails closed', () => {
    expect(() => tenantTable('campaigns', undefined as unknown as TenantContext)).toThrow(/TENANT_CONTEXT_MISSING/);
  });
});

describe('tenantTable (direct tenancy)', () => {
  const col = TENANT_TABLES.campaigns.column;
  it('select applies the tenant predicate BEFORE any caller filter', () => {
    tenantTable('campaigns', ctxA).select('id').eq('id', 'c-9');
    expect(calls.map((c) => c.op)).toEqual(['select', 'eq', 'eq']);
    expect(calls[1].args).toEqual([col, A]);
    expect(calls[2].args).toEqual(['id', 'c-9']);
  });
  it('update and delete are tenant-constrained; update may not move a row to another tenant', () => {
    tenantTable('campaigns', ctxA).update({ name: 'x' });
    tenantTable('campaigns', ctxA).delete();
    expect(calls.filter((c) => c.op === 'eq').map((c) => c.args)).toEqual([[col, A], [col, A]]);
    expect(() => tenantTable('campaigns', ctxA).update({ [col]: B })).toThrow(/TENANT_MISMATCH/);
  });
  it('insert/upsert stamp the tenant and refuse a payload naming another tenant', () => {
    tenantTable('campaigns', ctxA).insert([{ name: 'a' }, { name: 'b', [col]: A }]);
    expect((calls[0].args[0] as Array<Record<string, unknown>>).map((r) => r[col])).toEqual([A, A]);
    expect(() => tenantTable('campaigns', ctxA).upsert({ name: 'c', [col]: B })).toThrow(/TENANT_MISMATCH/);
    expect(calls).toHaveLength(1); // the refused upsert never reached the builder
  });
  it('an embedded select is refused (an outbound embed escapes the tenant predicate); a JSON path is allowed', () => {
    expect(() => tenantTable('campaigns', ctxA).select('id, social_accounts(company_id)')).toThrow(/embedded selects/);
    expect(() => tenantTable('campaigns', ctxA).select('id, websites!inner(company_id)')).toThrow(/embedded selects/);
    expect(calls).toHaveLength(0);
    tenantTable('campaigns', ctxA).select('id, meta->score');
    expect(calls[0].op).toBe('select');
  });
  it('an unregistered table is refused', () => {
    expect(() => tenantTable('no_such_table' as never, ctxA)).toThrow(/TENANT_TABLE_UNKNOWN/);
  });
});

describe('tenantChildTable (indirect tenancy)', () => {
  const spec = TENANT_CHILD_TABLES.daily_content_plans;
  it('verifies the parent UNDER the tenant before returning verbs, then pins the child to that parent', async () => {
    const t = await tenantChildTable('daily_content_plans', ctxA, 'p-1');
    t.select('id');
    const parentCalls = calls.filter((c) => c.table === spec.parent);
    expect(parentCalls.map((c) => c.op)).toEqual(['select', 'eq', 'eq', 'maybeSingle']);
    expect(parentCalls[1].args).toEqual([TENANT_TABLES[spec.parent].column, A]);
    expect(calls.filter((c) => c.table === 'daily_content_plans').map((c) => [c.op, c.args])).toEqual([['select', ['id', undefined]], ['eq', [spec.via, 'p-1']]]);
  });
  it('a foreign or missing parent is refused; an UNREADABLE parent is refused too (never "no check")', async () => {
    parentRow = null;
    await expect(tenantChildTable('daily_content_plans', ctxA, 'p-other')).rejects.toThrow(/TENANT_MISMATCH/);
    parentRow = { id: 'p-1' }; parentError = { code: '57014' };
    await expect(tenantChildTable('daily_content_plans', ctxA, 'p-1')).rejects.toThrow(/unreadable/);
  });
  it('a child payload naming another parent is refused', async () => {
    const t = await tenantChildTable('daily_content_plans', ctxA, 'p-1');
    expect(() => t.insert({ [spec.via]: 'p-2' })).toThrow(/TENANT_MISMATCH/);
  });
});

describe('tenantOrPlatformTable (e9 on C28)', () => {
  it('reads tenant + platform rows; tenantTable refuses a TENANT_OR_PLATFORM table', () => {
    expect(() => tenantTable('external_api_sources' as never, ctxA)).toThrow(/tenantOrPlatformTable/);
    tenantOrPlatformTable('external_api_sources' as never, ctxA).select('id');
    expect(calls.map((c) => c.op)).toEqual(['select', 'or']);
    expect(calls[1].args).toEqual([`company_id.eq.${A},company_id.is.null`]);
  });
  it('writes reach only the tenant rows and cannot move a row to the platform', () => {
    tenantOrPlatformTable('external_api_sources' as never, ctxA).update({ name: 'x' });
    expect(calls.filter((c) => c.op === 'eq').map((c) => c.args)).toEqual([['company_id', A]]);
    expect(() => tenantOrPlatformTable('external_api_sources' as never, ctxA).update({ company_id: null })).toThrow(/TENANT_MISMATCH/);
    expect(() => tenantOrPlatformTable('campaigns' as never, ctxA)).toThrow(/not TENANT_OR_PLATFORM/);
  });
});

describe('resolveTenantOfRow (job bootstrap)', () => {
  it('reads the row by id inside the seam and returns a system context for ITS tenant', async () => {
    parentRow = { company_id: A };
    const ctx = await resolveTenantOfRow('campaigns', 'row-1', 'lead job');
    expect(ctx?.companyId).toBe(A);
    expect(ctx?.origin).toBe('system');
    expect(calls.map((c) => [c.op, c.args])).toEqual([['select', ['company_id']], ['eq', ['id', 'row-1']], ['maybeSingle', []]]);
  });
  it('NULL tenant, missing row or unreadable row -> null (the job refuses); a reason is mandatory', async () => {
    parentRow = { company_id: null };
    expect(await resolveTenantOfRow('campaigns', 'row-1', 'lead job')).toBeNull();
    parentRow = null;
    expect(await resolveTenantOfRow('campaigns', 'row-1', 'lead job')).toBeNull();
    parentRow = { company_id: A }; parentError = { code: '57014' };
    expect(await resolveTenantOfRow('campaigns', 'row-1', 'lead job')).toBeNull();
    await expect(resolveTenantOfRow('campaigns', 'row-1', '')).rejects.toThrow(/reason/);
  });
});

describe('tenantRpc', () => {
  it('supplies the tenant argument from the context and refuses a conflicting one', () => {
    tenantRpc('some_fn', 'p_company_id', ctxA, { x: 1 });
    expect(rpcCalls[0]).toEqual({ fn: 'some_fn', args: { x: 1, p_company_id: A } });
    expect(() => tenantRpc('some_fn', 'p_company_id', ctxA, { p_company_id: B })).toThrow(TenantSeamError);
  });
});
