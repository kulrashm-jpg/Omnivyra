/**
 * STEP 3AH-118 (WS-F) — route-auth ORDERING: an approved primitive that runs
 * after a protected side effect protects nothing. These fixtures pin the
 * ordering rules (R5-ORDER / R5-READ / R6-ORDER / R7-PRINCIPAL) on control flow,
 * not on the textual presence of a primitive: every "bad" fixture below
 * invokes the primitive, so the pre-WS-F gate (R1–R4 presence) passes it.
 */
export {};

/* eslint-disable @typescript-eslint/no-var-requires */
const gate = require('../../../scripts/check-route-auth.js');
const policy = require('../../../scripts/route-auth-ordering-policy.js');

const AUTH = "import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';";
const TENANT = "import { enforceCompanyAccess } from '../../../backend/services/userContextService';";
const DB = "import { supabase } from '../../../backend/db/supabaseClient';";
const REL = 'pages/api/fixture/route.ts';
const SERVICE = 'backend/services/fixture/orderingService.ts';

type Violation = { rule: string; msg: string };
type Row = { violations: Violation[]; knownOpen: Violation[]; ordering: { shape: string; preAuthReads: number; patterned: string[]; flagged: string[] } };
type Opts = { modules?: Record<string, string>; ordering?: Record<string, unknown>; knownOpen?: Record<string, unknown> };

const analyze = (src: string, allowlist: Record<string, unknown> = {}, opts: Opts = {}): Row => gate.analyzeRoute(REL, src, allowlist, {}, opts);
const rules = (src: string, allowlist: Record<string, unknown> = {}, opts: Opts = {}): string[] => analyze(src, allowlist, opts).violations.map((v) => v.rule).sort();
const route = (body: string, imports = `${AUTH}\n${DB}`) => `${imports}\nexport default async function handler(req, res) {\n${body}\n}`;

describe('R5-ORDER — protected side effects before authentication', () => {
  it('safe: authentication first, then the write', () => {
    const src = route(`const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  await supabase.from('notes').insert({ user_id: user.id });
  return res.status(201).end();`);
    expect(rules(src)).toEqual([]);
    expect(analyze(src).ordering.shape).toBe('resolved');
  });

  it('auth-first tenant route: authenticate, authorize, then write', () => {
    const src = route(`const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  const access = await enforceCompanyAccess({ req, res, companyId: req.body.companyId });
  if (!access) return;
  await supabase.from('notes').insert({ company_id: req.body.companyId });
  return res.status(201).end();`, `${AUTH}\n${TENANT}\n${DB}`);
    expect(rules(src)).toEqual([]);
  });

  it('write before auth', () => {
    const src = route(`await supabase.from('notes').insert({ body: req.body.text });
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  return res.status(201).end();`);
    expect(rules(src)).toEqual(['R5-ORDER']);
    expect(analyze(src).violations[0].msg).toMatch(/db-write \.insert\(\)/);
  });

  it('storage deletion before auth', () => {
    const src = route(`await supabase.storage.from('media').remove([req.body.path]);
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  return res.status(204).end();`);
    expect(rules(src)).toEqual(['R5-ORDER']);
    expect(analyze(src).violations[0].msg).toMatch(/storage storage\.remove\(\)/);
  });

  it('queue enqueue before auth', () => {
    const src = route(`await enqueuePublishJob({ post: req.body.post });
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  return res.status(202).end();`, `${AUTH}\nimport { enqueuePublishJob } from '../../../backend/queue/fixtureQueue';`);
    expect(rules(src)).toEqual(['R5-ORDER']);
    expect(analyze(src).violations[0].msg).toMatch(/queue enqueuePublishJob\(\)/);
  });

  it('external API call before auth', () => {
    const src = route(`await fetch('https://api.example.com/v1/things', { method: 'POST' });
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  return res.status(200).end();`, AUTH);
    expect(rules(src)).toEqual(['R5-ORDER']);
    expect(analyze(src).violations[0].msg).toMatch(/external-call fetch\(\)/);
  });

  it('outbound communication before auth', () => {
    const src = route(`await sendInvitationEmail(req.body.email);
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  return res.status(200).end();`, `${AUTH}\nimport { sendInvitationEmail } from '../../../backend/services/fixtureMail';`);
    expect(rules(src)).toEqual(['R5-ORDER']);
    expect(analyze(src).violations[0].msg).toMatch(/outbound sendInvitationEmail\(\)/);
  });

  it('auth helper called AFTER the side effect (present syntactically, executes too late)', () => {
    const src = route(`const created = await supabase.from('notes').insert({ body: req.body.text });
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  return res.status(201).json(created);`);
    expect(gate.analyzeRoute(REL, src, {}, {}).primitives).toContain('getSupabaseUserFromRequest');
    expect(rules(src)).toEqual(['R5-ORDER']);
  });

  it('side effect hidden behind a same-module helper', () => {
    const src = `${AUTH}\n${DB}
async function persist(body) { await supabase.from('notes').upsert(body); }
export default async function handler(req, res) {
  await persist(req.body);
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  return res.status(200).end();
}`;
    expect(rules(src)).toEqual(['R5-ORDER']);
    expect(analyze(src).violations[0].msg).toMatch(/upsert/);
  });

  it('side effect hidden behind an imported service', () => {
    const service = `import { supabase } from '../../db/supabaseClient';\nexport async function recordThing(x) { await supabase.from('things').delete().eq('id', x); }`;
    const src = route(`await recordThing(req.body.text);
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  return res.status(204).end();`, `${AUTH}\nimport { recordThing } from '../../../backend/services/fixture/orderingService';`);
    expect(rules(src, {}, { modules: { [SERVICE]: service } })).toEqual(['R5-ORDER']);
    expect(analyze(src, {}, { modules: { [SERVICE]: service } }).violations[0].msg).toMatch(/via recordThing/);
  });

  it('auth in one branch does not dominate the write after the branch', () => {
    const src = route(`if (req.query.strict) {
    const { user } = await getSupabaseUserFromRequest(req);
    if (!user) return res.status(401).end();
  }
  await supabase.from('notes').insert({ body: req.body.text });
  return res.status(201).end();`);
    expect(rules(src)).toEqual(['R5-ORDER']);
  });

  it('auth only inside a try does not cover the catch', () => {
    const src = route(`try {
    const { user } = await getSupabaseUserFromRequest(req);
    if (!user) return res.status(401).end();
  } catch (e) {
    await supabase.from('errors').insert({ message: String(e) });
  }
  return res.status(200).end();`);
    expect(rules(src)).toEqual(['R5-ORDER']);
  });

  it('auth on the right of && / inside a deferred callback does not dominate', () => {
    const shortCircuit = route(`const strict = Boolean(req.query.strict);
  strict && (await getSupabaseUserFromRequest(req));
  await supabase.from('notes').insert({ body: req.body.text });
  return res.status(201).end();`);
    expect(rules(shortCircuit)).toEqual(['R5-ORDER']);
    const deferred = route(`setTimeout(() => getSupabaseUserFromRequest(req), 0);
  await supabase.from('notes').insert({ body: req.body.text });
  return res.status(201).end();`);
    expect(rules(deferred)).toEqual(['R5-ORDER']);
  });

  it('a callback the callee provably invokes (timeStage) DOES authenticate what follows', () => {
    const src = route(`const { user } = await timeStage(res, 'auth', () => getSupabaseUserFromRequest(req));
  if (!user) return res.status(401).end();
  await supabase.from('notes').insert({ user_id: user.id });
  return res.status(201).end();`, `${AUTH}\n${DB}\nimport { timeStage } from '../../../lib/platform/serverTiming';`);
    expect(rules(src)).toEqual([]);
  });
});

describe('R6-ORDER — side effects after authentication but before tenant authorization', () => {
  const imports = `${AUTH}\n${TENANT}\n${DB}`;

  it('tenant check after the side effect', () => {
    const src = route(`const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  await supabase.from('notes').delete().eq('company_id', req.body.companyId);
  const access = await enforceCompanyAccess({ req, res, companyId: req.body.companyId });
  if (!access) return;
  return res.status(204).end();`, imports);
    expect(rules(src)).toEqual(['R6-ORDER']);
  });

  it('optional request id: bound when present, absent means no tenant is named', () => {
    const src = route(`const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  const { companyId } = req.body;
  if (companyId) {
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;
  }
  await supabase.from('notes').insert({ user_id: user.id, company_id: companyId ?? null });
  return res.status(201).end();`, imports);
    expect(rules(src)).toEqual([]);
  });

  it('optional binding does not apply when the authorization is on a DIFFERENT value', () => {
    const src = route(`const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  const { companyId, otherCompanyId } = req.body;
  if (companyId) {
    const access = await enforceCompanyAccess({ req, res, companyId: otherCompanyId });
    if (!access) return;
  }
  await supabase.from('notes').insert({ company_id: companyId });
  return res.status(201).end();`, imports);
    expect(rules(src)).toEqual(['R6-ORDER']);
  });

  it('optional binding does not apply to a value loaded from the database', () => {
    const src = route(`const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  const { data: row } = await supabase.from('notes').select('company_id').eq('id', req.body.id).maybeSingle();
  const owner = row.company_id;
  if (owner) {
    const access = await enforceCompanyAccess({ req, res, companyId: owner });
    if (!access) return;
  }
  await supabase.from('notes').update({ body: req.body.text }).eq('id', req.body.id);
  return res.status(200).end();`, imports);
    expect(rules(src)).toEqual(['R6-ORDER']);
  });

  it('authorization guarded by `method === GET || POST` covers the matching switch cases only', () => {
    const body = (cases: string) => route(`const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  if (req.method === 'GET' || req.method === 'POST') {
    const access = await enforceCompanyAccess({ req, res, companyId: req.body.companyId });
    if (!access) return;
  }
  switch (req.method) {
${cases}
    default:
      return res.status(405).end();
  }`, imports);
    const covered = body(`    case 'POST':
      await supabase.from('notes').insert({ company_id: req.body.companyId });
      return res.status(201).end();`);
    expect(rules(covered)).toEqual([]);
    const uncovered = body(`    case 'DELETE':
      await supabase.from('notes').delete().eq('company_id', req.body.companyId);
      return res.status(204).end();`);
    expect(rules(uncovered)).toEqual(['R6-ORDER']);
  });
});

describe('secret guards, safe seams, verifiers', () => {
  const SECRET = { [REL]: { kind: 'machine-secret', env: ['CRON_SECRET'], reason: 'fixture cron trigger authenticated by a shared secret' } };
  const CMP = "import { bearerTokenMatches } from '../../../backend/security/constantTimeEqual';";

  it('a constant-time comparator guarding a rejection authenticates (direct and const-bound)', () => {
    const direct = route(`if (!process.env.CRON_SECRET) return res.status(401).end();
  if (!bearerTokenMatches(req.headers.authorization, process.env.CRON_SECRET)) return res.status(401).end();
  await supabase.from('jobs').insert({ at: Date.now() });
  return res.status(200).end();`, `${CMP}\n${DB}`);
    expect(rules(direct, SECRET)).toEqual([]);
    const bound = route(`const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(401).end();
  const ok = bearerTokenMatches(req.headers.authorization, secret);
  if (!ok) return res.status(401).end();
  await supabase.from('jobs').insert({ at: Date.now() });
  return res.status(200).end();`, `${CMP}\n${DB}`);
    expect(rules(bound, SECRET)).toEqual([]);
  });

  it('a write above the comparator, or a plain !== comparison, is before authentication', () => {
    const above = route(`await supabase.from('jobs').insert({ at: Date.now() });
  if (!process.env.CRON_SECRET) return res.status(401).end();
  if (!bearerTokenMatches(req.headers.authorization, process.env.CRON_SECRET)) return res.status(401).end();
  return res.status(200).end();`, `${CMP}\n${DB}`);
    expect(rules(above, SECRET)).toEqual(['R5-ORDER']);
    const plain = route(`if (!process.env.CRON_SECRET) return res.status(401).end();
  if (req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) return res.status(401).end();
  await supabase.from('jobs').insert({ at: Date.now() });
  return res.status(200).end();`, DB);
    expect(rules(plain, SECRET)).toEqual(['R5-ORDER']);
    // A reassignable binding proves nothing about the value tested later.
    const reassigned = route(`if (!process.env.CRON_SECRET) return res.status(401).end();
  let ok = bearerTokenMatches(req.headers.authorization, process.env.CRON_SECRET);
  if (req.query.debug) ok = true;
  if (!ok) return res.status(401).end();
  await supabase.from('jobs').insert({ at: Date.now() });
  return res.status(200).end();`, `${CMP}\n${DB}`);
    expect(rules(reassigned, SECRET)).toEqual(['R5-ORDER']);
  });

  it('logSecurityEvent from the audit service is a safe seam; a same-named local writer is not', () => {
    const seam = route(`const { user } = await getSupabaseUserFromRequest(req);
  if (!user) { await logSecurityEvent({ type: 'denied' }); return res.status(401).end(); }
  return res.status(200).end();`, `${AUTH}\nimport { logSecurityEvent } from '../../../backend/security/audit/SecurityAuditService';`);
    expect(rules(seam)).toEqual([]);
    const local = `${AUTH}\n${DB}
async function logSecurityEvent(e) { await supabase.from('security_events').insert(e); }
export default async function handler(req, res) {
  await logSecurityEvent({ type: 'attempt', body: req.body });
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  return res.status(200).end();
}`;
    expect(rules(local)).toEqual(['R5-ORDER']);
  });

  it('orderingVerifiers: a reviewed credential verifier followed by a 401 authenticates its path', () => {
    const src = route(`const plugin = await authenticatePluginToken(req.headers.authorization);
  if (!plugin) return res.status(401).json({ error: 'invalid token' });
  await supabase.from('plugins').update({ revoked: true }).eq('id', plugin.id);
  return res.status(200).end();`, `${DB}\nimport { authenticatePluginToken } from '../../../backend/services/fixturePlugin';`);
    const ordering = { orderingVerifiers: { [REL]: [{ verifier: 'authenticatePluginToken', reason: 'plugin bearer token resolves the registration; failure answers 401' }] } };
    const allow = { [REL]: { kind: 'machine-token', verifier: 'authenticatePluginToken', reason: 'fixture plugin route authenticated by its plugin token' } };
    expect(rules(src)).toContain('R5-ORDER');
    expect(rules(src, {}, { ordering })).not.toContain('R5-ORDER');
    expect(rules(src, allow)).toEqual([]);
    const noReject = src.replace("if (!plugin) return res.status(401).json({ error: 'invalid token' });", '');
    expect(rules(noReject, {}, { ordering })).toEqual(expect.arrayContaining(['ALLOWLIST', 'R5-ORDER']));
  });
});

describe('R5-READ — read before authentication where the contract requires authentication first', () => {
  const src = route(`const { data } = await supabase.from('notes').select('id').eq('id', req.query.id).maybeSingle();
  if (!data) return res.status(404).end();
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  return res.status(200).json(data);`);

  it('authFirst contract: a pre-authentication read fails', () => {
    const ordering = { authFirst: { [REL]: { reason: 'anti-enumeration: authenticate before the note lookup' } } };
    expect(rules(src, {}, { ordering })).toEqual(expect.arrayContaining(['R5-READ']));
  });

  it('without a contract the read is inventory, not a failure', () => {
    expect(rules(src)).not.toContain('R5-READ');
    expect(analyze(src).ordering.preAuthReads).toBe(1);
  });

  it('identity-scoped entries carry the contract', () => {
    const allow = { [REL]: { kind: 'identity-scoped', evidence: 'getSupabaseUserFromRequest', reason: 'notes are scoped to the calling user by user_id' } };
    expect(rules(src, allow)).toContain('R5-READ');
  });

  it('an auth-first read passes the contract', () => {
    const good = route(`const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  const { data } = await supabase.from('notes').select('id').eq('user_id', user.id);
  return res.status(200).json(data);`);
    expect(rules(good, {}, { ordering: { authFirst: { [REL]: { reason: 'anti-enumeration: authenticate before the note lookup' } } } })).toEqual([]);
  });
});

describe('R7-PRINCIPAL — authorization against caller-controlled principal data', () => {
  it('a role / user id taken from the request body is flagged; the session identity is not', () => {
    const imports = `${AUTH}\n${DB}\nimport { enforceRole } from '../../../backend/services/rbacService';`;
    const bad = route(`const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  const ok = await enforceRole({ req, res, companyId: req.query.companyId, userId: req.body.userId });
  if (!ok) return;
  return res.status(200).end();`, imports);
    expect(rules(bad)).toContain('R7-PRINCIPAL');
    const good = bad.replace('userId: req.body.userId', 'userId: user.id');
    expect(rules(good)).not.toContain('R7-PRINCIPAL');
  });
});

describe('allowlist narrowing is reviewed, narrow, and verified', () => {
  const imports = `${AUTH}\n${TENANT}\n${DB}`;
  const owned = route(`const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  if (req.body.companyId) { await enforceCompanyAccess({ req, res, companyId: String(req.body.teamId) }); }
  const { error } = await supabase.from('posts').update({ title: req.body.title }).eq('id', req.body.id).eq('user_id', user.id);
  return res.status(error ? 500 : 200).end();`, imports);
  const entry = (over: Record<string, unknown> = {}) => ({
    orderingPatterns: {
      [REL]: [{
        rule: 'R6-ORDER', pattern: 'identity-owned-resource',
        reason: 'the post row is updated only where user_id equals the session user',
        evidence: String.raw`\.eq\('user_id', user\.id\)`,
        effects: ['db-write .update() pages/api/fixture/route.ts'],
        ...over,
      }],
    },
  });

  it('without an entry the shape fails R6-ORDER', () => {
    expect(rules(owned)).toEqual(['R6-ORDER']);
  });

  it('a verified pattern narrows exactly its listed effects', () => {
    const row = analyze(owned, {}, { ordering: entry() });
    expect(row.violations).toEqual([]);
    expect(row.ordering.patterned).toEqual(['db-write .update() pages/api/fixture/route.ts']);
  });

  it('a NEW effect not listed in the pattern still fails', () => {
    const more = owned.replace('return res.status(error', "await supabase.from('audit').insert({ x: 1 });\n  return res.status(error");
    expect(rules(more, {}, { ordering: entry() })).toEqual(['R6-ORDER']);
  });

  it('evidence that no longer matches, a wrong shape, an R5 rule, or an unrecognised pattern is rejected', () => {
    expect(rules(owned.replace(".eq('user_id', user.id)", ''), {}, { ordering: entry() })).toEqual(['ALLOWLIST', 'R6-ORDER']);
    expect(rules(owned, {}, { ordering: entry({ evidence: String.raw`\.eq\('id', req\.body\.id\)` }) })).toEqual(['ALLOWLIST', 'R6-ORDER']);
    expect(rules(owned, {}, { ordering: entry({ rule: 'R5-ORDER' }) })).toEqual(['ALLOWLIST', 'R6-ORDER']);
    expect(rules(owned, {}, { ordering: entry({ pattern: 'trust-me' }) })).toEqual(['ALLOWLIST', 'R6-ORDER']);
  });

  it('a known-open ordering finding is printed as tracked, not hidden or failing', () => {
    const knownOpen = { [REL]: { finding: 'WSF-ORD-FIXTURE', owner: 'fixture', rules: ['R6-ORDER'], reason: 'fixture: a confirmed ordering finding tracked for follow-up' } };
    const row = analyze(owned, {}, { knownOpen });
    expect(row.violations).toEqual([]);
    expect(row.knownOpen.map((v) => v.rule)).toEqual(['R6-ORDER']);
  });

  it('the pattern catalogue is closed', () => {
    expect(Object.keys(policy.ORDERING_PATTERNS).sort()).toEqual(['existence-conditioned-binding', 'identity-derived-tenant', 'identity-owned-resource']);
  });
});

describe('the repository', () => {
  const { rows, stale, staleKnownOpen, knownOpen } = gate.scanRepo();
  const byRoute = new Map(rows.map((r: Row & { route: string }) => [r.route, r]));

  it('passes; every handler is interpreted; ordering findings are tracked WSF-ORD-* entries', () => {
    expect(rows.filter((r: Row) => r.violations.length).map((r: Row & { route: string }) => r.route)).toEqual([]);
    expect(stale).toEqual([]);
    expect(staleKnownOpen).toEqual([]);
    expect(rows.every((r: Row) => r.ordering.shape === 'resolved')).toBe(true);
    const ordering = Object.entries(knownOpen).filter(([, ko]) => (ko as { rules: string[] }).rules.some((r) => /^R[567]-/.test(r)));
    // WSF-ORD-001 is FIXED (backend/tests/unit/wsfOrd001ApprovePreemption.test.ts);
    // its knownOpen entry was removed in the same change, per _knownOpenComment.
    expect(ordering.map(([, ko]) => (ko as { finding: string }).finding).sort()).toEqual(['WSF-ORD-002', 'WSF-ORD-003', 'WSF-ORD-004', 'WSF-ORD-005', 'WSF-ORD-006', 'WSF-ORD-007']);
  });

  it('the cron secret route is authenticated by its const-bound comparator before its writes', () => {
    const cron = byRoute.get('pages/api/cron/process-scheduled-posts.ts') as Row;
    expect(cron.violations).toEqual([]);
    expect(cron.ordering.flagged).toEqual([]);
  });
});
