/**
 * Campaign WRITE role guard (BLOCKING security, 2026-11-13; e9 GO + owner rulings).
 * The standard campaign gates proved MEMBERSHIP only, so a Viewer / Engager could create, plan, schedule, release
 * (publish) and delete campaign work; requireCampaignAccess even labelled every member COMPANY_ADMIN.
 *
 * Runs on the shared routeAuthHarness: only the DB and the identity provider are faked - resolveUserContext,
 * enforceCompanyAccess, TenantGuard, requireCampaignAccess, rbacService and the new guard all run for real.
 * USER_A is COMPANY_ADMIN of CO_A in the base world; tests downgrade that row to VIEWER / CONTENT_ENGAGER.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production', REDIS_URL: 'redis://127.0.0.1:6379' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());
jest.mock('../../services/GovernanceEventService', () => ({ recordGovernanceEvent: async () => undefined }));
jest.mock('../../services/CampaignPreemptionService', () => ({
  executePreemptionFromRequest: async () => ({ preemptedCampaignId: 'x', preemptedExecutionStatus: 'PREEMPTED', preemptedBlueprintStatus: 'ARCHIVED', logId: 'l', justification: 'j' }),
  executeCampaignPreemption: async () => ({ preemptedCampaignId: 'x', preemptedExecutionStatus: 'PREEMPTED' }),
  PreemptionValidationError: class PreemptionValidationError extends Error {},
  PreemptionOwnershipError: class PreemptionOwnershipError extends Error {},
}));
const mockGuardAiRequest = jest.fn(async () => undefined);
jest.mock('../../services/ai/aiRequestGuard', () => ({
  ...jest.requireActual('../../services/ai/aiRequestGuard'),
  guardAiRequest: (...a: unknown[]) => mockGuardAiRequest(...(a as [])),
}));
jest.mock('../../services/CampaignPrePlanningService', () => ({ runPrePlanning: async () => ({ ok: true }) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const H = require('../helpers/routeAuthHarness');
const { campaignWriteDecision, asRawMembershipRole } = require('../../services/campaignWriteRole');
const { requireCampaignAccess } = require('../../services/campaignAccessService');
/* eslint-enable @typescript-eslint/no-var-requires */

const { CO_A, USER_A, CAMPAIGN_A, invoke, seed, rows } = H;
const ROLE_FORBIDDEN = { error: 'Your role can view this campaign but not change it.', code: 'ROLE_FORBIDDEN' };
const JUST = 'A sufficiently long justification for the preemption.';
const REQ_A = 'preq-a-0000-0000-0000-00000000000a';
const CAMPAIGN_A2 = 'camp-a2-0-0000-0000-0000000000a2';

function setRole(role: string) {
  const row = rows('user_company_roles').find((r: any) => r.user_id === USER_A && r.company_id === CO_A);
  row.role = role;
}
const route = (rel: string) => require(path.resolve(__dirname, '../../../pages/api', rel)).default;

beforeEach(() => {
  seed({
    campaigns: [{ id: CAMPAIGN_A2, company_id: CO_A, name: 'Campaign A2', status: 'planning' }],
    campaign_versions: [{ campaign_id: CAMPAIGN_A2, company_id: CO_A, version: 1, created_at: '2026-01-01', campaign_snapshot: {} }],
    campaign_preemption_requests: [{ id: REQ_A, initiator_campaign_id: CAMPAIGN_A, target_campaign_id: CAMPAIGN_A2, status: 'PENDING' }],
  });
});

describe('campaignWriteDecision (pure)', () => {
  const d = (method: string, rawRole: string | null, engagerException: string | null = null, bypass = false) =>
    campaignWriteDecision({ method, rawRole: asRawMembershipRole(rawRole), bypass, engagerException });
  it('reads are never refused', () => {
    for (const r of ['VIEWER', 'VIEW_ONLY', 'CONTENT_ENGAGER', null]) expect(d('GET', r)).toBe('allow');
  });
  it('writes by Viewer / view-only / Engager are refused; by creator-and-up allowed', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const r of ['VIEWER', 'VIEW_ONLY', 'viewer', 'CONTENT_ENGAGER']) expect(d(m, r)).toBe('forbid');
      for (const r of ['CONTENT_CREATOR', 'CONTENT_MANAGER', 'CONTENT_PLANNER', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'COMPANY_ADMIN', 'ADMIN']) expect(d(m, r)).toBe('allow');
    }
  });
  it('unknown or missing role on a write -> refused (fail closed); bypass allows', () => {
    expect(d('POST', 'SOMETHING_ELSE')).toBe('forbid');
    expect(d('POST', null)).toBe('forbid');
    expect(d('POST', 'VIEWER', null, true)).toBe('allow');
  });
  it('the Engager exception is NAMED and opt-in: it lets an Engager write, never a Viewer', () => {
    expect(d('POST', 'CONTENT_ENGAGER', 'campaign_messages')).toBe('allow');
    expect(d('POST', 'CONTENT_ENGAGER', 'voice_notes')).toBe('allow');
    expect(d('POST', 'VIEWER', 'campaign_messages')).toBe('forbid');
    expect(d('POST', 'VIEW_ONLY', 'voice_notes')).toBe('forbid');
  });
});

describe('requireCampaignAccess: real role, read kept, write refused for view-only', () => {
  const call = async (method: string, options?: unknown) => {
    const out: any = { status: undefined, body: undefined };
    const res: any = { status: (c: number) => { out.status = c; return res; }, json: (b: unknown) => { out.body = b; return res; }, setHeader: () => res };
    const req: any = { method, query: {}, body: {}, headers: { authorization: 'Bearer tok-user-a' }, cookies: {}, url: '/x', socket: { remoteAddress: '127.0.0.1' } };
    const access = await requireCampaignAccess(req, res, CAMPAIGN_A, options);
    return { access, ...out };
  };
  it('Viewer GET -> allowed, labelled with the REAL role (VIEW_ONLY), never the COMPANY_ADMIN stamp', async () => {
    setRole('VIEWER');
    const r = await call('GET');
    expect(r.access).not.toBeNull();
    expect(r.access.campaignAuth).toMatchObject({ companyRole: 'VIEW_ONLY', effectiveRole: 'VIEW_ONLY' });
  });
  it('Viewer POST -> 403 ROLE_FORBIDDEN; Engager POST -> 403 ROLE_FORBIDDEN (no exception named)', async () => {
    setRole('VIEWER');
    expect(await call('POST')).toMatchObject({ access: null, status: 403, body: ROLE_FORBIDDEN });
    setRole('CONTENT_ENGAGER');
    expect(await call('POST')).toMatchObject({ access: null, status: 403, body: ROLE_FORBIDDEN });
  });
  it('the named exception lets an Engager through, never a Viewer', async () => {
    setRole('CONTENT_ENGAGER');
    expect((await call('POST', { engagerException: 'campaign_messages' })).access).not.toBeNull();
    setRole('VIEWER');
    expect(await call('POST', { engagerException: 'campaign_messages' })).toMatchObject({ access: null, status: 403 });
  });
  it('CONTROL: an admin writes', async () => {
    expect((await call('POST')).access).not.toBeNull();
  });
});

describe('voice/transcribe (e9 2026-11-13): Viewer 403, Engager + Creator allowed', () => {
  // The AI guard is stubbed to stop at a sentinel: reaching it proves the caller passed the role gate, and no
  // provider is ever called.
  beforeEach(() => {
    const { AiGuardError } = jest.requireActual('../../services/ai/aiRequestGuard');
    mockGuardAiRequest.mockImplementation(async () => { throw new AiGuardError('GUARD_SENTINEL', 'sentinel', 429); });
  });
  afterEach(() => mockGuardAiRequest.mockImplementation(async () => undefined));
  const transcribe = () => invoke(route('voice/transcribe'), { method: 'POST', as: 'A', body: { companyId: CO_A, audioFile: 'data:audio/webm;base64,AAAA', provider: 'whisper' } });
  it('a Viewer gets 403 ROLE_FORBIDDEN (no spend)', async () => {
    setRole('VIEWER');
    expect(await transcribe()).toMatchObject({ status: 403, body: { code: 'ROLE_FORBIDDEN' } });
    expect(mockGuardAiRequest).not.toHaveBeenCalled();
  });
  it.each(['CONTENT_ENGAGER', 'CONTENT_CREATOR', 'COMPANY_ADMIN'])('%s passes the role gate (reaches the AI guard)', async (role) => {
    setRole(role);
    expect(await transcribe()).toMatchObject({ status: 429, body: { code: 'GUARD_SENTINEL' } });
  });
});

describe('campaigns/[id]/release (publishes to the live audience) - pinned', () => {
  let n = 0;
  const release = () => invoke(route('campaigns/[id]/release'), { method: 'POST', as: 'A', query: { id: CAMPAIGN_A }, body: {}, headers: { 'idempotency-key': `rel-${++n}-${Math.random()}` } });
  it('a Viewer gets 403 ROLE_FORBIDDEN', async () => { setRole('VIEWER'); expect(await release()).toMatchObject({ status: 403, body: ROLE_FORBIDDEN }); });
  it('an Engager gets 403 ROLE_FORBIDDEN', async () => { setRole('CONTENT_ENGAGER'); expect(await release()).toMatchObject({ status: 403, body: ROLE_FORBIDDEN }); });
  it('CONTROL: an admin is not refused by the role gate', async () => {
    const r = await release();
    expect(r.body?.code).not.toBe('ROLE_FORBIDDEN');
  });
});

describe('requireCampaignTenantAccess: activity-workspace/schedule', () => {
  let n = 0;
  const schedule = () => invoke(route('activity-workspace/schedule'), { method: 'POST', as: 'A', body: { campaignId: CAMPAIGN_A, companyId: CO_A, platform: 'linkedin', content: 'Post body', scheduledDate: '2099-01-01T09:00:00.000Z' }, headers: { 'idempotency-key': `sch-${++n}-${Math.random()}` } });
  it('a Viewer gets 403 ROLE_FORBIDDEN', async () => { setRole('VIEWER'); expect(await schedule()).toMatchObject({ status: 403, body: ROLE_FORBIDDEN }); });
  it('CONTROL: an admin is not refused by the role gate', async () => { expect((await schedule()).body?.code).not.toBe('ROLE_FORBIDDEN'); });
});

describe('preemption routes (6f): viewer 403, admin still passes the role gate', () => {
  const cases: Array<[string, () => unknown]> = [
    ['campaigns/approve-preemption', () => ({ requestId: REQ_A, companyId: CO_A, justification: JUST })],
    ['campaigns/execute-preemption', () => ({ initiatorCampaignId: CAMPAIGN_A, preemptedCampaignId: CAMPAIGN_A2, companyId: CO_A, justification: JUST })],
    ['campaigns/reject-preemption', () => ({ requestId: REQ_A, companyId: CO_A, reason: 'no' })],
  ];
  it.each(cases)('%s: Viewer -> 403 ROLE_FORBIDDEN', async (rel, body) => {
    setRole('VIEWER');
    expect(await invoke(route(rel), { method: 'POST', as: 'A', body: body() })).toMatchObject({ status: 403, body: ROLE_FORBIDDEN });
  });
  it.each(cases)('%s: CONTROL admin -> not refused by the role gate', async (rel, body) => {
    const r = await invoke(route(rel), { method: 'POST', as: 'A', body: body() });
    expect(r.body?.code).not.toBe('ROLE_FORBIDDEN');
  });
});

describe('dead permission + role lists fixed', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../../pages/api', rel), 'utf8');
  it("campaigns/approve checks APPROVE_CONTENT (the old key 'approve' does not exist and denied everyone)", () => {
    const src = read('campaigns/approve.ts');
    expect(src).toContain("hasPermission(role, 'APPROVE_CONTENT')");
    expect(src).not.toContain("hasPermission(role, 'approve')");
  });
  it.each(['campaigns/optimize-week.ts', 'campaigns/scheduler-payload.ts'])('%s lists NORMALIZED roles', (rel) => {
    const src = read(rel);
    expect(src).toContain('withRBAC(handler, [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CONTENT_CREATOR]');
    expect(src).not.toMatch(/withRBAC\(handler, \[[^\]]*Role\.(ADMIN|CONTENT_PLANNER)\b/);
  });
});

describe('inventory: no campaign write route without a role gate', () => {
  const API = path.resolve(__dirname, '../../../pages/api');
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
  const ROLE_GATES = /requireCampaignAccess\(|requireCampaignTenantAccess\(|enforceCampaignWriteRole\(|enforceRole\(|hasPermission\(|withRBAC\(handler, \[|isSuperAdmin\(|isPlatformSuperAdmin\(|enforceContentWriteRole\(/;
  const MEMBERSHIP_ONLY = /enforceCompanyAccess\(|requireTenantAccess\(|requireCompanyAccess\(|requireCompanyContext\(/;
  const WRITES = /\b(POST|PUT|PATCH|DELETE)\b/;
  // Scoped by the GATE, not by directory (05 review): EVERY route in pages/api that answers a write method behind a
  // membership-only gate AND touches campaign data (a campaign table, campaignId / campaign_id) must reach a role
  // gate - a campaign write moved or added anywhere cannot regress silently.
  const CAMPAIGN_TOUCH = /\.from\(\s*['"][a-z_]*campaign[a-z_]*['"]|ownedDbTable\(\s*['"][a-z_]*campaign[a-z_]*['"]|\bcampaignId\b|\bcampaign_id\b/;
  const files = walk(API).filter((f) => CAMPAIGN_TOUCH.test(fs.readFileSync(f, 'utf8')));
  it('the scan sees the routes it is meant to (positive control)', () => {
    expect(files.length).toBeGreaterThan(60);
    expect(files.some((f) => f.endsWith(path.join('campaigns', '[id]', 'release.ts')))).toBe(true);
    expect(files.some((f) => f.endsWith(path.join('planner', 'generate-workspace-content.ts')))).toBe(true);
  });
  // Surfaces that touch campaign ids but are NOT campaign mutations by the roles this guard governs - each reviewed.
  const OTHER_SURFACES: Record<string, string> = {
    'engagement/content-opportunities/lifecycle.ts': 'engagement surface (the Engager role\'s own work)',
    'engagement/crm-export.ts': 'engagement surface',
    'engagement/generate-response.ts': 'engagement surface (reply drafting)',
    'engagement/refine-suggestion.ts': 'engagement surface',
    'engagement/signal/status.ts': 'engagement surface (signal triage)',
    'lead-intelligence/campaigns.ts': 'OUTREACH surface (6f/e1) - role review raised separately',
    'lead-intelligence/execution.ts': 'OUTREACH surface (6f/e1) - role review raised separately',
  };
  // POST used for READ-ONLY computation (no write, no AI, no side effect) - reviewed 2026-11-13, each with its reason.
  const READ_ONLY_POST: Record<string, string> = {
    'campaigns/health.ts': 'computes a health view from the profile; writes nothing',
    'campaigns/memory.ts': 'reads campaign memory',
    'campaigns/[id]/suggest-themes.ts': 'reads stored strategic themes',
    'campaigns/validate-frequency.ts': 'validates a content mix against plan limits',
    'campaigns/validate-uniqueness.ts': 'reads campaign memory and compares overlap',
    'bolt/conflicts.ts': 'reads scheduling conflicts',
  };
  it('every write-capable route behind a membership-only gate also reaches a role gate', () => {
    const offenders = files.filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      return WRITES.test(src) && MEMBERSHIP_ONLY.test(src) && !ROLE_GATES.test(src);
    }).map((f) => path.relative(API, f).replace(/\\/g, '/')).filter((r) => !(r in READ_ONLY_POST) && !(r in OTHER_SURFACES));
    expect(offenders).toEqual([]);
  });
  // The reusable CLI other tracks point at their own folders (scripts/security/scan-write-role-gates.js) must agree
  // with this inventory - if the two drift, one of them is wrong.
  it('the reusable scan script agrees: 0 ungated campaign write routes, allow list = the reviewed sets above', () => {
    const root = path.resolve(__dirname, '../../..');
    const r = spawnSync(process.execPath, [
      'scripts/security/scan-write-role-gates.js', '--allow', 'scripts/security/write-role-gate-allow/campaign.txt', '--json', '--fail',
    ], { cwd: root, encoding: 'utf8' });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { counts: { roleGated: number }; hits: string[]; allowedHits: string[] };
    expect(out.hits).toEqual([]);
    expect(out.counts.roleGated).toBeGreaterThanOrEqual(50); // positive control: it really saw the gated routes
    const reviewed = new Set(Object.keys({ ...READ_ONLY_POST, ...OTHER_SURFACES }).map((rel) => `pages/api/${rel}`));
    expect(out.allowedHits.filter((h) => !reviewed.has(h))).toEqual([]);
  });
  // Per-wiring pin (83): every route that calls enforceCampaignWriteRole does so AFTER its membership gate (a guard
  // placed before the gate would run without an authorized user/company; one never called would not be found by the
  // stubbed suites).
  it('every explicit enforceCampaignWriteRole call follows the route\'s membership gate', () => {
    const wired = walk(API).filter((f) => fs.readFileSync(f, 'utf8').includes('enforceCampaignWriteRole('));
    expect(wired.length).toBeGreaterThanOrEqual(50);
    const misplaced = wired.filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      const gate = src.search(MEMBERSHIP_ONLY);
      return gate < 0 || src.indexOf('enforceCampaignWriteRole(', src.indexOf('\n', src.indexOf('import { enforceCampaignWriteRole'))) < gate;
    }).map((f) => path.relative(API, f).replace(/\\/g, '/'));
    expect(misplaced).toEqual([]);
  });
  it('platform-plan / health-report (withRBAC ALL_ROLES) are still covered by requireCampaignTenantAccess', () => {
    for (const rel of ['campaigns/platform-plan.ts', 'campaigns/health-report.ts']) {
      expect(fs.readFileSync(path.join(API, rel), 'utf8')).toContain('requireCampaignTenantAccess(');
    }
  });
  it('only campaign messages and voice notes name the Engager exception', () => {
    const named = walk(API).filter((f) => /engagerException:|engagerCampaignWriteException:/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(API, f).replace(/\\/g, '/')).sort();
    expect(named).toEqual(['campaign/messages.ts', 'voice/notes.ts', 'voice/notes/[noteId].ts', 'voice/transcribe.ts']);
  });
});
