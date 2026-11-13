/**
 * Outreach WRITE roles across EVERY outreach route the scan found membership-only (e9 GO, 2026-11-13).
 * Owner rulings: view-only means view only; in the Engagement inbox an Engager may TRIAGE + DRAFT (named allowance
 * 'engagement_triage_draft'), never send; extension/bootstrap needs EXECUTE_ACTIONS; cost-governance record/evaluate
 * are admin-only. Real auth chain (routeAuthHarness): only the DB + identity provider are faked.
 *
 * A Viewer is refused on every write of every route, BEFORE the route's own work; an Engager is allowed exactly on
 * the triage / draft routes (it passes the role gate - whatever the route then does) and refused on the rest.
 */
jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production', REDIS_URL: 'redis://127.0.0.1:6379' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));

import path from 'path';
import { COPILOT_INTENTS } from '../../types/copilot';
import { INVESTIGATION_AI_KINDS } from '../../types/investigationAi';
/* eslint-disable @typescript-eslint/no-var-requires */
const H = require('../helpers/routeAuthHarness');
/* eslint-enable @typescript-eslint/no-var-requires */
const { CO_A, USER_A, invoke, rows } = H;
const ROLE_FORBIDDEN = 'ROLE_FORBIDDEN';
function setRole(role: string) {
  const row = rows('user_company_roles').find((r: any) => r.user_id === USER_A && r.company_id === CO_A);
  row.role = role;
}
const route = (rel: string) => require(path.resolve(__dirname, '../../../pages/api', rel)).default;
const ID = '11111111-1111-4111-8111-111111111111';
// every company-id alias the routes read + the ids their pre-gate validation asks for (dummy values)
const BASE = {
  companyId: CO_A, company_id: CO_A, organizationId: CO_A, organization_id: CO_A, orgId: CO_A,
  thread_id: ID, threadId: ID, thread_ids: [ID], threadIds: [ID], message_id: ID, messageId: ID, signal_id: ID,
  signalId: ID, status: 'reviewed', opportunity_id: ID, id: ID, alertId: ID, action: 'acknowledge', audience_id: ID,
  draft: 'a draft', instruction: 'shorter', platform: 'linkedin', action_type: 'reply', action_id: ID, event_name: 'opened',
  opportunity: { topic: 't', suggested_title: 's', opportunity_type: 'post' },
  copilotIntent: COPILOT_INTENTS[0], investigationKind: INVESTIGATION_AI_KINDS[0], subjectRef: 'ref', prompt: 'p',
};
// NOTE: an Engager / admin "not refused" result is meaningful only because the SAME body makes the Viewer hit the
// role refusal (403) - i.e. the request demonstrably reaches the gate; a pre-gate 400 would make "not refused" vacuous.

type Case = { rel: string; method?: string; body?: Record<string, unknown>; query?: Record<string, unknown>; refusal?: 'ROLE_FORBIDDEN' | 'FORBIDDEN_ROLE' | 'any403' };
const ENGAGER_ALLOWED: Case[] = [
  { rel: 'engagement/thread/assign' }, { rel: 'engagement/thread/ignore' }, { rel: 'engagement/thread/bulk-ignore' },
  { rel: 'engagement/thread/bulk-resolve' }, { rel: 'engagement/thread/reply-lock' }, { rel: 'engagement/message/mark-self' },
  { rel: 'engagement/signal/status', method: 'PATCH' }, { rel: 'engagement/generate-response' },
  { rel: 'engagement/refine-suggestion' }, { rel: 'engagement/ai-suggestion', body: { event: 'shown' } },
];
const DEFAULT_RULE: Case[] = [
  { rel: 'engagement/content-opportunities/store' }, { rel: 'engagement/content-opportunities/update', method: 'PATCH' },
  { rel: 'engagement/content-opportunities/lifecycle', method: 'PATCH' }, { rel: 'engagement/platform-preferences', method: 'PATCH' },
  { rel: 'engagement/platform-sync' }, { rel: 'engagement/linkedin/sync' }, { rel: 'engagement/backfill-self-signals' },
  { rel: 'engagement/cancel-queued' }, { rel: 'engagement/detect-leads' }, { rel: 'engagement/crm-export' },
  { rel: 'engagement/telemetry' }, { rel: 'lead-intelligence/operations', body: { action: 'set_status' } },
  { rel: 'lead-intelligence/audiences', body: { action: 'create', name: 'A' } },
  { rel: 'leads/job/create' }, { rel: 'outreach/outcomes' },
  { rel: 'active-leads/alerts' }, { rel: 'active-leads/analyst-collections', body: { action: 'upsert_view' } },
  { rel: 'active-leads/analyst-macros', body: { action: 'upsert' } }, { rel: 'active-leads/copilot' },
  { rel: 'active-leads/investigation-ai' }, { rel: 'active-leads/learning', body: { action: 'recompute' } },
];
const SPECIAL: Case[] = [
  { rel: 'extension/bootstrap', refusal: 'any403' },
  { rel: 'active-leads/cost-governance', body: { action: 'record', category: 'ai' }, refusal: 'FORBIDDEN_ROLE' },
  { rel: 'active-leads/cost-governance', body: { action: 'evaluate', category: 'ai' }, refusal: 'FORBIDDEN_ROLE' },
];

async function call(c: Case) {
  return invoke(route(c.rel), { method: c.method ?? 'POST', as: 'A', body: { ...BASE, ...(c.body ?? {}) }, query: { ...BASE, ...(c.query ?? {}) } });
}
const refusedAsRole = (r: any, kind: Case['refusal'] = 'ROLE_FORBIDDEN') => {
  if (r.status !== 403) return false;
  const code = r.body?.code ?? r.body?.error;
  if (kind === 'any403') return true;
  return code === kind;
};

describe('VIEWER is refused on every write, on every route', () => {
  beforeEach(() => setRole('VIEWER'));
  it.each([...ENGAGER_ALLOWED, ...DEFAULT_RULE, ...SPECIAL].map((c) => [`${c.method ?? 'POST'} ${c.rel}${c.body?.action ? ` (${c.body.action})` : ''}`, c] as const))(
    '%s -> 403', async (_n, c) => {
      const r = await call(c);
      expect([r.status, r.body]).toEqual([403, expect.anything()]);
      expect(refusedAsRole(r, c.refusal)).toBe(true);
    });
});

describe('ENGAGER (owner ruling: triage + draft, never send)', () => {
  beforeEach(() => setRole('CONTENT_ENGAGER'));
  it.each(ENGAGER_ALLOWED.map((c) => [c.rel, c] as const))('passes the role gate on %s', async (_n, c) => {
    const r = await call(c);
    expect(refusedAsRole(r)).toBe(false); // whatever the route then answers, it is not the role refusal
  });
  it.each(DEFAULT_RULE.map((c) => [c.rel, c] as const))('is refused on %s', async (_n, c) => {
    expect(refusedAsRole(await call(c))).toBe(true);
  });
  it('is refused extension/bootstrap (EXECUTE_ACTIONS = Publisher / Admin)', async () => {
    expect((await call(SPECIAL[0])).status).toBe(403);
  });
});

// LOAD-BEARING (05): extension/bootstrap is asserted with 'any403' above (its refusal comes from enforceRole, not the
// ROLE_FORBIDDEN guard). An unrelated 403 would satisfy that - it is THIS admin control (`not.toBe(403)` on the SAME
// case) that makes it meaningful. Do not prune these admin cases as redundant.
describe('CONTROL: COMPANY_ADMIN passes every role gate', () => {
  beforeEach(() => setRole('COMPANY_ADMIN'));
  it.each([...ENGAGER_ALLOWED, ...DEFAULT_RULE, ...SPECIAL].map((c) => [`${c.rel}${c.body?.action ? ` (${c.body.action})` : ''}`, c] as const))(
    '%s', async (_n, c) => {
      const r = await call(c);
      expect(refusedAsRole(r, c.refusal === 'any403' ? 'ROLE_FORBIDDEN' : c.refusal)).toBe(false);
      if (c.refusal === 'any403') expect(r.status).not.toBe(403);
    });
});

describe('a CONTENT_CREATOR (creator-and-up) passes the default rule but not the admin-only / execute-only gates', () => {
  beforeEach(() => setRole('CONTENT_CREATOR'));
  it('default-rule route: allowed', async () => {
    expect(refusedAsRole(await call(DEFAULT_RULE[0]))).toBe(false);
  });
  it('cost-governance record: refused (admin-only)', async () => {
    expect(refusedAsRole(await call(SPECIAL[1]), 'FORBIDDEN_ROLE')).toBe(true);
  });
  it('extension/bootstrap: refused (EXECUTE_ACTIONS)', async () => {
    expect((await call(SPECIAL[0])).status).toBe(403);
  });
});

describe('reads stay open to a Viewer', () => {
  beforeEach(() => setRole('VIEWER'));
  it('audiences preview (a POST read) is not refused', async () => {
    expect(refusedAsRole(await call({ rel: 'lead-intelligence/audiences', body: { action: 'preview', rules: {} } }))).toBe(false);
  });
});
