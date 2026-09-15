/**
 * STEP 3AH-91 (SEC-F, F1) — R1-METHOD: the route-auth gate decides
 * authentication per HTTP-method branch, not per file.
 *
 * Before 3AH-91, R1 passed a file as soon as ANY code path invoked an
 * approved primitive, so a route whose GET authenticated and whose DELETE did
 * not was green (docs/security/ROUTE_AUTH_001_3AH85.md §7.1). These fixtures
 * pin the blind spot (the base gate reports no violation for them) and the
 * shapes that must stay green: shared prelude authentication, a primitive
 * wrapper, a branch delegating to an authenticating same-module function, and
 * fixed-response branches (405 / OPTIONS preflight).
 */
export {};

/* eslint-disable @typescript-eslint/no-var-requires */
const gate = require('../../../scripts/check-route-auth.js');

const AUTH = "import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';";
const TENANT = "import { enforceCompanyAccess } from '../../../backend/services/userContextService';";
const DB = "import { supabase } from '../../../backend/db/supabaseClient';";
const REL = 'pages/api/fixture/route.ts';

function rules(src: string, rel = REL, allowlist: Record<string, unknown> = {}, exemptions: Record<string, unknown> = {}): string[] {
  return gate.analyzeRoute(rel, src, allowlist, exemptions).violations.map((v: { rule: string }) => v.rule).sort();
}

describe('R1-METHOD — the blind spot (a primitive on one method does not cover another)', () => {
  it('if-dispatch: GET authenticates, DELETE writes with no primitive → R1-METHOD', () => {
    const src = `${AUTH}\n${DB}
async function handler(req, res) {
  if (req.method === 'GET') {
    const { user } = await getSupabaseUserFromRequest(req);
    if (!user) return res.status(401).end();
    return res.status(200).json({ id: user.id });
  }
  if (req.method === 'DELETE') {
    await supabase.from('notes').delete().eq('id', req.query.noteId);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).end();
}
export default createApiRoute(handler, { route: '/api/fixture' });`;
    expect(rules(src)).toContain('R1-METHOD');
  });

  it('switch-dispatch: case GET authenticates, case POST writes with no primitive → R1-METHOD', () => {
    const src = `${AUTH}\n${DB}
export default async function handler(req, res) {
  switch (req.method) {
    case 'GET': {
      const { user } = await getSupabaseUserFromRequest(req);
      return res.status(200).json({ user });
    }
    case 'POST':
      await supabase.from('t').insert(req.body);
      return res.status(201).end();
    default:
      return res.status(405).end();
  }
}`;
    expect(rules(src)).toContain('R1-METHOD');
  });

  it('method alias + toUpperCase() is still seen as dispatch', () => {
    const src = `${AUTH}\n${DB}
export default async function handler(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'PUT') { await supabase.from('t').update(req.body).eq('id', req.body.id); return res.status(200).end(); }
  const { user } = await getSupabaseUserFromRequest(req);
  return res.status(200).json({ user });
}`;
    expect(rules(src)).toContain('R1-METHOD');
  });

  it('an unauthenticated branch BEFORE the shared auth call is not covered by it (order matters)', () => {
    const src = `${AUTH}\n${DB}
export default async function handler(req, res) {
  if (req.method === 'GET') return listAll(req, res);
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  return res.status(200).json({ user });
}
async function listAll(req, res) { const { data } = await supabase.from('t').select('*'); return res.status(200).json(data); }`;
    expect(rules(src)).toContain('R1-METHOD');
  });

  it('a branch delegating to a same-module function that never authenticates → R1-METHOD', () => {
    const src = `${AUTH}\n${DB}
async function handleGet(req, res) { const { user } = await getSupabaseUserFromRequest(req); return res.json({ user }); }
async function handlePost(req, res) { await supabase.from('t').insert(req.body); return res.status(201).end(); }
async function handler(req, res) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return res.status(405).end();
}
export default createApiRoute(handler, { route: '/api/fixture' });`;
    expect(rules(src)).toContain('R1-METHOD');
  });

  it('ternary dispatch: the unauthenticated arm is flagged', () => {
    const src = `${AUTH}\n${DB}
async function handlePost(req, res) { const { user } = await getSupabaseUserFromRequest(req); return res.json({ user }); }
async function listPublic(req, res) { const { data } = await supabase.from('t').select('*'); return res.json(data); }
async function handler(req, res) {
  return req.method === 'GET' ? listPublic(req, res) : handlePost(req, res);
}
export default createApiRoute(handler, { route: '/api/fixture' });`;
    expect(rules(src)).toContain('R1-METHOD');
  });

  it('provenance still applies per branch: a same-named LOCAL function does not authenticate the POST branch', () => {
    const src = `import { getSupabaseUserFromRequest as realAuth } from '../../../backend/services/supabaseAuthService';
${DB}
async function getSupabaseUserFromRequest(req) { return { user: { id: 'anyone' } }; }
export default async function handler(req, res) {
  if (req.method === 'GET') { const { user } = await realAuth(req); return res.json({ user }); }
  if (req.method === 'POST') { const { user } = await getSupabaseUserFromRequest(req); await supabase.from('t').insert({ owner: user.id }); return res.end(); }
  return res.status(405).end();
}`;
    expect(rules(src)).toContain('R1-METHOD');
  });

  it('a primitive named only in a comment inside the branch does not count', () => {
    const src = `${AUTH}\n${DB}
export default async function handler(req, res) {
  if (req.method === 'GET') { const { user } = await getSupabaseUserFromRequest(req); return res.json({ user }); }
  if (req.method === 'PATCH') {
    // getSupabaseUserFromRequest(req) was called by the proxy
    await supabase.from('t').update(req.body).eq('id', req.body.id);
    return res.end();
  }
}`;
    expect(rules(src)).toContain('R1-METHOD');
  });

  it('the file-level R1 of the pre-3AH-91 gate is satisfied by these shapes (why R1-METHOD is needed)', () => {
    const src = `${AUTH}\n${DB}
export default async function handler(req, res) {
  if (req.method === 'GET') { const { user } = await getSupabaseUserFromRequest(req); return res.json({ user }); }
  if (req.method === 'DELETE') { await supabase.from('t').delete().eq('id', req.query.noteId); return res.end(); }
}`;
    const row = gate.analyzeRoute(REL, src, {}, {});
    expect(row.level).toBe('identity'); // R1 alone would pass
    expect(row.violations.map((v: { rule: string }) => v.rule)).not.toContain('R1');
    expect(row.violations.map((v: { rule: string }) => v.rule)).toContain('R1-METHOD');
  });
});

describe('R1-METHOD — shapes that must stay green', () => {
  it('shared prelude authentication before dispatch covers every branch', () => {
    const src = `${TENANT}\n${DB}
async function handler(req, res) {
  const companyId = req.query.companyId;
  const ok = await enforceCompanyAccess({ req, res, companyId });
  if (!ok) return;
  if (req.method === 'GET') { const { data } = await supabase.from('t').select('*').eq('company_id', companyId); return res.json(data); }
  if (req.method === 'DELETE') { await supabase.from('t').delete().eq('company_id', companyId).eq('id', req.query.id); return res.end(); }
  return res.status(405).end();
}
export default createApiRoute(handler, { route: '/api/fixture' });`;
    expect(rules(src)).toEqual([]);
  });

  it('a primitive wrapper around the handler authenticates every method', () => {
    const src = `import { withRBAC } from '../../../backend/middleware/withRBAC';\n${DB}
async function handler(req, res) {
  if (req.method === 'GET') { const { data } = await supabase.from('t').select('*').eq('company_id', req.rbac.companyId); return res.json(data); }
  if (req.method === 'POST') { await supabase.from('t').insert({ company_id: req.rbac.companyId }); return res.end(); }
}
export default createApiRoute(withRBAC(handler, ['ADMIN']), { route: '/api/fixture' });`;
    const row = gate.analyzeRoute(REL, src, {}, {});
    expect(row.methodShape).toBe('wrapper');
    expect(row.violations).toEqual([]);
  });

  it('every branch delegating to an authenticating same-module function passes', () => {
    const src = `${TENANT}\n${DB}
async function handleGet(req, res) { if (!(await enforceCompanyAccess({ req, res, companyId: req.query.companyId }))) return; return res.json({}); }
async function handlePost(req, res) { if (!(await enforceCompanyAccess({ req, res, companyId: req.body.companyId }))) return; await supabase.from('t').insert({}); return res.end(); }
async function handler(req, res) {
  switch (req.method) {
    case 'GET': return handleGet(req, res);
    case 'POST': return handlePost(req, res);
    default: return res.status(405).json({ error: 'Method not allowed' });
  }
}
export default createApiRoute(handler, { route: '/api/fixture' });`;
    expect(rules(src)).toEqual([]);
  });

  it('fixed-response branches (OPTIONS preflight, 405) are not data paths', () => {
    const src = `${AUTH}\n${DB}
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.setHeader('Allow', 'GET'); return res.status(204).end(); }
  if (req.method === 'HEAD') return res.status(200).end();
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  return res.json({ user });
}`;
    expect(rules(src)).toEqual([]);
  });

  it('`case "GET": case "HEAD":` fall-through labels share one covered body', () => {
    const src = `${AUTH}
export default async function handler(req, res) {
  switch (req.method) {
    case 'GET':
    case 'HEAD': { const { user } = await getSupabaseUserFromRequest(req); return res.json({ user }); }
    default: return res.status(405).end();
  }
}`;
    const row = gate.analyzeRoute(REL, src, {}, {});
    expect(row.violations).toEqual([]);
    expect(row.methodBranches[0].verbs).toEqual(['GET', 'HEAD']);
  });

  it('a non-binding allowlist entry (public/machine-secret) is the reviewed exception for the whole file', () => {
    const src = `${AUTH}\n${DB}
export default async function handler(req, res) {
  if (req.method === 'GET') { const { data } = await supabase.from('blog').select('id,title'); return res.json(data); }
  if (req.method === 'POST') { const { user } = await getSupabaseUserFromRequest(req); return res.json({ user }); }
}`;
    expect(rules(src, REL, { [REL]: { kind: 'public', reason: 'published blog list for the marketing site' } })).toEqual([]);
  });
});

describe('method exemptions are reviewed claims, re-verified every run', () => {
  const src = `${AUTH}\n${DB}
export default async function handler(req, res) {
  if (req.method === 'GET') { const { user } = await getSupabaseUserFromRequest(req); return res.json({ user }); }
  if (req.method === 'POST') { console.log('mock connect', req.body.code); return res.status(200).json({ id: 'mock_' + Date.now() }); }
}`;
  const writer = src.replace("console.log('mock connect', req.body.code);", "await supabase.from('t').insert(req.body);");

  it('without an exemption the unauthenticated stub branch is R1-METHOD', () => {
    expect(rules(src)).toEqual(['R1-METHOD']);
  });

  it('a stub exemption passes while the branch has no data path', () => {
    const ex = { [REL]: { POST: { kind: 'stub', reason: 'mock connect branch: builds a fake object, no data access' } } };
    expect(rules(src, REL, {}, ex)).toEqual([]);
  });

  it('a stub exemption fails as soon as the branch gains a data path', () => {
    const ex = { [REL]: { POST: { kind: 'stub', reason: 'mock connect branch: builds a fake object, no data access' } } };
    expect(rules(writer, REL, {}, ex)).toEqual(['ALLOWLIST']);
  });

  it('a public exemption fails when the branch writes', () => {
    const ex = { [REL]: { POST: { kind: 'public', reason: 'read-only public aggregate for the blog generator' } } };
    expect(rules(writer, REL, {}, ex)).toEqual(['ALLOWLIST']);
  });

  it('an unknown kind or a missing reason is rejected', () => {
    expect(rules(src, REL, {}, { [REL]: { POST: { kind: 'trust-me', reason: 'this branch is fine, promise!!' } } })).toEqual(['ALLOWLIST']);
    expect(rules(src, REL, {}, { [REL]: { POST: { kind: 'stub', reason: 'ok' } } })).toEqual(['ALLOWLIST']);
  });
});

describe('the repository itself', () => {
  const { rows, stale, staleMethodExemptions, methodExemptions } = gate.scanRepo();

  it('every route passes with per-method analysis on (no violations, no stale entries)', () => {
    const bad = rows.filter((r: { violations: unknown[] }) => r.violations.length)
      .map((r: { route: string; violations: Array<{ rule: string; msg: string }> }) => `${r.route}: ${r.violations.map((v) => `${v.rule} ${v.msg}`).join('; ')}`);
    expect(bad).toEqual([]);
    expect(stale).toEqual([]);
    expect(staleMethodExemptions).toEqual([]);
  });

  it('the handler of every route is resolved (no unrecognised export shapes) and dispatching routes are analysed', () => {
    const shapes = rows.reduce((a: Record<string, number>, r: { methodShape: string }) => ((a[r.methodShape] = (a[r.methodShape] || 0) + 1), a), {});
    expect(shapes.unresolved || 0).toBe(0);
    expect(shapes.none || 0).toBe(0);
    expect(shapes.dispatch).toBeGreaterThan(200);
  });

  it('the two reviewed method exemptions track open findings (SEC91-F1-01/02) and are still needed', () => {
    expect(Object.keys(methodExemptions).sort()).toEqual(['pages/api/accounts/[platform].ts', 'pages/api/track/angle-industry-matrix.ts']);
    const byRoute = new Map(rows.map((r: { route: string }) => [r.route, r]));
    const acct = byRoute.get('pages/api/accounts/[platform].ts') as { methodBranches: Array<{ verbs: string[]; via: string }> };
    expect(acct.methodBranches.find((b) => b.verbs.includes('POST'))!.via).toBe('exempt');
    const matrix = byRoute.get('pages/api/track/angle-industry-matrix.ts') as { methodBranches: Array<{ verbs: string[]; via: string }> };
    expect(matrix.methodBranches.find((b) => b.verbs.includes('GET'))!.via).toBe('exempt');
  });
});
