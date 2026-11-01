/**
 * ORCHESTRATION — LISTS AND CAMPAIGN TARGETS.
 *
 * A tenant selects a population (canonical prospect lists attached to a
 * campaign), the campaign records WHO it targeted as immutable targets, and the
 * eligible individuals are enrolled into a workflow's published version.
 *
 * What is REAL here: the canonical list module and its production store, the
 * campaign targeting / attachment / target stores, the ICP evidence reader, the
 * selection service, the ICP list evaluator, campaign enrollment, enrollment
 * eligibility, the journey policy and the execution instance store.
 *
 * What is modelled: the database, as a strict in-memory PostgREST double that
 * enforces what 20261127000000 / 20261228000000 / 20261231000000 enforce —
 * the active-membership partial unique index, the composite tenant foreign keys,
 * the targets' unique selection key and UPDATE refusal, the campaign targeting
 * guard (ratified ICP only; frozen once targets exist), and
 * `create_execution_instance` (published-version pin, occupied-journey unique
 * index, target tenant FK, `targets_not_installed`). The plan store and the
 * journey report's engine reads are stubbed; their own suites cover them.
 *
 * NO real database is reached. These are not real-schema results.
 */

type Row = Record<string, unknown>;

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_A = 'a0000000-0000-4000-8000-00000000000a';

const db = {
  tables: {} as Record<string, Row[]>,
  seq: 1,
  tick: 0,
  /** false = 20261231000000 has not run. */
  targetingInstalled: true,
  /** Called inside create_execution_instance just before the insert (races, publishes). */
  beforeCreate: null as null | ((args: Row) => void),
  rpcCalls: [] as string[],
};
const uuid = (): string => `00000000-0000-4000-8000-${String(db.seq++).padStart(12, '0')}`;
const stamp = (): string => new Date(Date.parse('2026-10-28T09:00:00.000Z') + (db.tick++) * 1000).toISOString();
const rowsOf = (t: string): Row[] => (db.tables[t] ??= []);
const err = (code: string, message: string) => ({ data: null, error: { code, message } });

const TARGETING_COLUMNS = ['targeting_mode', 'icp_id', 'icp_version', 'min_icp_score'];
const TARGETING_TABLES = ['prospect_campaign_lists', 'prospect_campaign_targets'];

/** The constraints of the migrations, checked on insert. */
function insertViolation(table: string, r: Row): { code: string; message: string } | null {
  const inOrg = (t: string, id: unknown, orgCol = 'organization_id') =>
    rowsOf(t).some((x) => x.id === id && x[orgCol] === r.organization_id);
  if (table === 'prospect_list_members') {
    if (!inOrg('prospect_lists', r.list_id)) return { code: '23503', message: 'prospect_list_members_list_tenant_fk' };
    if (rowsOf(table).some((x) => x.organization_id === r.organization_id && x.list_id === r.list_id
      && x.prospect_id === r.prospect_id && x.status === 'active')) {
      return { code: '23505', message: 'uq_prospect_list_members_active' };
    }
  }
  if (table === 'prospect_campaign_lists') {
    if (!inOrg('prospect_campaigns', r.campaign_id) || !inOrg('prospect_lists', r.list_id)) {
      return { code: '23503', message: 'prospect_campaign_lists tenant fk' };
    }
    if (rowsOf(table).some((x) => x.organization_id === r.organization_id && x.campaign_id === r.campaign_id && x.list_id === r.list_id)) {
      return { code: '23505', message: 'uq_prospect_campaign_lists' };
    }
  }
  if (table === 'prospect_campaign_targets') {
    if (!inOrg('prospect_campaigns', r.campaign_id) || !inOrg('prospect_lists', r.list_id)
      || !inOrg('canonical_leads', r.prospect_id, 'company_id')) {
      return { code: '23503', message: 'prospect_campaign_targets tenant fk' };
    }
    if (r.icp_id != null && !rowsOf('prospect_icp_versions').some((v) => v.organization_id === r.organization_id
      && v.icp_id === r.icp_id && v.version === r.icp_version)) {
      return { code: '23503', message: 'prospect_campaign_targets_icp_version_tenant_fk' };
    }
    if (r.score_evaluation_id != null && !inOrg('prospect_score_evaluations', r.score_evaluation_id)) {
      return { code: '23503', message: 'prospect_campaign_targets_score_evaluation_tenant_fk' };
    }
    if (rowsOf(table).some((x) => ['organization_id', 'campaign_id', 'list_id', 'prospect_id', 'selection_event_key'].every((k) => x[k] === r[k]))) {
      return { code: '23505', message: 'uq_prospect_campaign_targets_selection' };
    }
  }
  return null;
}

/** The guard triggers and FKs, checked on update. */
function updateViolation(table: string, affected: Row[], p: Row): { code: string; message: string } | null {
  if (table === 'prospect_campaign_targets') return { code: '23514', message: 'prospect_campaign_targets: a selection fact is immutable' };
  if (table === 'prospect_lists' && p.icp_id != null) {
    for (const r of affected) {
      if (!rowsOf('prospect_icps').some((i) => i.id === p.icp_id && i.organization_id === r.organization_id)) {
        return { code: '23503', message: 'insert or update on table "prospect_lists" violates foreign key constraint "prospect_lists_icp_tenant_fk"' };
      }
    }
  }
  if (table === 'prospect_campaigns' && TARGETING_COLUMNS.some((c) => c in p)) {
    for (const r of affected) {
      if (p.targeting_mode === 'icp') {
        const v = rowsOf('prospect_icp_versions').find((x) => x.organization_id === r.organization_id && x.icp_id === p.icp_id && x.version === p.icp_version);
        if (!v) return { code: '23503', message: 'prospect_campaigns_icp_version_tenant_fk' };
        if (v.status !== 'ratified') return { code: '23514', message: 'campaign_icp_not_ratified: an ICP campaign must be pinned to a ratified ICP version' };
      }
      const changed = TARGETING_COLUMNS.some((c) => (p[c] ?? null) !== (r[c] ?? null));
      if (changed && rowsOf('prospect_campaign_targets').some((t) => t.organization_id === r.organization_id && t.campaign_id === r.id)) {
        return { code: '23514', message: 'campaign_targeting_locked: this campaign has selected targets under its current targeting' };
      }
    }
  }
  return null;
}

const DEFAULTS: Record<string, () => Row> = {
  prospect_lists: () => ({ status: 'active', description: null, icp_id: null, created_at: stamp(), updated_at: stamp() }),
  prospect_list_members: () => ({ status: 'active', added_at: stamp(), removed_at: null, removed_by_user_id: null, removal_reason: null }),
  prospect_campaign_lists: () => ({ attached_at: stamp() }),
  prospect_campaign_targets: () => ({ selected_at: stamp() }),
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete',
      cols: '',
      filters: [] as Array<(r: Row) => boolean>,
      payload: null as Row | null,
      orders: [] as Array<[string, boolean]>,
      limit: Infinity,
    };
    const exec = async (mode: 'many' | 'maybe' | 'single') => {
      await Promise.resolve();
      if (!db.targetingInstalled) {
        if (TARGETING_TABLES.includes(table)) return err('42P01', `relation "${table}" does not exist`);
        if (['prospect_campaigns', 'prospect_lists'].includes(table)) {
          if (TARGETING_COLUMNS.some((c) => st.cols.includes(c))) return err('42703', 'column does not exist');
          if (st.payload && TARGETING_COLUMNS.some((c) => c in (st.payload as Row))) return err('PGRST204', 'column not found in schema cache');
        }
      }
      if (st.op === 'insert') {
        const row = { ...(DEFAULTS[table]?.() ?? {}), ...(st.payload as Row) };
        const v = insertViolation(table, row);
        if (v) return { data: null, error: v };
        const created = { id: uuid(), ...row };
        rowsOf(table).push(created);
        return { data: { ...created }, error: null };
      }
      const matched = rowsOf(table).filter((r) => st.filters.every((f) => f(r)));
      if (st.op === 'update') {
        const v = updateViolation(table, matched, st.payload as Row);
        if (v) return { data: null, error: v };
        for (const r of matched) Object.assign(r, st.payload);
      }
      if (st.op === 'delete') db.tables[table] = rowsOf(table).filter((r) => !matched.includes(r));
      let out = matched.map((r) => ({ ...r }));
      for (const [col, asc] of [...st.orders].reverse()) {
        out = out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      out = out.slice(0, st.limit);
      if (mode === 'many') return { data: out, error: null };
      if (mode === 'single' && out.length !== 1) return err('PGRST116', 'not exactly one row');
      return { data: out[0] ?? null, error: null };
    };
    const b: Record<string, unknown> = {
      select: (cols = '*') => { st.cols = String(cols); return b; },
      insert: (row: Row) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Row) => { st.op = 'update'; st.payload = row; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (c: string, v: unknown) => { st.filters.push((r) => r[c] === v); return b; },
      in: (c: string, v: unknown[]) => { st.filters.push((r) => v.includes(r[c])); return b; },
      is: (c: string, v: unknown) => { st.filters.push((r) => (r[c] ?? null) === v); return b; },
      // The canonical store's keyset cursor is the only `.or` it sends.
      or: (expr: string) => {
        const m = /^added_at\.lt\.([^,]+),and\(added_at\.eq\.([^,]+),id\.lt\.([^)]+)\)$/.exec(expr);
        if (!m) throw new Error(`double: unsupported or(${expr})`);
        st.filters.push((r) => String(r.added_at) < m[1] || (String(r.added_at) === m[2] && String(r.id) < m[3]));
        return b;
      },
      order: (c: string, o?: { ascending?: boolean }) => { st.orders.push([c, o?.ascending !== false]); return b; },
      limit: (n: number) => { st.limit = n; return b; },
      maybeSingle: () => exec('maybe'),
      single: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

const OCCUPIED = ['created', 'queued', 'active', 'paused'];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    // `create_execution_instance`, in 20261228000000's check order (verified
    // against real PostgreSQL 2026-10-28): campaign, workflow, SUBJECT, then the
    // target — one `target_mismatch` for every disagreement, another tenant's
    // target included, so no caller learns whether a foreign target exists.
    rpc: async (fn: string, a: Row) => {
      await Promise.resolve();
      db.rpcCalls.push(fn);
      if (fn !== 'create_execution_instance') return err('42883', `double: no function ${fn}`);
      const org = a.p_organization_id;
      if (!rowsOf('prospect_campaigns').some((c) => c.id === a.p_campaign_id && c.organization_id === org)) return err('P0001', 'ei_create:campaign_not_found');
      const wf = rowsOf('workflows').find((w) => w.id === a.p_workflow_id && w.organization_id === org);
      if (!wf) return err('P0001', 'ei_create:workflow_not_found');
      if (wf.status === 'archived') return err('P0001', 'ei_create:workflow_not_active');
      if (!rowsOf('canonical_leads').some((l) => l.id === a.p_subject_id && l.company_id === org)) return err('P0002', 'ei_create:subject_not_found');
      if (a.p_target_id != null) {
        if (!db.targetingInstalled) return err('23514', 'ei_create:targets_not_installed');
        const t = rowsOf('prospect_campaign_targets').find((x) => x.id === a.p_target_id && x.organization_id === org
          && x.campaign_id === a.p_campaign_id && x.prospect_id === a.p_subject_id);
        if (!t) return err('23514', 'ei_create:target_mismatch');
      }
      db.beforeCreate?.(a);
      if (!wf.current_version_id) return err('P0001', 'ei_create:no_published_version');
      if (rowsOf('execution_instances').some((i) => i.organization_id === org && i.campaign_id === a.p_campaign_id
        && i.workflow_id === a.p_workflow_id && i.subject_kind === a.p_subject_kind && i.subject_id === a.p_subject_id
        && OCCUPIED.includes(String(i.lifecycle_state)))) {
        return err('23505', 'duplicate key value violates unique constraint "uq_execution_instances_active"');
      }
      const id = uuid();
      const at = stamp();
      rowsOf('execution_instances').push({
        id, organization_id: org, campaign_id: a.p_campaign_id, workflow_id: a.p_workflow_id,
        workflow_version_id: wf.current_version_id, target_id: a.p_target_id ?? null,
        subject_kind: a.p_subject_kind, subject_id: a.p_subject_id, lifecycle_state: 'created', created_at: at, updated_at: at,
      });
      return { data: id, error: null };
    },
  },
}));

// The published definition per version id; `current_version_id` on the workflow row is "published".
const definitions = new Map<string, Row>();
const versionRow = (orgId: string, workflowId: string, id: string, n: number) => ({
  id, organizationId: orgId, workflowId, version: n, status: 'published',
  definition: definitions.get(id), createdBy: null, createdAt: '', updatedAt: '', publishedAt: '', publishedBy: null,
});
jest.mock('../../services/workflows/workflowStore', () => ({
  getCurrentWorkflowVersion: async (org: string, workflowId: string) => {
    const wf = rowsOf('workflows').find((w) => w.id === workflowId && w.organization_id === org);
    if (!wf?.current_version_id) return null;
    return versionRow(org, workflowId, String(wf.current_version_id), Number(wf.current_version));
  },
  getWorkflow: async (org: string, workflowId: string) => {
    const wf = rowsOf('workflows').find((w) => w.id === workflowId && w.organization_id === org);
    return wf ? { id: wf.id, name: wf.name } : null;
  },
  listWorkflowVersions: async (org: string, workflowId: string) =>
    rowsOf('workflow_versions').filter((v) => v.organization_id === org && v.workflow_id === workflowId)
      .map((v) => versionRow(org, workflowId, String(v.id), Number(v.version))),
}));

const plans = new Map<string, { id: string; organizationId: string }>();
jest.mock('../../services/executionPlans/executionPlanStore', () => ({
  createExecutionPlan: async ({ organizationId, executionInstanceId }: { organizationId: string; executionInstanceId: string }) => {
    if (plans.has(executionInstanceId)) throw Object.assign(new Error('that run already has a plan'), { code: 'plan_exists' });
    const plan = { id: uuid(), organizationId };
    plans.set(executionInstanceId, plan);
    return plan;
  },
  getPlanForInstance: async (_org: string, instanceId: string) => plans.get(instanceId) ?? null,
  listInstanceTasks: async () => [],
}));
jest.mock('../../services/workflowExecution/stepProgressionStore', () => ({ listProgressionSteps: async () => [] }));
jest.mock('../../services/outreachBridge/outreachBridgeStore', () => ({ listInstanceHandoffs: async () => [] }));
jest.mock('../../services/leadOutreachExecution', () => ({ getOutreachTaskById: async () => null, outcomeTypesFor: async () => [] }));
jest.mock('../../services/orchestration/whatsappEngineAdapter', () => ({ ENGINE_REQUESTS_TABLE: 'execution_engine_requests' }));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import {
  createProspectList, addProspectToList, removeProspectFromList, addProspectToListBySystem,
  removeProspectFromListBySystem, listMembers, updateProspectList,
} from '../../services/prospectLists';
import { productionListStore as store } from '../../services/prospectLists/store';
import { evaluateIcpList, EVALUATOR_ADDED_VIA, IcpListEvaluationError } from '../../services/prospectLists/icpListEvaluator';
import {
  getCampaignTargeting, setCampaignTargeting, getProspectCampaign, ProspectCampaignError,
} from '../../services/prospectCampaigns/prospectCampaignStore';
import {
  attachListToCampaign, detachListFromCampaign, listCampaignListAttachments, CampaignListError,
} from '../../services/prospectCampaigns/campaignListStore';
import {
  createCampaignTarget, listCampaignTargets, buildSelectionEventKey, CampaignTargetError,
} from '../../services/prospectCampaigns/campaignTargetStore';
import { selectCampaignTargets, CampaignSelectionError } from '../../services/prospectCampaigns/campaignSelectionService';
import { enrollCampaignTargets, CampaignEnrollmentError } from '../../services/orchestration/campaignEnrollment';
import { createExecutionInstance, ExecutionInstanceError } from '../../services/executionInstances/executionInstanceStore';
import { buildJourneyReport } from '../../services/orchestration/journeyReport';
import type { IndividualIntelligencePort } from '../../services/orchestration/individualIntelligence';

// ── Fixtures ────────────────────────────────────────────────────────────────

function seedCampaign(org: string, status = 'active'): string {
  const id = uuid();
  rowsOf('prospect_campaigns').push({
    id, organization_id: org, name: `c-${id.slice(-4)}`, description: null, status,
    targeting_mode: 'manual', icp_id: null, icp_version: null, min_icp_score: null, created_at: stamp(), updated_at: stamp(),
  });
  return id;
}
function seedProspects(org: string, n: number): string[] {
  return Array.from({ length: n }, () => {
    const id = uuid();
    rowsOf('canonical_leads').push({ id, company_id: org });
    return id;
  });
}
function seedIcp(org: string, versions: Array<'ratified' | 'superseded' | 'draft' | 'proposed'>): string {
  const icpId = uuid();
  rowsOf('prospect_icps').push({ id: icpId, organization_id: org });
  versions.forEach((status, i) => rowsOf('prospect_icp_versions').push({ id: uuid(), organization_id: org, icp_id: icpId, version: i + 1, status }));
  return icpId;
}
function seedEvaluation(org: string, prospectId: string, icpId: string, version: number, scoreIcp: number): string {
  const id = uuid();
  rowsOf('prospect_score_evaluations').push({ id, organization_id: org, prospect_id: prospectId, icp_id: icpId, icp_version: version, score_icp: scoreIcp, evaluated_at: stamp() });
  return id;
}
async function seedList(org: string, members: string[], name = 'list'): Promise<string> {
  const list = await createProspectList(store, { organizationId: org, name: `${name}-${db.seq}`, actorUserId: USER_A });
  if (list.ok === false) throw new Error(`fixture list: ${list.refusal}`);
  for (const prospectId of members) {
    const r = await addProspectToList(store, { organizationId: org, listId: list.value.id, prospectId, addedVia: 'manual', actorUserId: USER_A });
    if (r.ok === false) throw new Error(`fixture member: ${r.refusal}`);
  }
  return list.value.id;
}
function seedWorkflow(org: string, definition: Row = { steps: [{ key: 's1', channel: 'internal' }] }, status = 'active'): string {
  const id = uuid();
  rowsOf('workflows').push({ id, organization_id: org, name: `wf-${id.slice(-4)}`, status, current_version_id: null, current_version: 0 });
  publish(org, id, definition);
  return id;
}
function publish(org: string, workflowId: string, definition: Row): string {
  const wf = rowsOf('workflows').find((w) => w.id === workflowId) as Row;
  const versionId = uuid();
  const n = Number(wf.current_version) + 1;
  definitions.set(versionId, definition);
  rowsOf('workflow_versions').push({ id: versionId, organization_id: org, workflow_id: workflowId, version: n });
  wf.current_version_id = versionId;
  wf.current_version = n;
  return versionId;
}
const instances = () => rowsOf('execution_instances');

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try { await p; } catch (e) { return String((e as { code?: string }).code); }
  return 'resolved';
};

beforeEach(() => {
  db.tables = {};
  db.targetingInstalled = true;
  db.beforeCreate = null;
  db.rpcCalls = [];
  definitions.clear();
  plans.clear();
});

// ── Lists: manual / intake lists need no ICP; removal history is kept ─────────

describe('canonical lists — manual and intake lists exist without an ICP', () => {
  it('a manual list has no ICP and still feeds a manual campaign', async () => {
    const [p1, p2] = seedProspects(ORG_A, 2);
    const listId = await seedList(ORG_A, [p1, p2]);
    expect(await store.getListIcp(ORG_A, listId)).toBeNull();
    const campaignId = seedCampaign(ORG_A);
    await attachListToCampaign({ organizationId: ORG_A, campaignId, listId, actorUserId: USER_A });
    const report = await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'k1', origin: 'human', actorUserId: USER_A });
    expect(report.targeting.mode).toBe('manual');
    expect(report.selected).toBe(2);
    expect(report.created).toBe(2);
  });

  it('an intake list (system provenance) needs no ICP either', async () => {
    const [p1] = seedProspects(ORG_A, 1);
    const listId = await seedList(ORG_A, []);
    const r = await addProspectToListBySystem(store, { organizationId: ORG_A, listId, prospectId: p1, addedVia: 'evaluator:intake' });
    expect(r.ok).toBe(true);
    expect(await store.getListIcp(ORG_A, listId)).toBeNull();
  });

  it('system writes must carry evaluator provenance — the system path is not a second writer', async () => {
    const [p1] = seedProspects(ORG_A, 1);
    const listId = await seedList(ORG_A, []);
    const add = await addProspectToListBySystem(store, { organizationId: ORG_A, listId, prospectId: p1, addedVia: 'manual' });
    expect(add.ok).toBe(false);
    const rm = await removeProspectFromListBySystem(store, { organizationId: ORG_A, listId, prospectId: p1, removalReason: 'because' });
    expect(rm.ok).toBe(false);
  });

  it('removal is soft and a re-add is a NEW row — history is never rewritten', async () => {
    const [p1] = seedProspects(ORG_A, 1);
    const listId = await seedList(ORG_A, [p1]);
    await removeProspectFromList(store, { organizationId: ORG_A, listId, prospectId: p1, removalReason: 'not now', actorUserId: USER_A });
    await addProspectToList(store, { organizationId: ORG_A, listId, prospectId: p1, addedVia: 'manual', actorUserId: USER_A });
    const rows = rowsOf('prospect_list_members').filter((r) => r.list_id === listId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.status).sort()).toEqual(['active', 'removed']);
    const removed = rows.find((r) => r.status === 'removed') as Row;
    expect(removed.removed_by_user_id).toBe(USER_A);
    expect(removed.removal_reason).toBe('not now');
  });
});

// ── Campaign targeting: ICP campaigns require a valid ICP association ─────────

describe('campaign targeting — an ICP campaign must name a ratified ICP version of its tenant', () => {
  it('manual campaigns name no ICP', async () => {
    const campaignId = seedCampaign(ORG_A);
    const icpId = seedIcp(ORG_A, ['ratified']);
    expect(await codeOf(setCampaignTargeting({ organizationId: ORG_A, campaignId, mode: 'manual', icpId }))).toBe('manual_campaign_has_icp');
    const t = await setCampaignTargeting({ organizationId: ORG_A, campaignId, mode: 'manual' });
    expect(t).toMatchObject({ mode: 'manual', icpId: null, icpVersion: null, minIcpScore: null });
  });

  it('an ICP campaign pinned to a ratified version is accepted', async () => {
    const campaignId = seedCampaign(ORG_A);
    const icpId = seedIcp(ORG_A, ['ratified']);
    const t = await setCampaignTargeting({ organizationId: ORG_A, campaignId, mode: 'icp', icpId, icpVersion: 1, minIcpScore: 0.6 });
    expect(t).toMatchObject({ mode: 'icp', icpId, icpVersion: 1, minIcpScore: 0.6 });
    expect(await getCampaignTargeting(ORG_A, campaignId)).toEqual(t);
  });

  it.each([
    ['no icpId', { icpVersion: 1 }, 'icp_required'],
    ['no version', { icpId: '11111111-1111-4111-8111-111111111111' }, 'icp_version_required'],
    ['version 0', { icpId: '11111111-1111-4111-8111-111111111111', icpVersion: 0 }, 'icp_version_required'],
    ['score above 1', { icpId: '11111111-1111-4111-8111-111111111111', icpVersion: 1, minIcpScore: 1.5 }, 'invalid_min_icp_score'],
  ])('invalid ICP configuration is refused explicitly (%s)', async (_label, extra, code) => {
    const campaignId = seedCampaign(ORG_A);
    expect(await codeOf(setCampaignTargeting({ organizationId: ORG_A, campaignId, mode: 'icp', ...extra }))).toBe(code);
  });

  it.each(['draft', 'proposed', 'superseded'] as const)('a %s ICP version is refused (campaign_icp_not_ratified)', async (status) => {
    const campaignId = seedCampaign(ORG_A);
    const icpId = seedIcp(ORG_A, [status]);
    expect(await codeOf(setCampaignTargeting({ organizationId: ORG_A, campaignId, mode: 'icp', icpId, icpVersion: 1 }))).toBe('campaign_icp_not_ratified');
  });

  it('a missing ICP version, or another tenant\'s, is refused (icp_version_not_found)', async () => {
    const campaignId = seedCampaign(ORG_A);
    const foreignIcp = seedIcp(ORG_B, ['ratified']);
    expect(await codeOf(setCampaignTargeting({ organizationId: ORG_A, campaignId, mode: 'icp', icpId: foreignIcp, icpVersion: 1 }))).toBe('icp_version_not_found');
    const ownIcp = seedIcp(ORG_A, ['ratified']);
    expect(await codeOf(setCampaignTargeting({ organizationId: ORG_A, campaignId, mode: 'icp', icpId: ownIcp, icpVersion: 9 }))).toBe('icp_version_not_found');
  });

  it('another tenant cannot read or change a campaign\'s targeting', async () => {
    const campaignId = seedCampaign(ORG_A);
    expect(await getCampaignTargeting(ORG_B, campaignId)).toBeNull();
    expect(await setCampaignTargeting({ organizationId: ORG_B, campaignId, mode: 'manual' })).toBeNull();
  });

  it('targeting is frozen once the campaign has selected targets', async () => {
    const [p1] = seedProspects(ORG_A, 1);
    const campaignId = seedCampaign(ORG_A);
    const listId = await seedList(ORG_A, [p1]);
    await attachListToCampaign({ organizationId: ORG_A, campaignId, listId, actorUserId: USER_A });
    await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'k1', origin: 'human', actorUserId: USER_A });
    const icpId = seedIcp(ORG_A, ['ratified']);
    expect(await codeOf(setCampaignTargeting({ organizationId: ORG_A, campaignId, mode: 'icp', icpId, icpVersion: 1 }))).toBe('campaign_targeting_locked');
    // Re-stating the same targeting is not a change.
    expect(await setCampaignTargeting({ organizationId: ORG_A, campaignId, mode: 'manual' })).toMatchObject({ mode: 'manual' });
  });

  it('campaign reads keep working where 20261231000000 has not run; targeting refuses explicitly', async () => {
    const campaignId = seedCampaign(ORG_A);
    db.targetingInstalled = false;
    expect(await getProspectCampaign(ORG_A, campaignId)).toMatchObject({ id: campaignId });
    expect(await codeOf(getCampaignTargeting(ORG_A, campaignId))).toBe('targeting_schema_missing');
    expect(await codeOf(setCampaignTargeting({ organizationId: ORG_A, campaignId, mode: 'manual' }))).toBe('targeting_schema_missing');
    expect(ProspectCampaignError).toBeDefined();
  });
});

// ── Attachments ─────────────────────────────────────────────────────────────

describe('campaign × list attachment', () => {
  it('is idempotent and detachable', async () => {
    const campaignId = seedCampaign(ORG_A);
    const listId = await seedList(ORG_A, []);
    expect((await attachListToCampaign({ organizationId: ORG_A, campaignId, listId, actorUserId: USER_A })).created).toBe(true);
    expect((await attachListToCampaign({ organizationId: ORG_A, campaignId, listId, actorUserId: USER_A })).created).toBe(false);
    expect(await listCampaignListAttachments(ORG_A, campaignId)).toHaveLength(1);
    expect(await detachListFromCampaign({ organizationId: ORG_A, campaignId, listId })).toBe(true);
    expect(await detachListFromCampaign({ organizationId: ORG_A, campaignId, listId })).toBe(false);
  });

  it('refuses another tenant\'s list or campaign (not_found), and a missing schema explicitly', async () => {
    const campaignId = seedCampaign(ORG_A);
    const foreignList = await seedList(ORG_B, []);
    expect(await codeOf(attachListToCampaign({ organizationId: ORG_A, campaignId, listId: foreignList, actorUserId: USER_A }))).toBe('not_found');
    const ownList = await seedList(ORG_A, []);
    expect(await codeOf(attachListToCampaign({ organizationId: ORG_B, campaignId, listId: ownList, actorUserId: USER_A }))).toBe('not_found');
    db.targetingInstalled = false;
    expect(await codeOf(attachListToCampaign({ organizationId: ORG_A, campaignId, listId: ownList, actorUserId: USER_A }))).toBe('targeting_schema_missing');
    expect(CampaignListError).toBeDefined();
  });
});

// ── Targets: immutable, idempotent per occurrence, tenant-bound ───────────────

describe('campaign targets', () => {
  it('a retry of one occurrence re-finds the same target; a new key is a new selection', async () => {
    const [p1] = seedProspects(ORG_A, 1);
    const campaignId = seedCampaign(ORG_A);
    const listId = await seedList(ORG_A, [p1]);
    const base = { organizationId: ORG_A, campaignId, listId, prospectId: p1, origin: 'human' as const, actorUserId: USER_A, icpId: null, icpVersion: null, scoreEvaluationId: null };
    const first = await createCampaignTarget({ ...base, selectionEventKey: buildSelectionEventKey('human', 'k1') });
    const again = await createCampaignTarget({ ...base, selectionEventKey: buildSelectionEventKey('human', 'k1') });
    expect(first.created).toBe(true);
    expect(again).toEqual({ target: first.target, created: false });
    const other = await createCampaignTarget({ ...base, selectionEventKey: buildSelectionEventKey('human', 'k2') });
    expect(other.created).toBe(true);
    expect(await listCampaignTargets(ORG_A, campaignId)).toHaveLength(2);
    expect(await listCampaignTargets(ORG_A, campaignId, { selectionEventKey: 'human:k1' })).toHaveLength(1);
  });

  it('refuses a prospect, list or campaign of another tenant (cross_tenant_or_missing_reference)', async () => {
    const [foreignProspect] = seedProspects(ORG_B, 1);
    const campaignId = seedCampaign(ORG_A);
    const listId = await seedList(ORG_A, []);
    expect(await codeOf(createCampaignTarget({
      organizationId: ORG_A, campaignId, listId, prospectId: foreignProspect, selectionEventKey: 'human:k1',
      origin: 'human', actorUserId: USER_A, icpId: null, icpVersion: null, scoreEvaluationId: null,
    }))).toBe('cross_tenant_or_missing_reference');
  });

  it('a human selection names its actor; a derived one names none', async () => {
    const [p1] = seedProspects(ORG_A, 1);
    const campaignId = seedCampaign(ORG_A);
    const listId = await seedList(ORG_A, [p1]);
    const base = { organizationId: ORG_A, campaignId, listId, prospectId: p1, selectionEventKey: 'derived:k', icpId: null, icpVersion: null, scoreEvaluationId: null };
    expect(await codeOf(createCampaignTarget({ ...base, origin: 'human', actorUserId: null }))).toBe('origin_actor_mismatch');
    expect(await codeOf(createCampaignTarget({ ...base, origin: 'derived', actorUserId: USER_A }))).toBe('origin_actor_mismatch');
    expect(() => buildSelectionEventKey('human', 'has space')).toThrow(CampaignTargetError);
  });

  it('is not installed until 20261231000000 runs — explicit, not silent', async () => {
    const campaignId = seedCampaign(ORG_A);
    db.targetingInstalled = false;
    expect(await codeOf(listCampaignTargets(ORG_A, campaignId))).toBe('targets_schema_missing');
  });
});

// ── Selection: population, eligibility, exclusion reasons, preview ────────────

describe('selection — who the campaign targets, with every exclusion explained', () => {
  async function icpCampaign(minIcpScore: number | null) {
    const ps = seedProspects(ORG_A, 4);
    const icpId = seedIcp(ORG_A, ['ratified']);
    seedEvaluation(ORG_A, ps[0], icpId, 1, 0.9);
    seedEvaluation(ORG_A, ps[1], icpId, 1, 0.4);
    // ps[2] is evaluated under ANOTHER ICP only — not evidence for this one.
    seedEvaluation(ORG_A, ps[2], seedIcp(ORG_A, ['ratified']), 1, 0.99);
    // ps[3] is never evaluated.
    const campaignId = seedCampaign(ORG_A);
    await setCampaignTargeting({ organizationId: ORG_A, campaignId, mode: 'icp', icpId, icpVersion: 1, minIcpScore });
    const listId = await seedList(ORG_A, ps);
    await attachListToCampaign({ organizationId: ORG_A, campaignId, listId, actorUserId: USER_A });
    return { ps, icpId, campaignId, listId };
  }

  it('an ICP campaign selects only people evaluated under its pinned version, at or above the minimum', async () => {
    const { ps, campaignId } = await icpCampaign(0.5);
    const r = await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'k1', origin: 'human', actorUserId: USER_A });
    expect(r.population).toBe(4);
    expect(r.selected).toBe(1);
    expect(r.excluded).toEqual({ not_evaluated_under_icp: 2, below_min_icp_score: 1, list_archived: 0, list_not_found: 0 });
    const targets = await listCampaignTargets(ORG_A, campaignId);
    expect(targets.map((t) => t.prospectId)).toEqual([ps[0]]);
    expect(targets[0]).toMatchObject({ icpVersion: 1, origin: 'human', actorUserId: USER_A });
    expect(targets[0].scoreEvaluationId).not.toBeNull();
  });

  it('preview (dryRun) reports the same population and reasons and writes nothing', async () => {
    const { ps, campaignId } = await icpCampaign(0.5);
    const r = await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'k1', origin: 'human', actorUserId: USER_A, dryRun: true });
    expect(r).toMatchObject({ dryRun: true, population: 4, selected: 1, created: 0, reused: 0 });
    expect(r.excluded.not_evaluated_under_icp).toBe(2);
    expect(r.preview.map((p) => p.prospectId)).toEqual([ps[0]]);
    expect(rowsOf('prospect_campaign_targets')).toHaveLength(0);
  });

  it('repeating a selection occurrence creates no duplicates', async () => {
    const { campaignId } = await icpCampaign(null);
    const first = await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'k1', origin: 'human', actorUserId: USER_A });
    const again = await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'k1', origin: 'human', actorUserId: USER_A });
    expect(first).toMatchObject({ selected: 2, created: 2, reused: 0 });
    expect(again).toMatchObject({ selected: 2, created: 0, reused: 2 });
    expect(rowsOf('prospect_campaign_targets')).toHaveLength(2);
  });

  it('removed members, archived lists and vanished lists are not selected, and are reported', async () => {
    const [p1, p2] = seedProspects(ORG_A, 2);
    const campaignId = seedCampaign(ORG_A);
    const live = await seedList(ORG_A, [p1, p2]);
    await removeProspectFromList(store, { organizationId: ORG_A, listId: live, prospectId: p2, actorUserId: USER_A });
    const archived = await seedList(ORG_A, [p1]);
    for (const listId of [live, archived]) await attachListToCampaign({ organizationId: ORG_A, campaignId, listId, actorUserId: USER_A });
    const upd = await updateProspectList(store, { organizationId: ORG_A, listId: archived, status: 'archived', actorUserId: USER_A } as never);
    expect(upd.ok).toBe(true);
    const r = await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'k1', origin: 'human', actorUserId: USER_A });
    expect(r.selected).toBe(1);
    expect(r.excluded.list_archived).toBe(1);
    expect(r.lists.find((l) => l.listId === archived)?.skipped).toBe('list_archived');
  });

  it('an ICP whose pinned version was superseded after pinning still selects under that version', async () => {
    const { campaignId, icpId } = await icpCampaign(null);
    (rowsOf('prospect_icp_versions').find((v) => v.icp_id === icpId) as Row).status = 'superseded';
    const r = await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'k1', origin: 'human', actorUserId: USER_A });
    expect(r.selected).toBe(2);
  });

  it('an ICP version that was never ratified stops selection explicitly', async () => {
    const { campaignId, icpId } = await icpCampaign(null);
    (rowsOf('prospect_icp_versions').find((v) => v.icp_id === icpId) as Row).status = 'draft';
    expect(await codeOf(selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'k1', origin: 'human', actorUserId: USER_A }))).toBe('campaign_icp_not_ratified');
  });

  it('another tenant cannot select a campaign\'s targets', async () => {
    const { campaignId } = await icpCampaign(null);
    expect(await codeOf(selectCampaignTargets({ organizationId: ORG_B, campaignId, selectionKey: 'k1', origin: 'human', actorUserId: USER_A }))).toBe('campaign_not_found');
    expect(rowsOf('prospect_campaign_targets')).toHaveLength(0);
  });

  it('an archived campaign selects no one', async () => {
    const campaignId = seedCampaign(ORG_A, 'archived');
    expect(await codeOf(selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'k1', origin: 'human', actorUserId: USER_A }))).toBe('campaign_archived');
    expect(CampaignSelectionError).toBeDefined();
  });
});

// ── ICP list evaluator: ported onto canonical rows; people's decisions win ────

describe('ICP list evaluator', () => {
  async function icpList() {
    const ps = seedProspects(ORG_A, 3);
    const icpId = seedIcp(ORG_A, ['superseded', 'ratified']);
    seedEvaluation(ORG_A, ps[0], icpId, 2, 0.8);
    seedEvaluation(ORG_A, ps[1], icpId, 2, 0.7);
    seedEvaluation(ORG_A, ps[2], icpId, 1, 0.9);   // only under the superseded version
    const listId = await seedList(ORG_A, []);
    expect(await store.setListIcp(ORG_A, listId, icpId)).toBe(true);
    return { ps, icpId, listId };
  }

  it('adds people evaluated under the ratified version, with evaluator provenance', async () => {
    const { ps, listId } = await icpList();
    const r = await evaluateIcpList({ organizationId: ORG_A, listId });
    expect(r).toMatchObject({ icpVersion: 2, evaluated: 2, added: 2, removed: 0, keptOutByHuman: 0 });
    const active = rowsOf('prospect_list_members').filter((m) => m.list_id === listId && m.status === 'active');
    expect(active.map((m) => m.prospect_id).sort()).toEqual([ps[0], ps[1]].sort());
    expect(active.every((m) => m.added_via === EVALUATOR_ADDED_VIA && m.added_by_user_id === null)).toBe(true);
  });

  it('is idempotent, and dryRun previews without writing', async () => {
    const { listId } = await icpList();
    const preview = await evaluateIcpList({ organizationId: ORG_A, listId, dryRun: true });
    expect(preview).toMatchObject({ dryRun: true, added: 2 });
    expect(rowsOf('prospect_list_members')).toHaveLength(0);
    await evaluateIcpList({ organizationId: ORG_A, listId });
    const again = await evaluateIcpList({ organizationId: ORG_A, listId });
    expect(again).toMatchObject({ added: 0, alreadyMember: 2, removed: 0 });
    expect(rowsOf('prospect_list_members')).toHaveLength(2);
  });

  it('never re-adds someone a person removed, and keeps that removal in history', async () => {
    const { ps, listId } = await icpList();
    await evaluateIcpList({ organizationId: ORG_A, listId });
    await removeProspectFromList(store, { organizationId: ORG_A, listId, prospectId: ps[0], removalReason: 'asked not to', actorUserId: USER_A });
    const r = await evaluateIcpList({ organizationId: ORG_A, listId });
    expect(r).toMatchObject({ keptOutByHuman: 1, added: 0 });
    const rows = rowsOf('prospect_list_members').filter((m) => m.prospect_id === ps[0]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'removed', removed_by_user_id: USER_A, removal_reason: 'asked not to' });
  });

  it('removes only its own members who are no longer evaluated — never a person\'s member', async () => {
    const { ps, icpId, listId } = await icpList();
    const [manual] = seedProspects(ORG_A, 1);
    await addProspectToList(store, { organizationId: ORG_A, listId, prospectId: manual, addedVia: 'manual', actorUserId: USER_A });
    await evaluateIcpList({ organizationId: ORG_A, listId });
    // ps[1]'s evaluation moves to another version: no longer evidence for v2.
    (rowsOf('prospect_score_evaluations').find((e) => e.prospect_id === ps[1] && e.icp_id === icpId) as Row).icp_version = 1;
    const r = await evaluateIcpList({ organizationId: ORG_A, listId });
    expect(r.removed).toBe(1);
    const p1Rows = rowsOf('prospect_list_members').filter((m) => m.prospect_id === ps[1]);
    expect(p1Rows[0]).toMatchObject({ status: 'removed', removed_by_user_id: null });
    expect(String(p1Rows[0].removal_reason)).toMatch(/^evaluator:/);
    expect(rowsOf('prospect_list_members').find((m) => m.prospect_id === manual)?.status).toBe('active');
  });

  it('refuses a list with no ICP, an ICP without a ratified version, an archived list and another tenant', async () => {
    const plain = await seedList(ORG_A, []);
    expect(await codeOf(evaluateIcpList({ organizationId: ORG_A, listId: plain }))).toBe('list_has_no_icp');
    const draftIcp = seedIcp(ORG_A, ['draft']);
    await store.setListIcp(ORG_A, plain, draftIcp);
    expect(await codeOf(evaluateIcpList({ organizationId: ORG_A, listId: plain }))).toBe('icp_not_ratified');
    const { listId } = await icpList();
    expect(await codeOf(evaluateIcpList({ organizationId: ORG_B, listId }))).toBe('list_not_found');
    await updateProspectList(store, { organizationId: ORG_A, listId, status: 'archived', actorUserId: USER_A } as never);
    expect(await codeOf(evaluateIcpList({ organizationId: ORG_A, listId }))).toBe('list_archived');
    expect(IcpListEvaluationError).toBeDefined();
  });

  it('a list cannot take another tenant\'s ICP, and list ICP refuses explicitly before the migration', async () => {
    const listId = await seedList(ORG_A, []);
    const foreignIcp = seedIcp(ORG_B, ['ratified']);
    await expect(store.setListIcp(ORG_A, listId, foreignIcp)).rejects.toThrow(/foreign key/);
    db.targetingInstalled = false;
    expect(await codeOf(store.getListIcp(ORG_A, listId))).toBe('targeting_schema_missing');
    expect(await codeOf(store.setListIcp(ORG_A, listId, null))).toBe('targeting_schema_missing');
  });
});

// ── Enrollment: version pin, eligibility, dedup, idempotence ──────────────────

const intelligence = (scores: Record<string, number>): IndividualIntelligencePort => ({
  resolvePerson: async () => ({ ok: true, personId: null }),
  readPersonContacts: async () => null,
  readLeadIntelligence: async () => null,
  readProspectScore: async (_org, prospectId) => (prospectId in scores ? { intent: null, overall: scores[prospectId], confidence: null } : null),
  channelPermission: async () => null,
});
const GATED = { enrollment: { conditions: [{ fact: 'prospect_score_overall', op: 'gte', value: 0.5 }] }, steps: [{ key: 's1', channel: 'internal' }] };

describe('enrollment — selected targets become individual journeys', () => {
  async function selected(n: number, definition?: Row) {
    const ps = seedProspects(ORG_A, n);
    const campaignId = seedCampaign(ORG_A);
    const listId = await seedList(ORG_A, ps);
    await attachListToCampaign({ organizationId: ORG_A, campaignId, listId, actorUserId: USER_A });
    await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'k1', origin: 'human', actorUserId: USER_A });
    const workflowId = seedWorkflow(ORG_A, definition);
    return { ps, campaignId, listId, workflowId };
  }

  it('enrolls each eligible person once, pinned to the published version and linked to the target', async () => {
    const { ps, campaignId, workflowId } = await selected(3);
    const versionId = (rowsOf('workflows')[0] as Row).current_version_id;
    const r = await enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId });
    expect(r).toMatchObject({ population: 3, enrolled: 3, alreadyEnrolled: 0, excluded: 0, workflowVersionId: versionId, versionChangedDuringRun: 0 });
    expect(instances()).toHaveLength(3);
    const targets = await listCampaignTargets(ORG_A, campaignId);
    for (const i of instances()) {
      expect(i.workflow_version_id).toBe(versionId);
      expect(targets.find((t) => t.id === i.target_id)?.prospectId).toBe(i.subject_id);
    }
    expect(new Set(instances().map((i) => i.subject_id))).toEqual(new Set(ps));
    expect(plans.size).toBe(3);
  });

  it('excludes ineligible people with the version\'s reason, and previews without writing', async () => {
    const { ps, campaignId, workflowId } = await selected(3, GATED);
    const intel = intelligence({ [ps[0]]: 0.9, [ps[1]]: 0.2 });
    const preview = await enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId, dryRun: true, intelligence: intel });
    expect(preview).toMatchObject({ dryRun: true, wouldEnroll: 1, enrolled: 0, excluded: 2 });
    expect(Object.keys(preview.exclusionReasons).join(' ')).toMatch(/prospect_score_overall/);
    expect(instances()).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
    const real = await enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId, intelligence: intel });
    expect(real).toMatchObject({ enrolled: 1, excluded: 2 });
    expect(instances().map((i) => i.subject_id)).toEqual([ps[0]]);
  });

  it('a repeated run enrolls no one twice', async () => {
    const { campaignId, workflowId } = await selected(2);
    await enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId });
    const again = await enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId });
    expect(again).toMatchObject({ enrolled: 0, alreadyEnrolled: 2 });
    expect(instances()).toHaveLength(2);
  });

  it('concurrent runs converge on one journey per person (the unique index decides)', async () => {
    const { campaignId, workflowId } = await selected(3);
    const [a, b] = await Promise.all([
      enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId }),
      enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId }),
    ]);
    expect(instances()).toHaveLength(3);
    expect(a.enrolled + b.enrolled).toBe(3);
    expect(a.alreadyEnrolled + b.alreadyEnrolled).toBe(3);
  });

  it('a person selected from two lists, or by two occurrences, is ONE journey', async () => {
    const { ps, campaignId, workflowId } = await selected(2);
    const second = await seedList(ORG_A, [ps[0]]);
    await attachListToCampaign({ organizationId: ORG_A, campaignId, listId: second, actorUserId: USER_A });
    await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'k2', origin: 'human', actorUserId: USER_A });
    expect((await listCampaignTargets(ORG_A, campaignId)).length).toBe(5);
    const r = await enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId });
    expect(r).toMatchObject({ targets: 5, population: 2, enrolled: 2 });
    expect(instances()).toHaveLength(2);
    // The earliest target is the one linked.
    const earliest = (await listCampaignTargets(ORG_A, campaignId)).find((t) => t.prospectId === ps[0]);
    expect(instances().find((i) => i.subject_id === ps[0])?.target_id).toBe(earliest?.id);
  });

  it('can be limited to one selection occurrence', async () => {
    const { ps, campaignId, listId, workflowId } = await selected(1);
    const [late] = seedProspects(ORG_A, 1);
    await addProspectToList(store, { organizationId: ORG_A, listId, prospectId: late, addedVia: 'manual', actorUserId: USER_A });
    await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'k2', origin: 'human', actorUserId: USER_A });
    const r = await enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId, selectionEventKey: 'human:k1' });
    expect(r).toMatchObject({ population: 1, enrolled: 1 });
    expect(instances().map((i) => i.subject_id)).toEqual([ps[0]]);
  });

  it('existing journeys keep their pinned version when a new version is published', async () => {
    const { campaignId, workflowId, listId } = await selected(1);
    await enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId });
    const v1 = instances()[0].workflow_version_id;
    const v2 = publish(ORG_A, workflowId, { steps: [{ key: 's1', channel: 'internal' }, { key: 's2', channel: 'internal' }] });
    const [late] = seedProspects(ORG_A, 1);
    await addProspectToList(store, { organizationId: ORG_A, listId, prospectId: late, addedVia: 'manual', actorUserId: USER_A });
    await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'k2', origin: 'human', actorUserId: USER_A });
    const r = await enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId });
    expect(r).toMatchObject({ enrolled: 1, alreadyEnrolled: 1, workflowVersionId: v2 });
    expect(instances().map((i) => i.workflow_version_id)).toEqual([v1, v2]);
  });

  it('reports a publish that lands mid-run instead of hiding it', async () => {
    const { campaignId, workflowId } = await selected(1);
    db.beforeCreate = () => { db.beforeCreate = null; publish(ORG_A, workflowId, { steps: [{ key: 'x', channel: 'internal' }] }); };
    const r = await enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId });
    expect(r).toMatchObject({ enrolled: 1, versionChangedDuringRun: 1 });
  });

  it('another tenant can neither enroll the campaign nor see its targets', async () => {
    const { campaignId, workflowId } = await selected(2);
    expect(await codeOf(enrollCampaignTargets({ organizationId: ORG_B, campaignId, workflowId }))).toBe('campaign_not_found');
    expect(instances()).toHaveLength(0);
    expect(CampaignEnrollmentError).toBeDefined();
  });

  it('a workflow of another tenant is refused by the instance store', async () => {
    const { campaignId } = await selected(1);
    const foreignWorkflow = seedWorkflow(ORG_B);
    const r = enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId: foreignWorkflow });
    // Eligibility sees no published version in ORG_A, so the person is excluded — never enrolled.
    await expect(r).resolves.toMatchObject({ enrolled: 0, excluded: 1, exclusionReasons: { no_published_version: 1 } });
    expect(instances()).toHaveLength(0);
  });

  it('a target of another tenant, or of another campaign, cannot pin a journey', async () => {
    const a = await selected(1);
    const [targetA] = await listCampaignTargets(ORG_A, a.campaignId);
    const campaignB = seedCampaign(ORG_B);
    const workflowB = seedWorkflow(ORG_B);
    const [prospectB] = seedProspects(ORG_B, 1);
    // Another tenant's target answers exactly like a mismatched one (no existence leak).
    expect(await codeOf(createExecutionInstance({
      organizationId: ORG_B, campaignId: campaignB, workflowId: workflowB, subjectKind: 'prospect', subjectId: prospectB, targetId: targetA.id,
    }))).toBe('target_mismatch');
    expect(await codeOf(createExecutionInstance({
      organizationId: ORG_B, campaignId: campaignB, workflowId: workflowB, subjectKind: 'prospect', subjectId: targetA.prospectId, targetId: targetA.id,
    }))).toBe('subject_not_found');
    const otherCampaign = seedCampaign(ORG_A);
    expect(await codeOf(createExecutionInstance({
      organizationId: ORG_A, campaignId: otherCampaign, workflowId: a.workflowId, subjectKind: 'prospect', subjectId: targetA.prospectId, targetId: targetA.id,
    }))).toBe('target_mismatch');
    expect(ExecutionInstanceError).toBeDefined();
  });

  it('a target is not enrollable until the targets schema exists (targets_not_installed)', async () => {
    const [p1] = seedProspects(ORG_A, 1);
    const campaignId = seedCampaign(ORG_A);
    const workflowId = seedWorkflow(ORG_A);
    db.targetingInstalled = false;
    expect(await codeOf(createExecutionInstance({
      organizationId: ORG_A, campaignId, workflowId, subjectKind: 'prospect', subjectId: p1, targetId: '22222222-2222-4222-8222-222222222222',
    }))).toBe('targets_not_installed');
    expect(await codeOf(enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId }))).toBe('targets_schema_missing');
  });
});

// ── End to end: population → targets → journeys → journey report ──────────────

describe('end to end — a tenant selects a population and eligible people are enrolled', () => {
  it('ICP list → ICP campaign → selection → enrollment → journey report, with accurate counts', async () => {
    const ps = seedProspects(ORG_A, 5);
    const icpId = seedIcp(ORG_A, ['ratified']);
    ps.slice(0, 4).forEach((p, i) => seedEvaluation(ORG_A, p, icpId, 1, [0.9, 0.8, 0.3, 0.7][i]));

    // 1. The ICP list is maintained by the evaluator; a manual list sits beside it.
    const icpListId = await seedList(ORG_A, [], 'icp');
    await store.setListIcp(ORG_A, icpListId, icpId);
    expect(await evaluateIcpList({ organizationId: ORG_A, listId: icpListId })).toMatchObject({ added: 4 });
    const manualListId = await seedList(ORG_A, [ps[4], ps[0]], 'manual');

    // 2. The campaign targets the ICP, min score 0.5, from both lists.
    const campaignId = seedCampaign(ORG_A);
    await setCampaignTargeting({ organizationId: ORG_A, campaignId, mode: 'icp', icpId, icpVersion: 1, minIcpScore: 0.5 });
    for (const listId of [icpListId, manualListId]) await attachListToCampaign({ organizationId: ORG_A, campaignId, listId, actorUserId: USER_A });

    // 3. Preview, then select.
    const preview = await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'launch', origin: 'human', actorUserId: USER_A, dryRun: true });
    expect(preview).toMatchObject({ population: 5, selected: 4, created: 0 });
    expect(preview.excluded).toMatchObject({ below_min_icp_score: 1, not_evaluated_under_icp: 1 });
    const selection = await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'launch', origin: 'human', actorUserId: USER_A });
    expect(selection).toMatchObject({ selected: 4, created: 4 });

    // 4. Enroll under a gated version: ps[1] fails the version's own condition.
    const workflowId = seedWorkflow(ORG_A, GATED);
    const intel = intelligence({ [ps[0]]: 0.9, [ps[1]]: 0.1, [ps[3]]: 0.6 });
    const enrollment = await enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId, intelligence: intel });
    expect(enrollment).toMatchObject({ targets: 4, population: 3, enrolled: 2, excluded: 1, alreadyEnrolled: 0 });
    const again = await enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId, intelligence: intel });
    expect(again).toMatchObject({ enrolled: 0, alreadyEnrolled: 2, excluded: 1 });

    // 5. The journey report counts exactly the journeys that exist.
    const report = await buildJourneyReport({ organizationId: ORG_A, workflowId, now: '2026-10-28T10:00:00.000Z' });
    expect(report?.runsRead).toBe(2);
    expect(report?.versions).toHaveLength(1);
    expect(report?.versions[0]).toMatchObject({ enrolled: 2, journeys: { created: 2 } });
    expect(await buildJourneyReport({ organizationId: ORG_B, workflowId })).toBeNull();
  });
});
