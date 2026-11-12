/**
 * tenantTable / tenantChildTable / tenantRpc (tenant-seam S1). The writeOwner double is HOSTILE: any builder
 * method the seam calls that the test did not expect throws, so an extra or missing call cannot pass silently.
 */
const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
let parentRow: unknown = { id: 'p-1' };
let parentError: unknown = null;
let limitRows: Record<string, unknown[]> = {};
let limitError: Record<string, unknown> = {};

function builder(table: string): any {
  const record = (op: string) => (...args: unknown[]) => { calls.push({ table, op, args }); return b; };
  const b: any = new Proxy({}, {
    get(_t, prop: string) {
      if (['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'or', 'in'].includes(prop)) return record(prop);
      if (prop === 'maybeSingle') return async () => { calls.push({ table, op: 'maybeSingle', args: [] }); return { data: parentRow, error: parentError }; };
      if (prop === 'limit') return async (...args: unknown[]) => { calls.push({ table, op: 'limit', args }); return { data: limitRows[table] ?? [], error: limitError[table] ?? null }; };
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

import { tenantTable, tenantChildTable, tenantChildTableOf, tenantOrPlatformTable, resolveTenantOfRow, ownerCompanyOfRow, tenantRpc, tenantContextFor, systemTenantContext, TenantSeamError, type TenantContext } from '../../db/tenantTable';
import { TENANT_TABLES, TENANT_CHILD_TABLES } from '../../db/tenantTables';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ctxA = tenantContextFor({ userId: 'user-1' }, A);

beforeEach(() => { calls.length = 0; rpcCalls.length = 0; parentRow = { id: 'p-1' }; parentError = null; limitRows = {}; limitError = {}; });

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

describe('tenantChildTable multi-hop and non-id-key parents (55 S2)', () => {
  it('registry: the asset chain and render chain are children of children, keyed as declared', () => {
    expect(TENANT_CHILD_TABLES.content_asset_versions).toMatchObject({ via: 'asset_id', parent: 'content_assets', parentKey: 'asset_id' });
    expect(TENANT_CHILD_TABLES.content_asset_platform_override).toMatchObject({ via: 'attachment_id', parent: 'content_asset_attachment' });
    expect(TENANT_CHILD_TABLES.creator_render_attempt).toMatchObject({ via: 'variant_id', parent: 'creator_render_variant' });
    expect(TENANT_CHILD_TABLES.scheduled_posts).toMatchObject({ via: 'campaign_id', parent: 'campaigns' });
  });
  it('two hops: content_assets is read by asset_id for its campaign, the campaign is verified UNDER the tenant, then the child is pinned', async () => {
    limitRows.content_assets = [{ campaign_id: 'c-1' }];
    parentRow = { id: 'c-1' };
    const t = await tenantChildTable('content_asset_versions', ctxA, 'a-1');
    t.select('version_id');
    expect(calls.filter((c) => c.table === 'content_assets').map((c) => [c.op, c.args])).toEqual([['select', ['campaign_id']], ['eq', ['asset_id', 'a-1']], ['limit', [51]]]);
    const camp = calls.filter((c) => c.table === 'campaigns');
    expect(camp.map((c) => c.op)).toEqual(['select', 'eq', 'eq', 'maybeSingle']);
    expect(camp[1].args).toEqual([TENANT_TABLES.campaigns.column, A]);
    expect(camp[2].args).toEqual(['id', 'c-1']);
    expect(calls.filter((c) => c.table === 'content_asset_versions').map((c) => [c.op, c.args])).toEqual([['select', ['version_id', undefined]], ['eq', ['asset_id', 'a-1']]]);
  });
  it('two hops: a foreign grandparent, a NULL link, a missing parent or an unreadable parent are all refused', async () => {
    limitRows.content_assets = [{ campaign_id: 'c-9' }]; parentRow = null;
    await expect(tenantChildTable('content_asset_versions', ctxA, 'a-1')).rejects.toThrow(/TENANT_MISMATCH/);
    limitRows.content_assets = [{ campaign_id: null }]; parentRow = { id: 'c-1' };
    await expect(tenantChildTable('content_asset_versions', ctxA, 'a-1')).rejects.toThrow(/TENANT_MISMATCH/);
    limitRows.content_assets = [];
    await expect(tenantChildTable('content_asset_versions', ctxA, 'a-1')).rejects.toThrow(/TENANT_MISMATCH/);
    limitRows.content_assets = [{ campaign_id: 'c-1' }]; limitError.content_assets = { code: '57014' };
    await expect(tenantChildTable('content_asset_versions', ctxA, 'a-1')).rejects.toThrow(/unreadable/);
  });
  it('a NON-unique direct key: every parent row must be this tenant\'s (shared with another tenant, or NULL, is refused)', async () => {
    const col = TENANT_TABLES.content_core_asset.column;
    const HEX = 'abcdef12-3456-4789-8abc-def012345678'; // letters, so the case-insensitive match is really exercised
    limitRows.content_core_asset = [{ [col]: HEX }, { [col]: HEX.toUpperCase() }];
    await expect(tenantChildTable('content_asset_attachment', tenantContextFor({ userId: 'u' }, HEX), 'core-1')).resolves.toBeDefined();
    calls.length = 0;
    limitRows.content_core_asset = [{ [col]: A }, { [col]: A }];
    await expect(tenantChildTable('content_asset_attachment', ctxA, 'core-1')).resolves.toBeDefined();
    expect(calls.filter((c) => c.table === 'content_core_asset').map((c) => [c.op, c.args])).toEqual([['select', [col]], ['eq', ['content_core_id', 'core-1']], ['limit', [51]]]);
    limitRows.content_core_asset = [{ [col]: A }, { [col]: B }];
    await expect(tenantChildTable('content_asset_attachment', ctxA, 'core-1')).rejects.toThrow(/TENANT_MISMATCH/);
    limitRows.content_core_asset = [{ [col]: A }, { [col]: null }];
    await expect(tenantChildTable('content_asset_attachment', ctxA, 'core-1')).rejects.toThrow(/TENANT_MISMATCH/);
    // Over-wide is an AVAILABILITY refusal with its own code, never reported as a tenant mismatch (05).
    limitRows.content_core_asset = Array.from({ length: 51 }, () => ({ [col]: A }));
    const wide = tenantChildTable('content_asset_attachment', ctxA, 'core-1');
    await expect(wide).rejects.toThrow(/TENANT_PARENT_FANOUT/);
    await expect(tenantChildTable('content_asset_attachment', ctxA, 'core-1')).rejects.not.toThrow(/TENANT_MISMATCH/);
    limitRows.content_assets = Array.from({ length: 51 }, () => ({ campaign_id: 'c-1' }));
    await expect(tenantChildTable('content_asset_versions', ctxA, 'a-1')).rejects.toThrow(/TENANT_PARENT_FANOUT/);
  });
  it('a hand-built context whose company id is not lowercase is refused at the seam (05 NOTE 2)', () => {
    const HEX = 'abcdef12-3456-4789-8abc-def012345678'; // has letters, so upper-casing changes it (A is all digits)
    const upper = { companyId: HEX.toUpperCase(), origin: 'request', reason: null } as unknown as TenantContext;
    expect(HEX.toUpperCase()).not.toBe(HEX);
    expect(() => tenantTable('campaigns', upper)).toThrow(/lowercase/);
    expect(tenantContextFor({ userId: 'u' }, HEX.toUpperCase()).companyId).toBe(HEX);
  });
  it('three hops end to end: platform_override -> attachment -> core_asset', async () => {
    const col = TENANT_TABLES.content_core_asset.column;
    limitRows.content_asset_attachment = [{ content_core_id: 'core-1' }];
    limitRows.content_core_asset = [{ [col]: A }];
    const t = await tenantChildTable('content_asset_platform_override', ctxA, 'att-1');
    expect(calls.filter((c) => c.table === 'content_asset_attachment').map((c) => [c.op, c.args])).toEqual([['select', ['content_core_id']], ['eq', ['id', 'att-1']], ['limit', [51]]]);
    expect(() => t.insert({ attachment_id: 'att-2' })).toThrow(/TENANT_MISMATCH/);
    limitRows.content_core_asset = [{ [col]: B }];
    await expect(tenantChildTable('content_asset_platform_override', ctxA, 'att-1')).rejects.toThrow(/TENANT_MISMATCH/);
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

describe('tenantChildTableOf (many parents, one read; e1 S2)', () => {
  const col = TENANT_TABLES.campaigns.column;
  it('verifies ALL parents in ONE read under the tenant, then pins every verb with .in(via, parents)', async () => {
    limitRows.campaigns = [{ id: 'c-1' }, { id: 'c-2' }];
    const t = await tenantChildTableOf('scheduled_posts', ctxA, ['c-1', 'c-2', 'c-1']);
    expect(calls.filter((c) => c.table === 'campaigns').map((c) => [c.op, c.args])).toEqual([
      ['select', ['id', undefined]], ['eq', [col, A]], ['in', ['id', ['c-1', 'c-2']]], ['limit', [201]],
    ]);
    t.select('id', { count: 'exact', head: true });
    t.delete();
    expect(calls.filter((c) => c.table === 'scheduled_posts' && c.op === 'in').map((c) => c.args)).toEqual([
      ['campaign_id', ['c-1', 'c-2']], ['campaign_id', ['c-1', 'c-2']],
    ]);
  });
  it('ONE foreign or missing parent refuses the WHOLE call (never silently dropped); unreadable refuses too', async () => {
    limitRows.campaigns = [{ id: 'c-1' }];
    await expect(tenantChildTableOf('scheduled_posts', ctxA, ['c-1', 'c-foreign'])).rejects.toThrow(/TENANT_MISMATCH: .*1 of 2/);
    limitRows.campaigns = [{ id: 'c-1' }]; limitError.campaigns = { code: '57014' };
    await expect(tenantChildTableOf('scheduled_posts', ctxA, ['c-1'])).rejects.toThrow(/unreadable/);
  });
  it('an EMPTY list reads no parent and returns verbs that match nothing (never "no filter")', async () => {
    const t = await tenantChildTableOf('scheduled_posts', ctxA, []);
    t.select('id');
    expect(calls.filter((c) => c.table === 'campaigns')).toHaveLength(0);
    expect(calls.filter((c) => c.table === 'scheduled_posts').map((c) => [c.op, c.args])).toEqual([['select', ['id', undefined]], ['in', ['campaign_id', []]]]);
  });
  it('insert/upsert must name a verified parent; update may not move a row outside the set', async () => {
    limitRows.campaigns = [{ id: 'c-1' }, { id: 'c-2' }];
    const t = await tenantChildTableOf('scheduled_posts', ctxA, ['c-1', 'c-2']);
    expect(() => t.insert({ content: 'x' })).toThrow(/TENANT_PAYLOAD_INVALID/);
    expect(() => t.upsert([{ campaign_id: 'c-1' }, { campaign_id: 'c-9' }])).toThrow(/TENANT_MISMATCH/);
    expect(() => t.update({ campaign_id: 'c-9' })).toThrow(/TENANT_MISMATCH/);
    t.insert([{ campaign_id: 'c-1' }, { campaign_id: 'c-2' }]);
    expect(calls.filter((c) => c.table === 'scheduled_posts' && c.op === 'insert')).toHaveLength(1);
  });
  it('more than 200 parents -> TENANT_PARENT_FANOUT before any read; a blank id is refused', async () => {
    await expect(tenantChildTableOf('scheduled_posts', ctxA, Array.from({ length: 201 }, (_, i) => `c-${i}`))).rejects.toThrow(/TENANT_PARENT_FANOUT/);
    await expect(tenantChildTableOf('scheduled_posts', ctxA, ['c-1', ''])).rejects.toThrow(/TENANT_MISMATCH/);
    expect(calls).toHaveLength(0);
  });
  it('a multi-hop parent falls back to the per-id chain check', async () => {
    limitRows.content_assets = [{ campaign_id: 'c-1' }];
    parentRow = { id: 'c-1' };
    await tenantChildTableOf('content_asset_versions', ctxA, ['a-1', 'a-2']);
    expect(calls.filter((c) => c.table === 'content_assets' && c.op === 'eq').map((c) => c.args)).toEqual([['asset_id', 'a-1'], ['asset_id', 'a-2']]);
  });
});

describe('upsert conflict key must include the scoping column (05; the #378 upsertVariant class)', () => {
  const col = TENANT_TABLES.campaigns.column;
  it('tenantTable: no onConflict (= primary key) or a key without the tenant column is refused before the builder', () => {
    expect(() => tenantTable('campaigns', ctxA).upsert({ id: 'x', name: 'n' })).toThrow(/onConflict that includes/);
    expect(() => tenantTable('campaigns', ctxA).upsert({ id: 'x' }, { onConflict: 'id' })).toThrow(/onConflict that includes/);
    expect(calls).toHaveLength(0);
    tenantTable('campaigns', ctxA).upsert({ id: 'x' }, { onConflict: `id, ${col}` });
    tenantTable('campaigns', ctxA).upsert({ id: 'x' }, { ignoreDuplicates: true });
    expect(calls.filter((c) => c.op === 'upsert')).toHaveLength(2);
  });
  it('tenantChildTable: the conflict key must include the parent link', async () => {
    const t = await tenantChildTable('daily_content_plans', ctxA, 'p-1');
    const via = TENANT_CHILD_TABLES.daily_content_plans.via;
    expect(() => t.upsert({ day: 'mon' }, { onConflict: 'id' })).toThrow(/onConflict that includes/);
    t.upsert({ day: 'mon' }, { onConflict: `${via},day` });
    expect(calls.filter((c) => c.table === 'daily_content_plans' && c.op === 'upsert')).toHaveLength(1);
  });
  it('tenantChildTableOf: an onConflict without via cannot resolve onto another parent\'s row', async () => {
    limitRows.campaigns = [{ id: 'c-1' }];
    const t = await tenantChildTableOf('scheduled_posts', ctxA, ['c-1']);
    expect(() => t.upsert({ campaign_id: 'c-1', platform: 'x' }, { onConflict: 'platform' })).toThrow(/onConflict that includes campaign_id/);
    t.upsert({ campaign_id: 'c-1', platform: 'x' }, { onConflict: 'campaign_id,platform' });
    expect(calls.filter((c) => c.table === 'scheduled_posts' && c.op === 'upsert')).toHaveLength(1);
  });
});

describe('ownerCompanyOfRow (derive-then-authorize, R10)', () => {
  const col = TENANT_TABLES.campaigns.column;
  it('returns ONLY the owning company id (lowercase), read by id, never row data', async () => {
    const HEX = 'abcdef12-3456-4789-8abc-def012345678';
    parentRow = { [col]: HEX.toUpperCase() };
    await expect(ownerCompanyOfRow('campaigns', 'c-1', 'playbook by id')).resolves.toBe(HEX);
    expect(calls.map((c) => [c.op, c.args])).toEqual([['select', [col]], ['eq', ['id', 'c-1']], ['maybeSingle', []]]);
  });
  it('missing, unreadable, NULL-tenant or non-uuid tenant -> null (uniform 404); a reason is required', async () => {
    parentRow = null;
    await expect(ownerCompanyOfRow('campaigns', 'c-1', 'by id')).resolves.toBeNull();
    parentRow = { [col]: A }; parentError = { code: '57014' };
    await expect(ownerCompanyOfRow('campaigns', 'c-1', 'by id')).resolves.toBeNull();
    parentError = null; parentRow = { [col]: null };
    await expect(ownerCompanyOfRow('campaigns', 'c-1', 'by id')).resolves.toBeNull();
    parentRow = { [col]: 'not-a-uuid' };
    await expect(ownerCompanyOfRow('campaigns', 'c-1', 'by id')).resolves.toBeNull();
    await expect(ownerCompanyOfRow('campaigns', '', 'by id')).resolves.toBeNull();
    await expect(ownerCompanyOfRow('campaigns', 'c-1', '')).rejects.toThrow(/reason/);
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
