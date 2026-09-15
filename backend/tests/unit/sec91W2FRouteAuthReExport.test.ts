/**
 * STEP 3AH-91 (W2F-1) — the route-auth gate analyses routes that RE-EXPORT
 * their default handler.
 *
 * Before: scripts/check-route-auth.js decided "is this a route?" with
 * /export\s+default\b/, so `export { default } from '…'` files (4 on the tree:
 * activity-workspace/content, analytics/v1/system-state,
 * command-center/creator-content/generate, intelligence/snapshot) were counted
 * as "helper modules" and never analysed — an unauthenticated handler behind a
 * barrel passed the gate. After: the re-export is followed (into any repo
 * module) and R1–R4 + R1-METHOD are applied to the module that serves the
 * route, with the same provenance/delegation rules; an unresolvable re-export
 * fails closed. Confirmed binding findings surfaced by this are tracked as
 * KNOWN OPEN (printed every run, WARN when fixed) — never silently passed.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

/* eslint-disable @typescript-eslint/no-var-requires */
const gate = require('../../../scripts/check-route-auth.js');

const REL = 'pages/api/fixture/route.ts';
const TARGET = 'backend/services/fixture/routeHandler.ts';
const AUTH_T = "import { getSupabaseUserFromRequest } from '../supabaseAuthService';";
const TENANT_T = "import { enforceCompanyAccess } from '../userContextService';";
const DB_T = "import { supabase } from '../../db/supabaseClient';";
const BARREL = "export { default } from '../../../backend/services/fixture/routeHandler';";

type Row = { violations: Array<{ rule: string; msg: string }>; reExport: string[]; level: string; methodShape: string; knownOpen: Array<{ rule: string }> };
function analyze(src: string, modules: Record<string, string>, allowlist: Record<string, unknown> = {}, rel = REL, knownOpen: Record<string, unknown> = {}): Row {
  return gate.analyzeRoute(rel, src, allowlist, {}, { modules, knownOpen });
}
const rules = (row: Row) => row.violations.map((v) => v.rule).sort();

describe('W2F-1 — a re-exporting file IS a route', () => {
  it('isRouteFile recognises `export { default } from`, `export { h as default } from`, and local `export { h as default }`', () => {
    expect(gate.isRouteFile(BARREL)).toBe(true);
    expect(gate.isRouteFile("export { handler as default } from './impl';")).toBe(true);
    expect(gate.isRouteFile('async function handler(req, res) {}\nexport { handler as default };')).toBe(true);
    expect(gate.isRouteFile('export default async function handler(req, res) {}')).toBe(true);
  });

  it('named re-exports, type re-exports and commented-out re-exports are NOT routes', () => {
    expect(gate.isRouteFile("export { default as Foo } from './x';\nexport { a, b } from './y';")).toBe(false);
    expect(gate.isRouteFile("export type { default } from './x';")).toBe(false);
    expect(gate.isRouteFile("// export { default } from './x';\nexport const helper = 1;")).toBe(false);
  });
});

describe('W2F-1 — the re-exported handler is analysed with the same rules', () => {
  it('an UNAUTHENTICATED handler behind `export { default } from` → R1 (the pre-W2F-1 blind spot)', () => {
    const handler = `${DB_T}\nexport default async function handler(req, res) { const { data } = await supabase.from('notes').select('*'); res.status(200).json(data); }`;
    const row = analyze(BARREL, { [TARGET]: handler });
    expect(rules(row)).toEqual(['R1']);
    expect(row.reExport).toEqual([TARGET]);
  });

  it('an authenticated, tenant-bound handler behind the barrel passes', () => {
    const handler = `${TENANT_T}\nexport default async function handler(req, res) { const ok = await enforceCompanyAccess({ req, res, companyId: req.query.companyId }); if (!ok) return; res.status(200).end(); }`;
    const row = analyze(BARREL, { [TARGET]: handler });
    expect(row.violations).toEqual([]);
    expect(row.level).toBe('tenant');
  });

  it('R2 (identity-only with a request id) and R3 (campaign id unbound) apply through the re-export', () => {
    const handler = `${AUTH_T}\nexport default async function handler(req, res) { const { user } = await getSupabaseUserFromRequest(req); if (!user) return res.status(401).end(); const c = (req.body as any)?.campaignId; res.status(200).json({ c }); }`;
    expect(rules(analyze(BARREL, { [TARGET]: handler }))).toEqual(['R2', 'R3']);
  });

  it('dynamic [segment] identifiers come from the ROUTE path, not the handler module path', () => {
    const handler = `${AUTH_T}\nexport default async function handler(req, res) { const { user } = await getSupabaseUserFromRequest(req); res.status(200).json({ user }); }`;
    const row = gate.analyzeRoute('pages/api/notes/[noteId].ts', "export { default } from '../../../backend/services/fixture/routeHandler';", {}, {}, { modules: { [TARGET]: handler } });
    expect(row.ids).toEqual(['[noteId]']);
    expect(rules(row)).toEqual(['R2']);
  });

  it('R1-METHOD applies to the re-exported handler (GET authenticates, DELETE does not)', () => {
    const handler = `${AUTH_T}\n${DB_T}
export default async function handler(req, res) {
  if (req.method === 'GET') { const { user } = await getSupabaseUserFromRequest(req); return res.status(200).json({ user }); }
  if (req.method === 'DELETE') { await supabase.from('t').delete().eq('x', 1); return res.status(204).end(); }
  return res.status(405).end();
}`;
    const row = analyze(BARREL, { [TARGET]: handler });
    expect(rules(row)).toEqual(['R1-METHOD']);
    expect(row.violations[0].msg).toContain(TARGET);
  });

  it('R4 (fail-open secret) in the re-exported handler', () => {
    const handler = `export default async function handler(req, res) { const s = process.env.WORKER_SECRET; if (s) { if (req.headers['x'] !== s) return res.status(401).end(); } res.status(200).end(); }`;
    expect(rules(analyze(BARREL, { [TARGET]: handler }, { [REL]: { kind: 'machine-secret', env: ['WORKER_SECRET'], reason: 'fixture worker trigger authenticated by a shared secret' } }))).toEqual(['R4']);
  });

  it('`export { handler as default } from` — evidence is SCOPED to that handler (a sibling export\'s primitive does not count)', () => {
    const impl = `${AUTH_T}\n${DB_T}
export async function getHandler(req, res) { const { data } = await supabase.from('t').select('*'); res.json(data); }
export async function postHandler(req, res) { const { user } = await getSupabaseUserFromRequest(req); res.json({ user }); }`;
    const barrel = "export { getHandler as default } from '../../../backend/services/fixture/routeHandler';";
    expect(rules(analyze(barrel, { [TARGET]: impl }))).toEqual(['R1']);
    const authed = "export { postHandler as default } from '../../../backend/services/fixture/routeHandler';";
    expect(analyze(authed, { [TARGET]: impl }).violations).toEqual([]);
  });

  it('local `export { handler as default }` resolves the handler by name', () => {
    const open = `${DB_T.replace('../../db', '../../../backend/db')}\nasync function handler(req, res) { await supabase.from('t').delete(); res.end(); }\nexport { handler as default };`;
    expect(rules(analyze(open, {}))).toEqual(['R1']);
  });

  it('a chain of re-exports is followed and recorded', () => {
    const mid = 'pages/api/fixture/inner.ts';
    const barrel = "export { default } from './inner';";
    const inner = "export { default } from '../../../backend/services/fixture/routeHandler';";
    const handler = `${DB_T}\nexport default async function handler(req, res) { await supabase.from('t').select('*'); res.end(); }`;
    const row = analyze(barrel, { [mid]: inner, [TARGET]: handler });
    expect(row.reExport).toEqual([mid, TARGET]);
    expect(rules(row)).toEqual(['R1']);
  });

  it('fails CLOSED when the re-export cannot be analysed (package, missing module, cycle)', () => {
    expect(rules(analyze("export { default } from 'some-package/handler';", {}))).toEqual(['R1']);
    expect(rules(analyze("export { default } from './does-not-exist-w2f1';", {}))).toEqual(['R1']);
    const a = 'pages/api/fixture/a.ts';
    const b = 'pages/api/fixture/b.ts';
    const row = gate.analyzeRoute(a, "export { default } from './b';", {}, {}, { modules: { [b]: "export { default } from './a';", [a]: "export { default } from './b';" } });
    expect(rules(row)).toEqual(['R1']);
    expect(row.violations[0].msg).toMatch(/fails closed/);
  });

  it('allowlist entries stay keyed by the ROUTE path and their evidence is re-verified against the served module', () => {
    const handler = `${AUTH_T}\n${DB_T}\nexport default async function handler(req, res) { const { user } = await getSupabaseUserFromRequest(req); const { data } = await supabase.from('notes').select('*').eq('user_id', user.id).eq('id', req.query.noteId); res.json(data); }`;
    const entry = { [REL]: { kind: 'identity-scoped', reason: 'notes are filtered by the caller user id', evidence: "\\.eq\\('user_id', user\\.id\\)" } };
    expect(analyze(BARREL, { [TARGET]: handler }, entry).violations).toEqual([]);
    const noBinding = handler.replace(".eq('user_id', user.id)", '');
    expect(rules(analyze(BARREL, { [TARGET]: noBinding }, entry))).toEqual(['ALLOWLIST']);
  });
});

describe('W2F-1 — dynamic-import primitives are provenance-checked like static imports', () => {
  it('`const { getSupabaseUserFromRequest } = await import(…supabaseAuthService)` authenticates', () => {
    const handler = `export default async function handler(req, res) { const { getSupabaseUserFromRequest } = await import('../supabaseAuthService'); const { user } = await getSupabaseUserFromRequest(req); res.json({ user }); }`;
    expect(analyze(BARREL, { [TARGET]: handler }).level).toBe('identity');
  });

  it('a commented-out lazy import, or one from the wrong module, does not', () => {
    const commented = `// const { getSupabaseUserFromRequest } = await import('../supabaseAuthService');\nexport default async function handler(req, res) { const { user } = await getSupabaseUserFromRequest(req); res.json({ user }); }`;
    expect(rules(analyze(BARREL, { [TARGET]: commented }))).toEqual(['R1']);
    const wrong = `export default async function handler(req, res) { const { getSupabaseUserFromRequest } = await import('./myLocalAuth'); const { user } = await getSupabaseUserFromRequest(req); res.json({ user }); }`;
    expect(rules(analyze(BARREL, { [TARGET]: wrong }))).toEqual(['R1']);
  });
});

describe('W2F-1 — known-open tracking is narrow and never hides R1/R1-METHOD/R4', () => {
  const handler = `${AUTH_T}\nexport default async function handler(req, res) { const { user } = await getSupabaseUserFromRequest(req); const id = (req.body as any)?.companyId; res.json({ user, id }); }`;
  const ko = (over: Record<string, unknown> = {}) => ({ [REL]: { rules: ['R2'], finding: 'SEC91-TEST-1', owner: 'SEC-A', reason: 'fixture: confirmed open binding finding tracked here', ...over } });

  it('a listed R2 moves to row.knownOpen (printed by the CLI), nothing else changes', () => {
    const row = analyze(BARREL, { [TARGET]: handler }, {}, REL, ko());
    expect(row.violations).toEqual([]);
    expect(row.knownOpen.map((v) => v.rule)).toEqual(['R2']);
  });

  it('R1 / R1-METHOD / R4 cannot be tracked; a malformed entry tracks nothing', () => {
    const unauth = `export default async function handler(req, res) { res.json({}); }`;
    expect(rules(analyze(BARREL, { [TARGET]: unauth }, {}, REL, ko({ rules: ['R1'] })))).toEqual(['ALLOWLIST', 'R1']);
    expect(rules(analyze(BARREL, { [TARGET]: handler }, {}, REL, ko({ finding: '' })))).toEqual(['ALLOWLIST', 'R2']);
    expect(rules(analyze(BARREL, { [TARGET]: handler }, {}, REL, ko({ reason: 'short' })))).toEqual(['ALLOWLIST', 'R2']);
    expect(gate.verifyKnownOpen({ rules: ['R4'], finding: 'X-1', owner: 'SEC-A', reason: 'x'.repeat(30) })).toEqual([expect.stringContaining('cannot be tracked')]);
  });

  it('a known-open entry whose rule no longer fires is reported stale; one for a missing route fails', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w2f1-'));
    const file = path.join(dir, 'allowlist.json');
    const real = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../scripts/route-auth-allowlist.json'), 'utf8'));
    real.knownOpen['pages/api/intelligence/snapshot.ts'] = { rules: ['R2'], finding: 'SEC91-TEST-2', owner: 'SEC-A', reason: 'fixture: this route binds its tenant, so R2 never fires' };
    real.knownOpen['pages/api/w2f1/does-not-exist.ts'] = { rules: ['R3'], finding: 'SEC91-TEST-3', owner: 'SEC-A', reason: 'fixture: route that does not exist on the tree' };
    fs.writeFileSync(file, JSON.stringify(real));
    try {
      const out = gate.scanRepo({ allowlistPath: file });
      expect(out.staleKnownOpen).toEqual(['pages/api/intelligence/snapshot.ts R2']);
      expect(out.stale).toContain('pages/api/w2f1/does-not-exist.ts (knownOpen)');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('W2F-1 — the repository', () => {
  const { rows, helpers, stale, staleKnownOpen, knownOpen } = gate.scanRepo();
  const byRoute = new Map<string, Row & { route: string }>(rows.map((r: Row & { route: string }) => [r.route, r]));

  it('the four re-exporting routes are analysed through their handler module (not counted as helpers)', () => {
    const expected: Record<string, string> = {
      'pages/api/activity-workspace/content.ts': 'backend/services/activityWorkspace/contentRouteHandler.ts',
      'pages/api/analytics/v1/system-state.ts': 'pages/api/analytics/system-state.ts',
      'pages/api/command-center/creator-content/generate.ts': 'backend/services/creator/generateRoute/generateHandler.ts',
      'pages/api/intelligence/snapshot.ts': 'backend/services/intelligence/snapshotRouteHandler.ts',
    };
    for (const [route, target] of Object.entries(expected)) {
      const r = byRoute.get(route);
      expect(r).toBeDefined();
      expect(r!.reExport[r!.reExport.length - 1]).toBe(target);
      expect(['identity', 'tenant', 'platform']).toContain(r!.level);
      expect(r!.methodShape).not.toBe('unresolved');
      expect(helpers).not.toContain(route);
    }
  });

  it('no remaining helper module re-exports a default (every served file is analysed)', () => {
    for (const h of helpers) {
      expect(gate.defaultExportOf(fs.readFileSync(path.join(__dirname, '../../..', h), 'utf8'))).toBeNull();
    }
  });

  it('the gate passes; the findings surfaced by re-export analysis are tracked as KNOWN OPEN, and still reproduce', () => {
    expect(rows.filter((r: Row) => r.violations.length).map((r: Row & { route: string }) => r.route)).toEqual([]);
    expect(stale).toEqual([]);
    expect(staleKnownOpen).toEqual([]);
    const content = byRoute.get('pages/api/activity-workspace/content.ts')!;
    expect(content.knownOpen.map((v) => v.rule).sort()).toEqual(['R2', 'R3']);
    const generate = byRoute.get('pages/api/command-center/creator-content/generate.ts')!;
    expect(generate.knownOpen.map((v) => v.rule)).toEqual(['R3']);
    for (const [, entry] of Object.entries(knownOpen as Record<string, { rules: string[] }>)) {
      for (const r of entry.rules) expect(['R2', 'R3', 'R4-ENV']).toContain(r);
    }
  });
});
