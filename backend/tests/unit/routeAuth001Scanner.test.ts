/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — the default-deny route authentication gate.
 *
 * STEP 3AH-84 found live routes with no authentication that the existing
 * detector (check-tenant-authz.js) could not see: it only fires when a route
 * extracts a companyId-style key AND calls supabase.from() in the route file.
 * Routes keyed by campaignId, [id], noteId, user_id, or that delegate to a
 * service were invisible. These fixtures pin each of those shapes, plus the
 * ways a textual scanner can be fooled (a name in a comment, an unused import,
 * a same-named local function, a regex literal that desynchronises parsing).
 */
export {};

/* eslint-disable @typescript-eslint/no-var-requires */
const gate = require('../../../scripts/check-route-auth.js');

const AUTH_IMPORT = "import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';";
const DB_IMPORT = "import { supabase } from '../../../backend/db/supabaseClient';";

function rules(src: string, rel = 'pages/api/fixture/route.ts', allowlist: Record<string, unknown> = {}): string[] {
  return gate.analyzeRoute(rel, src, allowlist).violations.map((v: { rule: string }) => v.rule).sort();
}

describe('R1 — authentication must be invoked', () => {
  it('the 3AH-84 shape: campaign-keyed service-role read with no auth → R1', () => {
    const src = `${DB_IMPORT}
      export default async function handler(req, res) {
        const { campaignId } = req.query;
        const { data } = await supabase.from('campaign_performance').select('*').eq('campaign_id', campaignId);
        res.status(200).json(data);
      }`;
    expect(rules(src)).toContain('R1');
  });

  it('a dormant/unreferenced vulnerable route is flagged exactly like a live one', () => {
    // No caller anywhere references this path; the gate does not care — a
    // mounted pages/api file is an entry point whether or not our UI calls it.
    const src = `${DB_IMPORT}
      export default async function handler(req, res) {
        await supabase.from('voice_notes').delete().eq('id', req.query.noteId);
        res.status(200).json({ success: true });
      }`;
    expect(rules(src, 'pages/api/never-called/[noteId].ts')).toContain('R1');
  });

  it('a primitive named only in a comment or a string does not count', () => {
    const src = `// getSupabaseUserFromRequest(req) is called upstream
      const note = 'enforceCompanyAccess(';
      export default async function handler(req, res) { res.status(200).json({ note }); }`;
    expect(rules(src)).toContain('R1');
  });

  it('an imported-but-never-called primitive does not count', () => {
    const src = `${AUTH_IMPORT}
      export default async function handler(req, res) { res.status(200).json({ ok: true }); }`;
    expect(rules(src)).toContain('R1');
  });

  it('a same-named LOCAL function is not the primitive (provenance)', () => {
    const src = `async function isSuperAdmin(req) { return req.headers['x-admin'] === '1'; }
      async function getSupabaseUserFromRequest(req) { return { user: { id: 'anyone' } }; }
      export default async function handler(req, res) {
        const { user } = await getSupabaseUserFromRequest(req);
        if (!(await isSuperAdmin(req))) return res.status(403).end();
        res.status(200).json({ user });
      }`;
    expect(rules(src)).toContain('R1');
  });

  it('a primitive imported from the WRONG module does not count', () => {
    const src = `import { enforceCompanyAccess } from '../../../lib/looksLikeAuth';
      export default async function handler(req, res) {
        const ok = await enforceCompanyAccess({ req, res, companyId: req.query.companyId });
        if (!ok) return; res.status(200).end();
      }`;
    expect(rules(src)).toContain('R1');
  });

  it('delegation into an arbitrary service is NOT credited', () => {
    const src = `import { doEverything } from '../../../backend/services/campaignMemoryService';
      export default async function handler(req, res) { res.status(200).json(await doEverything(req)); }`;
    expect(rules(src)).toContain('R1');
  });

  it('delegation through a verified pages/api helper IS credited (community-ai requireTenantScope)', () => {
    const src = `import { requireTenantScope } from './utils';
      export default async function handler(req, res) {
        const scope = await requireTenantScope(req, res);
        if (!scope) return;
        res.status(200).json({ ok: true });
      }`;
    expect(rules(src, 'pages/api/community-ai/fixture.ts')).toEqual([]);
  });

  it('a regex literal containing quotes does not blind the scanner', () => {
    const src = `import { enforceCompanyAccess } from '../../../backend/services/userContextService';
      const titleOf = (s) => s.match(/Content for "([^"]+)"/);
      export default async function handler(req, res) {
        const ok = await enforceCompanyAccess({ req, res, companyId: req.query.companyId });
        if (!ok) return; res.status(200).json(titleOf('x'));
      }`;
    expect(rules(src)).toEqual([]);
  });
});

describe('R2/R3 — identifiers must be bound, not merely authenticated', () => {
  it('identity only + [id] path segment → R2', () => {
    const src = `${AUTH_IMPORT}
      import { getTemplate } from '../../../backend/services/templateService';
      export default async function handler(req, res) {
        const { user } = await getSupabaseUserFromRequest(req);
        if (!user) return res.status(401).end();
        res.status(200).json(await getTemplate(req.query.id));
      }`;
    expect(rules(src, 'pages/api/fixture/[id].ts')).toContain('R2');
  });

  it('identity only + client user_id → R2', () => {
    const src = `${AUTH_IMPORT}
      export default async function handler(req, res) {
        const { user } = await getSupabaseUserFromRequest(req);
        if (!user) return res.status(401).end();
        const { user_id } = req.body;
        res.status(200).json({ user_id });
      }`;
    expect(rules(src)).toContain('R2');
  });

  it('identity only + campaignId → R3 (campaign never bound)', () => {
    const src = `${AUTH_IMPORT}
      export default async function handler(req, res) {
        const { user } = await getSupabaseUserFromRequest(req);
        if (!user) return res.status(401).end();
        res.status(200).json({ c: req.query.campaignId });
      }`;
    expect(rules(src)).toEqual(expect.arrayContaining(['R2', 'R3']));
  });

  it('enforceCompanyAccess on companyId WITHOUT the campaignId → R3 (the commit-plan class)', () => {
    const src = `import { enforceCompanyAccess } from '../../../backend/services/userContextService';
      export default async function handler(req, res) {
        const { companyId, campaignId } = req.body;
        const ok = await enforceCompanyAccess({ req, res, companyId });
        if (!ok) return; res.status(200).json({ campaignId });
      }`;
    expect(rules(src)).toContain('R3');
  });

  it('enforceCompanyAccess WITH the campaignId passes (the guard binds it)', () => {
    const src = `import { enforceCompanyAccess } from '../../../backend/services/userContextService';
      export default async function handler(req, res) {
        const { companyId, campaignId } = req.body;
        const ok = await enforceCompanyAccess({ req, res, companyId, campaignId });
        if (!ok) return; res.status(200).json({ campaignId });
      }`;
    expect(rules(src)).toEqual([]);
  });

  it('requireCampaignAccess passes', () => {
    const src = `import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
      export default async function handler(req, res) {
        const access = await requireCampaignAccess(req, res, req.query.campaignId);
        if (!access) return; res.status(200).json({ companyId: access.companyId });
      }`;
    expect(rules(src)).toEqual([]);
  });
});

describe('R4 — fail-open secret checks', () => {
  it('`if (secret) { reject on mismatch }` with nothing when unset → R4', () => {
    const src = `import { requireAuth } from '../../../backend/middleware/authMiddleware';
      export default async function handler(req, res) {
        const expected = process.env.PUBLISHING_WORKER_SECRET;
        if (expected) {
          if (req.headers['x-worker-secret'] !== expected) return res.status(401).json({ error: 'no' });
        }
        res.status(200).json({ ran: true });
      }`;
    expect(rules(src)).toContain('R4');
  });

  it('`if (secret && hdr !== secret) reject` → R4', () => {
    const src = `export default async function handler(req, res) {
        const s = process.env.X_WORKER_TOKEN;
        if (s && req.headers.authorization !== s) return res.status(401).end();
        res.status(200).end();
      }`;
    expect(rules(src)).toContain('R4');
  });

  it('fail-closed shapes are not flagged', () => {
    const closed = `export default async function handler(req, res) {
        const s = process.env.CRON_SECRET;
        if (!s) return res.status(503).json({ error: 'not configured' });
        if (req.headers.authorization !== 'Bearer ' + s) return res.status(401).end();
        res.status(200).end();
      }`;
    const prodElse = `export default async function handler(req, res) {
        const s = process.env.INTERNAL_METRICS_SECRET;
        if (s) { if (req.headers['x'] !== s) return res.status(401).end(); }
        else if (process.env.NODE_ENV === 'production') { return res.status(401).end(); }
        res.status(200).end();
      }`;
    expect(gate.failOpenSecret(gate.executable(closed))).toEqual([]);
    expect(gate.failOpenSecret(gate.executable(prodElse))).toEqual([]);
  });
});

describe('allowlist entries are re-verified, never trusted', () => {
  const rel = 'pages/api/fixture/route.ts';
  it('machine-secret entry whose env var is not referenced → ALLOWLIST', () => {
    const src = `export default async function handler(req, res) { res.status(200).end(); }`;
    expect(rules(src, rel, { [rel]: { kind: 'machine-secret', env: ['CRON_SECRET'], reason: 'scheduler endpoint authenticated by CRON_SECRET' } })).toContain('ALLOWLIST');
  });
  it('retired entry that does not answer 410 → ALLOWLIST', () => {
    const src = `export default async function handler(req, res) { res.status(200).json({ still: 'alive' }); }`;
    expect(rules(src, rel, { [rel]: { kind: 'retired', reason: 'retired endpoint, answers 410 Gone' } })).toContain('ALLOWLIST');
  });
  it('inline-binding entry whose evidence code was removed → ALLOWLIST', () => {
    const src = `${AUTH_IMPORT}
      export default async function handler(req, res) { const { user } = await getSupabaseUserFromRequest(req); res.status(200).json({ id: req.query.id, user }); }`;
    const entry = { kind: 'inline-binding', evidence: "\\.eq\\('company_id', companyId\\)", reason: 'reads filter company_id to the authorised company' };
    expect(rules(src, rel, { [rel]: entry })).toContain('ALLOWLIST');
  });
  it('a binding claim never replaces authentication → R1', () => {
    const src = `${DB_IMPORT}
      export default async function handler(req, res) { const { data } = await supabase.from('t').select('*').eq('user_id', req.query.user_id); res.status(200).json(data); }`;
    const entry = { kind: 'identity-scoped', evidence: "\\.eq\\('user_id'", reason: 'rows are scoped to the caller user id' };
    expect(rules(src, rel, { [rel]: entry })).toContain('R1');
  });
  it('an unknown kind is rejected', () => {
    const src = `export default async function handler(req, res) { res.status(200).end(); }`;
    expect(rules(src, rel, { [rel]: { kind: 'trust-me', reason: 'this route is fine, promise' } })).toContain('ALLOWLIST');
  });
});

describe('the repository itself', () => {
  const { rows, stale } = gate.scanRepo();
  const byRoute = new Map(rows.map((r: { route: string }) => [r.route, r]));

  it('every pages/api route passes the gate (no violations, no stale allowlist entries)', () => {
    const bad = rows.filter((r: { violations: unknown[] }) => r.violations.length).map((r: { route: string; violations: Array<{ rule: string; msg: string }> }) => `${r.route}: ${r.violations.map((v) => v.rule).join(',')}`);
    expect(bad).toEqual([]);
    expect(stale).toEqual([]);
  });

  it.each([
    'pages/api/campaigns/weekly-performance.ts',
    'pages/api/campaigns/campaign-summary-update.ts',
    'pages/api/voice/notes/[noteId].ts',
    'pages/api/voice/transcribe.ts',
    'pages/api/analyze/content.ts',
    'pages/api/social/comments.ts',
    'pages/api/wordpress-plugin/register.ts',
    'pages/api/auth/linkedin.ts',
    'pages/api/governance/summary.ts',
    'pages/api/companies/[id]/efficiency.ts',
  ])('STEP 3AH-84 live route %s now authenticates through a primitive (not an allowlist entry)', (route) => {
    const row = byRoute.get(route) as { level: string; allow: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.allow).toBeNull();
    expect(row!.level).not.toBe('none');
  });
});
