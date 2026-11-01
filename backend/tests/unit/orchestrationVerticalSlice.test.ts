/**
 * ORCHESTRATION VERTICAL SLICE — tenant workflow → versioned definition →
 * individual enrollment → intelligence-based eligibility and treatment →
 * scheduled action → selected engine → recorded result → updated journey state.
 *
 * What is REAL here:
 *   - journey policy, the workflow definition validator, enrollment eligibility,
 *     the progression sweeper and both engine adapters;
 *   - the WS-3 engine itself: approval (submit/approve), governance, quota, the
 *     compare-and-set claim, the internal transport and its work item — over the
 *     strict in-memory database used by the WS-3 suites (append-only audit,
 *     unique attempt numbers, one work item per attempt).
 *
 * What is modelled:
 *   - the journey tables (instances, plans, steps, tasks) as an in-memory world,
 *     with `advance_execution_plan`'s rule — a step becomes ready only once its
 *     predecessor is completed/skipped and its delay has elapsed — emulated on a
 *     test clock;
 *   - the WS-3 bridge RPC, emulated exactly as its SQL does it: one outreach task
 *     per execution task (lead_id = subject_id, plan_task_id = execution_task_id),
 *     `awaiting_approval` when the step requires approval, else `pending`;
 *   - the WhatsApp engine's create/expand/enqueue calls, recorded (its send path,
 *     claim-before-send and governance gate are proven in w0cWhatsappBroadcastGovernance).
 *
 * No real database, provider or network is reached.
 */

type Row = Record<string, unknown>;

// ── WS-3 strict database double (as in ws3Milestone5aInternalDispatch) ───────
const db = { tables: {} as Record<string, Row[]>, nextId: 1 };
const APPEND_ONLY = ['outreach_approvals', 'outreach_attempts', 'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions', 'outreach_internal_work_items'];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st: { op: string; filters: Array<[string, unknown]>; payload: Row | null } = { op: 'select', filters: [], payload: null };
    const rows = () => (db.tables[table] ??= []);
    const matches = (r: Row) => st.filters.every(([c, v]) => {
      if (c.startsWith('__gte__')) return String(r[c.slice(7)] ?? '') >= String(v);
      if (c.startsWith('__is__')) return (r[c.slice(6)] ?? null) === v;
      if (c.startsWith('__in__')) return (v as unknown[]).includes(r[c.slice(6)]);
      return r[c] === v;
    });
    const exec = async (mode: 'many' | 'maybe' | 'single'): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      if (st.op === 'insert') {
        const row = st.payload as Row;
        if (table === 'outreach_attempts' && rows().some((r) => r.company_id === row.company_id && r.task_id === row.task_id && r.attempt_number === row.attempt_number)) {
          return { data: null, error: { code: '23505', message: 'duplicate attempt_number' } };
        }
        if (table === 'outreach_internal_work_items' && rows().some((r) => r.company_id === row.company_id && r.task_id === row.task_id && r.attempt_id === row.attempt_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate work item for attempt' } };
        }
        if (table === 'execution_engine_requests') {
          // The migration's UNIQUE (organization_id, execution_task_id).
          if (rows().some((r) => r.organization_id === row.organization_id && r.execution_task_id === row.execution_task_id)) {
            return { data: null, error: { code: '23505', message: 'execution_engine_requests_task_unique' } };
          }
          row.updated_at = world.clock;
          row.external_ref = row.external_ref ?? null;
          row.detail = row.detail ?? null;
        }
        const created = { ...row, id: `${table}-${db.nextId++}`, created_at: '2026-10-28T00:00:00.000Z' };
        rows().push(created);
        return { data: created, error: null };
      }
      if (st.op === 'update') {
        if (APPEND_ONLY.includes(table)) return { data: null, error: { code: '2F004', message: 'append-only' } };
        const affected = rows().filter(matches);
        if (table === 'execution_engine_requests') {
          // The guard trigger: a reference is set once; a settled request never moves.
          for (const r of affected) {
            const p = st.payload as Row;
            if (r.external_ref != null && p.external_ref !== undefined && p.external_ref !== r.external_ref) {
              return { data: null, error: { code: '23514', message: 'external_ref is set once' } };
            }
            if (['completed', 'skipped', 'failed', 'uncertain'].includes(String(r.state)) && p.state !== undefined && p.state !== r.state) {
              return { data: null, error: { code: '23514', message: 'a settled request does not move' } };
            }
          }
          for (const r of affected) Object.assign(r, st.payload, { updated_at: world.clock });
          return { data: affected.map((r) => ({ id: r.id })), error: null };
        }
        for (const r of affected) Object.assign(r, st.payload);
        return { data: affected.map((r) => ({ id: r.id })), error: null };
      }
      const found = rows().filter(matches);
      return mode === 'many' ? { data: found, error: null } : { data: found[0] ?? null, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (row: Row) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Row) => { st.op = 'update'; st.payload = row; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      gte: (c: string, v: unknown) => { st.filters.push([`__gte__${c}`, v]); return b; },
      is: (c: string, v: unknown) => { st.filters.push([`__is__${c}`, v]); return b; },
      in: (c: string, v: unknown[]) => { st.filters.push([`__in__${c}`, v]); return b; },
      order: () => b,
      limit: () => exec('many'),
      maybeSingle: () => exec('maybe'),
      single: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

const fakeRedis = {
  store: new Map<string, number>(),
  async incrby(k: string, by: number) { const n = (this.store.get(k) ?? 0) + by; this.store.set(k, n); return n; },
  async decrby(k: string, by: number) { const n = (this.store.get(k) ?? 0) - by; this.store.set(k, n); return n; },
  async get(k: string) { const v = this.store.get(k); return v === undefined ? null : String(v); },
  async set(k: string, v: string) { this.store.set(k, Number(v)); return 'OK'; },
  async expire() { return 1; },
};
jest.mock('../../queue/bullmqClient', () => ({ getSharedRedisClient: () => fakeRedis }));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

// ── The journey world: instances, plans, steps, tasks ───────────────────────
interface WStep { id: string; planId: string; stepKey: string; stepOrder: number; channel: string; delay: number; state: string; settledAt: string | null; completedAt: string | null }
interface WTask { id: string; organizationId: string; executionInstanceId: string; planStepId: string; subjectKind: 'lead' | 'prospect'; subjectId: string; channel: string; requiresApproval: boolean }
interface WInstance { id: string; organizationId: string; workflowVersionId: string; subjectKind: 'lead' | 'prospect'; subjectId: string; lifecycleState: string; plan: { id: string; definitionSnapshot: unknown } }

const world = {
  clock: '2026-10-28T09:00:00.000Z',
  instances: [] as WInstance[],
  steps: [] as WStep[],
  tasks: [] as WTask[],
  transitions: [] as Array<{ stepId: string; state: string }>,
};

const ADVANCING = ['completed', 'skipped'];
const hoursAfter = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3_600_000).toISOString();

jest.mock('../../services/workflowExecution/stepProgressionStore', () => ({
  // `advance_execution_plan`, emulated: promote the frontier step when its
  // predecessor advanced and its delay elapsed; complete the run when all settled.
  advanceExecutionRun: async ({ organizationId, executionInstanceId }: { organizationId: string; executionInstanceId: string }) => {
    const inst = world.instances.find((i) => i.id === executionInstanceId && i.organizationId === organizationId);
    if (!inst) throw Object.assign(new Error('instance_not_found'), { code: 'instance_not_found' });
    const steps = world.steps.filter((s) => s.planId === inst.plan.id).sort((a, b) => a.stepOrder - b.stepOrder);
    let promoted = 0;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.state !== 'pending') continue;
      const prev = steps[i - 1];
      const anchor = prev ? (ADVANCING.includes(prev.state) ? prev.settledAt : null) : '2026-01-01T00:00:00.000Z';
      if (anchor !== null && hoursAfter(anchor, s.delay) <= world.clock) { s.state = 'ready'; promoted++; }
      break;
    }
    if (steps.every((s) => ['completed', 'skipped', 'failed', 'cancelled'].includes(s.state))) inst.lifecycleState = 'completed';
    else if (inst.lifecycleState === 'created') inst.lifecycleState = 'active';
    return promoted;
  },
  getReadyStep: async (_org: string, planId: string) => {
    const s = world.steps.find((x) => x.planId === planId && x.state === 'ready');
    return s ? { id: s.id, planId: s.planId, stepKey: s.stepKey, stepOrder: s.stepOrder, channel: s.channel, state: s.state } : null;
  },
  transitionPlanStep: async ({ stepId, state }: { organizationId: string; stepId: string; state: string }) => {
    const s = world.steps.find((x) => x.id === stepId)!;
    if (['completed', 'skipped', 'failed', 'cancelled'].includes(s.state)) {
      throw Object.assign(new Error('already settled'), { code: 'already_settled' });
    }
    s.state = state;
    s.settledAt = world.clock;
    if (state === 'completed') s.completedAt = world.clock;
    world.transitions.push({ stepId, state });
    return { id: s.id, state: s.state };
  },
  listProgressionSteps: async (_org: string, planId: string) =>
    world.steps.filter((s) => s.planId === planId).map((s) => ({ ...s })),
}));

jest.mock('../../services/executionPlans/executionPlanStore', () => ({
  getPlanForInstance: async (org: string, instanceId: string) => {
    const i = world.instances.find((x) => x.id === instanceId && x.organizationId === org);
    return i ? { id: i.plan.id, definitionSnapshot: i.plan.definitionSnapshot } : null;
  },
  listInstanceTasks: async (org: string, instanceId: string) =>
    world.tasks.filter((t) => t.executionInstanceId === instanceId && t.organizationId === org),
  lastCompletedActionAtForSubject: async (org: string, kind: string, id: string) => {
    const stepIds = new Set(world.tasks.filter((t) => t.organizationId === org && t.subjectKind === kind && t.subjectId === id).map((t) => t.planStepId));
    const done = world.steps.filter((s) => stepIds.has(s.id) && s.completedAt !== null).map((s) => s.completedAt as string).sort();
    return done.length ? done[done.length - 1] : null;
  },
}));

jest.mock('../../services/executionInstances/executionInstanceStore', () => ({
  listExecutionInstanceIdsInStates: async (org: string, states: readonly string[]) =>
    world.instances.filter((i) => i.organizationId === org && states.includes(i.lifecycleState)).map((i) => i.id),
  listWorkflowExecutionInstances: async (org: string) => world.instances.filter((i) => i.organizationId === org),
}));

// The WS-3 bridge RPC, emulated as its SQL does it.
jest.mock('../../services/outreachBridge/outreachBridgeStore', () => {
  const handoffs: Row[] = [];
  return {
    __handoffs: handoffs,
    bridgeExecutionTask: async ({ organizationId, executionTaskId }: { organizationId: string; executionTaskId: string }) => {
      const existing = handoffs.find((h) => h.organizationId === organizationId && h.executionTaskId === executionTaskId);
      if (existing) return { handoff: existing, replayed: true };
      const task = world.tasks.find((t) => t.id === executionTaskId && t.organizationId === organizationId)!;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ws3 = require('../../services/leadOutreachExecution');
      const inserted = await ws3.insertOutreachTask({
        companyId: organizationId, leadId: task.subjectId, planTaskId: executionTaskId, taskOrder: 1,
        kind: 'human', action: 'workflow step', channel: task.channel, dependsOnPlanTaskId: null,
        estimatedDelayHours: 0, confidence: 1, explanation: 'workflow step', requiresApproval: task.requiresApproval,
        plannerVersion: 'workflow-bridge', translationVersion: ws3.TRANSLATION_VERSION,
        governanceVersion: ws3.GOVERNANCE_VERSION, executionRuntimeVersion: ws3.EXECUTION_RUNTIME_VERSION,
        materializedAt: world.clock,
      });
      const outreachTaskId = String(inserted.data.id);
      await ws3.setOutreachTaskState(organizationId, outreachTaskId, { status: task.requiresApproval ? 'awaiting_approval' : 'pending' });
      const h = { organizationId, executionTaskId, outreachTaskId, executionInstanceId: task.executionInstanceId };
      handoffs.push(h);
      return { handoff: h, replayed: false };
    },
    listInstanceHandoffs: async (org: string, instanceId: string) =>
      handoffs.filter((h) => h.organizationId === org && h.executionInstanceId === instanceId),
  };
});

jest.mock('../../services/workflows/workflowStore', () => {
  const actual = jest.requireActual('../../services/workflows/workflowStore');
  return {
    ...actual,
    getCurrentWorkflowVersion: async () => currentVersion,
    getWorkflow: async (org: string, id: string) => (org === ORG_A && id === WORKFLOW_ID ? { id, name: 'Discovery calls' } : null),
    listWorkflowVersions: async () => (currentVersion ? [currentVersion] : []),
  };
});

import {
  INTERNAL_CHANNEL, __clearTransportsForTests, __resetQuotaRedisForTests, approveOutreachTask,
  getOutreachTaskById, listInternalWorkItems, registerDefaultTransports,
} from '../../services/leadOutreachExecution';
import { registry } from '../../observability/registry';
import { validateWorkflowDefinition, type WorkflowVersion } from '../../services/workflows/workflowStore';
import { advanceAndDispatchWorkflowExecution, type TenantSweepResult } from '../../services/workflowExecution/workflowProgressionSweeper';
import { createWs3Adapter, type EngineAdapter } from '../../services/orchestration/engineAdapters';
import { broadcastNameFor, createWhatsAppAdapter, defaultWhatsAppDeps, STALE_SUBMISSION_MS, type WhatsAppAdapterDeps } from '../../services/orchestration/whatsappEngineAdapter';
import { checkEnrollmentEligibility } from '../../services/orchestration/enrollment';
import { buildJourneyReport } from '../../services/orchestration/journeyReport';
import type { IndividualIntelligencePort } from '../../services/orchestration/individualIntelligence';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bridgeModule = require('../../services/outreachBridge/outreachBridgeStore') as { __handoffs: Row[] };

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const WORKFLOW_ID = '33333333-3333-4333-8333-333333333333';

// ── The tenant's workflow, validated by the REAL validator ──────────────────
const DEFINITION = validateWorkflowDefinition({
  objective: { statement: 'Book a discovery call with qualified prospects', success_outcome: 'step_completion', target_rate: 0.3 },
  enrollment: { conditions: [{ fact: 'prospect_score_overall', op: 'gte', value: 0.5 }] },
  policy: { min_hours_between_actions: 24 },
  steps: [
    { key: 'assign-sdr', channel: 'internal', delay_after_previous_hours: 0, execution_mode: 'human' },
    {
      key: 'wa-intro', channel: 'whatsapp', delay_after_previous_hours: 0, execution_mode: 'assisted',
      whatsapp: { template_name: 'discovery_intro_v1' },
      when: [{ fact: 'has_phone', op: 'eq', value: true }],
    },
  ],
});
let currentVersion: WorkflowVersion | null = null;

// ── Individuals, through the facts port ─────────────────────────────────────
interface Person { personId: string | null; score: number | null; phone: string | null; whatsapp: boolean; email: boolean }
const people: Record<string, Person> = {};
const intelligence: IndividualIntelligencePort = {
  resolvePerson: async (_org, subject) => ({ ok: true, personId: people[subject.id]?.personId ?? null }),
  readPersonContacts: async (_org, personId) => {
    const p = Object.values(people).find((x) => x.personId === personId);
    return p ? { email: null, phone: p.phone } : null;
  },
  readLeadIntelligence: async () => null,
  readProspectScore: async (_org, prospectId) => (people[prospectId]?.score == null ? null : { intent: null, overall: people[prospectId].score, confidence: 0.9 }),
  channelPermission: async (_org, personId, channel) => {
    const p = Object.values(people).find((x) => x.personId === personId);
    if (!p) return null;
    return channel === 'whatsapp' ? p.whatsapp : p.email;
  },
};

// ── The WhatsApp engine seam: ledger with real uniqueness, recorded engine calls ──
const wa = {
  broadcasts: [] as Array<{ id: string; org: string; name: string; template: string }>,
  recipients: new Map<string, { phone: string; status: string }>(),
  enqueued: [] as string[],
  failEnqueue: null as string | null,
};
const waDeps: WhatsAppAdapterDeps = {
  // The REAL request-ledger functions, over the database double (which emulates the
  // migration's unique key and guard trigger). Only the engine calls are doubles.
  getOrCreateRequest: defaultWhatsAppDeps.getOrCreateRequest,
  transitionRequest: defaultWhatsAppDeps.transitionRequest,
  async findBroadcastByName(org, name) { return wa.broadcasts.find((b) => b.org === org && b.name === name)?.id ?? null; },
  async readPersonPhone(_org, personId) { return Object.values(people).find((p) => p.personId === personId)?.phone ?? null; },
  async findWhatsAppAccount() { return { id: 'sa-whatsapp' }; },
  createBroadcast: (async (input: { company_id: string; name: string; template_name?: string }) => {
    const id = `bc-${wa.broadcasts.length + 1}`;
    wa.broadcasts.push({ id, org: input.company_id, name: input.name, template: String(input.template_name) });
    return id;
  }) as never,
  expandRecipients: (async (id: string, contacts: Array<{ phone_e164: string }>) => {
    wa.recipients.set(id, { phone: contacts[0].phone_e164, status: 'pending' });
    return { inserted: 1, skipped: 0 };
  }) as never,
  enqueueBroadcast: (async (id: string) => {
    if (wa.failEnqueue) throw new Error(wa.failEnqueue);
    wa.enqueued.push(id);
  }) as never,
  async readRecipientStatus(id) { return wa.recipients.get(id)?.status ?? null; },
};
/** The engine's send path delivering (processBatch → Meta → 'sent'). */
const engineSends = (status = 'sent') => { for (const [, r] of wa.recipients) if (r.status === 'pending') r.status = status; };

const adapters = (): EngineAdapter[] => [createWs3Adapter(), createWhatsAppAdapter(waDeps)];
const sweep = (org = ORG_A): Promise<TenantSweepResult> =>
  advanceAndDispatchWorkflowExecution(org, { now: world.clock, deps: { adapters: adapters(), intelligence } });

let seq = 0;
/** Enrol a subject: the instance, its plan (frozen snapshot), steps and tasks. */
function enrol(org: string, subjectId: string, definition = DEFINITION): string {
  const instanceId = `inst-${++seq}`;
  const planId = `plan-${seq}`;
  world.instances.push({ id: instanceId, organizationId: org, workflowVersionId: currentVersion!.id, subjectKind: 'prospect', subjectId, lifecycleState: 'created', plan: { id: planId, definitionSnapshot: JSON.parse(JSON.stringify(definition)) } });
  definition.steps.forEach((s, i) => {
    const stepId = `${planId}-step-${i + 1}`;
    world.steps.push({ id: stepId, planId, stepKey: s.key, stepOrder: i + 1, channel: s.channel, delay: s.delay_after_previous_hours, state: 'pending', settledAt: null, completedAt: null });
    world.tasks.push({ id: `${planId}-task-${i + 1}`, organizationId: org, executionInstanceId: instanceId, planStepId: stepId, subjectKind: 'prospect', subjectId, channel: s.channel, requiresApproval: s.execution_mode === 'human' || s.requires_approval === true });
  });
  return instanceId;
}
const stepOf = (instanceId: string, key: string) => {
  const inst = world.instances.find((i) => i.id === instanceId)!;
  return world.steps.find((s) => s.planId === inst.plan.id && s.stepKey === key)!;
};
const outreachTaskFor = (instanceId: string) => String(bridgeModule.__handoffs.find((h) => h.executionInstanceId === instanceId)!.outreachTaskId);

beforeEach(() => {
  db.tables = {};
  db.nextId = 1;
  fakeRedis.store.clear();
  registry.reset();
  __resetQuotaRedisForTests();
  __clearTransportsForTests();
  registerDefaultTransports({ emailProvider: { name: 'stub', async send() { throw new Error('email must not be called'); } } });
  world.clock = '2026-10-28T09:00:00.000Z';
  world.instances = []; world.steps = []; world.tasks = []; world.transitions = [];
  bridgeModule.__handoffs.length = 0;
  wa.broadcasts = []; wa.recipients = new Map(); wa.enqueued = []; wa.failEnqueue = null;
  for (const k of Object.keys(people)) delete people[k];
  people['p-ready'] = { personId: 'person-ready', score: 0.8, phone: '+15551230001', whatsapp: true, email: false };
  people['p-nophone'] = { personId: 'person-nophone', score: 0.8, phone: null, whatsapp: true, email: false };
  people['p-optout'] = { personId: 'person-optout', score: 0.9, phone: '+15551230003', whatsapp: false, email: false };
  people['p-cold'] = { personId: 'person-cold', score: 0.2, phone: '+15551230004', whatsapp: true, email: false };
  currentVersion = {
    id: 'version-1', organizationId: ORG_A, workflowId: WORKFLOW_ID, version: 1, status: 'published',
    definition: DEFINITION, createdBy: null, createdAt: world.clock, updatedAt: world.clock, publishedAt: world.clock, publishedBy: 'owner',
  };
  // The tenant's WS-3 governance configuration (tenant enablement is WS-3's switch).
  (db.tables.outreach_governance_config ??= []).push({
    company_id: ORG_A, enabled: true, kill_switch: false, enabled_channels: [INTERNAL_CHANNEL],
    restricted_regions: [], daily_limit_tenant: null, daily_limit_lead: null,
  });
});

describe('the tenant workflow configuration is versioned policy, validated', () => {
  it('carries objective, enrollment, frequency and per-step treatment in the frozen definition', () => {
    expect(DEFINITION.objective).toEqual({ statement: 'Book a discovery call with qualified prospects', success_outcome: 'step_completion', target_rate: 0.3 });
    expect(DEFINITION.enrollment?.conditions).toEqual([{ fact: 'prospect_score_overall', op: 'gte', value: 0.5 }]);
    expect(DEFINITION.policy).toEqual({ min_hours_between_actions: 24 });
    expect(DEFINITION.steps.map((s) => [s.key, s.channel])).toEqual([['assign-sdr', 'internal'], ['wa-intro', 'whatsapp']]);
    expect(DEFINITION.steps[1].whatsapp).toEqual({ template_name: 'discovery_intro_v1' });
  });

  it('refuses a whatsapp step without a template and engine settings on another channel', () => {
    const base = { key: 's', delay_after_previous_hours: 0, execution_mode: 'human' };
    expect(() => validateWorkflowDefinition({ steps: [{ ...base, channel: 'whatsapp' }] })).toThrow(/whatsapp/);
    expect(() => validateWorkflowDefinition({ steps: [{ ...base, channel: 'internal', whatsapp: { template_name: 'x' } }] })).toThrow(/only allowed on a whatsapp step/);
  });

  it('refuses unknown facts and mistyped conditions', () => {
    const step = { key: 's', channel: 'internal', delay_after_previous_hours: 0, execution_mode: 'human' };
    expect(() => validateWorkflowDefinition({ steps: [{ ...step, when: [{ fact: 'favourite_colour', op: 'eq', value: 'red' }] }] })).toThrow(/fact must be one of/);
    expect(() => validateWorkflowDefinition({ steps: [{ ...step, when: [{ fact: 'has_phone', op: 'gte', value: 1 }] }] })).toThrow();
  });
});

describe('enrollment — the version decides who may enter, from the person\'s facts', () => {
  it('enrols a qualified prospect and refuses one below the score threshold, with reasons', async () => {
    const ok = await checkEnrollmentEligibility({ organizationId: ORG_A, workflowId: WORKFLOW_ID, subject: { kind: 'prospect', id: 'p-ready' }, intelligence });
    expect(ok).toEqual({ eligible: true, assessedVersionId: 'version-1', reasons: [] });
    const cold = await checkEnrollmentEligibility({ organizationId: ORG_A, workflowId: WORKFLOW_ID, subject: { kind: 'prospect', id: 'p-cold' }, intelligence });
    expect(cold.eligible).toBe(false);
    expect(cold.reasons[0]).toMatch(/prospect_score_overall gte 0.5 does not hold/);
  });

  it('a person we cannot assess is NOT enrolled (unknown fails closed)', async () => {
    people['p-unscored'] = { personId: 'person-unscored', score: null, phone: null, whatsapp: true, email: false };
    const v = await checkEnrollmentEligibility({ organizationId: ORG_A, workflowId: WORKFLOW_ID, subject: { kind: 'prospect', id: 'p-unscored' }, intelligence });
    expect(v.eligible).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/unknown/);
  });
});

describe('THE VERTICAL SLICE — two engines, multiple actions, one journey', () => {
  it('assign-sdr (WS-3, human-approved) → frequency gap → wa-intro (WhatsApp) → journey completed', async () => {
    const run = enrol(ORG_A, 'p-ready');

    // Sweep 1: the first step is due; WS-3 materializes it and it awaits a human.
    let r = await sweep();
    expect(r.decisions).toEqual([expect.objectContaining({ stepKey: 'assign-sdr', engine: 'ws3', decision: 'waiting', outcome: 'awaiting_approval' })]);
    const ws3Task = outreachTaskFor(run);
    expect((await getOutreachTaskById(ORG_A, ws3Task))?.status).toBe('awaiting_approval');
    expect(stepOf(run, 'assign-sdr').state).toBe('ready');

    // A human approves through the existing WS-3 approval API.
    expect((await approveOutreachTask(ORG_A, ws3Task, { approverUserId: 'sdr-lead' })).ok).toBe(true);

    // Sweep 2: the REAL WS-3 dispatcher sends through the internal transport.
    r = await sweep();
    expect(r.decisions).toEqual([expect.objectContaining({ stepKey: 'assign-sdr', engine: 'ws3', decision: 'executed', outcome: 'sent' })]);
    expect(stepOf(run, 'assign-sdr').state).toBe('completed');
    expect(await listInternalWorkItems(ORG_A, ws3Task)).toHaveLength(1);

    // Sweep 3, same instant: wa-intro is due, but the person was just contacted.
    r = await sweep();
    expect(r.decisions).toEqual([expect.objectContaining({ stepKey: 'wa-intro', engine: 'whatsapp', decision: 'deferred' })]);
    expect(wa.broadcasts).toHaveLength(0);

    // 25 hours later: the WhatsApp engine is asked, once, with the authored template.
    world.clock = hoursAfter(world.clock, 25);
    r = await sweep();
    expect(r.decisions).toEqual([expect.objectContaining({ stepKey: 'wa-intro', engine: 'whatsapp', decision: 'waiting', outcome: 'submitted' })]);
    expect(wa.broadcasts).toEqual([{ id: 'bc-1', org: ORG_A, name: broadcastNameFor(`${world.instances[0].plan.id}-task-2`), template: 'discovery_intro_v1' }]);
    expect(wa.recipients.get('bc-1')?.phone).toBe('+15551230001');
    expect(wa.enqueued).toEqual(['bc-1']);

    // The engine sends; the next sweep records the result and the journey completes.
    engineSends('sent');
    r = await sweep();
    expect(r.decisions).toEqual([expect.objectContaining({ stepKey: 'wa-intro', engine: 'whatsapp', decision: 'executed', outcome: 'sent' })]);
    expect(stepOf(run, 'wa-intro').state).toBe('completed');
    await sweep();
    expect(world.instances[0].lifecycleState).toBe('completed');
    expect(wa.broadcasts).toHaveLength(1);
  });

  it('the same workflow treats people differently: no phone → the WhatsApp step is skipped, journey continues', async () => {
    const run = enrol(ORG_A, 'p-nophone', validateWorkflowDefinition({ steps: [DEFINITION.steps[1]] }));
    const r = await sweep();
    expect(r.decisions).toEqual([expect.objectContaining({ stepKey: 'wa-intro', decision: 'skipped' })]);
    expect(r.decisions[0].reasons.join(' ')).toMatch(/has_phone eq true does not hold/);
    expect(stepOf(run, 'wa-intro').state).toBe('skipped');
    expect(db.tables.execution_engine_requests ?? []).toHaveLength(0);
    await sweep();
    expect(world.instances[0].lifecycleState).toBe('completed');
  });

  it('a workflow NEVER overrides an opt-out: whatsapp_permitted=false skips, and nothing is requested', async () => {
    enrol(ORG_A, 'p-optout', validateWorkflowDefinition({ steps: [DEFINITION.steps[1]] }));
    const r = await sweep();
    expect(r.decisions[0]).toMatchObject({ decision: 'skipped' });
    expect(r.decisions[0].reasons.join(' ')).toMatch(/whatsapp_permitted eq true does not hold/);
    expect(db.tables.execution_engine_requests ?? []).toHaveLength(0);
    expect(wa.broadcasts).toHaveLength(0);
  });

  it('a human rejection of the WS-3 action is a skip, not a failure', async () => {
    const run = enrol(ORG_A, 'p-ready', validateWorkflowDefinition({ steps: [DEFINITION.steps[0]] }));
    await sweep();
    const t = outreachTaskFor(run);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { rejectOutreachTask } = require('../../services/leadOutreachExecution');
    expect((await rejectOutreachTask(ORG_A, t, { approverUserId: 'sdr-lead' })).ok).toBe(true);
    const r = await sweep();
    expect(r.decisions[0]).toMatchObject({ engine: 'ws3', decision: 'skipped', outcome: 'rejected' });
    expect(stepOf(run, 'assign-sdr').state).toBe('skipped');
  });

  it('autonomous steps are NOT dispatched without approval: they are submitted to a human', async () => {
    const autonomous = validateWorkflowDefinition({ steps: [{ key: 'auto', channel: 'internal', delay_after_previous_hours: 0, execution_mode: 'autonomous' }] });
    const run = enrol(ORG_A, 'p-ready', autonomous);
    const r = await sweep();
    expect(r.decisions[0]).toMatchObject({ engine: 'ws3', decision: 'waiting', outcome: 'awaiting_approval' });
    expect(r.decisions[0].reasons[0]).toMatch(/autonomous dispatch is not authorized/);
    expect((await getOutreachTaskById(ORG_A, outreachTaskFor(run)))?.status).toBe('awaiting_approval');
    expect(db.tables.outreach_internal_work_items ?? []).toHaveLength(0);
  });

  it('a channel with no engine is visible and stays ready; nothing is re-routed', async () => {
    const run = enrol(ORG_A, 'p-ready', validateWorkflowDefinition({ steps: [{ key: 'li', channel: 'linkedin', delay_after_previous_hours: 0, execution_mode: 'human' }] }));
    const r = await sweep();
    expect(r.unsupported).toEqual(['linkedin']);
    expect(r.decisions[0]).toMatchObject({ decision: 'unsupported' });
    expect(stepOf(run, 'li').state).toBe('ready');
  });
});

describe('WhatsApp engine adapter — idempotency, recovery and failure handling', () => {
  const waOnly = () => validateWorkflowDefinition({ steps: [DEFINITION.steps[1]] });

  it('two concurrent sweeps make ONE request and ONE broadcast', async () => {
    enrol(ORG_A, 'p-ready', waOnly());
    await Promise.all([sweep(), sweep(), sweep()]);
    expect(wa.broadcasts).toHaveLength(1);
    expect(wa.enqueued).toHaveLength(1);
  });

  it('repeated sweeps while the engine is sending never re-request', async () => {
    enrol(ORG_A, 'p-ready', waOnly());
    await sweep();
    await sweep();
    await sweep();
    expect(wa.broadcasts).toHaveLength(1);
  });

  it('an uncertain send is for a human and is never resent', async () => {
    const run = enrol(ORG_A, 'p-ready', waOnly());
    await sweep();
    engineSends('send_uncertain');
    const r = await sweep();
    expect(r.decisions[0]).toMatchObject({ decision: 'needs_human', outcome: 'send_uncertain' });
    expect(stepOf(run, 'wa-intro').state).toBe('ready');
    await sweep();
    expect(wa.broadcasts).toHaveLength(1);
  });

  it('a governance block inside the engine settles the step skipped', async () => {
    const run = enrol(ORG_A, 'p-ready', waOnly());
    await sweep();
    engineSends('blocked_governance');
    const r = await sweep();
    expect(r.decisions[0]).toMatchObject({ decision: 'skipped', outcome: 'blocked_governance' });
    expect(stepOf(run, 'wa-intro').state).toBe('skipped');
  });

  it('an enqueue refusal (e.g. template not approved) is for a human; no resubmission', async () => {
    enrol(ORG_A, 'p-ready', waOnly());
    wa.failEnqueue = 'template discovery_intro_v1 is not approved';
    const r = await sweep();
    expect(r.decisions[0]).toMatchObject({ decision: 'needs_human', outcome: 'submit_failed' });
    wa.failEnqueue = null;
    await sweep();
    expect(wa.broadcasts).toHaveLength(1);
    expect(wa.enqueued).toHaveLength(0);
  });

  it('a stale claim with NO broadcast is released and retried (nothing could have been sent)', async () => {
    enrol(ORG_A, 'p-ready', waOnly());
    const task = world.tasks[0].id;
    (db.tables.execution_engine_requests ??= []).push({ id: 'req-seeded', organization_id: ORG_A, execution_task_id: task, engine: 'whatsapp', state: 'submitting', external_ref: null, detail: null, updated_at: world.clock });
    world.clock = new Date(Date.parse(world.clock) + STALE_SUBMISSION_MS + 1000).toISOString();
    const r = await sweep();
    expect(r.decisions[0]).toMatchObject({ outcome: 'submitted' });
    expect(wa.broadcasts).toHaveLength(1);
  });

  it('a stale claim WITH a broadcast goes to a human — a second send is never risked', async () => {
    enrol(ORG_A, 'p-ready', waOnly());
    const task = world.tasks[0].id;
    (db.tables.execution_engine_requests ??= []).push({ id: 'req-seeded', organization_id: ORG_A, execution_task_id: task, engine: 'whatsapp', state: 'submitting', external_ref: null, detail: null, updated_at: world.clock });
    wa.broadcasts.push({ id: 'bc-orphan', org: ORG_A, name: broadcastNameFor(task), template: 'discovery_intro_v1' });
    world.clock = new Date(Date.parse(world.clock) + STALE_SUBMISSION_MS + 1000).toISOString();
    const r = await sweep();
    expect(r.decisions[0]).toMatchObject({ decision: 'needs_human', outcome: 'submission_interrupted' });
    expect(wa.broadcasts).toHaveLength(1);
  });

  it('a fresh claim held by another sweep waits', async () => {
    enrol(ORG_A, 'p-ready', waOnly());
    (db.tables.execution_engine_requests ??= []).push({ id: 'req-seeded', organization_id: ORG_A, execution_task_id: world.tasks[0].id, engine: 'whatsapp', state: 'submitting', external_ref: null, detail: null, updated_at: world.clock });
    const r = await sweep();
    expect(r.decisions[0]).toMatchObject({ decision: 'waiting', outcome: 'submitting' });
    expect(wa.broadcasts).toHaveLength(0);
  });

  it('a phone number not in E.164 form is skipped, never guessed', async () => {
    people['p-ready'].phone = '5551230001';
    const run = enrol(ORG_A, 'p-ready', waOnly());
    const r = await sweep();
    expect(r.decisions[0]).toMatchObject({ decision: 'skipped', outcome: 'no_e164_phone' });
    expect(stepOf(run, 'wa-intro').state).toBe('skipped');
  });
});

describe('tenant isolation and bounds', () => {
  it('a tenant sweep sees only its own journeys', async () => {
    enrol(ORG_B, 'p-ready');
    const r = await sweep(ORG_A);
    expect(r.counters.instances_scanned).toBe(0);
    expect(bridgeModule.__handoffs).toHaveLength(0);
  });

  it('a paused journey takes no action', async () => {
    enrol(ORG_A, 'p-ready');
    world.instances[0].lifecycleState = 'paused';
    const r = await sweep();
    expect(r.counters.instances_scanned).toBe(0);
    expect(bridgeModule.__handoffs).toHaveLength(0);
  });
});

describe('business intelligence — the journey report', () => {
  it('reports enrollment, journey states, step decisions, engine outcomes and objective attainment', async () => {
    const done = enrol(ORG_A, 'p-ready');
    enrol(ORG_A, 'p-nophone', validateWorkflowDefinition({ ...DEFINITION, steps: [DEFINITION.steps[1]] }));
    // Drive the first journey to completion as in the slice.
    await sweep();
    await approveOutreachTask(ORG_A, outreachTaskFor(done), { approverUserId: 'sdr-lead' });
    await sweep();
    world.clock = hoursAfter(world.clock, 25);
    await sweep();
    engineSends('sent');
    await sweep();
    await sweep();

    const report = await buildJourneyReport({ organizationId: ORG_A, workflowId: WORKFLOW_ID, now: world.clock });
    expect(report).not.toBeNull();
    const v = report!.versions[0];
    expect(v).toMatchObject({ workflowVersionId: 'version-1', enrolled: 2 });
    expect(v.journeys).toEqual({ completed: 2 });
    expect(v.steps.find((s) => s.stepKey === 'assign-sdr')!.states).toEqual({ completed: 1 });
    expect(v.steps.find((s) => s.stepKey === 'wa-intro')!.states).toEqual({ completed: 1, skipped: 1 });
    expect(v.engines.ws3).toEqual({ sent: 1 });
    expect(v.engines.whatsapp).toEqual({ completed: 1, not_requested: 1 });
    expect(v.attainment).toEqual({ reached: 2, rate: 1, target: 0.3, measured: true, note: null });
    expect(report!.notMeasured).toEqual(['cost — no engine records a per-action cost']);
  });

  it('another tenant cannot read this workflow\'s report', async () => {
    expect(await buildJourneyReport({ organizationId: ORG_B, workflowId: WORKFLOW_ID })).toBeNull();
  });
});

// ── Sweeper invariants carried over from the parked 041-A-I / 041-A-K suites,
//    which tested the email-engine routing this slice replaces with adapters. ──
import { listSweepableTenants, SWEEP_LIMITS } from '../../services/workflowExecution/workflowProgressionSweeper';

describe('sweeper invariants (from 041-A-I / 041-A-K)', () => {
  it('tenant discovery comes from enabled WS-3 configuration only', async () => {
    (db.tables.outreach_governance_config ??= []).push(
      { company_id: ORG_B, enabled: false, kill_switch: false, enabled_channels: [], restricted_regions: [] },
    );
    expect(await listSweepableTenants()).toEqual([ORG_A]);
  });

  it('the per-tenant task budget is a stated bound, not a silent truncation', async () => {
    enrol(ORG_A, 'p-ready');
    enrol(ORG_A, 'p-nophone');
    const r = await advanceAndDispatchWorkflowExecution(ORG_A, { now: world.clock, limit: 1, deps: { adapters: adapters(), intelligence } });
    expect(r.counters.tasks_seen).toBe(1);
    expect(r.workRemains).toBe(true);
    expect(SWEEP_LIMITS).toEqual({ tenants: 25, instancesPerTenant: 50, tasksPerTenant: 25, instanceWindowPerTenant: 1000 });
  });

  it('a step another actor already settled is CONVERGENCE, not an error, and is not overwritten', async () => {
    const run = enrol(ORG_A, 'p-nophone', validateWorkflowDefinition({ steps: [DEFINITION.steps[1]] }));
    // Promote it, then let "an operator" settle it before the sweeper does.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sp = require('../../services/workflowExecution/stepProgressionStore');
    await sp.advanceExecutionRun({ organizationId: ORG_A, executionInstanceId: run });
    const original = sp.transitionPlanStep;
    sp.transitionPlanStep = async (input: { stepId: string; state: string }) => {
      stepOf(run, 'wa-intro').state = 'cancelled';
      return original(input);
    };
    try {
      const r = await sweep();
      expect(r.counters.settlement_converged).toBe(1);
      expect(r.counters.errors).toBe(0);
      expect(stepOf(run, 'wa-intro').state).toBe('cancelled');
    } finally {
      sp.transitionPlanStep = original;
    }
  });

  it('an engine that throws leaves the step ready and is reported; nothing is settled failed', async () => {
    const run = enrol(ORG_A, 'p-ready', validateWorkflowDefinition({ steps: [DEFINITION.steps[0]] }));
    const exploding: EngineAdapter = { engine: 'ws3', channels: ['internal', 'email'], execute: async () => { throw Object.assign(new Error('boom'), { code: 'engine_down' }); } };
    const r = await advanceAndDispatchWorkflowExecution(ORG_A, { now: world.clock, deps: { adapters: [exploding, createWhatsAppAdapter(waDeps)], intelligence } });
    expect(r.counters.errors).toBe(1);
    expect(r.issues[0]).toMatchObject({ code: 'engine_down' });
    expect(stepOf(run, 'assign-sdr').state).toBe('ready');
    expect(world.transitions).toHaveLength(0);
  });
});
