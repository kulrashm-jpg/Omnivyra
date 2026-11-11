/**
 * Egress bypass characterisation (Agent F egress matrix, 2026-11-03, rows 2, 4b,
 * 6, 7, 8, 9).
 *
 * Each path below can send to a recipient who holds an in-force canonical
 * restriction (`contact_governance_records`), because it reads no contact
 * governance at all (or, for WhatsApp, not the person anchor). Whether these
 * paths MUST refuse is the owner decision GD-3 (and K-6 for transactional mail);
 * nothing here decides it and no production code is changed.
 *
 * Every path has two tests:
 *   - `CURRENT: ...` asserts the send happens today. It proves the harness reaches
 *     the real send call, so the paired `it.failing` cannot pass for a setup error.
 *   - `PENDING GD-3: ... must refuse a suppressed recipient` asserts the refusal.
 *     It fails today, which `it.failing` reports as a pass. When enforcement lands
 *     both tests go red: delete the CURRENT test and turn the PENDING one into `it`.
 *     If the owner decides a path is exempt, delete both and record the decision.
 *
 * The suppressed recipient is the same everywhere: an in-force `unsubscribe` on
 * channel `*` in this tenant, anchored to the target and to the person. Both
 * governance loaders are mocked to return it, so an enforcement change that reads
 * the canonical store sees it. Nothing here contacts any provider.
 */

type Row = Record<string, unknown>;

const ORG = 'org-a';
const PERSON = 'person-1';
const PHONE = '+15550100001';
const EMAIL = 'opted.out@example.com';
const HANDLE = 'https://www.linkedin.com/in/opted-out';

// ── Governance store ────────────────────────────────────────────────────────

const gov = { records: [] as Row[] };

const record = (over: Row): Row => ({
  id: `g-${gov.records.length + 1}`, organizationId: ORG, personId: null, targetNormalized: null,
  channel: '*', governanceType: 'unsubscribe', effectiveFrom: '2020-01-01T00:00:00.000Z',
  effectiveUntil: null, revokedAt: null, purposeScope: null, ...over,
});

/** The suppressed recipient, anchored to the person and to every target used here. */
const suppressEverywhere = () => {
  gov.records = [
    record({ personId: PERSON }),
    ...[PHONE, EMAIL, HANDLE, 'comment-1', 'post-1'].map((t) => record({ targetNormalized: t })),
  ];
};

jest.mock('../../services/prospectIdentity/contactGovernanceRepository', () => {
  const actual = jest.requireActual('../../services/prospectIdentity/contactGovernanceRepository');
  return {
    ...actual,
    // Shaped like the real loader since A2: the rows come back as ONE tenant read with
    // its database instant (`read_at`). A stub without `reads` is indeterminate and
    // would block for the wrong reason, hiding what this table characterises.
    loadTenantGovernanceRecords: async (org: string) => {
      const records = gov.records.filter((r) => r.organizationId === org);
      return { ok: true, records, reads: [{ anchor: 'tenant', ok: true, records, readAt: '2026-11-11T10:00:00.000Z' }] };
    },
    loadGovernanceRecords: async (l: { organizationId: string }) => ({ ok: true, records: gov.records.filter((r) => r.organizationId === l.organizationId) }),
  };
});

// ── Data layer: an in-memory table per name ───────────────────────────────────

const db: Record<string, Row[]> = {};

function table(name: string) {
  const st = { op: 'select' as 'select' | 'update' | 'insert', patch: null as Row | null, eq: [] as Array<[string, unknown]>, ins: [] as Array<[string, unknown[]]> };
  const rows = (): Row[] => (db[name] ??= []);
  const match = (r: Row) => st.eq.every(([c, v]) => (v === null ? r[c] == null : r[c] === v)) && st.ins.every(([c, vs]) => vs.includes(r[c]));
  const run = async (): Promise<{ data: unknown; error: unknown; count?: number }> => {
    if (st.op === 'insert') {
      const list = Array.isArray(st.patch) ? (st.patch as Row[]) : [st.patch as Row];
      const added = list.map((p, i) => ({ id: `${name}-${rows().length + i + 1}`, ...p }));
      rows().push(...added);
      return { data: added, error: null };
    }
    if (st.op === 'update') {
      const hit = rows().filter(match);
      hit.forEach((r) => Object.assign(r, st.patch));
      return { data: hit, error: null };
    }
    const found = rows().filter(match);
    return { data: found, error: null, count: found.length };
  };
  const first = async () => {
    const r = await run();
    return { data: Array.isArray(r.data) ? (r.data as Row[])[0] ?? null : r.data, error: r.error };
  };
  const api: Record<string, unknown> = {};
  const chain = (fn?: (...a: any[]) => void) => (...a: any[]) => { fn?.(...a); return api; };
  Object.assign(api, {
    select: chain(), order: chain(), limit: chain(), range: chain(), or: chain(), gte: chain(), lte: chain(), lt: chain(), not: chain(),
    insert: chain((p: Row) => { st.op = 'insert'; st.patch = p; }),
    upsert: chain((p: Row) => { st.op = 'insert'; st.patch = p; }),
    update: chain((p: Row) => { st.op = 'update'; st.patch = p; }),
    eq: chain((c: string, v: unknown) => { st.eq.push([c, v]); }),
    is: chain((c: string, v: unknown) => { st.eq.push([c, v]); }),
    in: chain((c: string, vs: unknown[]) => { st.ins.push([c, vs]); }),
    single: first,
    maybeSingle: first,
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
  });
  return api;
}

// ── Send sinks (spies) ──────────────────────────────────────────────────────

const sends = {
  fetch: [] as string[],
  connector: [] as Row[],
  rpa: [] as Row[],
  edge: [] as Row[],
};

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => table(t) }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => table(t),
    rpc: async () => ({ data: null, error: null }),
    functions: { invoke: async (_fn: string, opts: { body: Row }) => { sends.edge.push(opts.body); return { data: null, error: null }; } },
  },
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

// WhatsApp
jest.mock('../../auth/metaAuthService', () => ({ getValidAccessToken: async () => 'test-token' }));
jest.mock('../../auth/credentialEncryption', () => ({ requireEncryptionKey: () => Buffer.from('11'.repeat(32), 'hex') }));

// Community executor (API, RPA, browser)
jest.mock('../../services/communityAiPlatformPolicyService', () => ({
  getCommunityAiPlatformPolicy: async () => ({ execution_enabled: true, require_human_approval: false }),
}));
jest.mock('../../services/usageEnforcementService', () => ({ checkUsageBeforeExecution: async () => ({ allowed: true }) }));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: async () => undefined }));
jest.mock('../../services/usageMeterService', () => ({ incrementUsageMeter: async () => undefined }));
jest.mock('../../services/communityAiNotificationService', () => ({ notifyCommunityAi: async () => undefined }));
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: async () => undefined }));
jest.mock('../../services/communityAiActionLogService', () => ({ logCommunityAiActionEvent: async () => undefined }));
jest.mock('../../services/platformTokenService', () => ({ getToken: async () => ({ access_token: 'tok' }) }));
jest.mock('../../services/platformConnectors/linkedinConnector', () => ({
  executeAction: async (action: Row) => { sends.connector.push(action); return { success: true, platform_id: 'li-1' }; },
}));
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: async (task: Row) => { sends.rpa.push(task); return { success: true }; },
}));

// Social comments route
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => ({ user: { id: 'user-1' }, error: null }),
}));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: async () => ({ userId: 'user-1' }) }));
jest.mock('../../services/engagementIngestionService', () => ({
  ingestComments: async () => ({ ingested: 0 }), getCommentsForScheduledPost: async () => [],
}));

// Extension lease handout
jest.mock('../../middleware/extensionAuthMiddleware', () => ({
  requireExtensionAuth: async () => ({ session: { userId: 'user-1', orgId: ORG, hmacNonce: 'nonce' } }),
}));
jest.mock('../../services/engagementCapabilityMap', () => ({
  CAPABILITY_MAP_VERSION: 'cap-test', resolveEngagementCapability: () => ({ status: 'api_verified' }),
}));
jest.mock('../../services/extensionReliabilityService', () => ({ isCurrentlyDisabled: () => false }));
jest.mock('../../services/extensionCommandSchema', () => ({
  COMMAND_SCHEMA_VERSION: 'schema-test', validateCommandPayload: (_p: string, _a: string, payload: Row) => ({ ok: true, payload }),
}));
jest.mock('../../services/communityAiExecutionResultService', () => ({
  recordExecutionMetric: async () => undefined, persistExecutionResult: async () => ({ ok: true }),
}));
jest.mock('../../services/rpaWorker/rpaAccountTier', () => ({ resolveAccountTier: async () => 'business' }));

import crypto from 'crypto';
import { processBatch } from '../../services/whatsappBroadcastService';
import { executeAction, type CommunityAiAction } from '../../services/communityAiActionExecutor';
import commentsRoute from '../../../pages/api/social/comments';
import extensionCommandsRoute from '../../../pages/api/extension/commands';
import * as emailService from '../../services/emailService';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}

async function callRoute(handler: unknown, req: Row) {
  const res = mockRes();
  await (handler as (q: unknown, s: unknown) => Promise<void>)({ headers: {}, query: {}, body: {}, ...req }, res);
  return res;
}

const encryptPhone = (e164: string): string => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from('11'.repeat(32), 'hex'), iv);
  const enc = c.update(e164, 'utf8', 'hex') + c.final('hex');
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc}`;
};

const action = (over: Partial<CommunityAiAction>): CommunityAiAction => ({
  id: 'act-1', tenant_id: ORG, organization_id: ORG, platform: 'linkedin', action_type: 'reply',
  target_id: 'comment-1', suggested_text: 'Thanks!', playbook_id: null, risk_level: 'low',
  requires_human_approval: false, discovered_user_id: PERSON, ...over,
});

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  sends.fetch.length = 0; sends.connector.length = 0; sends.rpa.length = 0; sends.edge.length = 0;
  suppressEverywhere();
  (global as unknown as { fetch: unknown }).fetch = async (url: string) => {
    sends.fetch.push(String(url));
    return { ok: true, status: 200, json: async () => ({ id: 'reply-1', messages: [{ id: 'wamid.1' }] }) };
  };
});

// ── Path runners: each returns how many sends reached the provider/hand-off ───

/** Row 9: pages/api/social/comments.ts action=reply (LinkedIn) — direct fetch. */
async function socialCommentReply(): Promise<number> {
  db.social_accounts = [{ id: 'acct-1', user_id: 'user-1', company_id: ORG }];
  await callRoute(commentsRoute, {
    method: 'POST',
    body: { action: 'reply', platform: 'linkedin', postId: 'post-1', accountId: 'acct-1', commentId: 'comment-1', replyText: 'Thanks!' },
  });
  return sends.fetch.filter((u) => u.includes('api.linkedin.com')).length;
}

/** Row 6: executeAction → runExecution → runApiExecution → connector.executeAction. */
async function communityApiReply(): Promise<number> {
  await executeAction(action({ execution_mode: 'api' }), true, { source: 'manual' });
  return sends.connector.length;
}

/** Row 8: executeAction → runExecution → runRpaExecution → executeRpaTask. */
async function communityRpaReply(): Promise<number> {
  await executeAction(action({ execution_mode: 'rpa', target_id: HANDLE }), true, { source: 'manual' });
  return sends.rpa.length;
}

/** Row 7a: executeAction → prepareBrowserDispatch (DM queued for the extension). */
async function communityBrowserDm(): Promise<number> {
  const r = await executeAction(action({ execution_mode: 'browser', action_type: 'dm', target_id: HANDLE }), true, { source: 'manual' });
  return r.status === 'dispatched' ? 1 : 0;
}

/** Row 7b: GET /api/extension/commands hands the pending DM to the browser. */
async function extensionLeaseHandout(): Promise<number> {
  db.community_ai_actions = [{
    id: 'act-dm', organization_id: ORG, platform: 'linkedin', action_type: 'dm', target_id: HANDLE,
    suggested_text: 'Hello', execution_mode: 'browser', status: 'pending', created_at: '2026-11-03T00:00:00.000Z',
    dispatch_lease_expires_at: null, dispatch_lease_id: null, execution_correlation_id: 'c-1',
    command_chain: null, command_chain_index: 0, discovered_user_id: PERSON,
  }];
  const res = await callRoute(extensionCommandsRoute, { method: 'GET', headers: { 'x-omnivyra-capability-version': 'cap-test' } });
  return Array.isArray(res.body?.commands) ? res.body.commands.length : 0;
}

/** Row 2: emailService transactional helpers → edge function send-transactional-email. */
async function transactionalEmail(kind: string): Promise<number> {
  switch (kind) {
    case 'company_referral':
      await emailService.sendCompanyAdminReferral(EMAIL, { admin: null, companyName: null, supportEmail: 'support@example.com' });
      break;
    case 'team_invite':
      await emailService.sendInvite(EMAIL, 'https://example.com/invite');
      break;
    case 'inbound_signup_notice':
      await emailService.sendInboundSignupNoticeToAdmin(EMAIL, { prospectEmail: 'p@example.com', companyName: null, supportEmail: 'support@example.com' });
      break;
    case 'credit_alert':
      await emailService.sendCreditAlert({ recipientEmail: EMAIL, companyName: null, consumedPercent: 90, remainingCredits: 1, projectedRequiredCredits: 2, ctaUrl: 'https://example.com' });
      break;
    default: throw new Error(kind);
  }
  return sends.edge.filter((b) => b.recipientEmail === EMAIL).length;
}

/** Row 4b: processBatch reads governance with personId null — a person-anchored record is invisible. */
async function whatsappPersonAnchor(): Promise<number> {
  gov.records = [record({ personId: PERSON })];            // person anchor ONLY (e.g. email unsubscribe link)
  db.unified_persons = [{ id: PERSON, company_id: ORG, primary_phone: PHONE }];
  db.social_accounts = [{ id: 'sa1', company_id: ORG, phone_number_id: 'pn1' }];
  db.whatsapp_broadcasts = [{ id: 'b1', company_id: ORG, social_account_id: 'sa1', message_type: 'text', body: 'hi', name: 'n' }];
  db.whatsapp_broadcast_recipients = [{ id: 'r1', broadcast_id: 'b1', encrypted_phone: encryptPhone(PHONE), status: 'pending', person_id: PERSON }];
  await processBatch('b1', ['r1']);
  return sends.fetch.filter((u) => u.includes('graph.facebook.com')).length;
}

// ── The table ─────────────────────────────────────────────────────────────────

const PATHS: Array<[string, () => Promise<number>]> = [
  ['social/comments direct reply (pages/api/social/comments.ts)', socialCommentReply],
  ['community runExecution API mode (communityAiActionExecutorRuntime.runExecution)', communityApiReply],
  ['community runExecution RPA mode (runRpaExecution → executeRpaTask)', communityRpaReply],
  ['community runExecution browser dispatch (prepareBrowserDispatch)', communityBrowserDm],
  ['extension lease handout (GET /api/extension/commands)', extensionLeaseHandout],
  ['WhatsApp broadcast person anchor (whatsappBroadcastService.processBatch)', whatsappPersonAnchor],
  // K-6 is undecided for these; only E4 (domain reminder) is a decided exemption and is not listed.
  ['transactional company_referral email (emailService.sendCompanyAdminReferral)', () => transactionalEmail('company_referral')],
  ['transactional team_invite email (emailService.sendInvite)', () => transactionalEmail('team_invite')],
  ['transactional inbound_signup_notice email (emailService.sendInboundSignupNoticeToAdmin)', () => transactionalEmail('inbound_signup_notice')],
  ['transactional credit_alert email (emailService.sendCreditAlert)', () => transactionalEmail('credit_alert')],
];

describe('egress bypass characterisation (GD-3 undecided)', () => {
  describe.each(PATHS)('%s', (path, run) => {
    it(`CURRENT: ${path} sends to a suppressed recipient`, async () => {
      expect(await run()).toBeGreaterThan(0);
    });

    it.failing(`PENDING GD-3: ${path} must refuse a suppressed recipient`, async () => {
      expect(await run()).toBe(0);
    });
  });
});
