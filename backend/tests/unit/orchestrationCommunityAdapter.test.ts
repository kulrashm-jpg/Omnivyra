/**
 * Community-action engine adapter — contract, authorization, concurrency,
 * failure paths and the supported/unsupported allowlist. Fakes only: no
 * database, no platform connector, no extension.
 */

jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });
// The engine's RPA module opens a queue connection at import; no test may reach it.
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: jest.fn(() => { throw new Error('RPA must not be reached from a unit test'); }),
}));

import {
  createCommunityAdapter,
  classifyCommunityAction,
  enginePreflight,
  noBindingInterface,
  STALE_SUBMISSION_MS,
  type CommunityActionRow,
  type CommunityAdapterDeps,
  type PreflightDeps,
  type RequestRow,
} from '../../services/orchestration/communityEngineAdapter';
import { buildAdapterRegistry, createWs3Adapter, type EngineResult, type EngineStepContext } from '../../services/orchestration/engineAdapters';
import { createWhatsAppAdapter } from '../../services/orchestration/whatsappEngineAdapter';
import { WORKFLOW_STEP_CHANNELS } from '../../services/workflows/workflowStore';
import {
  CONTRACT_ORG, CONTRACT_OTHER_ORG, contractContext, contractScenarios, expectContractResult,
} from './helpers/engineAdapterContractKit';
import { provenIdentity } from './helpers/communityIdentityFixture';
import type { ExecutionResult } from '../../services/communityAiActionExecutor';
import { withApprovalEvidence, approvedAgo } from '../helpers/communityApprovalEvidenceFixture';

const ACTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = '2026-10-28T09:00:00.000Z';
const tick = () => new Promise<void>((r) => setImmediate(r));

const ctx = (over: Partial<EngineStepContext> = {}): EngineStepContext =>
  contractContext({ channel: 'community', personId: '77777777-7777-4777-8777-777777777777', now: NOW, ...over });

/** Prompt 3: an approved action carries its approval of record (approve.ts), < 7 days old. */
function approvedAction(over: Partial<CommunityActionRow> = {}): CommunityActionRow {
  const base: CommunityActionRow = {
    id: ACTION_ID,
    tenant_id: CONTRACT_ORG,
    organization_id: CONTRACT_ORG,
    platform: 'linkedin',
    action_type: 'reply',
    target_id: 'urn:li:activity:123',
    suggested_text: 'Thanks for sharing this.',
    final_text: null,
    playbook_id: 'pb-1',
    requires_human_approval: true,
    risk_level: 'low',
    status: 'approved',
    execution_mode: 'api',
    scheduled_at: null,
    execution_correlation_id: null,
    execution_result: null,
    intent_classification: null,
  };
  // The approval binds the row as approved (overrides included); a fixture that
  // sets approved_at itself describes a row without an approval of record.
  if ('approved_at' in over) return { ...base, ...over } as CommunityActionRow;
  try {
    return withApprovalEvidence({ ...base, ...over } as never, { approvedAt: approvedAgo() }) as CommunityActionRow;
  } catch {
    // An unbindable override (e.g. a tenant mismatch): the approval of the base row, then the override.
    return { ...withApprovalEvidence(base as never, { approvedAt: approvedAgo() }), ...over } as CommunityActionRow;
  }
}

type EngineBehaviour =
  | 'executed'
  | 'throw_after'
  | 'throw_before'
  | { result: ExecutionResult; rowStatus?: string; acted: boolean };

interface PreflightKnobs {
  executionEnabled: boolean;
  guardrail: { allowed: boolean; reason?: 'auto_disabled' | 'daily_platform_limit' | 'per_post_limit' | 'per_evaluation_limit' };
  playbookThrows: boolean;
  playbookVerdict: { allowed: boolean; reason?: string };
  usageAllowed: boolean;
}

/** A fake world: request ledger, the engine's action table, the engine itself. */
function world(initial: CommunityActionRow | null = approvedAction()) {
  const ledger = new Map<string, RequestRow & { org: string }>();
  const actions = new Map<string, CommunityActionRow>();
  if (initial) actions.set(initial.id, { ...initial });
  let external = 0;
  let next: EngineBehaviour = 'executed';
  const calls: { action: unknown; approved: boolean; options: unknown }[] = [];
  const knobs: PreflightKnobs = {
    executionEnabled: true,
    guardrail: { allowed: true },
    playbookThrows: false,
    playbookVerdict: { allowed: true },
    usageAllowed: true,
  };
  let preflightThrows = false;
  let permission: boolean | null | 'throws' = true;

  const preflightDeps: PreflightDeps = {
    // Prompt 3: the tenant's decision. auto_rules OFF: a journey step is not 'auto' (LD-4).
    getPolicy: async () => (knobs.executionEnabled
      ? { ok: true as const, policy: { execution_enabled: true as const, auto_rules_enabled: false }, version: 'v1' }
      : { ok: false as const, code: 'POLICY_EXECUTION_DISABLED' }),
    recordRefusal: async () => true,
    guardrail: async () => knobs.guardrail,
    getPlaybook: (async () => { if (knobs.playbookThrows) throw new Error('nope'); return { id: 'pb-1' }; }) as unknown as PreflightDeps['getPlaybook'],
    loadHistory: async () => ({ replies_last_hour: 0, follows_today: 0, actions_today: 0 }),
    validatePlaybook: (() => ({ requires_approval: false, ...knobs.playbookVerdict })) as unknown as PreflightDeps['validatePlaybook'],
    resolveMode: async () => 'api',
    checkUsage: (async () => ({ allowed: knobs.usageAllowed })) as unknown as PreflightDeps['checkUsage'],
  };

  const deps: CommunityAdapterDeps = {
    async getOrCreateRequest(org, task) {
      await tick();
      const k = `${org}:${task}`;
      if (!ledger.has(k)) ledger.set(k, { org, id: `req-${ledger.size + 1}`, state: 'requested', external_ref: null, detail: null, updated_at: NOW });
      const { org: _o, ...row } = ledger.get(k)!;
      return { ...row };
    },
    async transitionRequest(org, task, from, patch) {
      await tick();
      const row = ledger.get(`${org}:${task}`);
      if (!row || row.state !== from) return false;
      // The DB guard trigger: external_ref is set once; settled rows never move.
      if (row.external_ref !== null && patch.external_ref !== undefined && patch.external_ref !== row.external_ref) return false;
      if (['completed', 'skipped', 'failed', 'uncertain'].includes(row.state)) return false;
      if ((patch.state === 'submitted' || patch.state === 'completed') && (patch.external_ref ?? row.external_ref) === null) return false;
      Object.assign(row, patch, { updated_at: NOW });
      return true;
    },
    // 20261231000006: identity is proven in its own suite; here it passes.
    binding: { resolve: async () => ({ kind: 'bound', actionId: ACTION_ID, identity: provenIdentity }) },
    async readAction(org, id) {
      await tick();
      const a = actions.get(id);
      return a && a.organization_id === org ? { ...a } : null;
    },
    async claimAction(org, id) {
      await tick();
      const a = actions.get(id);
      if (!a || a.organization_id !== org || a.status !== 'approved') return false;
      a.status = 'executing';
      return true;
    },
    preflight: async (row) => {
      if (preflightThrows) throw new Error('policy table unreadable');
      return enginePreflight(row, preflightDeps);
    },
    channelPermitted: async () => {
      if (permission === 'throws') throw new Error('governance store down');
      return permission;
    },
    executeAction: (async (action: { id: string }, approved: boolean, options: unknown) => {
      calls.push({ action, approved, options });
      await tick();
      const a = actions.get(action.id)!;
      const b = next;
      next = 'executed';
      if (b === 'throw_before') throw new Error('engine unavailable');
      if (b === 'throw_after') { external += 1; throw new Error('socket hang up'); }
      if (b === 'executed') { external += 1; a.status = 'executed'; return { ok: true, status: 'executed', execution_mode: 'api' }; }
      if (b.acted) external += 1;
      if (b.rowStatus) a.status = b.rowStatus;
      return b.result;
    }) as unknown as CommunityAdapterDeps['executeAction'],
  };

  return {
    deps,
    ledger,
    actions,
    knobs,
    calls,
    externalActions: () => external,
    setNext: (b: EngineBehaviour) => { next = b; },
    setPreflightThrows: (v: boolean) => { preflightThrows = v; },
    setPermission: (v: boolean | null | 'throws') => { permission = v; },
    request: () => ledger.get(`${CONTRACT_ORG}:${contractContext().executionTaskId}`),
  };
}

async function run(w: ReturnType<typeof world>, c: EngineStepContext = ctx()): Promise<EngineResult> {
  const a = createCommunityAdapter(w.deps);
  const r = await a.execute(c);
  expectContractResult(a, r);
  return r;
}

// ── 1. The shared contract ─────────────────────────────────────────────────

describe('community adapter — shared contract', () => {
  it('satisfies contractScenarios', async () => {
    let w = world();
    let totalExternal = 0;
    await contractScenarios({
      make() {
        totalExternal += w.externalActions();
        w = world();
        return createCommunityAdapter(w.deps);
      },
      externalActions: () => totalExternal + w.externalActions(),
      failAfterCall() { w.setNext('throw_after'); },
      refuseByGate() { w.knobs.executionEnabled = false; },
    }, ctx());
  });

  it('claims exactly the community channel, which is authorable, and joins the registry without a clash', () => {
    const a = createCommunityAdapter();
    expect(a.engine).toBe('community');
    expect(a.channels).toEqual(['community']);
    for (const c of a.channels) expect(WORKFLOW_STEP_CHANNELS).toContain(c);
    const reg = buildAdapterRegistry([createWs3Adapter(), createWhatsAppAdapter(), a]);
    expect(reg.get('community')).toBe(a);
  });

  it('refuses a channel it does not serve, without touching the ledger', async () => {
    const w = world();
    const r = await run(w, ctx({ channel: 'whatsapp' }));
    expect(r).toMatchObject({ outcome: 'unsupported_channel', disposition: 'needs_human' });
    expect(w.ledger.size).toBe(0);
    expect(w.externalActions()).toBe(0);
  });
});

// ── 2. Supported path ───────────────────────────────────────────────────────

describe('community adapter — supported path', () => {
  it('executes an approved, bound reply once through the engine, then replays from the ledger', async () => {
    const w = world();
    const r = await run(w);
    expect(r).toEqual({ engine: 'community', outcome: 'executed', disposition: 'completed', reason: null, externalRef: ACTION_ID });
    expect(w.externalActions()).toBe(1);
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0].approved).toBe(true);
    expect((w.calls[0].options as Record<string, unknown>).auto).toBeUndefined();
    expect(w.calls[0].options).toMatchObject({
      // LD-4: a journey step is human-approved, never 'auto' (no auto flag).
      persist: true, source: 'orchestration',
      correlation_id: contractContext().executionTaskId,
      idempotency_key: `wf:${contractContext().executionTaskId}`,
      final_text: 'Thanks for sharing this.',
    });
    expect(w.request()).toMatchObject({ state: 'completed', external_ref: ACTION_ID });

    const again = await run(w);
    expect(again).toMatchObject({ outcome: 'completed', disposition: 'completed', externalRef: ACTION_ID });
    expect(w.externalActions()).toBe(1);
  });

  it('a person who opted out after the request existed is not acted on: settled skipped, nothing claimed or sent', async () => {
    const w = world();
    w.setPermission(null);
    expect(await run(w)).toMatchObject({ outcome: 'permission_unreadable', disposition: 'wait' });
    expect(w.request()!.state).toBe('requested');                // a request row now exists

    w.setPermission(false);
    expect(await run(w)).toMatchObject({ outcome: 'blocked_governance', disposition: 'skipped', externalRef: ACTION_ID });
    expect(w.calls).toHaveLength(0);
    expect(w.actions.get(ACTION_ID)!.status).toBe('approved');
    expect(w.request()).toMatchObject({ state: 'skipped', external_ref: ACTION_ID });

    w.setPermission(true);                                       // settled: a later allow does not revive it
    expect(await run(w)).toMatchObject({ outcome: 'skipped', disposition: 'skipped' });
    expect(w.calls).toHaveLength(0);
  });

  it('an unreadable governance store decides nothing: waits, nothing claimed or sent', async () => {
    const w = world();
    w.setPermission('throws');
    expect(await run(w)).toMatchObject({ outcome: 'permission_unreadable', disposition: 'wait' });
    expect(w.calls).toHaveLength(0);
    expect(w.actions.get(ACTION_ID)!.status).toBe('approved');
    expect(w.request()!.state).toBe('requested');
  });

  it('with no person, no permission can be evaluated: goes to a person, nothing claimed or sent', async () => {
    const w = world();
    expect(await run(w, ctx({ personId: null }))).toMatchObject({ outcome: 'person_unresolved', disposition: 'needs_human' });
    expect(w.calls).toHaveLength(0);
  });

  it('a cancel-requested action goes to a person, not into an endless wait; nothing claimed or sent', async () => {
    const w = world(approvedAction({ cancel_requested_at: '2026-10-28T09:00:00.000Z' }));
    expect(await run(w)).toMatchObject({ outcome: 'cancel_requested', disposition: 'needs_human', externalRef: ACTION_ID });
    expect(w.calls).toHaveLength(0);
    expect(w.actions.get(ACTION_ID)!.status).toBe('approved');
    expect(w.request()!.state).toBe('requested');
  });

  it('a browser-dispatched action waits, then completes from the engine row', async () => {
    const w = world(approvedAction({ execution_mode: 'browser' }));
    w.setNext({ result: { ok: true, status: 'dispatched', execution_mode: 'browser', response: { dispatch: 'queued_for_extension' } }, rowStatus: 'pending', acted: false });
    const r = await run(w);
    expect(r).toMatchObject({ outcome: 'dispatched', disposition: 'wait', externalRef: ACTION_ID });
    expect(w.request()).toMatchObject({ state: 'submitted', external_ref: ACTION_ID });

    expect(await run(w)).toMatchObject({ outcome: 'pending', disposition: 'wait' });
    w.actions.get(ACTION_ID)!.status = 'executed';               // the extension acked
    expect(await run(w)).toMatchObject({ outcome: 'executed', disposition: 'completed', externalRef: ACTION_ID });
    expect(w.calls).toHaveLength(1);
  });

  it('an action already performed by a person is observed as completed, never repeated', async () => {
    const w = world(approvedAction({ status: 'executed' }));
    const r = await run(w);
    expect(r).toMatchObject({ outcome: 'executed', disposition: 'completed', externalRef: ACTION_ID });
    expect(w.calls).toHaveLength(0);
    expect(w.request()).toMatchObject({ state: 'completed', external_ref: ACTION_ID });
  });

  it('an action the community scheduler owns (scheduled_at set) is left to it', async () => {
    const w = world(approvedAction({ scheduled_at: '2026-10-29T09:00:00.000Z' }));
    expect(await run(w)).toMatchObject({ outcome: 'scheduled', disposition: 'wait' });
    expect(w.calls).toHaveLength(0);
    expect(w.actions.get(ACTION_ID)!.status).toBe('approved');
  });
});

// ── 3. Authorization ────────────────────────────────────────────────────────

describe('community adapter — authorization', () => {
  it('the default binding reports the missing interface and acts on nothing', async () => {
    const w = world();
    w.deps.binding = noBindingInterface;
    const r = await run(w);
    expect(r).toMatchObject({ outcome: 'target_binding_unavailable', disposition: 'needs_human', externalRef: null });
    expect(w.calls).toHaveLength(0);
    expect(w.request()).toMatchObject({ state: 'requested', external_ref: null });
  });

  it('no or ambiguous binding is reported, never guessed', async () => {
    const w = world();
    w.deps.binding = { resolve: async () => ({ kind: 'none', reason: 'no action bound to this task' }) };
    expect(await run(w)).toMatchObject({ outcome: 'no_bound_action', disposition: 'needs_human' });
    w.deps.binding = { resolve: async () => ({ kind: 'ambiguous', reason: 'two actions bound' }) };
    expect(await run(w)).toMatchObject({ outcome: 'ambiguous_bound_action', disposition: 'needs_human' });
    expect(w.calls).toHaveLength(0);
  });

  it('a cross-tenant target is invisible to the tenant-filtered read and refused', async () => {
    const w = world(approvedAction({ tenant_id: CONTRACT_OTHER_ORG, organization_id: CONTRACT_OTHER_ORG }));
    const r = await run(w);
    expect(r).toMatchObject({ outcome: 'action_not_found', disposition: 'needs_human' });
    expect(w.calls).toHaveLength(0);
    expect(w.actions.get(ACTION_ID)!.status).toBe('approved');
  });

  it('a row whose tenant does not match is refused even if a read returned it', async () => {
    const w = world(approvedAction({ tenant_id: CONTRACT_OTHER_ORG }));
    expect(await run(w)).toMatchObject({ outcome: 'tenant_scope_violation', disposition: 'needs_human' });
    const w2 = world(approvedAction({ organization_id: CONTRACT_OTHER_ORG }));
    w2.deps.readAction = async () => approvedAction({ organization_id: CONTRACT_OTHER_ORG });
    expect(await run(w2)).toMatchObject({ outcome: 'tenant_scope_violation', disposition: 'needs_human' });
    expect(w.calls.length + w2.calls.length).toBe(0);
  });

  it('a pending action that needs approval waits; once a person approves it, it runs once', async () => {
    const w = world(approvedAction({ status: 'pending', approved_at: null }));
    expect(await run(w)).toMatchObject({ outcome: 'awaiting_approval', disposition: 'wait' });
    expect(w.calls).toHaveLength(0);
    // A person approves it (approve.ts: status, approver, content binding, passkey).
    Object.assign(w.actions.get(ACTION_ID)!, withApprovalEvidence({ ...w.actions.get(ACTION_ID)!, status: 'approved' } as never, { approvedAt: approvedAgo(60_000) }));
    expect(await run(w)).toMatchObject({ outcome: 'executed', disposition: 'completed' });
    expect(w.externalActions()).toBe(1);
  });

  it('an action nobody approved is never treated as approved', async () => {
    const w = world(approvedAction({ status: 'pending', approved_at: null, requires_human_approval: false }));
    expect(await run(w)).toMatchObject({ outcome: 'not_approved', disposition: 'needs_human' });
    const w2 = world(approvedAction({ approved_at: null }));
    expect(await run(w2)).toMatchObject({ outcome: 'approval_unproven', disposition: 'needs_human' });
    expect(w.calls.length + w2.calls.length).toBe(0);
  });

  it('a playbook refusal in pre-flight leaves the action untouched', async () => {
    const w = world();
    w.knobs.playbookVerdict = { allowed: false, reason: 'Action type "reply" is not allowed by this playbook.' };
    expect(await run(w)).toMatchObject({ outcome: 'PLAYBOOK_VIOLATION', disposition: 'needs_human' });
    expect(w.actions.get(ACTION_ID)!.status).toBe('approved');
    expect(w.request()!.state).toBe('requested');
    expect(w.calls).toHaveLength(0);
  });

  it('a playbook that is missing for this tenant is refused', async () => {
    const w = world();
    w.knobs.playbookThrows = true;
    expect(await run(w)).toMatchObject({ outcome: 'PLAYBOOK_NOT_FOUND', disposition: 'needs_human' });
    const w2 = world(approvedAction({ playbook_id: null }));
    expect(await run(w2)).toMatchObject({ outcome: 'PLAYBOOK_REQUIRED', disposition: 'needs_human' });
    expect(w.calls.length + w2.calls.length).toBe(0);
  });

  it('a permission/approval refusal from the engine itself is reported and never retried', async () => {
    const w = world();
    w.setNext({ result: { ok: false, status: 'failed', error: 'APPROVAL_REQUIRED' }, rowStatus: 'failed', acted: false });
    const r = await run(w);
    expect(r).toMatchObject({ outcome: 'failed', disposition: 'needs_human', externalRef: ACTION_ID });
    expect(r.reason).toMatch(/APPROVAL_REQUIRED/);
    expect(w.request()!.state).toBe('failed');
    expect(await run(w)).toMatchObject({ outcome: 'failed', disposition: 'needs_human' });
    expect(w.calls).toHaveLength(1);
  });
});

// ── 4. Concurrency ──────────────────────────────────────────────────────────

describe('community adapter — concurrency', () => {
  it('two executes racing for one task cause exactly one external action', async () => {
    const w = world();
    const a = createCommunityAdapter(w.deps);
    const [r1, r2] = await Promise.all([a.execute(ctx()), a.execute(ctx())]);
    expectContractResult(a, r1);
    expectContractResult(a, r2);
    expect(w.externalActions()).toBe(1);
    expect(w.calls).toHaveLength(1);
    expect([r1.disposition, r2.disposition]).toContain('completed');
    for (const r of [r1, r2]) expect(['completed', 'wait']).toContain(r.disposition);
  });

  it('five racing executes still cause one external action', async () => {
    const w = world();
    const a = createCommunityAdapter(w.deps);
    const rs = await Promise.all(Array.from({ length: 5 }, () => a.execute(ctx())));
    rs.forEach((r) => expectContractResult(a, r));
    expect(w.externalActions()).toBe(1);
  });

  it('when the route or scheduler claims the action first, the adapter releases its claim and acts on nothing', async () => {
    const w = world();
    const inner = w.deps.claimAction;
    w.deps.claimAction = async (org, id, now) => {
      w.actions.get(id)!.status = 'executing';                  // someone else won the engine claim
      return inner(org, id, now);
    };
    const r = await run(w);
    expect(r).toMatchObject({ outcome: 'action_moved', disposition: 'wait' });
    expect(w.calls).toHaveLength(0);
    expect(w.request()).toMatchObject({ state: 'requested', external_ref: ACTION_ID });
    // Next sweep sees it in flight elsewhere and waits.
    w.deps.claimAction = inner;
    expect(await run(w)).toMatchObject({ outcome: 'executing', disposition: 'wait' });
    expect(w.calls).toHaveLength(0);
  });

  it('a request claimed for one action is never re-pointed at another', async () => {
    const w = world();
    w.ledger.set(`${CONTRACT_ORG}:${contractContext().executionTaskId}`, { org: CONTRACT_ORG, id: 'r', state: 'requested', external_ref: 'some-other-action', detail: null, updated_at: NOW });
    expect(await run(w)).toMatchObject({ outcome: 'binding_changed', disposition: 'needs_human' });
    expect(w.calls).toHaveLength(0);
  });
});

// ── 5. Failure paths ────────────────────────────────────────────────────────

describe('community adapter — failure paths', () => {
  it('a throw before anything is claimed waits and acts on nothing', async () => {
    const w = world();
    w.setPreflightThrows(true);
    expect(await run(w)).toMatchObject({ outcome: 'gate_unreadable', disposition: 'wait' });
    w.setPreflightThrows(false);
    w.deps.binding = { resolve: async () => { throw new Error('db down'); } };
    expect(await run(w)).toMatchObject({ outcome: 'binding_unreadable', disposition: 'wait' });
    w.deps.getOrCreateRequest = async () => { throw new Error('ledger down'); };
    expect(await run(w)).toMatchObject({ outcome: 'request_unavailable', disposition: 'wait' });
    expect(w.calls).toHaveLength(0);
    expect(w.actions.get(ACTION_ID)!.status).toBe('approved');
  });

  it('a throw while claiming the engine row releases the request; nothing was handed to the engine', async () => {
    const w = world();
    w.deps.claimAction = async () => { throw new Error('timeout'); };
    expect(await run(w)).toMatchObject({ outcome: 'action_moved', disposition: 'wait' });
    expect(w.request()!.state).toBe('requested');
    expect(w.calls).toHaveLength(0);
  });

  it('a throw from the engine after the claim is uncertain and never re-executed', async () => {
    for (const b of ['throw_after', 'throw_before'] as const) {
      const w = world();
      w.setNext(b);
      const r = await run(w);
      expect(r).toMatchObject({ outcome: 'uncertain', disposition: 'needs_human', externalRef: ACTION_ID });
      expect(w.request()!.state).toBe('uncertain');
      expect(await run(w)).toMatchObject({ outcome: 'uncertain', disposition: 'needs_human' });
      expect(w.calls).toHaveLength(1);
    }
  });

  it('an engine timeout, a lost terminal write, or an unknown status is uncertain', async () => {
    const cases: ExecutionResult[] = [
      { ok: false, status: 'failed', error: 'RPA_EXECUTION_TIMEOUT', execution_mode: 'rpa' },
      { ok: false, status: 'failed', error: 'STATE_MISMATCH', response: { persist_error: 'STATE_MISMATCH' } },
      { ok: true, status: 'weird' as ExecutionResult['status'] },
    ];
    for (const result of cases) {
      const w = world();
      w.setNext({ result, acted: true });
      expect(await run(w)).toMatchObject({ outcome: 'uncertain', disposition: 'needs_human' });
      expect(w.request()!.state).toBe('uncertain');
      await run(w);
      expect(w.calls).toHaveLength(1);
    }
  });

  it('the engine\'s API→browser fallback after a possibly-landed API call is uncertain', async () => {
    const w = world();
    w.setNext({ result: { ok: true, status: 'dispatched', execution_mode: 'browser', response: { fallback_from: 'api', api_error: 'API_EXECUTION_TIMEOUT' } }, rowStatus: 'pending', acted: true });
    expect(await run(w)).toMatchObject({ outcome: 'uncertain', disposition: 'needs_human', externalRef: ACTION_ID });
    expect(w.request()!.state).toBe('uncertain');
  });

  it('the fallback after a definite API refusal is an ordinary dispatch', async () => {
    const w = world();
    w.setNext({ result: { ok: true, status: 'dispatched', execution_mode: 'browser', response: { fallback_from: 'api', api_error: 'PLATFORM_NOT_CONNECTED' } }, rowStatus: 'pending', acted: false });
    expect(await run(w)).toMatchObject({ outcome: 'dispatched', disposition: 'wait' });
    expect(w.request()!.state).toBe('submitted');
  });

  it('a dispatched action the engine later reaps is uncertain; an ordinary failure needs a person', async () => {
    const w = world();
    w.setNext({ result: { ok: true, status: 'dispatched', execution_mode: 'browser' }, rowStatus: 'pending', acted: false });
    await run(w);
    Object.assign(w.actions.get(ACTION_ID)!, { status: 'failed', execution_result: { source: 'lease_reaper', error_code: 'DISPATCH_LEASE_EXPIRED_IN_FLIGHT' } });
    expect(await run(w)).toMatchObject({ outcome: 'uncertain', disposition: 'needs_human' });

    const w2 = world();
    w2.setNext({ result: { ok: true, status: 'dispatched', execution_mode: 'browser' }, rowStatus: 'pending', acted: false });
    await run(w2);
    Object.assign(w2.actions.get(ACTION_ID)!, { status: 'failed', execution_result: { error_code: 'EXTENSION_REJECTED' } });
    expect(await run(w2)).toMatchObject({ outcome: 'failed', disposition: 'needs_human' });
    expect(w2.request()!.state).toBe('failed');
  });

  describe('stale claims', () => {
    const stale = (w: ReturnType<typeof world>, external_ref: string | null, updated_at = '2026-10-28T08:00:00.000Z') =>
      w.ledger.set(`${CONTRACT_ORG}:${contractContext().executionTaskId}`, { org: CONTRACT_ORG, id: 'r', state: 'submitting', external_ref, detail: null, updated_at });

    it('a fresh claim waits', async () => {
      const w = world();
      stale(w, ACTION_ID, new Date(Date.parse(NOW) - STALE_SUBMISSION_MS + 1000).toISOString());
      expect(await run(w)).toMatchObject({ outcome: 'submitting', disposition: 'wait' });
      expect(w.calls).toHaveLength(0);
    });

    it('a stale claim whose action is still approved is released and executed once', async () => {
      const w = world();
      stale(w, ACTION_ID);
      expect(await run(w)).toMatchObject({ outcome: 'executed', disposition: 'completed' });
      expect(w.externalActions()).toBe(1);
    });

    it('a stale claim is not begun again when the step only reports what the engine holds', async () => {
      const w = world();
      stale(w, ACTION_ID);
      expect(await run(w, ctx({ holdOnly: true }))).toMatchObject({ outcome: 'not_begun', disposition: 'skipped' });
      expect(w.calls).toHaveLength(0);
    });

    it('a stale claim whose action is executing is uncertain, never re-executed', async () => {
      const w = world(approvedAction({ status: 'executing' }));
      stale(w, ACTION_ID);
      expect(await run(w)).toMatchObject({ outcome: 'uncertain', disposition: 'needs_human' });
      expect(w.request()!.state).toBe('uncertain');
      expect(w.calls).toHaveLength(0);
    });

    it('a stale claim whose action was queued to the extension is adopted and observed', async () => {
      const w = world(approvedAction({ status: 'pending', execution_correlation_id: 'c' }));
      stale(w, ACTION_ID);
      expect(await run(w)).toMatchObject({ outcome: 'pending', disposition: 'wait' });
      expect(w.request()!.state).toBe('submitted');
      expect(w.calls).toHaveLength(0);
    });

    it('a stale claim whose action finished is settled from the engine row', async () => {
      const w = world(approvedAction({ status: 'executed' }));
      stale(w, ACTION_ID);
      expect(await run(w)).toMatchObject({ outcome: 'executed', disposition: 'completed' });
      expect(w.calls).toHaveLength(0);
    });
  });

  describe('kill switches', () => {
    it('the platform policy kill switch refuses before claiming and leaves the action approved', async () => {
      const w = world();
      w.knobs.executionEnabled = false;
      expect(await run(w)).toMatchObject({ outcome: 'PLATFORM_POLICY', disposition: 'needs_human' });
      expect(w.actions.get(ACTION_ID)!.status).toBe('approved');
      expect(w.request()!.state).toBe('requested');
      expect(w.calls).toHaveLength(0);
    });

    it('the company auto-execution switch refuses', async () => {
      const w = world();
      w.knobs.guardrail = { allowed: false, reason: 'auto_disabled' };
      expect(await run(w)).toMatchObject({ outcome: 'auto_disabled', disposition: 'needs_human' });
      expect(w.calls).toHaveLength(0);
    });

    it('the network-expansion observation lock refuses', async () => {
      const w = world(approvedAction({ action_type: 'follow', platform: 'twitter', intent_classification: { primary_intent: 'network_expansion' } }));
      expect(await run(w)).toMatchObject({ outcome: 'PHASE_5B_OBSERVATION_LOCK', disposition: 'needs_human' });
      expect(w.calls).toHaveLength(0);
    });

    it('a kill switch flipped between pre-flight and execution is the engine\'s refusal, reported', async () => {
      const w = world();
      w.setNext({ result: { ok: false, status: 'skipped', reason: 'PLATFORM_POLICY' }, rowStatus: 'skipped', acted: false });
      const r = await run(w);
      expect(r).toMatchObject({ outcome: 'skipped', disposition: 'needs_human' });
      expect(r.reason).toMatch(/PLATFORM_POLICY/);
      expect(w.request()!.state).toBe('failed');
      await run(w);
      expect(w.calls).toHaveLength(1);
    });
  });

  describe('rate limits', () => {
    it('a company daily limit waits without consuming the action', async () => {
      const w = world();
      w.knobs.guardrail = { allowed: false, reason: 'daily_platform_limit' };
      expect(await run(w)).toMatchObject({ outcome: 'daily_platform_limit', disposition: 'wait' });
      expect(w.actions.get(ACTION_ID)!.status).toBe('approved');
      w.knobs.guardrail = { allowed: true };
      expect(await run(w)).toMatchObject({ outcome: 'executed', disposition: 'completed' });
      expect(w.externalActions()).toBe(1);
    });

    it('the per-post reply limit needs a person', async () => {
      const w = world();
      w.knobs.guardrail = { allowed: false, reason: 'per_post_limit' };
      expect(await run(w)).toMatchObject({ outcome: 'per_post_limit', disposition: 'needs_human' });
    });

    it('a playbook rate limit waits', async () => {
      const w = world();
      w.knobs.playbookVerdict = { allowed: false, reason: 'Playbook limit exceeded' };
      expect(await run(w)).toMatchObject({ outcome: 'PLAYBOOK_LIMIT', disposition: 'wait' });
      expect(w.calls).toHaveLength(0);
    });

    it('an exhausted plan allowance needs a person, in pre-flight and from the engine', async () => {
      const w = world();
      w.knobs.usageAllowed = false;
      expect(await run(w)).toMatchObject({ outcome: 'PLAN_LIMIT_EXCEEDED', disposition: 'needs_human' });
      expect(w.calls).toHaveLength(0);
      const w2 = world();
      w2.setNext({ result: { ok: false, status: 'blocked', error: { code: 'PLAN_LIMIT_EXCEEDED' } }, rowStatus: 'blocked', acted: false });
      expect(await run(w2)).toMatchObject({ outcome: 'blocked', disposition: 'needs_human' });
      expect(w2.request()!.state).toBe('failed');
    });
  });
});

// ── 6. Unsupported capabilities ────────────────────────────────────────────

describe('community adapter — unsupported capabilities', () => {
  const unsupported: [string, Partial<CommunityActionRow>, RegExp][] = [
    ['schedule', { action_type: 'schedule' }, /unsupported_action_type:schedule/],
    ['comment_ingest', { action_type: 'comment_ingest' }, /unsupported_action_type:comment_ingest/],
    ['unknown type', { action_type: 'boost' }, /unsupported_action_type:boost/],
    ['like on youtube', { action_type: 'like', platform: 'youtube' }, /unsupported_platform:like:youtube/],
    ['follow on linkedin', { action_type: 'follow', platform: 'linkedin' }, /unsupported_platform:follow:linkedin/],
    ['share on instagram', { action_type: 'share', platform: 'instagram' }, /unsupported_platform:share:instagram/],
    ['dm on reddit', { action_type: 'dm', platform: 'reddit', execution_mode: 'browser' }, /unsupported_platform:dm:reddit/],
    ['manual simulation', { execution_mode: 'manual' }, /unsupported_mode:manual/],
    ['dm via rpa', { action_type: 'dm', execution_mode: 'rpa', target_id: 'https://www.linkedin.com/messaging/thread/2-abcdefghijklmnop/' }, /unsupported_mode:rpa_dm/],
    ['linkedin dm into whatever thread is open', { action_type: 'dm', execution_mode: 'browser', target_id: 'Jane Doe' }, /unsupported_dm_target/],
    ['reply without text', { suggested_text: '  ', final_text: null }, /reply_text_missing/],
  ];

  it.each(unsupported)('%s is reported, never performed or re-routed', async (_name, over, code) => {
    const w = world(approvedAction(over));
    const r = await run(w);
    expect(r.outcome).toBe('unsupported_action');
    expect(r.disposition).toBe('needs_human');
    expect(r.reason).toMatch(code);
    expect(w.calls).toHaveLength(0);
    expect(w.actions.get(ACTION_ID)!.status).toBe('approved');
    expect(w.request()!.state).toBe('requested');
  });

  it('the supported matrix: what the connectors and the extension genuinely perform', () => {
    const ok = (over: Partial<CommunityActionRow>) => classifyCommunityAction(approvedAction(over)).supported;
    expect(ok({ action_type: 'reply', platform: 'youtube' })).toBe(true);
    expect(ok({ action_type: 'like', platform: 'reddit' })).toBe(true);
    expect(ok({ action_type: 'share', platform: 'twitter' })).toBe(true);
    expect(ok({ action_type: 'follow', platform: 'twitter' })).toBe(true);
    // Addressed DMs the engine's own DM policy refuses are refused here, before any claim.
    expect(ok({ action_type: 'dm', platform: 'instagram', execution_mode: 'browser', target_id: 'https://www.instagram.com/direct/t/1234567/' })).toBe(false);
    expect(ok({ action_type: 'dm', platform: 'twitter', execution_mode: 'browser', target_id: 'some.handle' })).toBe(false);
  });
});
