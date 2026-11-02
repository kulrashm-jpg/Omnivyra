/**
 * Community journey link — the operator link from an execution task to an
 * existing community action, the adapter binding that reads it, the status
 * mapping back onto the request ledger, the route's authorization order, and the
 * migration contract. Fakes only: no database, no platform, no extension.
 */

import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: jest.fn(() => { throw new Error('RPA must not be reached from a unit test'); }),
}));

import {
  createCommunityAdapter,
  createLinkedActionBinding,
  defaultCommunityDeps,
  linkedActionBinding,
  SUPPORTED_COMMUNITY_ACTIONS,
  type CommunityActionRow,
  type CommunityAdapterDeps,
  type RequestRow,
} from '../../services/orchestration/communityEngineAdapter';
import {
  CommunityJourneyLinkError,
  LINKABLE_ACTION_STATUSES,
  linkCommunityAction,
  translateLinkError,
  type CommunityJourneyLink,
  type LinkStoreDeps,
} from '../../services/orchestration/communityJourneyLinkStore';
import type { ExecutionTask } from '../../services/executionPlans/executionPlanStore';
import type { EngineResult, EngineStepContext } from '../../services/orchestration/engineAdapters';
import {
  CONTRACT_ORG, CONTRACT_OTHER_ORG, contractContext, expectContractResult,
} from './helpers/engineAdapterContractKit';
// 20261231000006: every link must prove the run's person; this suite's actions
// engage a platform account verified as that person (identity suite: separate).
import { DISCOVERED_USER, identityWorld } from './helpers/communityIdentityFixture';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const tick = () => new Promise<void>((r) => setImmediate(r));

const INSTANCE = contractContext().executionInstanceId;
const TASK = contractContext().executionTaskId;
const TASK_2 = '88888888-8888-4888-8888-888888888888';
const ACTION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTION_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_INSTANCE = '99999999-9999-4999-8999-999999999999';
const NOW = '2026-10-28T09:00:00.000Z';

function task(over: Partial<ExecutionTask> = {}): ExecutionTask {
  return {
    id: TASK, organizationId: CONTRACT_ORG, executionInstanceId: INSTANCE,
    planStepId: contractContext().planStepId, subjectKind: 'prospect',
    subjectId: contractContext().subject.id, channel: 'community', action: null,
    delayAfterPreviousHours: 0, requiresApproval: true, state: 'prepared',
    createdAt: NOW, updatedAt: NOW, ...over,
  };
}

function action(over: Partial<CommunityActionRow> = {}): CommunityActionRow {
  return {
    id: ACTION, tenant_id: CONTRACT_ORG, organization_id: CONTRACT_ORG,
    platform: 'linkedin', action_type: 'reply', target_id: 'urn:li:activity:123',
    suggested_text: 'Thanks for sharing this.', final_text: null, playbook_id: 'pb-1',
    requires_human_approval: true, risk_level: 'low', approved_at: null, status: 'pending',
    execution_mode: 'api', scheduled_at: null, execution_correlation_id: null,
    execution_result: null, intent_classification: null, discovered_user_id: DISCOVERED_USER, ...over,
  };
}

/**
 * One fake database: tasks, actions, links (with BOTH unique constraints and the
 * guard's eligibility checks emulated at insert), and the engine request ledger.
 */
function db() {
  const tasks = new Map<string, ExecutionTask>([[TASK, task()], [TASK_2, task({ id: TASK_2 })]]);
  const actions = new Map<string, CommunityActionRow>([[ACTION, action()], [ACTION_2, action({ id: ACTION_2 })]]);
  const links: CommunityJourneyLink[] = [];
  const writes: string[] = [];
  let seq = 0;

  const idw = identityWorld();
  const linkDeps: LinkStoreDeps = {
    identity: idw.port,
    async readLinkByTask(org, taskId) {
      await tick();
      return links.find((l) => l.organizationId === org && l.executionTaskId === taskId) ?? null;
    },
    async listLinksByInstance(org, inst) {
      return links.filter((l) => l.organizationId === org && l.executionInstanceId === inst);
    },
    async readTask(org, id) {
      await tick();
      const t = tasks.get(id);
      return t && t.organizationId === org ? { ...t } : null;
    },
    async readAction(org, id) {
      await tick();
      const a = actions.get(id);
      return a && a.organization_id === org ? { ...a } : null;
    },
    async insertLink(row) {
      await tick();
      writes.push('community_action_journey_links:insert');
      if (links.some((l) => l.organizationId === row.organization_id && l.executionTaskId === row.execution_task_id)) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "community_action_journey_links_task_unique"' } };
      }
      if (links.some((l) => l.organizationId === row.organization_id && l.communityActionId === row.community_action_id)) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "community_action_journey_links_action_unique"' } };
      }
      const a = actions.get(row.community_action_id);
      if (!a || a.organization_id !== row.organization_id) return { data: null, error: { code: '23514', message: 'cajl:action_not_found' } };
      const link: CommunityJourneyLink = {
        id: `link-${++seq}`, organizationId: row.organization_id, executionTaskId: row.execution_task_id,
        executionInstanceId: row.execution_instance_id, communityActionId: row.community_action_id,
        personId: row.person_id, identityClaimId: row.identity_claim_id,
        linkedBy: row.linked_by, createdAt: NOW,
      };
      links.push(link);
      return { data: link, error: null };
    },
  };

  // The engine request ledger + engine, as the adapter suite fakes them.
  const ledger = new Map<string, RequestRow>();
  let external = 0;
  const executed: string[] = [];
  const adapterDeps: CommunityAdapterDeps = {
    async getOrCreateRequest(org, t) {
      await tick();
      const k = `${org}:${t}`;
      if (!ledger.has(k)) ledger.set(k, { id: `req-${ledger.size + 1}`, state: 'requested', external_ref: null, detail: null, updated_at: NOW });
      return { ...ledger.get(k)! };
    },
    async transitionRequest(org, t, from, patch) {
      await tick();
      const row = ledger.get(`${org}:${t}`);
      if (!row || row.state !== from) return false;
      if (row.external_ref !== null && patch.external_ref !== undefined && patch.external_ref !== row.external_ref) return false;
      if ((patch.state === 'submitted' || patch.state === 'completed') && (patch.external_ref ?? row.external_ref) === null) return false;
      Object.assign(row, patch, { updated_at: NOW });
      return true;
    },
    binding: createLinkedActionBinding(async (org, t) => {
      await tick();
      const l = links.find((x) => x.organizationId === org && x.executionTaskId === t);
      return l ? { actionId: l.communityActionId, personId: l.personId } : null;
    }, idw.port),
    readAction: (org, id) => linkDeps.readAction(org, id),
    async claimAction(org, id) {
      await tick();
      const a = actions.get(id);
      if (!a || a.organization_id !== org || a.status !== 'approved') return false;
      a.status = 'executing';
      return true;
    },
    preflight: async () => ({ allowed: true }),
    channelPermitted: async () => true,
    executeAction: (async (a: { id: string }) => {
      await tick();
      external += 1;
      executed.push(a.id);
      actions.get(a.id)!.status = 'executed';
      return { ok: true, status: 'executed', execution_mode: 'api' };
    }) as unknown as CommunityAdapterDeps['executeAction'],
  };

  /** What the approve route does — the ONLY approval writer. */
  const approveViaRoute = (id: string) => Object.assign(actions.get(id)!, { status: 'approved', approved_at: NOW });

  return {
    tasks, actions, links, writes, linkDeps, ledger, adapterDeps, approveViaRoute,
    externalActions: () => external, executed,
    request: (t = TASK) => ledger.get(`${CONTRACT_ORG}:${t}`),
  };
}

const link = (w: ReturnType<typeof db>, over: Partial<Parameters<typeof linkCommunityAction>[0]> = {}) =>
  linkCommunityAction({
    organizationId: CONTRACT_ORG, executionInstanceId: INSTANCE, executionTaskId: TASK,
    communityActionId: ACTION, linkedBy: 'user-1', ...over,
  }, w.linkDeps);

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try { await p; return 'ok'; } catch (e) {
    if (e instanceof CommunityJourneyLinkError) return e.code;
    throw e;
  }
};

const ctx = (over: Partial<EngineStepContext> = {}) =>
  contractContext({ channel: 'community', personId: '77777777-7777-4777-8777-777777777777', now: NOW, ...over });

async function run(w: ReturnType<typeof db>, c: EngineStepContext = ctx()): Promise<EngineResult> {
  const a = createCommunityAdapter(w.adapterDeps);
  const r = await a.execute(c);
  expectContractResult(a, r);
  return r;
}

// ── 1. Linking: authorization and eligibility ──────────────────────────────

describe('community journey link — authorization', () => {
  it('links a prepared community task to a tenant-owned, supported, pending action', async () => {
    const w = db();
    const r = await link(w);
    expect(r.replayed).toBe(false);
    expect(r.link).toMatchObject({ organizationId: CONTRACT_ORG, executionTaskId: TASK, executionInstanceId: INSTANCE, communityActionId: ACTION, linkedBy: 'user-1' });
    expect(w.links).toHaveLength(1);
  });

  it('refuses a task of another tenant, or of another run, as not found', async () => {
    const w = db();
    w.tasks.set(TASK, task({ organizationId: CONTRACT_OTHER_ORG }));
    expect(await codeOf(link(w))).toBe('task_not_found');
    const w2 = db();
    expect(await codeOf(link(w2, { executionInstanceId: OTHER_INSTANCE }))).toBe('task_not_found');
    expect(w.links.length + w2.links.length).toBe(0);
  });

  it('refuses an action of another tenant (invisible), or one whose tenant_id disagrees', async () => {
    const w = db();
    w.actions.set(ACTION, action({ tenant_id: CONTRACT_OTHER_ORG, organization_id: CONTRACT_OTHER_ORG }));
    expect(await codeOf(link(w))).toBe('action_not_found');
    const w2 = db();
    w2.actions.set(ACTION, action({ tenant_id: CONTRACT_OTHER_ORG }));
    expect(await codeOf(link(w2))).toBe('cross_tenant');
    expect(w.links.length + w2.links.length).toBe(0);
  });

  it('refuses unsupported action types and platform pairs, via the adapter\'s own classifier', async () => {
    for (const over of [
      { action_type: 'schedule' },
      { action_type: 'follow', platform: 'linkedin' },
      { action_type: 'share', platform: 'reddit' },
      { action_type: 'reply', suggested_text: null, final_text: null },
      { action_type: 'dm', execution_mode: 'rpa' },
      { execution_mode: 'manual' },
    ] as Partial<CommunityActionRow>[]) {
      const w = db();
      w.actions.set(ACTION, action(over));
      expect(await codeOf(link(w))).toBe('unsupported_action');
      expect(w.links).toHaveLength(0);
    }
  });

  it('refuses a non-community step and a task that is not prepared', async () => {
    const w = db();
    w.tasks.set(TASK, task({ channel: 'whatsapp' }));
    expect(await codeOf(link(w))).toBe('task_not_community');
    const w2 = db();
    w2.tasks.set(TASK, task({ state: 'cancelled' }));
    expect(await codeOf(link(w2))).toBe('task_not_prepared');
  });

  it('refuses an action that is already executing or ended (including uncertain)', async () => {
    for (const status of ['executing', 'executed', 'failed', 'skipped', 'uncertain', 'dispatched', null]) {
      const w = db();
      w.actions.set(ACTION, action({ status }));
      expect(await codeOf(link(w))).toBe('action_not_linkable');
    }
    expect([...LINKABLE_ACTION_STATUSES]).toEqual(['pending', 'approved']);
  });

  it('refuses malformed identifiers before any read', async () => {
    const w = db();
    expect(await codeOf(link(w, { communityActionId: 'not-a-uuid' }))).toBe('invalid_action');
    expect(await codeOf(link(w, { executionTaskId: 'x' }))).toBe('invalid_task');
    expect(await codeOf(link(w, { organizationId: 'x' }))).toBe('invalid_org');
  });
});

// ── 2. Idempotency and concurrency ─────────────────────────────────────────

describe('community journey link — idempotency and races', () => {
  it('a retry of the same link returns the original, creating nothing', async () => {
    const w = db();
    const first = await link(w);
    const again = await link(w);
    expect(again).toEqual({ link: first.link, replayed: true });
    expect(w.links).toHaveLength(1);
  });

  it('a replay still answers after the linked action has moved on (crash after insert, before reply)', async () => {
    const w = db();
    await link(w);
    w.actions.get(ACTION)!.status = 'executed';
    expect((await link(w)).replayed).toBe(true);
  });

  it('a task already linked to a different action is refused, never re-pointed', async () => {
    const w = db();
    await link(w);
    expect(await codeOf(link(w, { communityActionId: ACTION_2 }))).toBe('task_already_linked');
    expect(w.links).toHaveLength(1);
    expect(w.links[0].communityActionId).toBe(ACTION);
  });

  it('an action already linked to another task is refused (one task per action)', async () => {
    const w = db();
    await link(w);
    expect(await codeOf(link(w, { executionTaskId: TASK_2 }))).toBe('action_already_linked');
    expect(w.links).toHaveLength(1);
  });

  it('five concurrent identical links produce one link; every caller gets it', async () => {
    const w = db();
    const all = await Promise.all(Array.from({ length: 5 }, () => link(w)));
    expect(w.links).toHaveLength(1);
    expect(new Set(all.map((r) => r.link.id)).size).toBe(1);
    expect(all.filter((r) => !r.replayed)).toHaveLength(1);
  });

  it('concurrent links of one task to two actions: exactly one wins', async () => {
    const w = db();
    const codes = await Promise.all([codeOf(link(w)), codeOf(link(w, { communityActionId: ACTION_2 }))]);
    expect(codes.sort()).toEqual(['ok', 'task_already_linked']);
    expect(w.links).toHaveLength(1);
  });

  it('concurrent links of one action to two tasks: exactly one wins', async () => {
    const w = db();
    const codes = await Promise.all([codeOf(link(w)), codeOf(link(w, { executionTaskId: TASK_2 }))]);
    expect(codes.sort()).toEqual(['action_already_linked', 'ok']);
    expect(w.links).toHaveLength(1);
  });

  it('database refusals translate by consequence', () => {
    const c = (e: unknown) => { try { translateLinkError(e); } catch (x) { return (x as CommunityJourneyLinkError).code; } return 'none'; };
    expect(c({ code: '23514', message: 'cajl:run_not_executable' })).toBe('run_not_executable');
    expect(c({ code: '23514', message: 'cajl:immutable — link x is never re-pointed' })).toBe('immutable');
    expect(c({ code: '23503', message: 'fk' })).toBe('not_found');
    expect(c({ code: 'XX', message: 'boom' })).toBe('link_error');
  });
});

// ── 3. Approval is never bypassed ──────────────────────────────────────────

describe('community journey link — approval', () => {
  it('linking approves nothing and writes only the link', async () => {
    const w = db();
    await link(w);
    expect(w.actions.get(ACTION)).toMatchObject({ status: 'pending', approved_at: null });
    expect(w.writes).toEqual(['community_action_journey_links:insert']);
    const src = read('backend/services/orchestration/communityJourneyLinkStore.ts');
    expect(src).not.toMatch(/\.update\(|\.upsert\(|\.delete\(|approved_at\s*:/);
  });

  it('a linked pending action waits for the approve route; then it runs exactly once', async () => {
    const w = db();
    await link(w);
    expect(await run(w)).toMatchObject({ outcome: 'awaiting_approval', disposition: 'wait', externalRef: ACTION });
    expect(w.externalActions()).toBe(0);
    w.approveViaRoute(ACTION);
    expect(await run(w)).toMatchObject({ outcome: 'executed', disposition: 'completed', externalRef: ACTION });
    expect(await run(w)).toMatchObject({ outcome: 'completed', disposition: 'completed' });
    expect(w.externalActions()).toBe(1);
    expect(w.request()).toMatchObject({ state: 'completed', external_ref: ACTION });
  });

  it('a linked action that requires no approval is not executed autonomously', async () => {
    const w = db();
    w.actions.set(ACTION, action({ requires_human_approval: false }));
    await link(w);
    expect(await run(w)).toMatchObject({ outcome: 'not_approved', disposition: 'needs_human' });
    expect(w.externalActions()).toBe(0);
  });

  it('"approved" without an approval time is not trusted', async () => {
    const w = db();
    await link(w);
    w.actions.get(ACTION)!.status = 'approved';
    expect(await run(w)).toMatchObject({ outcome: 'approval_unproven', disposition: 'needs_human' });
    expect(w.externalActions()).toBe(0);
  });
});

// ── 4. The binding through the adapter, end to end ─────────────────────────

describe('community journey link — adapter binding', () => {
  it('the adapter\'s default binding is the link binding', () => {
    expect(defaultCommunityDeps.binding).toBe(linkedActionBinding);
  });

  it('an unlinked step acts on nothing and needs a person', async () => {
    const w = db();
    expect(await run(w)).toMatchObject({ outcome: 'no_bound_action', disposition: 'needs_human', externalRef: null });
    expect(w.externalActions()).toBe(0);
    expect(w.request()).toMatchObject({ state: 'requested', external_ref: null });
  });

  it('an unreadable link waits; nothing is claimed', async () => {
    const w = db();
    w.adapterDeps.binding = createLinkedActionBinding(async () => { throw new Error('down'); });
    expect(await run(w)).toMatchObject({ outcome: 'binding_unreadable', disposition: 'wait' });
    expect(w.request()).toMatchObject({ state: 'requested' });
  });

  it('a link of one tenant never binds a step of another tenant', async () => {
    const w = db();
    await link(w);
    expect(await run(w, ctx({ organizationId: CONTRACT_OTHER_ORG }))).toMatchObject({ outcome: 'no_bound_action' });
    expect(w.externalActions()).toBe(0);
  });

  it('tenant and support are re-checked at execution time', async () => {
    const w = db();
    w.approveViaRoute(ACTION);
    await link(w);
    w.actions.get(ACTION)!.tenant_id = CONTRACT_OTHER_ORG;          // drifted after linking
    expect(await run(w)).toMatchObject({ outcome: 'tenant_scope_violation', disposition: 'needs_human' });
    const w2 = db();
    w2.approveViaRoute(ACTION);
    await link(w2);
    w2.actions.get(ACTION)!.platform = 'youtube';                   // reply ok, but…
    w2.actions.get(ACTION)!.action_type = 'like';                   // …youtube cannot like
    expect(await run(w2)).toMatchObject({ outcome: 'unsupported_action', disposition: 'needs_human' });
    expect(w.externalActions() + w2.externalActions()).toBe(0);
  });

  it('duplicate concurrent dispatch of a linked step causes one external action', async () => {
    const w = db();
    w.approveViaRoute(ACTION);
    await link(w);
    const rs = await Promise.all(Array.from({ length: 5 }, () => run(w)));
    expect(w.externalActions()).toBe(1);
    expect(rs.filter((r) => r.disposition === 'completed').length).toBeGreaterThanOrEqual(1);
    expect(w.request()).toMatchObject({ state: 'completed', external_ref: ACTION });
  });
});

// ── 5. Status mapping, durable on the request ledger ───────────────────────

describe('community journey link — status mapping (Agent A contract)', () => {
  const linkedWith = async (status: string, over: Partial<CommunityActionRow> = {}) => {
    const w = db();
    await link(w);
    Object.assign(w.actions.get(ACTION)!, { status, approved_at: NOW, ...over });
    return w;
  };

  it('executed → completed (ledger completed)', async () => {
    const w = await linkedWith('executed');
    expect(await run(w)).toMatchObject({ outcome: 'executed', disposition: 'completed', externalRef: ACTION });
    expect(w.request()).toMatchObject({ state: 'completed', external_ref: ACTION });
  });

  it('skipped → skipped (ledger skipped)', async () => {
    const w = await linkedWith('skipped');
    expect(await run(w)).toMatchObject({ outcome: 'skipped', disposition: 'skipped', externalRef: ACTION });
    expect(w.request()).toMatchObject({ state: 'skipped', external_ref: ACTION });
    expect(await run(w)).toMatchObject({ outcome: 'skipped', disposition: 'skipped' });
  });

  it('failed → needs_human (ledger failed), never re-run', async () => {
    const w = await linkedWith('failed');
    expect(await run(w)).toMatchObject({ outcome: 'failed', disposition: 'needs_human', externalRef: ACTION });
    expect(w.request()).toMatchObject({ state: 'failed', external_ref: ACTION });
    w.actions.get(ACTION)!.status = 'approved';                     // even if someone re-opens it
    expect(await run(w)).toMatchObject({ outcome: 'failed', disposition: 'needs_human' });
    expect(w.externalActions()).toBe(0);
  });

  it('uncertain → needs_human with outcome uncertain (ledger uncertain), never auto-executed', async () => {
    const w = await linkedWith('uncertain');
    expect(await run(w)).toMatchObject({ outcome: 'uncertain', disposition: 'needs_human', externalRef: ACTION });
    expect(w.request()).toMatchObject({ state: 'uncertain', external_ref: ACTION });
    w.actions.get(ACTION)!.status = 'approved';
    expect(await run(w)).toMatchObject({ outcome: 'uncertain', disposition: 'needs_human' });
    expect(w.externalActions()).toBe(0);
  });

  it('executing → wait; the ledger stays open', async () => {
    const w = await linkedWith('executing');
    expect(await run(w)).toMatchObject({ outcome: 'executing', disposition: 'wait' });
    expect(w.request()).toMatchObject({ state: 'requested' });
  });

  it('an action the engine marks uncertain after this request submitted it is settled uncertain', async () => {
    const w = db();
    w.approveViaRoute(ACTION);
    await link(w);
    w.adapterDeps.executeAction = (async () => {
      w.actions.get(ACTION)!.status = 'pending';
      return { ok: true, status: 'dispatched', execution_mode: 'browser', response: { dispatch: 'queued_for_extension' } };
    }) as unknown as CommunityAdapterDeps['executeAction'];
    expect(await run(w)).toMatchObject({ outcome: 'dispatched', disposition: 'wait' });
    expect(w.request()).toMatchObject({ state: 'submitted' });
    w.actions.get(ACTION)!.status = 'uncertain';                    // Agent A's reconciliation
    expect(await run(w)).toMatchObject({ outcome: 'uncertain', disposition: 'needs_human', externalRef: ACTION });
    expect(w.request()).toMatchObject({ state: 'uncertain' });
  });
});

// ── 6. The route: authorization order ──────────────────────────────────────

describe('community journey link — route', () => {
  const ROUTE = read('pages/api/execution-instances/[id]/community-link.ts');

  it('checks membership, then the run capability, then (POST) the community execute role, then binds the run', () => {
    const iAccess = ROUTE.indexOf('enforceCompanyAccess({');
    const iCap = ROUTE.indexOf('requireCapability(req');
    const iRole = ROUTE.indexOf('enforceRole({');
    const iRun = ROUTE.indexOf('getExecutionInstance(companyId');
    const iLink = ROUTE.indexOf('linkCommunityAction({');
    for (const i of [iAccess, iCap, iRole, iRun, iLink]) expect(i).toBeGreaterThan(0);
    expect(iAccess).toBeLessThan(iCap);
    expect(iCap).toBeLessThan(iRole);
    expect(iRole).toBeLessThan(iRun);
    expect(iRun).toBeLessThan(iLink);
    expect(ROUTE).toMatch(/COMMUNITY_AI_CAPABILITIES\.EXECUTE_ACTIONS/);
    expect(ROUTE).toMatch(/guard\.ok !== true/);
    expect(ROUTE).toMatch(/organizationId: companyId,\s+\/\/ the VERIFIED tenant/);
  });

  it('is not an approval path and executes nothing', () => {
    const code = ROUTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/APPROVE_ACTIONS|approved_at|executeAction|community_ai_actions|createCommunityAdapter/);
  });
});

// ── 7. Migration contract ──────────────────────────────────────────────────

describe('community journey link — migration contract', () => {
  const MIG = 'supabase/migrations/20261231000003_community_journey_link.sql';
  const sql = read(MIG);
  const rb = read('supabase/migrations/rollbacks/community_journey_link_rollback.sql');

  it('is guarded by preconditions and postconditions', () => {
    expect(sql).toMatch(/to_regclass\('public\.execution_tasks'\) IS NULL/);
    expect(sql).toMatch(/to_regclass\('public\.uq_execution_tasks_id_org'\) IS NULL/);
    expect(sql).toMatch(/to_regclass\('public\.community_ai_actions'\) IS NULL/);
    expect(sql).toMatch(/to_regclass\('public\.execution_engine_requests'\) IS NULL/);
    expect(sql).toMatch(/postcondition: one action per task is unenforced/);
    expect(sql).toMatch(/postcondition: one task per action is unenforced/);
  });

  it('is idempotent (re-runnable)', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.community_action_journey_links/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_community_ai_actions_id_org/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.community_action_journey_links_guard/);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_community_action_journey_links_guard/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS community_action_journey_links_service_role/);
  });

  it('enforces one action per task, one task per action, and tenant-composite FKs to both sides', () => {
    expect(sql).toMatch(/community_action_journey_links_task_unique\s+UNIQUE \(organization_id, execution_task_id\)/);
    expect(sql).toMatch(/community_action_journey_links_action_unique\s+UNIQUE \(organization_id, community_action_id\)/);
    expect(sql).toMatch(/FOREIGN KEY \(execution_task_id, organization_id\)\s+REFERENCES public\.execution_tasks \(id, organization_id\)/);
    expect(sql).toMatch(/FOREIGN KEY \(community_action_id, organization_id\)\s+REFERENCES public\.community_ai_actions \(id, organization_id\)/);
    expect(sql).toMatch(/v_action\.tenant_id IS DISTINCT FROM NEW\.organization_id/);
  });

  it('the guard\'s supported types equal SUPPORTED_COMMUNITY_ACTIONS and its linkable statuses equal the store\'s', () => {
    const types = /action_type NOT IN \(([^)]*)\)/.exec(sql);
    expect(types).not.toBeNull();
    const inSql = [...(types as RegExpExecArray)[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(inSql).toEqual(Object.keys(SUPPORTED_COMMUNITY_ACTIONS).sort());
    const st = /v_action\.status NOT IN \(([^)]*)\)/.exec(sql);
    const stInSql = [...(st as RegExpExecArray)[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(stInSql).toEqual([...LINKABLE_ACTION_STATUSES].sort());
  });

  it('a link is immutable and eligible only for a prepared community task in an executable run', () => {
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE ON public\.community_action_journey_links/);
    expect(sql).toMatch(/IF TG_OP = 'UPDATE' THEN\s+RAISE EXCEPTION 'cajl:immutable/);
    expect(sql).toMatch(/cajl:task_not_community/);
    expect(sql).toMatch(/cajl:task_not_prepared/);
    expect(sql).toMatch(/cajl:run_not_executable/);
    expect(sql).toMatch(/cajl:instance_mismatch/);
  });

  it('is no second ledger and does not touch the engine row\'s status semantics', () => {
    const table = /CREATE TABLE IF NOT EXISTS public\.community_action_journey_links \(([\s\S]*?)\n\);/.exec(sql);
    expect(table).not.toBeNull();
    const body = (table as RegExpExecArray)[1].replace(/--.*$/gm, '');
    for (const col of ['status', 'state', 'platform', 'action_type', 'target_id', 'suggested_text', 'final_text', 'approved_at']) {
      expect(body).not.toMatch(new RegExp(`^\\s+${col}\\s`, 'm'));
    }
    const code = sql.replace(/--.*$/gm, '');
    expect(code).not.toMatch(/ALTER TABLE (ONLY )?public\.community_ai_actions/);
    expect(code).not.toMatch(/community_ai_actions_status_check/);
    expect(code).not.toMatch(/UPDATE public\.community_ai_actions|INSERT INTO public\.community_ai_actions|DELETE FROM/);
    expect(code).not.toMatch(/SECURITY DEFINER/);
  });

  it('is closed to client roles', () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON public\.community_action_journey_links FROM anon, authenticated/);
    expect(sql).toMatch(/FOR ALL TO service_role/);
  });

  it('the rollback refuses while links exist, then drops only what this added', () => {
    expect(rb).toMatch(/EXISTS \(SELECT 1 FROM public\.community_action_journey_links\)/);
    expect(rb).toMatch(/RAISE EXCEPTION 'rollback refused/);
    expect(rb.indexOf('rollback refused')).toBeLessThan(rb.indexOf('DROP TABLE'));
    expect(rb).toMatch(/DROP TABLE IF EXISTS public\.community_action_journey_links;/);
    expect(rb).toMatch(/DROP INDEX IF EXISTS public\.uq_community_ai_actions_id_org;/);
    expect(rb).not.toMatch(/community_ai_actions_status_check|ALTER TABLE/);
  });

  it('sorts after the slots it depends on (20261231000002 is Agent A\'s)', () => {
    const files = fs.readdirSync(path.join(process.cwd(), 'supabase/migrations')).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
    const i = files.indexOf('20261231000003_community_journey_link.sql');
    expect(i).toBeGreaterThan(files.indexOf('20261231000001_orchestration_engine_requests_engines.sql'));
    expect(i).toBeGreaterThan(files.indexOf('20261229000000_pi_outreach_bridge.sql'));
  });
});
