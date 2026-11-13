/**
 * /api/response/rules - S2 tenant seam (two-id sweep UNBOUND-READ, 2026-11-13).
 *
 * THE DEFECTS:
 *  - POST inserted a rule for company A referencing a CALLER-SUPPLIED template_id with no ownership check (the FK
 *    response_rules_template_id_fkey accepts any company's template).
 *  - GET embedded response_templates(template_name) with no organization predicate, so a rule holding another
 *    company's template id (including one already STORED) returned that company's template name.
 *  - The user-supplied platform was interpolated into a PostgREST or-filter unvalidated.
 *
 * The Supabase fake is FAITHFUL: eq / in filters must match; or() is recorded verbatim; insert returns the row.
 */
type Row = Record<string, unknown>;
const CO_A = 'c0a00000-0000-4000-8000-00000000000a';
const CO_B = 'c0b00000-0000-4000-8000-00000000000b';
const TPL_A = 'c0e00000-0000-4000-8000-0000000000a1';
const TPL_B = 'c0e00000-0000-4000-8000-0000000000b1';

let tables: Record<string, Row[]> = {};
const inserts: Array<{ table: string; row: Row }> = [];
const orFilters: string[] = [];
let seq = 0;

function query(table: string) {
  const filters: Array<[string, string, unknown]> = [];
  let op: 'select' | 'insert' = 'select';
  let payload: Row | null = null;
  const q: any = {};
  const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, c, v]) => (k === 'in' ? (v as unknown[]).includes(r[c]) : r[c] === v)));
  q.select = () => q;
  q.eq = (c: string, v: unknown) => { filters.push(['eq', c, v]); return q; };
  q.in = (c: string, v: unknown[]) => { filters.push(['in', c, v]); return q; };
  q.or = (expr: string) => { orFilters.push(expr); return q; };
  q.order = () => q;
  q.insert = (p: Row) => { op = 'insert'; payload = p; return q; };
  q.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
  q.single = async () => {
    if (op === 'insert') { const row = { id: `rule-${++seq}`, ...payload! }; (tables[table] ??= []).push(row); inserts.push({ table, row }); return { data: row, error: null }; }
    const r = rows(); return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { code: 'PGRST116' } };
  };
  q.then = (ok: any, ko: any) => Promise.resolve({ data: rows(), error: null }).then(ok, ko);
  return q;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => query(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => query(t), ownedDbRpc: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: jest.fn(async () => ({ userId: 'u-1', defaultCompanyId: null })),
  enforceCompanyAccess: jest.fn(async ({ res, companyId }: any) => {
    if (companyId === CO_A) return { userId: 'u-1' };
    res.status(403).json({ error: 'Access denied' });
    return null;
  }),
}));

import handler from '../../../pages/api/response/rules';

const call = async (method: 'GET' | 'POST', queryArgs: Row, body: Row = {}) => {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  await (handler as any)({ method, query: queryArgs, body, headers: {} }, res);
  return res;
};

beforeEach(() => {
  inserts.length = 0; orFilters.length = 0; seq = 0;
  tables = {
    response_templates: [
      { id: TPL_A, organization_id: CO_A, template_name: 'A friendly reply' },
      { id: TPL_B, organization_id: CO_B, template_name: 'B SECRET template' },
    ],
    response_rules: [
      { id: 'rule-a-own', organization_id: CO_A, platform: 'linkedin', intent_type: 'question', template_id: TPL_A, auto_reply: false, priority: 2 },
      // A STORED foreign reference (written before this fix): A's rule pointing at B's template.
      { id: 'rule-a-foreign', organization_id: CO_A, platform: 'x', intent_type: 'complaint', template_id: TPL_B, auto_reply: false, priority: 1 },
      { id: 'rule-b', organization_id: CO_B, platform: 'x', intent_type: 'complaint', template_id: TPL_B, auto_reply: true, priority: 9 },
    ],
  };
});

describe('POST /api/response/rules: the template must belong to the authorized company', () => {
  it('CONTROL: A creates a rule with its OWN template → 201, stamped with A', async () => {
    const res = await call('POST', { organization_id: CO_A }, { intent_type: 'question', template_id: TPL_A });
    expect(res.statusCode).toBe(201);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].row).toMatchObject({ organization_id: CO_A, template_id: TPL_A });
  });

  it("CRITICAL: A referencing B's template → uniform 404, NOTHING inserted", async () => {
    const res = await call('POST', { organization_id: CO_A }, { intent_type: 'question', template_id: TPL_B });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Template not found' });
    expect(inserts).toHaveLength(0);
  });

  it("foreign == unknown: B's template answers exactly like a missing one", async () => {
    const foreign = await call('POST', { organization_id: CO_A }, { intent_type: 'q', template_id: TPL_B });
    const missing = await call('POST', { organization_id: CO_A }, { intent_type: 'q', template_id: 'c0e00000-0000-4000-8000-0000000000ff' });
    expect([foreign.statusCode, foreign.body]).toEqual([missing.statusCode, missing.body]);
  });

  it('a non-uuid template_id → 400, nothing read or inserted', async () => {
    const res = await call('POST', { organization_id: CO_A }, { intent_type: 'q', template_id: 'not-a-uuid' });
    expect(res.statusCode).toBe(400);
    expect(inserts).toHaveLength(0);
  });
});

describe('GET /api/response/rules: template names never cross companies', () => {
  it("lists ONLY A's rules; a STORED foreign template reference resolves to null, B's name is never returned", async () => {
    const res = await call('GET', { organization_id: CO_A });
    expect(res.statusCode).toBe(200);
    const rules = res.body.rules as Array<Row & { response_templates: { template_name: string } | null }>;
    expect(rules.map((r) => r.id).sort()).toEqual(['rule-a-foreign', 'rule-a-own']);
    expect(rules.find((r) => r.id === 'rule-a-own')!.response_templates).toEqual({ template_name: 'A friendly reply' });
    expect(rules.find((r) => r.id === 'rule-a-foreign')!.response_templates).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('B SECRET');
  });

  it('the platform filter accepts plain tokens only (it is interpolated into a PostgREST or-filter)', async () => {
    const ok = await call('GET', { organization_id: CO_A, platform: 'linkedin' });
    expect(ok.statusCode).toBe(200);
    expect(orFilters).toEqual(['platform.eq.linkedin,platform.is.null']);
    const injected = await call('GET', { organization_id: CO_A, platform: 'x,organization_id.neq.0' });
    expect(injected.statusCode).toBe(400);
    expect(orFilters).toHaveLength(1);
  });
});
