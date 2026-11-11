/**
 * Community journey link — the action must concern the run's PERSON
 * (communityIdentityProof.ts, 20261231000006).
 *
 *   1. the proof itself: every refusal code, and that nothing but a verified
 *      provider-id claim ever proves a person
 *   2. the route, end to end over a fake database: authorization, tenant, the
 *      identity refusals, idempotency and concurrency — with the REAL store and
 *      the REAL proof (no seam the route could bypass)
 *   3. execution time: the adapter re-proves the person on the row it acts on
 *   4. the migration contract (static; the integration owner runs PostgreSQL)
 *
 * Fakes only: no database, no platform, no extension.
 */

import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: jest.fn(() => { throw new Error('RPA must not be reached from a unit test'); }),
}));

// ── a fake database (tenant filters are applied exactly as written) ─────────

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const unreadable = new Set<string>();
const inserts: Array<{ table: string; row: Row }> = [];
const tick = () => new Promise<void>((r) => setImmediate(r));

function fakeQuery(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let insertRow: Row | null = null;
  let limitN: number | null = null;
  const run = async (mode: 'one' | 'many') => {
    await tick();
    if (insertRow !== null) {
      const row = insertRow;
      inserts.push({ table, row });
      const rows = (tables[table] ??= []);
      if (table === 'community_action_journey_links') {
        if (rows.some((r) => r.organization_id === row.organization_id && r.execution_task_id === row.execution_task_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "community_action_journey_links_task_unique"' } };
        }
        if (rows.some((r) => r.organization_id === row.organization_id && r.community_action_id === row.community_action_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "community_action_journey_links_action_unique"' } };
        }
      }
      const stored = { id: `row-${rows.length + 1}`, created_at: NOW, ...row };
      rows.push(stored);
      return { data: { ...stored }, error: null };
    }
    if (unreadable.has(table)) return { data: null, error: { code: '08006', message: 'connection failure' } };
    let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    if (limitN !== null) rows = rows.slice(0, limitN);
    if (mode === 'many') return { data: rows.map((r) => ({ ...r })), error: null };
    return { data: rows[0] ? { ...rows[0] } : null, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; },
    in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; },
    not: () => b,
    order: () => b,
    limit: (n: number) => { limitN = n; return b; },
    insert: (row: Row) => { insertRow = row; return b; },
    maybeSingle: () => run('one'),
    single: () => run('one'),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run('many').then(res, rej),
  };
  return b;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => fakeQuery(t), ownedDbRpc: jest.fn() }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => fakeQuery(t), rpc: jest.fn() } }));

// ── authorization seams, each one switchable ───────────────────────────────

const auth = { member: true, capability: true, role: true };
const authCalls: string[] = [];
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async ({ res }: { res: { status: (c: number) => { json: (b: unknown) => void } } }) => {
    authCalls.push('access');
    if (!auth.member) { res.status(403).json({ error: 'forbidden' }); return null; }
    return { userId: 'user-1' };
  }),
}));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: jest.fn(async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => {
    authCalls.push('capability');
    if (!auth.capability) { res.status(403).json({ error: 'capability' }); return { ok: false }; }
    return { ok: true };
  }),
}));
jest.mock('../../services/rbacService', () => ({
  ...jest.requireActual('../../services/rbacService'),
  enforceRole: jest.fn(async ({ res }: { res: { status: (c: number) => { json: (b: unknown) => void } } }) => {
    authCalls.push('role');
    if (!auth.role) { res.status(403).json({ error: 'role' }); return null; }
    return { userId: 'user-1', role: 'COMPANY_ADMIN' };
  }),
}));
jest.mock('../../services/executionInstances/executionInstanceStore', () => ({
  getExecutionInstance: jest.fn(async (org: string, id: string) => {
    authCalls.push('instance');
    return org === CONTRACT_ORG && id === INSTANCE ? { id, organizationId: org } : null;
  }),
}));

import handler, { statusForLinkError } from '../../../pages/api/execution-instances/[id]/community-link';
import {
  IDENTITY_REFUSAL_CODES,
  proveActionPerson,
  TRANSIENT_IDENTITY_CODES,
  type ProofActionRow,
} from '../../services/orchestration/communityIdentityProof';
import {
  createCommunityAdapter,
  createLinkedActionBinding,
  type CommunityActionRow,
  type CommunityAdapterDeps,
  type RequestRow,
} from '../../services/orchestration/communityEngineAdapter';
import type { EngineStepContext } from '../../services/orchestration/engineAdapters';
import {
  CONTRACT_ORG, CONTRACT_OTHER_ORG, contractContext, expectContractResult,
} from './helpers/engineAdapterContractKit';
import {
  DISCOVERED_USER, OTHER_PERSON, PROVEN_PERSON, PROVIDER_ID, SUBJECT, VERIFIED_CLAIM, identityWorld,
  subjectOAuthEvidence,
} from './helpers/communityIdentityFixture';

const NOW = '2026-10-28T09:00:00.000Z';
const INSTANCE = contractContext().executionInstanceId;
const TASK = contractContext().executionTaskId;
const TASK_2 = '88888888-8888-4888-8888-888888888888';
const ACTION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_DU = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

function actionRow(over: Partial<CommunityActionRow> = {}): CommunityActionRow {
  return {
    id: ACTION, tenant_id: CONTRACT_ORG, organization_id: CONTRACT_ORG,
    platform: 'linkedin', action_type: 'reply', target_id: 'urn:li:activity:123',
    suggested_text: 'Thanks for sharing this.', final_text: null, playbook_id: 'pb-1',
    requires_human_approval: true, risk_level: 'low', approved_at: null, status: 'pending',
    execution_mode: 'api', scheduled_at: null, execution_correlation_id: null,
    execution_result: null, intent_classification: null, discovered_user_id: DISCOVERED_USER, ...over,
  };
}

// ── 1. The proof ────────────────────────────────────────────────────────────

describe('community person proof', () => {
  const prove = (w: ReturnType<typeof identityWorld>, action: Partial<ProofActionRow> = {}, expected: Array<string | null> = []) =>
    proveActionPerson({ organizationId: CONTRACT_ORG, subject: SUBJECT, action: actionRow(action as Partial<CommunityActionRow>), expectedPersonIds: expected }, w.port);
  const codeOf = async (p: ReturnType<typeof prove>) => { const r = await p; return r.ok === false ? r.code : 'ok'; };

  it('proves the run\'s person through one active, verified external_id claim', async () => {
    const w = identityWorld();
    expect(await prove(w)).toEqual({
      ok: true, personId: PROVEN_PERSON, claimId: VERIFIED_CLAIM, discoveredUserId: DISCOVERED_USER,
      platform: 'linkedin', providerId: PROVIDER_ID.toLowerCase(),
    });
  });

  it('missing identity: no account, an account of no tenant row, an account with no provider id', async () => {
    expect(await codeOf(prove(identityWorld(), { discovered_user_id: null }))).toBe('identity_missing');
    expect(await codeOf(prove(identityWorld(), { discovered_user_id: OTHER_DU }))).toBe('identity_missing');
    const w = identityWorld();
    w.discovered.get(DISCOVERED_USER)!.external_user_id = '   ';
    expect(await codeOf(prove(w))).toBe('identity_missing');
  });

  it('never infers: a username / name / profile URL that matches nothing proves nothing', async () => {
    const w = identityWorld();
    // The account's provider id is unknown; only a "username" would match a claim.
    Object.assign(w.discovered.get(DISCOVERED_USER)!, { external_user_id: null, external_username: PROVIDER_ID, profile_url: 'https://linkedin.com/in/x' });
    expect(await codeOf(prove(w))).toBe('identity_missing');
    expect(w.reads).not.toContain('claims');
  });

  it('missing person: the run\'s subject has no canonical person; an unreadable subject waits', async () => {
    const w = identityWorld();
    w.subjects.set(`${SUBJECT.kind}:${SUBJECT.id}`, { org: CONTRACT_ORG, personId: null });
    expect(await codeOf(prove(w))).toBe('person_unresolved');
    const w2 = identityWorld();
    w2.knobs.subjectUnreadable = true;
    expect(await codeOf(prove(w2))).toBe('person_unreadable');
    expect(TRANSIENT_IDENTITY_CODES.has('person_unreadable')).toBe(true);
  });

  it('cross-tenant: the action, the account, or the claim of another tenant never proves', async () => {
    expect(await codeOf(prove(identityWorld(), { tenant_id: CONTRACT_OTHER_ORG }))).toBe('identity_cross_tenant');
    const w = identityWorld();
    w.discovered.get(DISCOVERED_USER)!.tenant_id = CONTRACT_OTHER_ORG;
    expect(await codeOf(prove(w))).toBe('identity_cross_tenant');
    const w2 = identityWorld();
    w2.discovered.get(DISCOVERED_USER)!.organization_id = CONTRACT_OTHER_ORG;   // invisible to this tenant
    expect(await codeOf(prove(w2))).toBe('identity_missing');
    const w3 = identityWorld();
    w3.claims[0].organization_id = CONTRACT_OTHER_ORG;
    expect(await codeOf(prove(w3))).toBe('identity_unclaimed');
    // The run's subject resolved in another tenant is not this tenant's person.
    const w4 = identityWorld(CONTRACT_OTHER_ORG);
    expect(await codeOf(proveActionPerson({ organizationId: CONTRACT_ORG, subject: SUBJECT, action: actionRow() }, w4.port))).toBe('person_unresolved');
  });

  it('a claim that slips through the read filter is re-checked, never trusted', async () => {
    const w = identityWorld();
    w.port.readActiveExternalIdClaims = async () => [{ ...w.claims[0], organization_id: CONTRACT_OTHER_ORG }];
    expect(await codeOf(prove(w))).toBe('identity_unclaimed');
    w.port.readActiveExternalIdClaims = async () => [{ ...w.claims[0], revoked_at: NOW }];
    expect(await codeOf(prove(w))).toBe('identity_unclaimed');
    w.port.readActiveExternalIdClaims = async () => [{ ...w.claims[0], claim_type: 'external_profile' }];
    expect(await codeOf(prove(w))).toBe('identity_unclaimed');
  });

  it('platform mismatch between the account and the action', async () => {
    const w = identityWorld();
    w.discovered.get(DISCOVERED_USER)!.platform = 'twitter';
    expect(await codeOf(prove(w))).toBe('identity_platform_mismatch');
  });

  it('unclaimed: no claim, a revoked claim, or a claim attributed to nobody', async () => {
    const w = identityWorld();
    w.claims.length = 0;
    expect(await codeOf(prove(w))).toBe('identity_unclaimed');
    const w2 = identityWorld();
    w2.claims[0].revoked_at = NOW;
    expect(await codeOf(prove(w2))).toBe('identity_unclaimed');
    const w3 = identityWorld();
    w3.claims[0].person_id = null;
    expect(await codeOf(prove(w3))).toBe('identity_unclaimed');
  });

  it('unverified: the attribution every current writer makes is not authoritative', async () => {
    const w = identityWorld();
    Object.assign(w.claims[0], { verification_state: 'unverified', verified_at: null });
    expect(await codeOf(prove(w))).toBe('identity_unverified');
    const w2 = identityWorld();
    w2.claims[0].verified_at = null;                           // incoherent "verified"
    expect(await codeOf(prove(w2))).toBe('identity_unverified');
    const w3 = identityWorld();
    w3.claims[0].verification_state = 'rejected';
    expect(await codeOf(prove(w3))).toBe('identity_unverified');
  });

  it('ambiguous: two active claims for one account (even both verified) prove nobody', async () => {
    const w = identityWorld();
    w.claims.push({ ...w.claims[0], id: 'dupe-claim', person_id: OTHER_PERSON });
    expect(await codeOf(prove(w))).toBe('identity_ambiguous');
    const w2 = identityWorld();
    w2.claims.push({ ...w2.claims[0], id: 'dupe-claim' });      // same person, two rows
    expect(await codeOf(prove(w2))).toBe('identity_ambiguous');
  });

  it('mismatch: the account is verified as another person; a recorded person differs', async () => {
    const w = identityWorld();
    w.claims[0].person_id = OTHER_PERSON;
    expect(await codeOf(prove(w))).toBe('identity_mismatch');
    expect(await codeOf(prove(identityWorld(), {}, [OTHER_PERSON]))).toBe('person_mismatch');
    expect(await codeOf(prove(identityWorld(), {}, [null, PROVEN_PERSON]))).toBe('ok');
  });

  it('follow: the followed account must BE the action\'s account', async () => {
    expect(await codeOf(prove(identityWorld(), { action_type: 'follow', platform: 'linkedin', target_id: 'someone-else' }))).toBe('target_actor_mismatch');
    expect(await codeOf(prove(identityWorld(), { action_type: 'follow', target_id: `  @${PROVIDER_ID.toUpperCase()} ` }))).toBe('ok');
  });

  it('dm: a thread, or any recipient other than the account\'s provider id, is unproven', async () => {
    expect(await codeOf(prove(identityWorld(), { action_type: 'dm', target_id: 'https://www.linkedin.com/messaging/thread/2-abc/' }))).toBe('dm_recipient_unproven');
    expect(await codeOf(prove(identityWorld(), { action_type: 'dm', target_id: PROVIDER_ID, metadata: { dm_thread_ready: true, dm_thread_id: 'x' } }))).toBe('dm_recipient_unproven');
    expect(await codeOf(prove(identityWorld(), { action_type: 'dm', target_id: 'some.handle' }))).toBe('dm_recipient_unproven');
    expect(await codeOf(prove(identityWorld(), { action_type: 'dm', target_id: PROVIDER_ID }))).toBe('ok');
  });

  it('unreadable account or claims is transient, never a pass', async () => {
    const w = identityWorld();
    w.knobs.discoveredUnreadable = true;
    expect(await codeOf(prove(w))).toBe('identity_unreadable');
    const w2 = identityWorld();
    w2.knobs.claimsUnreadable = true;
    expect(await codeOf(prove(w2))).toBe('identity_unreadable');
    const w3 = identityWorld();
    w3.port.readActiveExternalIdClaims = async () => { throw new Error('down'); };
    expect(await codeOf(prove(w3))).toBe('identity_unreadable');
  });

  it('the refusal vocabulary is closed and every code has a route status', () => {
    expect(new Set(IDENTITY_REFUSAL_CODES).size).toBe(IDENTITY_REFUSAL_CODES.length);
    for (const c of IDENTITY_REFUSAL_CODES) {
      const s = statusForLinkError(c);
      expect([404, 422, 503]).toContain(s);
      if (TRANSIENT_IDENTITY_CODES.has(c)) expect(s).toBe(503);
    }
    expect(statusForLinkError('identity_cross_tenant')).toBe(404);
    expect(statusForLinkError('identity_mismatch')).toBe(422);
    expect(statusForLinkError('link_unproven')).toBe(409);
  });
});

// ── 2. The route, end to end over the fake database ─────────────────────────

function seed(over: { claim?: Partial<Row>; du?: Partial<Row>; action?: Partial<Row>; person?: string | null } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  unreadable.clear();
  inserts.length = 0;
  authCalls.length = 0;
  Object.assign(auth, { member: true, capability: true, role: true });
  const task = (id: string) => ({
    id, organization_id: CONTRACT_ORG, execution_instance_id: INSTANCE, plan_step_id: contractContext().planStepId,
    subject_kind: SUBJECT.kind, subject_id: SUBJECT.id, channel: 'community', action: null,
    delay_after_previous_hours: 0, requires_approval: true, state: 'prepared', created_at: NOW, updated_at: NOW,
  });
  tables.execution_tasks = [task(TASK), task(TASK_2)];
  tables.community_ai_actions = [{ ...actionRow(), ...over.action }];
  tables.community_ai_discovered_users = [{
    id: DISCOVERED_USER, tenant_id: CONTRACT_ORG, organization_id: CONTRACT_ORG, platform: 'linkedin',
    external_user_id: PROVIDER_ID, external_username: 'jane-doe', profile_url: 'https://linkedin.com/in/jane-doe', ...over.du,
  }];
  tables.canonical_leads = [{ id: SUBJECT.id, company_id: CONTRACT_ORG, unified_person_id: over.person === undefined ? PROVEN_PERSON : over.person }];
  tables.identity_claims = [{
    id: VERIFIED_CLAIM, organization_id: CONTRACT_ORG, person_id: PROVEN_PERSON, claim_type: 'external_id',
    platform: 'linkedin', normalized_value: PROVIDER_ID.toLowerCase(), verification_state: 'verified',
    verified_at: '2026-10-20T00:00:00.000Z', revoked_at: null, evidence: subjectOAuthEvidence(), ...over.claim,
  }];
  tables.community_action_journey_links = [];
}

function mockRes() {
  const res: { statusCode: number; body: Record<string, unknown> | undefined; status: (c: number) => typeof res; json: (b: unknown) => typeof res; setHeader: () => typeof res } = {
    statusCode: 0, body: undefined,
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b as Record<string, unknown>; return res; },
    setHeader() { return res; },
  };
  return res;
}

async function post(body: Row = {}, query: Row = {}) {
  const res = mockRes();
  await (handler as unknown as (req: unknown, res: unknown) => Promise<void>)({
    method: 'POST', url: `/api/execution-instances/${INSTANCE}/community-link`, headers: {},
    query: { id: INSTANCE, ...query },
    body: { company_id: CONTRACT_ORG, executionTaskId: TASK, communityActionId: ACTION, ...body },
  }, res);
  return res;
}

const links = () => tables.community_action_journey_links ?? [];

describe('community link route — person validity is part of authorization', () => {
  beforeEach(() => seed());

  it('links only after membership, capability, role and run; records the proven person and claim', async () => {
    const r = await post();
    expect(r.statusCode).toBe(201);
    expect(r.body?.link).toMatchObject({ communityActionId: ACTION, personId: PROVEN_PERSON, identityClaimId: VERIFIED_CLAIM, linkedBy: 'user-1' });
    expect(authCalls).toEqual(['access', 'capability', 'role', 'instance']);
    expect(links()).toHaveLength(1);
    expect(links()[0]).toMatchObject({ organization_id: CONTRACT_ORG, person_id: PROVEN_PERSON, identity_claim_id: VERIFIED_CLAIM });
  });

  it('holding both grants is not enough: an unproven person is refused, nothing written', async () => {
    const cases: Array<[Parameters<typeof seed>[0], string, number]> = [
      [{ claim: { verification_state: 'unverified', verified_at: null } }, 'identity_unverified', 422],
      [{ claim: { person_id: OTHER_PERSON } }, 'identity_mismatch', 422],
      [{ claim: { revoked_at: NOW } }, 'identity_unclaimed', 422],
      [{ claim: { organization_id: CONTRACT_OTHER_ORG } }, 'identity_unclaimed', 422],
      [{ action: { discovered_user_id: null } }, 'identity_missing', 422],
      [{ du: { tenant_id: CONTRACT_OTHER_ORG } }, 'identity_cross_tenant', 404],
      [{ du: { platform: 'twitter' } }, 'identity_platform_mismatch', 422],
      [{ person: null }, 'person_unresolved', 422],
    ];
    for (const [over, code, status] of cases) {
      seed(over);
      const r = await post();
      expect({ code: r.body?.code, status: r.statusCode }).toEqual({ code, status });
      expect(links()).toHaveLength(0);
    }
  });

  it('ambiguous identity is refused', async () => {
    tables.identity_claims.push({ ...tables.identity_claims[0], id: 'dupe', person_id: OTHER_PERSON });
    const r = await post();
    expect(r.body?.code).toBe('identity_ambiguous');
    expect(r.statusCode).toBe(422);
    expect(links()).toHaveLength(0);
  });

  it('an unreadable identity record is a 503, never a link', async () => {
    unreadable.add('identity_claims');
    const r = await post();
    expect(r).toMatchObject({ statusCode: 503, body: { code: 'identity_unreadable' } });
    expect(links()).toHaveLength(0);
  });

  it('the body cannot name the person, the claim or the tenant', async () => {
    const r = await post({ personId: OTHER_PERSON, person_id: OTHER_PERSON, identity_claim_id: 'x', organization_id: CONTRACT_OTHER_ORG, skipIdentity: true });
    expect(r.statusCode).toBe(201);
    expect(links()[0]).toMatchObject({ organization_id: CONTRACT_ORG, person_id: PROVEN_PERSON, identity_claim_id: VERIFIED_CLAIM });
  });

  it('unauthorized mutation: no membership, no capability, or no execute role writes nothing and reads no identity', async () => {
    for (const k of ['member', 'capability', 'role'] as const) {
      seed();
      auth[k] = false;
      const r = await post();
      expect(r.statusCode).toBe(403);
      expect(links()).toHaveLength(0);
      expect(authCalls).not.toContain('instance');
    }
  });

  it('wrong tenant: a run of another tenant is not found, nothing written', async () => {
    const r = await post({ company_id: CONTRACT_OTHER_ORG });
    expect(r.statusCode).toBe(404);
    expect(links()).toHaveLength(0);
    // A task in another tenant (same run id) is not this run's task.
    seed();
    tables.execution_tasks[0].organization_id = CONTRACT_OTHER_ORG;
    expect((await post()).body?.code).toBe('task_not_found');
    expect(links()).toHaveLength(0);
  });

  it('duplicate: the same link again is a replay — and the replay re-proves the person', async () => {
    expect((await post()).statusCode).toBe(201);
    const again = await post();
    expect(again).toMatchObject({ statusCode: 200, body: { replayed: true } });
    expect(links()).toHaveLength(1);
    tables.identity_claims[0].revoked_at = NOW;                    // identity withdrawn since
    const stale = await post();
    expect(stale).toMatchObject({ statusCode: 422, body: { code: 'identity_unclaimed' } });
    expect(links()).toHaveLength(1);
  });

  it('concurrent: five identical POSTs make one link', async () => {
    const all = await Promise.all(Array.from({ length: 5 }, () => post()));
    expect(links()).toHaveLength(1);
    expect(all.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(all.filter((r) => r.statusCode === 200)).toHaveLength(4);
  });

  it('concurrent: one action to two tasks — exactly one wins', async () => {
    const [a, b] = await Promise.all([post(), post({ executionTaskId: TASK_2 })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect(links()).toHaveLength(1);
  });

  it('the route has no identity bypass', () => {
    const code = read('pages/api/execution-instances/[id]/community-link.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/person_id|personId|identity_claim|skipIdentity|proveActionPerson|identity:/);
    expect(code).toMatch(/linkCommunityAction\(\{/);
  });
});

// ── 3. Execution time: the adapter re-proves the person ────────────────────

function adapterWorld(linkPersonId: string | null = PROVEN_PERSON) {
  const idw = identityWorld();
  const action = actionRow({ status: 'approved', approved_at: NOW });
  let request: RequestRow = { id: 'req-1', state: 'requested', external_ref: null, detail: null, updated_at: NOW };
  let external = 0;
  const deps: CommunityAdapterDeps = {
    async getOrCreateRequest() { return { ...request }; },
    async transitionRequest(_o, _t, from, patch) {
      if (request.state !== from) return false;
      request = { ...request, ...patch, updated_at: NOW } as RequestRow;
      return true;
    },
    binding: createLinkedActionBinding(async (org, t) => (org === CONTRACT_ORG && t === TASK ? { actionId: ACTION, personId: linkPersonId } : null), idw.port),
    async readAction(org, id) { return org === CONTRACT_ORG && id === ACTION ? { ...action } : null; },
    async claimAction() {
      if (action.status !== 'approved') return false;
      action.status = 'executing';
      return true;
    },
    preflight: async () => ({ allowed: true }),
    channelPermitted: async () => true,
    executeAction: (async () => { external += 1; action.status = 'executed'; return { ok: true, status: 'executed', execution_mode: 'api' }; }) as unknown as CommunityAdapterDeps['executeAction'],
  };
  return { idw, action, deps, externalActions: () => external, request: () => request };
}

const stepCtx = (over: Partial<EngineStepContext> = {}) =>
  contractContext({ channel: 'community', personId: PROVEN_PERSON, now: NOW, ...over });

async function execute(w: ReturnType<typeof adapterWorld>, c: EngineStepContext = stepCtx()) {
  const a = createCommunityAdapter(w.deps);
  const r = await a.execute(c);
  expectContractResult(a, r);
  return r;
}

describe('community adapter — execution-time person re-check', () => {
  it('a proven link executes exactly once', async () => {
    const w = adapterWorld();
    expect(await execute(w)).toMatchObject({ outcome: 'executed', disposition: 'completed' });
    expect(w.externalActions()).toBe(1);
  });

  it('a claim revoked, unverified or re-attributed after linking stops the step; nothing claimed or sent', async () => {
    const mutations: Array<[(w: ReturnType<typeof adapterWorld>) => void, string]> = [
      [(w) => { w.idw.claims[0].revoked_at = NOW; }, 'identity_unclaimed'],
      [(w) => { Object.assign(w.idw.claims[0], { verification_state: 'unverified', verified_at: null }); }, 'identity_unverified'],
      [(w) => { w.idw.claims[0].person_id = OTHER_PERSON; }, 'identity_mismatch'],
      [(w) => { w.idw.claims.push({ ...w.idw.claims[0], id: 'dupe' }); }, 'identity_ambiguous'],
      [(w) => { w.action.discovered_user_id = OTHER_DU; }, 'identity_missing'],
      [(w) => { w.action.action_type = 'dm'; w.action.target_id = 'https://www.linkedin.com/messaging/thread/2-abcdefghijklmnop/'; w.action.execution_mode = 'browser'; }, 'unsupported_action'],
    ];
    for (const [mutate, code] of mutations) {
      const w = adapterWorld();
      mutate(w);
      expect(await execute(w)).toMatchObject({ outcome: code, disposition: 'needs_human', externalRef: ACTION });
      expect(w.externalActions()).toBe(0);
      expect(w.request()).toMatchObject({ state: 'requested', external_ref: null });
      expect(w.action.status).toBe('approved');
    }
  });

  it('the run\'s person changed since linking (subject re-pointed) → person_mismatch', async () => {
    const w = adapterWorld();
    w.idw.subjects.set(`${SUBJECT.kind}:${SUBJECT.id}`, { org: CONTRACT_ORG, personId: OTHER_PERSON });
    w.idw.claims[0].person_id = OTHER_PERSON;               // even if the account now matches the new person
    expect(await execute(w)).toMatchObject({ outcome: 'person_mismatch', disposition: 'needs_human' });
    expect(w.externalActions()).toBe(0);
  });

  it('the step context names a different person → person_mismatch', async () => {
    const w = adapterWorld();
    expect(await execute(w, stepCtx({ personId: OTHER_PERSON }))).toMatchObject({ outcome: 'person_mismatch' });
    expect(w.externalActions()).toBe(0);
  });

  it('a link that records no person never executes (legacy shape included)', async () => {
    const w = adapterWorld(null);
    expect(await execute(w)).toMatchObject({ outcome: 'person_unresolved', disposition: 'needs_human' });
    const w2 = adapterWorld();
    w2.deps.binding = createLinkedActionBinding(async () => ACTION, w2.idw.port);   // bare action id
    expect(await execute(w2)).toMatchObject({ outcome: 'person_unresolved' });
    expect(w.externalActions() + w2.externalActions()).toBe(0);
  });

  it('a binding with no identity check binds nothing executable', async () => {
    const w = adapterWorld();
    w.deps.binding = { resolve: async () => ({ kind: 'bound', actionId: ACTION }) };
    expect(await execute(w)).toMatchObject({ outcome: 'person_identity_unbound', disposition: 'needs_human' });
    expect(w.externalActions()).toBe(0);
  });

  it('an unreadable identity waits and claims nothing; a throwing check too', async () => {
    const w = adapterWorld();
    w.idw.knobs.claimsUnreadable = true;
    expect(await execute(w)).toMatchObject({ outcome: 'identity_unreadable', disposition: 'wait' });
    const w2 = adapterWorld();
    w2.deps.binding = { resolve: async () => ({ kind: 'bound', actionId: ACTION, identity: async () => { throw new Error('x'); } }) };
    expect(await execute(w2)).toMatchObject({ outcome: 'identity_unreadable', disposition: 'wait' });
    expect(w.externalActions() + w2.externalActions()).toBe(0);
    expect(w.request()).toMatchObject({ state: 'requested' });
  });

  it('another tenant\'s step never binds the link', async () => {
    const w = adapterWorld();
    expect(await execute(w, stepCtx({ organizationId: CONTRACT_OTHER_ORG }))).toMatchObject({ outcome: 'no_bound_action' });
    expect(w.externalActions()).toBe(0);
  });
});

// ── 4. Migration contract (static) ─────────────────────────────────────────

describe('community identity link — migration contract', () => {
  const sql = read('supabase/migrations/20270111100013_community_identity_link.sql');
  const rb = read('supabase/migrations/rollbacks/community_identity_link_rollback.sql');
  const code = sql.replace(/--.*$/gm, '');

  it('is guarded: preconditions, refusal of unproven existing links, postconditions', () => {
    expect(code).toMatch(/to_regclass\('public\.community_action_journey_links'\) IS NULL/);
    expect(code).toMatch(/to_regclass\('public\.identity_claims'\) IS NULL/);
    expect(code).toMatch(/to_regclass\('public\.uq_unified_persons_id_company'\) IS NULL/);
    expect(code).toMatch(/to_regclass\('public\.community_ai_discovered_users'\) IS NULL/);
    expect(code).toMatch(/link\(s\) carry no proven person/);
    expect(code).toMatch(/postcondition: the identity guard is missing/);
    expect(code).toMatch(/postcondition: the tenant-composite person FK is missing/);
    expect(code.indexOf('carry no proven person')).toBeLessThan(code.indexOf('SET NOT NULL'));
  });

  it('is idempotent', () => {
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS person_id uuid/);
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS identity_claim_id uuid/);
    expect(code).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint[\s\S]*?community_action_journey_links_person_fk/);
    expect(code).toMatch(/CREATE INDEX IF NOT EXISTS ix_community_action_journey_links_person/);
    expect(code).toMatch(/CREATE OR REPLACE FUNCTION public\.community_action_journey_links_identity_guard/);
    expect(code).toMatch(/DROP TRIGGER IF EXISTS trg_community_action_journey_links_identity_guard/);
  });

  it('the person is a tenant-composite FK, cascading on erasure', () => {
    expect(code).toMatch(/FOREIGN KEY \(person_id, organization_id\)\s+REFERENCES public\.unified_persons \(id, company_id\) ON DELETE CASCADE/);
  });

  it('the guard proves person, account, addressing and a verified, unambiguous claim — tenant-first', () => {
    for (const c of ['person_unresolved', 'person_mismatch', 'identity_cross_tenant', 'identity_missing',
      'identity_platform_mismatch', 'target_actor_mismatch', 'dm_recipient_unproven', 'identity_unclaimed',
      'identity_mismatch', 'identity_ambiguous', 'identity_unverified']) {
      expect(code).toMatch(new RegExp(`'cajl:${c}'`));
      expect((IDENTITY_REFUSAL_CODES as readonly string[])).toContain(c);
    }
    expect(code).toMatch(/l\.company_id = NEW\.organization_id AND l\.id::text = v_task\.subject_id/);
    expect(code).toMatch(/c\.company_id = NEW\.organization_id AND c\.id::text = v_task\.subject_id/);
    expect(code).toMatch(/d\.organization_id = NEW\.organization_id/);
    expect(code).toMatch(/c\.id = NEW\.identity_claim_id AND c\.organization_id = NEW\.organization_id/);
    expect(code).toMatch(/v_claim\.verification_state IS DISTINCT FROM 'verified' OR v_claim\.verified_at IS NULL/);
    expect(code).toMatch(/claim_type IS DISTINCT FROM 'external_id'/);
    expect(code).toMatch(/BEFORE INSERT ON public\.community_action_journey_links/);
    // Sorts after the 20261231000003 guard (alphabetical firing order).
    expect('trg_community_action_journey_links_guard' < 'trg_community_action_journey_links_identity_guard').toBe(true);
  });

  it('never infers from usernames, profile URLs, names, emails or phones', () => {
    expect(code).not.toMatch(/external_username|profile_url\b(?!')|primary_email|primary_phone|display_name|external_profile/);
  });

  it('touches no other table\'s columns, constraints or statuses', () => {
    expect(code).not.toMatch(/ALTER TABLE (ONLY )?public\.(community_ai_actions|identity_claims|community_ai_discovered_users|unified_persons)/);
    expect(code).not.toMatch(/community_ai_actions_status_check/);
    expect(code).not.toMatch(/INSERT INTO|UPDATE public\.|DELETE FROM/);
    expect(code).not.toMatch(/SECURITY DEFINER/);
  });

  it('the rollback refuses while links exist, then drops only what this added', () => {
    expect(rb).toMatch(/EXISTS \(SELECT 1 FROM public\.community_action_journey_links\)/);
    expect(rb.indexOf('rollback refused')).toBeGreaterThan(0);
    expect(rb.indexOf('rollback refused')).toBeLessThan(rb.indexOf('DROP TRIGGER'));
    expect(rb).toMatch(/DROP COLUMN IF EXISTS person_id/);
    expect(rb).toMatch(/DROP COLUMN IF EXISTS identity_claim_id/);
    expect(rb).not.toMatch(/DROP TABLE|community_ai_actions|identity_claims/);
  });

  it('takes its own slot after 20261231000003', () => {
    const files = fs.readdirSync(path.join(process.cwd(), 'supabase/migrations')).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
    expect(files.indexOf('20270111100013_community_identity_link.sql')).toBeGreaterThan(files.indexOf('20270111100010_community_journey_link.sql'));
  });

  it('the SQL normalizer mirrors normalizeExternalIdentity\'s rules', () => {
    expect(code).toMatch(/lower\(btrim\(coalesce\(p_value, ''\)/);
    expect(code).toMatch(/regexp_replace\(v_raw, '\^@', ''\)/);
    expect(code).toMatch(/regexp_replace\(v_s, '\^www\[\.\]', ''\)/);
    expect(code).toMatch(/regexp_replace\(v_s, '\/\+\$', ''\)/);
  });
});
