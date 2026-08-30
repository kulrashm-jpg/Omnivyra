/**
 * WITHRBAC-STRUCT-001 — `req.rbac.companyId` and the structural guard.
 *
 * Part 1 pins the wrapper contract: the authorized company is exposed, it is
 * EXACTLY the value the authorization decision used, and nothing else about
 * withRBAC changed — same precedence, same role checks, same super-admin
 * behaviour, same missing-company response, and no extra membership query.
 *
 * Part 2 pins the detector against synthetic fixtures of every vulnerability
 * class this programme has actually shipped a fix for, plus the safe patterns
 * that must not be flagged.
 */

import { Role } from '../../services/rbacService';

/* ── Part 1: the withRBAC contract ─────────────────────────────────────── */

/** Every call enforceRole received, so precedence and query counts are visible. */
const enforceCalls: Array<{ companyId: unknown; allowedRoles: Role[] }> = [];
let enforceResult: { userId: string; role: Role } | null = { userId: 'u1', role: Role.COMPANY_ADMIN };
let enforceSideEffect: ((res: any) => void) | null = null;

jest.mock('../../services/rbacService', () => {
  const actual = jest.requireActual('../../services/rbacService');
  return {
    ...actual,
    enforceRole: jest.fn(async (input: any) => {
      enforceCalls.push({ companyId: input.companyId, allowedRoles: input.allowedRoles });
      if (enforceSideEffect) { enforceSideEffect(input.res); return null; }
      return enforceResult;
    }),
  };
});

import { withRBAC } from '../../middleware/withRBAC';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}
async function run(opts: { query?: any; body?: any; roles?: Role[] }) {
  const seen: any = { rbac: undefined, called: false };
  const handler = jest.fn(async (req: any) => { seen.called = true; seen.rbac = req.rbac; });
  const wrapped = withRBAC(handler as any, opts.roles ?? [Role.COMPANY_ADMIN]);
  const res = mockRes();
  await wrapped({ method: 'GET', query: opts.query ?? {}, body: opts.body ?? {}, headers: {} } as never, res);
  return { ...seen, res, handler };
}

beforeEach(() => {
  enforceCalls.length = 0;
  enforceResult = { userId: 'u1', role: Role.COMPANY_ADMIN };
  enforceSideEffect = null;
});

describe('withRBAC exposes the authorized company', () => {
  it('CRITICAL: req.rbac.companyId is the company the wrapper authorized', async () => {
    const r = await run({ query: { companyId: 'company-a' } });
    expect(r.rbac.companyId).toBe('company-a');
    expect(enforceCalls[0].companyId).toBe('company-a');
    // The exposed value and the value the decision used are the same value.
    expect(r.rbac.companyId).toBe(enforceCalls[0].companyId);
  });

  it('CRITICAL: it follows the decision, not the request — body value when query is absent', async () => {
    const r = await run({ body: { companyId: 'from-body' } });
    expect(enforceCalls[0].companyId).toBe('from-body');
    expect(r.rbac.companyId).toBe('from-body');
  });

  it('CRITICAL: query wins over body, and rbac.companyId reflects the winner', async () => {
    const r = await run({ query: { companyId: 'from-query' }, body: { companyId: 'from-body' } });
    expect(enforceCalls[0].companyId).toBe('from-query');
    expect(r.rbac.companyId).toBe('from-query');
    expect(r.rbac.companyId).not.toBe('from-body');
  });

  it('userId and role are unchanged', async () => {
    enforceResult = { userId: 'user-42', role: Role.CONTENT_CREATOR };
    const r = await run({ query: { companyId: 'c1' } });
    expect(r.rbac.userId).toBe('user-42');
    expect(r.rbac.role).toBe(Role.CONTENT_CREATOR);
  });

  it('super-admin behaviour is unchanged and still carries the named company', async () => {
    enforceResult = { userId: 'super-1', role: Role.SUPER_ADMIN };
    const r = await run({ query: { companyId: 'any-company' }, roles: [Role.COMPANY_ADMIN] });
    expect(r.called).toBe(true);
    expect(r.rbac.role).toBe(Role.SUPER_ADMIN);
    expect(r.rbac.companyId).toBe('any-company');
  });

  it('a denial still short-circuits — handler never runs, response untouched', async () => {
    enforceSideEffect = (res) => res.status(400).json({ error: 'companyId required' });
    const r = await run({});
    expect(r.called).toBe(false);
    expect(r.res.statusCode).toBe(400);
    expect(r.res.body).toEqual({ error: 'companyId required' });
    expect(r.rbac).toBeUndefined();
  });

  it('CRITICAL: no additional authorization query is introduced', async () => {
    await run({ query: { companyId: 'c1' } });
    expect(enforceCalls).toHaveLength(1);
  });

  it('the allowed-role set passed to enforceRole is unchanged', async () => {
    await run({ query: { companyId: 'c1' }, roles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
    expect(enforceCalls[0].allowedRoles).toEqual([Role.COMPANY_ADMIN, Role.SUPER_ADMIN]);
  });
});

/* ── Part 2: the structural detector ───────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { classify } = require('../../../scripts/check-withrbac-binding.js');

const wrap = (roles: string, body: string) =>
  `${body}\nexport default withRBAC(handler, ${roles});\n`;

describe('the structural guard catches the shipped vulnerability classes', () => {
  it('RECOMMENDATIONS-SEC-001 — camelCase wrapper vs snake_case handler', () => {
    const src = wrap('[Role.COMPANY_ADMIN]', `
      async function handler(req, res) {
        const { company_id } = req.body || {};
        await supabase.from('recommendation_snapshots').select('*').eq('company_id', company_id);
      }`);
    expect(classify(src).cls).toBe('SUSPICIOUS');
  });

  it('OPPORTUNITIES-SEC-001 — query vs body, hidden behind a truthiness guard', () => {
    const src = wrap('[Role.COMPANY_ADMIN]', `
      async function handler(req, res) {
        const companyId = typeof req.body.companyId === 'string' ? req.body.companyId : '';
        const row = await supabase.from('opportunity_items').select('*').eq('id', req.query.id).single();
        const resolved = companyId || row.company_id;
        if (companyId && companyId !== row.company_id) return res.status(403).json({});
        await takeAction(req.query.id, resolved);
      }`);
    expect(classify(src).cls).toBe('SUSPICIOUS');
  });

  it('WITHRBAC-SEC-001 — resource by id, company read back off the row', () => {
    const src = wrap('[Role.COMPANY_ADMIN, Role.SUPER_ADMIN]', `
      async function handler(req, res) {
        const campaignId = req.query.campaignId;
        const { data: row } = await supabase.from('campaigns').select('*').eq('id', campaignId).maybeSingle();
        await compose({ companyId: row.company_id });
      }`);
    expect(classify(src).cls).toBe('SUSPICIOUS');
  });

  it('row-derived company ALONE is caught (no select-by-id to fall back on)', () => {
    // Isolates the row-company rule: without this fixture, disabling that rule
    // still passes because the select-by-id rule catches the other fixtures.
    const src = wrap('[Role.COMPANY_ADMIN]', `
      async function handler(req, res) {
        const { data: rows } = await supabase.from('campaigns').select('company_id').eq('slug', req.query.slug);
        await compose({ companyId: rows[0].company_id });
      }`);
    expect(classify(src).cls).toBe('SUSPICIOUS');
  });

  it('select-by-id ALONE is caught (no company read back off the row)', () => {
    // Isolates the resource-by-id rule for the same reason.
    const src = wrap('[Role.COMPANY_ADMIN]', `
      async function handler(req, res) {
        const { data: row } = await supabase.from('opportunity_items').select('id, title').eq('id', req.query.id).single();
        await archive(row.id);
      }`);
    expect(classify(src).cls).toBe('SUSPICIOUS');
  });

  it('caller-controlled company passed straight to a tenant sink', () => {
    const src = wrap('[Role.COMPANY_ADMIN]', `
      async function handler(req, res) {
        const { companyId } = req.body;
        await supabase.from('scheduled_posts').select('*').eq('company_id', companyId);
      }`);
    expect(classify(src).cls).toBe('SUSPICIOUS');
  });
});

describe('the structural guard does not flag safe patterns', () => {
  it('binds req.rbac.companyId', () => {
    const src = wrap('[Role.COMPANY_ADMIN]', `
      async function handler(req, res) {
        const { companyId } = req.body;
        await supabase.from('campaigns').select('*').eq('company_id', req.rbac.companyId);
      }`);
    expect(classify(src).cls).toBe('SAFE');
  });

  it.each([
    ['requireCompanyAccess', 'if (!(await requireCompanyAccess(userId, req.body.companyId, res))) return;'],
    ['requireCampaignTenantAccess', 'if (!(await requireCampaignTenantAccess(req, res, req.body.campaignId))) return;'],
    ['requireCompanyContext', 'const ctx = await requireCompanyContext({ req, res, companyId: req.body.companyId });'],
  ])('uses the %s primitive', (_n, guard) => {
    const src = wrap('[Role.COMPANY_ADMIN]', `
      async function handler(req, res) {
        const { companyId } = req.body;
        ${guard}
        await supabase.from('campaigns').select('*').eq('company_id', companyId);
      }`);
    expect(classify(src).cls).toBe('SAFE');
  });

  it('SUPER_ADMIN-only divergence grants nothing', () => {
    const src = wrap('[Role.SUPER_ADMIN]', `
      async function handler(req, res) {
        const companyId = req.body.companyId;
        await supabase.from('campaigns').select('*').eq('company_id', companyId);
      }`);
    expect(classify(src).cls).toBe('SAFE');
  });

  it('reads only the query company — matches the wrapper precedence', () => {
    const src = wrap('[Role.COMPANY_ADMIN]', `
      async function handler(req, res) {
        const companyId = req.query.companyId;
        if (!companyId) return res.status(400).json({});
        await supabase.from('campaigns').select('*').eq('company_id', companyId);
      }`);
    expect(classify(src).cls).toBe('SAFE');
  });

  it('compares the resource company to the authorized company', () => {
    const src = wrap('[Role.COMPANY_ADMIN]', `
      async function handler(req, res) {
        const companyId = req.query.companyId;
        const { data: row } = await supabase.from('campaigns').select('company_id').eq('id', req.query.id).maybeSingle();
        if (row.company_id !== companyId) return res.status(403).json({});
      }`);
    expect(classify(src).cls).toBe('SAFE');
  });

  it('derives the company from the caller own membership', () => {
    const src = wrap('[Role.COMPANY_ADMIN]', `
      async function handler(req, res) {
        const { data: m } = await supabase.from('user_company_roles').select('company_id').eq('user_id', user.id).eq('status','active').maybeSingle();
        await supabase.from('campaigns').select('*').eq('company_id', m.company_id);
      }`);
    expect(classify(src).cls).toBe('SAFE');
  });

  it('a route with no company derivation and no tenant sink is not flagged', () => {
    const src = wrap('[Role.COMPANY_ADMIN]', `
      async function handler(req, res) { return res.status(200).json({ ok: true }); }`);
    expect(classify(src).cls).toBe('SAFE');
  });

  it('never returns UNKNOWN for any of the fixtures above', () => {
    const fixtures = [
      wrap('[Role.COMPANY_ADMIN]', 'async function handler(req){ const {company_id}=req.body; }'),
      wrap('[Role.SUPER_ADMIN]', 'async function handler(req){ const c=req.body.companyId; }'),
      wrap('[Role.COMPANY_ADMIN]', 'async function handler(req){ const c=req.query.companyId; }'),
    ];
    for (const f of fixtures) expect(classify(f).cls).not.toBe('UNKNOWN');
  });
});
