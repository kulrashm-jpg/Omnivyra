/**
 * Agent C (Outreach foundation) — response generation never executes, and the
 * engagement-controls auto-reply switch fails closed.
 *
 * Owner ruling: Engagement Intelligence generates and does not send.
 *
 * BEFORE: POST /api/response/generate took a caller-supplied `execute` flag;
 * `orchestrateResponse` then called `communityAiActionExecutor.executeAction`
 * directly when a `response_rules.auto_reply` rule matched and an active
 * playbook existed — never passing the audited automation gate
 * (automation/automationService). D-01 refused the ad-hoc action inside the
 * executor, but the route still built and handed over a send.
 *
 * AFTER: the orchestrator imports no executor and reads no playbook; the route
 * refuses `execute` with 400 GENERATION_DOES_NOT_EXECUTE before any read.
 *
 * Every assertion below fails against the BEFORE code:
 *   - the executor and playbook modules are tripwires: the old orchestrator
 *     called both on the auto_reply path;
 *   - the old route accepted execute:true and generated (200);
 *   - the old engagementGovernanceService defaulted auto_reply_enabled to TRUE.
 */
export {};

// ── Tripwires: the send path generation must never reach ─────────────────────
const tripped: string[] = [];
jest.mock('../../services/communityAiActionExecutor', () => ({
  executeAction: (...a: unknown[]) => { tripped.push('executeAction'); void a; throw new Error('TRIPWIRE executeAction'); },
}));
jest.mock('../../services/playbooks/playbookService', () => ({
  listPlaybooks: (...a: unknown[]) => { tripped.push('listPlaybooks'); void a; return Promise.resolve([{ id: 'pb-1', status: 'active' }]); },
}));

// ── Generation collaborators: a policy that DOES match auto_reply ────────────
const mockResolvePolicy = jest.fn();
jest.mock('../../services/responsePolicyEngine', () => ({
  resolveResponsePolicy: (...a: unknown[]) => mockResolvePolicy(...a),
}));
const mockGenerate = jest.fn();
jest.mock('../../services/responseGenerationService', () => ({
  generateResponse: (...a: unknown[]) => mockGenerate(...a),
}));
jest.mock('../../services/platformResponseFormatter', () => ({
  formatForPlatform: (text: string) => `formatted:${text}`,
}));

// ── Route seams ──────────────────────────────────────────────────────────────
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
const mockEnforceCompanyAccess = jest.fn();
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: async () => ({ userId: 'user-1', defaultCompanyId: 'org-1' }),
  enforceCompanyAccess: (...a: unknown[]) => mockEnforceCompanyAccess(...a),
}));

/** Read-only fake: every table answers from `rows`; any write trips. */
const rows: Record<string, unknown> = {};
const dbWrites: string[] = [];
function chain(table: string) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit']) c[m] = () => c;
  for (const m of ['insert', 'update', 'upsert', 'delete']) c[m] = () => { dbWrites.push(`${table}.${m}`); return c; };
  c.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
  c.single = c.maybeSingle;
  return c;
}
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => chain(t), rpc: () => { dbWrites.push('rpc'); return Promise.resolve({ data: null, error: null }); } },
}));

import { orchestrateResponse } from '../../services/responseOrchestrator';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const generateRoute = require('../../../pages/api/response/generate').default as (req: unknown, res: unknown) => Promise<unknown>;

function mockRes() {
  const r: { statusCode: number; body: any; headers: Record<string, string> } & Record<string, any> = { statusCode: 200, body: undefined, headers: {} };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; };
  return r;
}

const AUTO_REPLY_POLICY = {
  template_structure: 'thanks', tone: 'friendly', emoji_policy: 'none', auto_reply: true,
};

beforeEach(() => {
  tripped.length = 0;
  dbWrites.length = 0;
  mockResolvePolicy.mockReset().mockResolvedValue(AUTO_REPLY_POLICY);
  mockGenerate.mockReset().mockResolvedValue({ text: 'Thank you!' });
  mockEnforceCompanyAccess.mockReset().mockResolvedValue({ userId: 'user-1' });
  rows.engagement_messages = { id: 'msg-1', thread_id: 'thr-1', content: 'Great post', platform: 'linkedin', platform_message_id: 'urn:1' };
  rows.engagement_threads = { organization_id: 'org-1' };
  rows.engagement_message_intelligence = { intent: 'praise', sentiment: 'positive' };
  rows.lead_signals = null;
});

describe('orchestrateResponse — generation never executes', () => {
  it('an auto_reply rule with an active playbook and execute:true still only suggests', async () => {
    const result = await orchestrateResponse({
      message_id: 'msg-1', organization_id: 'org-1', platform: 'linkedin',
      intent: 'praise', sentiment: 'positive', original_message: 'Great post',
      // A legacy caller may still send the old flag; it must change nothing.
      ...({ execute: true } as Record<string, unknown>),
    } as Parameters<typeof orchestrateResponse>[0]);

    expect(tripped).toEqual([]);
    expect(dbWrites).toEqual([]);
    expect(result).toMatchObject({
      ok: true, executed: false, suggested_text: 'formatted:Thank you!', auto_reply_rule_matched: true,
    });
  });

  it('without auto_reply it suggests and reports no rule match', async () => {
    mockResolvePolicy.mockResolvedValue({ ...AUTO_REPLY_POLICY, auto_reply: false });
    const result = await orchestrateResponse({
      message_id: 'msg-1', organization_id: 'org-1', platform: 'linkedin', original_message: 'hi',
    });
    expect(tripped).toEqual([]);
    expect(result).toMatchObject({ ok: true, executed: false, auto_reply_rule_matched: false });
  });

  it('the module source has no path to the executor, a playbook or a database', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '../../services/responseOrchestrator.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/communityAiActionExecutor/);
    expect(src).not.toMatch(/\bexecuteAction\b/);
    expect(src).not.toMatch(/playbookService|listPlaybooks/);
    expect(src).not.toMatch(/supabaseClient|ownedDbTable/);
    expect(src).not.toMatch(/\bexecute\s*\?\s*:/); // the input type no longer carries `execute`
  });
});

describe('POST /api/response/generate — execute is refused', () => {
  const body = { organization_id: 'org-1', message_id: 'msg-1' };

  it.each([[true], ['true'], [1]])('execute=%p -> 400 GENERATION_DOES_NOT_EXECUTE, nothing generated or read', async (execute) => {
    const res = mockRes();
    await generateRoute({ method: 'POST', body: { ...body, execute }, headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'GENERATION_DOES_NOT_EXECUTE' });
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockEnforceCompanyAccess).not.toHaveBeenCalled();
    expect(tripped).toEqual([]);
  });

  it('without execute it generates a suggestion and reports executed:false', async () => {
    const res = mockRes();
    await generateRoute({ method: 'POST', body, headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, executed: false, suggested_text: 'formatted:Thank you!', auto_reply_rule_matched: true });
    expect(tripped).toEqual([]);
    expect(dbWrites).toEqual([]);
  });

  it('execute:false is the explicit no-op and is accepted', async () => {
    const res = mockRes();
    await generateRoute({ method: 'POST', body: { ...body, execute: false }, headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.executed).toBe(false);
  });
});

// ── engagementGovernanceService — auto_reply_enabled fails closed ────────────
describe('engagementGovernanceService.auto_reply_enabled fails closed', () => {
  type Answer = { data: Record<string, unknown> | null; error: { message: string } | null };
  let answer: Answer = { data: null, error: null };
  let upsertAnswer: Answer = { data: null, error: null };
  let svc: typeof import('../../services/engagementGovernanceService');

  beforeAll(() => {
    jest.isolateModules(() => {
      jest.doMock('../../db/writeOwner', () => ({
        ownedDbTable: () => {
          const c: Record<string, unknown> = {};
          c.select = () => c; c.eq = () => c;
          c.maybeSingle = async () => answer;
          c.upsert = () => ({ select: () => ({ single: async () => upsertAnswer }) });
          return c;
        },
      }));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      svc = require('../../services/engagementGovernanceService');
    });
  });

  it.each<[string, Answer]>([
    ['no row', { data: null, error: null }],
    ['unreadable table', { data: null, error: { message: 'permission denied' } }],
    ['row with NULL', { data: { auto_reply_enabled: null }, error: null }],
    ['row without the column', { data: { bulk_reply_enabled: true }, error: null }],
    ['non-boolean truthy value', { data: { auto_reply_enabled: 'true' }, error: null }],
  ])('%s -> OFF', async (_label, a) => {
    answer = a;
    expect((await svc.getControls('org-1')).auto_reply_enabled).toBe(false);
  });

  it('missing organization id -> OFF', async () => {
    expect((await svc.getControls('')).auto_reply_enabled).toBe(false);
  });

  it('an explicit stored true is honoured (the switch still works when set)', async () => {
    answer = { data: { auto_reply_enabled: true }, error: null };
    expect((await svc.getControls('org-1')).auto_reply_enabled).toBe(true);
  });

  it('updateControls reads back OFF when the stored value is missing', async () => {
    upsertAnswer = { data: { organization_id: 'org-1' }, error: null };
    expect((await svc.updateControls('org-1', { bulk_reply_enabled: false })).auto_reply_enabled).toBe(false);
  });

  it('the other controls keep their existing defaults (scope: auto reply only)', async () => {
    answer = { data: null, error: null };
    const c = await svc.getControls('org-1');
    expect(c).toMatchObject({ bulk_reply_enabled: true, ai_suggestions_enabled: true, triage_engine_enabled: true });
  });
});
