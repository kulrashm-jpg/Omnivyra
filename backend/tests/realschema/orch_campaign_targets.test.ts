/**
 * ORCHESTRATION — lists, campaign targets and enrollment, against REAL PostgreSQL.
 *
 * The REAL canonical list module and store, the REAL campaign targeting /
 * attachment / target stores, the REAL ICP evidence reader, selection service,
 * ICP list evaluator, campaign enrollment, enrollment eligibility (with the
 * DURABLE intelligence port — facts are read from the database), the REAL
 * execution instance, workflow and plan stores, the REAL journey report and the
 * REAL routes, all writing to the REAL schema built by baseline + replay
 * (20261127 lists, 20261226 campaigns, 20261227 workflows, 20261228 instances and
 * plans, 20261231 targeting).
 *
 * Replaced, and only these: the PostgREST transport (`ownedDbTable` /
 * `supabase.rpc` become SQL on the harness connection — the pattern of
 * b3_outcome_lifecycle), the shared route wrapper, and the two auth gates, which
 * each test sets to refuse or allow so the ORDER of checks is what is asserted.
 * Every constraint, trigger, unique index and database function is real.
 */

import { Client } from 'pg';
import { db, inRollback, seedTenants, ORG_A, ORG_B } from './setup';

type Row = Record<string, unknown>;

// One connection serves every call, so each savepoint/statement/release unit is
// serialized: two interleaved service runs then race BETWEEN calls — at the real
// unique index — instead of corrupting each other's savepoints.
let adapterTail: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = adapterTail.then(fn, fn);
  adapterTail = run.catch(() => undefined);
  return run;
}
(global as unknown as { __orchSerialized: typeof serialized }).__orchSerialized = serialized;

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const serial = (global as unknown as { __orchSerialized: <T>(fn: () => Promise<T>) => Promise<T> }).__orchSerialized;
    const { db: client } = require('./setup') as { db: { query: Function } };
    type Filter = { col: string; op: 'eq' | 'is' | 'in' | 'or'; val: unknown };
    const st = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete',
      cols: '*', payload: null as Row | null, filters: [] as Filter[],
      orders: [] as Array<{ col: string; asc: boolean }>, limit: null as number | null, mode: 'many' as 'many' | 'one' | 'single',
    };
    const normalize = (row: Row): Row => {
      const out: Row = {};
      for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
      return out;
    };
    const where = (params: unknown[]): string => {
      if (st.filters.length === 0) return '';
      const parts = st.filters.map((f) => {
        if (f.op === 'is' && f.val === null) return `"${f.col}" IS NULL`;
        if (f.op === 'in') {
          const list = (f.val as unknown[]).map((v) => { params.push(v); return `$${params.length}`; });
          return list.length ? `"${f.col}" IN (${list.join(', ')})` : 'false';
        }
        if (f.op === 'or') {
          // The canonical list store's keyset cursor is the only `.or` sent.
          const m = /^added_at\.lt\.([^,]+),and\(added_at\.eq\.([^,]+),id\.lt\.([^)]+)\)$/.exec(String(f.val));
          if (!m) throw new Error(`pg adapter: unsupported or(${String(f.val)})`);
          params.push(m[1], m[2], m[3]);
          return `("added_at" < $${params.length - 2} OR ("added_at" = $${params.length - 1} AND "id" < $${params.length}))`;
        }
        params.push(f.val);
        return `"${f.col}" = $${params.length}`;
      });
      return ` WHERE ${parts.join(' AND ')}`;
    };
    const exec = async () => {
      const params: unknown[] = [];
      const render = (v: unknown) => (Array.isArray(v) ? v : (v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
      let sql: string;
      if (st.op === 'insert') {
        const row = st.payload ?? {};
        const keys = Object.keys(row);
        sql = `INSERT INTO public."${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (`
          + keys.map((k) => { params.push(render(row[k])); return `$${params.length}`; }).join(', ')
          + `) RETURNING ${st.cols}`;
      } else if (st.op === 'update') {
        const row = st.payload ?? {};
        const sets = Object.keys(row).map((k) => { params.push(render(row[k])); return `"${k}" = $${params.length}`; }).join(', ');
        sql = `UPDATE public."${table}" SET ${sets}${where(params)} RETURNING ${st.cols}`;
      } else if (st.op === 'delete') {
        sql = `DELETE FROM public."${table}"${where(params)} RETURNING ${st.cols}`;
      } else {
        sql = `SELECT ${st.cols} FROM public."${table}"${where(params)}`;
        if (st.orders.length) sql += ` ORDER BY ${st.orders.map((o) => `"${o.col}" ${o.asc ? 'ASC' : 'DESC'}`).join(', ')}`;
        if (st.limit !== null) sql += ` LIMIT ${st.limit}`;
      }
      await client.query('SAVEPOINT pg_adapter');
      try {
        const res = await client.query(sql, params) as { rows: Row[] };
        await client.query('RELEASE SAVEPOINT pg_adapter');
        const out = res.rows.map(normalize);
        if (st.mode === 'single' && out.length !== 1) return { data: null, error: { code: 'PGRST116', message: `expected one row, got ${out.length}` } };
        if (st.mode !== 'many') return { data: out[0] ?? null, error: null };
        return { data: out, error: null };
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT pg_adapter');
        return { data: null, error: err };
      }
    };
    const b: Row = {
      select: (cols?: string) => { if (cols) st.cols = cols; return b; },
      insert: (row: Row) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Row) => { st.op = 'update'; st.payload = row; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (col: string, val: unknown) => { st.filters.push({ col, op: 'eq', val }); return b; },
      is: (col: string, val: unknown) => { st.filters.push({ col, op: 'is', val }); return b; },
      in: (col: string, val: unknown[]) => { st.filters.push({ col, op: 'in', val }); return b; },
      or: (expr: string) => { st.filters.push({ col: '', op: 'or', val: expr }); return b; },
      order: (col: string, opts?: { ascending?: boolean }) => { st.orders.push({ col, asc: opts?.ascending !== false }); return b; },
      limit: (n: number) => { st.limit = n; return b; },
      single: () => { st.mode = 'single'; return b; },
      maybeSingle: () => { st.mode = 'one'; return b; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => serial(exec).then(res, rej),
    };
    return b;
  },
}));

// `supabase.rpc` → the REAL database function, named arguments, rows returned.
jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => (global as unknown as { __orchSerialized: <T>(f: () => Promise<T>) => Promise<T> }).__orchSerialized(async () => {
      const { db: client } = require('./setup') as { db: { query: Function } };
      if (!/^[a-z_]+$/.test(fn)) throw new Error(`pg adapter: bad function name ${fn}`);
      const keys = Object.keys(args);
      const sql = `SELECT * FROM public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
      await client.query('SAVEPOINT pg_rpc');
      try {
        const res = await client.query(sql, keys.map((k) => args[k])) as { rows: Row[] };
        await client.query('RELEASE SAVEPOINT pg_rpc');
        return { data: res.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]))), error: null };
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT pg_rpc');
        return { data: null, error: err };
      }
    }),
  },
}));

// The journey report imports the WhatsApp adapter for a table name; its import
// chain reads app config. Nothing here sends or calls a provider.
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (handler: unknown) => handler }));
const gate = { access: null as null | { userId: string }, capability: true };
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: async ({ res }: { res: { status: (n: number) => { json: (b: unknown) => void } } }) => {
    if (gate.access === null) { res.status(403).json({ error: 'not a member' }); return null; }
    return gate.access;
  },
}));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: async (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
    if (!gate.capability) { res.status(403).json({ error: 'missing capability' }); return { ok: false }; }
    // The real guard answers with the authenticated principal (Follow-up E's batch enrolment binds an acknowledgement to it).
    return { ok: true, principal: { userId: (gate.access as { userId?: string } | null)?.userId } };
  },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const lists = require('../../services/prospectLists');
const { productionListStore: store } = require('../../services/prospectLists/store');
const { evaluateIcpList } = require('../../services/prospectLists/icpListEvaluator');
const campaigns = require('../../services/prospectCampaigns/prospectCampaignStore');
const attach = require('../../services/prospectCampaigns/campaignListStore');
const targets = require('../../services/prospectCampaigns/campaignTargetStore');
const { selectCampaignTargets } = require('../../services/prospectCampaigns/campaignSelectionService');
const { enrollCampaignTargets } = require('../../services/orchestration/campaignEnrollment');
const instances = require('../../services/executionInstances/executionInstanceStore');
const workflows = require('../../services/workflows/workflowStore');
const { buildJourneyReport } = require('../../services/orchestration/journeyReport');
/* eslint-enable @typescript-eslint/no-var-requires */

// ── Fixtures (real rows satisfying the real foreign keys) ───────────────────
const rnd = () => Math.random().toString(36).slice(2, 10);
const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as Row;
const count = async (sql: string, params: unknown[] = []) => Number((await one(sql, params)).n);

async function newUser(): Promise<string> {
  return String((await one('INSERT INTO public.users (email) VALUES ($1) RETURNING id', [`orch-${rnd()}@example.test`])).id);
}
async function newProspect(org: string): Promise<string> {
  const key = `orch-${rnd()}`;
  const u = await one(`INSERT INTO public.canonical_users (company_id, user_type, device, external_user_key)
    VALUES ($1,'known','desktop',$2) RETURNING id`, [org, `${key}-u`]);
  return String((await one(`INSERT INTO public.canonical_leads (company_id, user_id, source, external_lead_key)
    VALUES ($1,$2,'orch',$3) RETURNING id`, [org, u.id, key])).id);
}
async function newIcp(org: string, actor: string, statuses: string[]): Promise<string> {
  const icp = String((await one('INSERT INTO public.prospect_icps (organization_id, icp_key) VALUES ($1,$2) RETURNING id', [org, `icp-${rnd()}`])).id);
  for (const [i, status] of statuses.entries()) {
    const ratified = status === 'ratified' || status === 'superseded';
    await db.query(`INSERT INTO public.prospect_icp_versions
      (organization_id, icp_id, version, status, criteria, proposal, ratified_at, ratified_by, superseded_at, superseded_by_version)
      VALUES ($1,$2,$3,$4,'[]','{}',$5,$6,$7,$8)`,
    [org, icp, i + 1, status, ratified ? new Date() : null, ratified ? actor : null,
      status === 'superseded' ? new Date() : null, status === 'superseded' ? i + 2 : null]);
  }
  return icp;
}
async function evaluate(org: string, prospect: string, icp: string, version: number, scoreIcp: number, scoreOverall = 0.5): Promise<string> {
  return String((await one(`INSERT INTO public.prospect_score_evaluations
    (organization_id, prospect_id, icp_id, icp_version, rules_version, scored_at, evaluated_at, score_icp, score_overall, confidence, input_digest)
    VALUES ($1,$2,$3,$4,'orch-r1',now(),clock_timestamp(),$5,$6,0.8,$7) RETURNING id`,
  [org, prospect, icp, version, scoreIcp, scoreOverall, rnd()])).id);
}
async function newList(org: string, actor: string, members: string[]): Promise<string> {
  const l = await lists.createProspectList(store, { organizationId: org, name: `list-${rnd()}`, actorUserId: actor });
  if (l.ok !== true) throw new Error(`list: ${l.refusal}`);
  for (const p of members) {
    const r = await lists.addProspectToList(store, { organizationId: org, listId: l.value.id, prospectId: p, addedVia: 'manual', actorUserId: actor });
    if (r.ok !== true) throw new Error(`member: ${r.refusal}`);
  }
  return l.value.id;
}
async function newCampaign(org: string): Promise<string> {
  return String((await campaigns.createProspectCampaign({ organizationId: org, name: `camp-${rnd()}`, status: 'active' })).id);
}
const STEPS = [{ key: 'assign', channel: 'internal', delay_after_previous_hours: 0, execution_mode: 'human' }];
async function publishVersion(org: string, workflowId: string, actor: string, definition: Row): Promise<string> {
  const draft = await workflows.createDraftVersion({ organizationId: org, workflowId, definition, actorUserId: actor });
  const out = await workflows.publishWorkflowVersion({ organizationId: org, versionId: draft.id, actorUserId: actor });
  return String(out.version.id);
}
async function newWorkflow(org: string, actor: string, definition: Row = { steps: STEPS }): Promise<{ workflowId: string; versionId: string }> {
  const wf = await workflows.createWorkflow({ organizationId: org, name: `wf-${rnd()}`, actorUserId: actor });
  return { workflowId: String(wf.id), versionId: await publishVersion(org, String(wf.id), actor, definition) };
}
const GATED = { enrollment: { conditions: [{ fact: 'prospect_score_overall', op: 'gte', value: 0.5 }] }, steps: STEPS };

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try { await p; } catch (e) { return String((e as { code?: string }).code); }
  return 'resolved';
};
const targetRows = (campaignId: string) => count('SELECT count(*) n FROM public.prospect_campaign_targets WHERE campaign_id = $1', [campaignId]);
const journeyRows = (campaignId: string) => count('SELECT count(*) n FROM public.execution_instances WHERE campaign_id = $1', [campaignId]);

// ── The schema itself ───────────────────────────────────────────────────────

describe('real schema — 20261231000000 as PostgreSQL holds it', () => {
  it('has the asserted foreign keys, unique indexes and defaults, and no competing store', async () => {
    expect(await count(`SELECT count(*) n FROM pg_constraint WHERE contype='f' AND conrelid='public.execution_instances'::regclass`)).toBe(5);
    expect(await count(`SELECT count(*) n FROM pg_constraint WHERE contype='f' AND conrelid='public.prospect_campaign_targets'::regclass`)).toBe(6);
    for (const ix of ['uq_prospect_campaign_targets_selection', 'uq_prospect_campaign_targets_id_org', 'uq_prospect_campaign_lists_identity']) {
      expect(await count('SELECT count(*) n FROM pg_indexes WHERE indexname = $1 AND indexdef ILIKE \'%UNIQUE%\'', [ix])).toBe(1);
    }
    expect((await one(`SELECT column_default d FROM information_schema.columns WHERE table_name='prospect_campaigns' AND column_name='targeting_mode'`)).d).toMatch(/'manual'/);
    expect(await count(`SELECT count(*) n FROM pg_class WHERE relname IN ('prospect_list_memberships','prospect_icp_qualifications','campaign_targets') AND relkind='r'`)).toBe(0);
    expect(await count(`SELECT count(*) n FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname='public' AND c.relkind='r' AND c.relname LIKE '%list_member%'`)).toBe(1);
  });

  it('the earlier migrations\' postconditions still hold after 20261231 (re-run safety)', async () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    for (const f of ['20270111100000_pi_prospect_campaigns.sql', '20270111100002_pi_execution_instances.sql', '20270111100007_orchestration_campaign_targeting.sql']) {
      const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations', f), 'utf8');
      const blocks = (sql.match(/^DO \$\$[\s\S]*?^\$\$;/gm) ?? []).filter((b) => /postcondition/.test(b));
      expect({ f, blocks: blocks.length > 0 }).toEqual({ f, blocks: true });
      for (const block of blocks) await expect(db.query(block)).resolves.toBeDefined();
    }
  });

  it('a target is never updated, and a person\'s erasure cascades to their unenrolled targets', async () => {
    await inRollback(async () => {
      await seedTenants();
      const actor = await newUser();
      const [p] = [await newProspect(ORG_A)];
      const campaignId = await newCampaign(ORG_A);
      const listId = await newList(ORG_A, actor, [p]);
      await attach.attachListToCampaign({ organizationId: ORG_A, campaignId, listId, actorUserId: actor });
      await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'k1', origin: 'human', actorUserId: actor });
      await db.query('SAVEPOINT u');
      await expect(db.query('UPDATE public.prospect_campaign_targets SET selection_event_key = $1 WHERE campaign_id = $2', ['human:x', campaignId])).rejects.toMatchObject({ code: '23514' });
      await db.query('ROLLBACK TO SAVEPOINT u');
      await db.query('DELETE FROM public.prospect_list_members WHERE prospect_id = $1', [p]);
      await db.query('DELETE FROM public.canonical_leads WHERE id = $1', [p]);
      expect(await targetRows(campaignId)).toBe(0);
    });
  });
});

// ── Lists without and with an ICP ───────────────────────────────────────────

describe('lists — manual and intake lists need no ICP; human decisions win', () => {
  it('manual and intake lists exist without an ICP and feed a manual campaign', async () => {
    await inRollback(async () => {
      await seedTenants();
      const actor = await newUser();
      const [p1, p2, p3] = [await newProspect(ORG_A), await newProspect(ORG_A), await newProspect(ORG_A)];
      const manual = await newList(ORG_A, actor, [p1, p2]);
      const intake = await newList(ORG_A, actor, []);
      expect((await lists.addProspectToListBySystem(store, { organizationId: ORG_A, listId: intake, prospectId: p3, addedVia: 'evaluator:intake' })).ok).toBe(true);
      expect(await store.getListIcp(ORG_A, manual)).toBeNull();
      expect(await store.getListIcp(ORG_A, intake)).toBeNull();
      const campaignId = await newCampaign(ORG_A);
      for (const listId of [manual, intake]) await attach.attachListToCampaign({ organizationId: ORG_A, campaignId, listId, actorUserId: actor });
      const r = await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'k1', origin: 'human', actorUserId: actor });
      expect(r).toMatchObject({ population: 3, selected: 3, created: 3 });
      expect(await targetRows(campaignId)).toBe(3);
    });
  });

  it('ICP list membership follows evaluations; a person\'s removal is never undone; a re-add keeps history', async () => {
    await inRollback(async () => {
      await seedTenants();
      const actor = await newUser();
      const ps = [await newProspect(ORG_A), await newProspect(ORG_A), await newProspect(ORG_A)];
      const icp = await newIcp(ORG_A, actor, ['ratified']);
      for (const p of ps) await evaluate(ORG_A, p, icp, 1, 0.8);
      const manualOnly = await newProspect(ORG_A);
      const listId = await newList(ORG_A, actor, [manualOnly]);
      expect(await store.setListIcp(ORG_A, listId, icp)).toBe(true);

      expect(await evaluateIcpList({ organizationId: ORG_A, listId, dryRun: true })).toMatchObject({ added: 3, removed: 0 });
      expect(await count('SELECT count(*) n FROM public.prospect_list_members WHERE list_id = $1', [listId])).toBe(1);
      expect(await evaluateIcpList({ organizationId: ORG_A, listId })).toMatchObject({ icpVersion: 1, added: 3, removed: 0 });

      // A person removes ps[0]; the evaluator must not re-add them.
      await lists.removeProspectFromList(store, { organizationId: ORG_A, listId, prospectId: ps[0], removalReason: 'asked not to', actorUserId: actor });
      expect(await evaluateIcpList({ organizationId: ORG_A, listId })).toMatchObject({ keptOutByHuman: 1, added: 0 });
      expect(await count(`SELECT count(*) n FROM public.prospect_list_members WHERE list_id=$1 AND prospect_id=$2 AND status='active'`, [listId, ps[0]])).toBe(0);

      // A person re-adds them: a NEW row; the removal stays in history.
      await lists.addProspectToList(store, { organizationId: ORG_A, listId, prospectId: ps[0], addedVia: 'manual', actorUserId: actor });
      const hist = (await db.query(`SELECT status, removed_by_user_id, removal_reason FROM public.prospect_list_members
        WHERE list_id=$1 AND prospect_id=$2 ORDER BY added_at`, [listId, ps[0]])).rows;
      expect(hist).toEqual([
        { status: 'removed', removed_by_user_id: actor, removal_reason: 'asked not to' },
        { status: 'active', removed_by_user_id: null, removal_reason: null },
      ]);

      // v2 is ratified (v1 superseded) and evaluates only ps[2]: the evaluator removes
      // ITS member ps[1]; the person's members (ps[0] re-added, manualOnly) stay.
      await db.query(`UPDATE public.prospect_icp_versions SET status='superseded', superseded_at=now(), superseded_by_version=2
        WHERE organization_id=$1 AND icp_id=$2 AND version=1`, [ORG_A, icp]);
      await db.query(`INSERT INTO public.prospect_icp_versions (organization_id, icp_id, version, status, criteria, proposal, ratified_at, ratified_by)
        VALUES ($1,$2,2,'ratified','[]','{}',now(),$3)`, [ORG_A, icp, actor]);
      await evaluate(ORG_A, ps[2], icp, 2, 0.9);
      expect(await evaluateIcpList({ organizationId: ORG_A, listId })).toMatchObject({ icpVersion: 2, evaluated: 1, removed: 1 });
      const active = (await db.query(`SELECT prospect_id FROM public.prospect_list_members WHERE list_id=$1 AND status='active' ORDER BY prospect_id`, [listId])).rows.map((r) => r.prospect_id);
      expect(active.sort()).toEqual([ps[0], ps[2], manualOnly].sort());
      const evicted = await one(`SELECT removed_by_user_id, removal_reason FROM public.prospect_list_members WHERE list_id=$1 AND prospect_id=$2`, [listId, ps[1]]);
      expect(evicted.removed_by_user_id).toBeNull();
      expect(String(evicted.removal_reason)).toMatch(/^evaluator:/);
    });
  });

  it('a list cannot take another tenant\'s ICP', async () => {
    await inRollback(async () => {
      await seedTenants();
      const actor = await newUser();
      const listId = await newList(ORG_A, actor, []);
      const foreign = await newIcp(ORG_B, actor, ['ratified']);
      await expect(store.setListIcp(ORG_A, listId, foreign)).rejects.toThrow(/foreign key/);
    });
  });
});

// ── Campaign targeting authority ────────────────────────────────────────────

describe('campaign targeting — a ratified ICP version of the same tenant, enforced by PostgreSQL', () => {
  it('accepts a ratified version; refuses draft, proposed, missing and foreign versions; locks after selection', async () => {
    await inRollback(async () => {
      await seedTenants();
      const actor = await newUser();
      const campaignId = await newCampaign(ORG_A);
      const ratified = await newIcp(ORG_A, actor, ['ratified']);
      const draft = await newIcp(ORG_A, actor, ['draft']);
      const proposed = await newIcp(ORG_A, actor, ['proposed']);
      const foreign = await newIcp(ORG_B, actor, ['ratified']);
      const set = (icpId: string, icpVersion = 1) => campaigns.setCampaignTargeting({ organizationId: ORG_A, campaignId, mode: 'icp', icpId, icpVersion });
      expect(await codeOf(set(draft))).toBe('campaign_icp_not_ratified');
      expect(await codeOf(set(proposed))).toBe('campaign_icp_not_ratified');
      expect(await codeOf(set(ratified, 7))).toBe('icp_version_not_found');
      expect(await codeOf(set(foreign))).toBe('icp_version_not_found');
      expect(await set(ratified)).toMatchObject({ mode: 'icp', icpId: ratified, icpVersion: 1 });
      expect(await campaigns.getCampaignTargeting(ORG_B, campaignId)).toBeNull();

      // The database CHECK refuses an incoherent row even past the store.
      await db.query('SAVEPOINT c');
      await expect(db.query(`UPDATE public.prospect_campaigns SET targeting_mode='manual' WHERE id=$1`, [campaignId])).rejects.toMatchObject({ code: '23514' });
      await db.query('ROLLBACK TO SAVEPOINT c');

      const p = await newProspect(ORG_A);
      await evaluate(ORG_A, p, ratified, 1, 0.9);
      const listId = await newList(ORG_A, actor, [p]);
      await attach.attachListToCampaign({ organizationId: ORG_A, campaignId, listId, actorUserId: actor });
      await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'k1', origin: 'human', actorUserId: actor });
      expect(await codeOf(campaigns.setCampaignTargeting({ organizationId: ORG_A, campaignId, mode: 'manual' }))).toBe('campaign_targeting_locked');
    });
  });
});

// ── Selection ───────────────────────────────────────────────────────────────

describe('selection — permanent, idempotent targets with explained exclusions', () => {
  it('previews without writing, then selects exactly the preview, and a retry duplicates nothing', async () => {
    await inRollback(async () => {
      await seedTenants();
      const actor = await newUser();
      const ps = [await newProspect(ORG_A), await newProspect(ORG_A), await newProspect(ORG_A), await newProspect(ORG_A)];
      const icp = await newIcp(ORG_A, actor, ['ratified']);
      const other = await newIcp(ORG_A, actor, ['ratified']);
      const ev0 = await evaluate(ORG_A, ps[0], icp, 1, 0.9);
      await evaluate(ORG_A, ps[1], icp, 1, 0.3);
      await evaluate(ORG_A, ps[2], other, 1, 0.99);
      const campaignId = await newCampaign(ORG_A);
      await campaigns.setCampaignTargeting({ organizationId: ORG_A, campaignId, mode: 'icp', icpId: icp, icpVersion: 1, minIcpScore: 0.5 });
      const listId = await newList(ORG_A, actor, ps);
      await attach.attachListToCampaign({ organizationId: ORG_A, campaignId, listId, actorUserId: actor });

      const preview = await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'launch', origin: 'human', actorUserId: actor, dryRun: true });
      expect(preview).toMatchObject({ population: 4, selected: 1, created: 0 });
      expect(preview.excluded).toEqual({ not_evaluated_under_icp: 2, below_min_icp_score: 1, list_archived: 0, list_not_found: 0 });
      expect(await targetRows(campaignId)).toBe(0);

      const real = await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'launch', origin: 'human', actorUserId: actor });
      expect(real).toMatchObject({ selected: 1, created: 1, reused: 0 });
      const again = await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 'launch', origin: 'human', actorUserId: actor });
      expect(again).toMatchObject({ selected: 1, created: 0, reused: 1 });
      const t = await one('SELECT * FROM public.prospect_campaign_targets WHERE campaign_id = $1', [campaignId]);
      expect(t).toMatchObject({ prospect_id: ps[0], selection_event_key: 'human:launch', origin: 'human', actor_user_id: actor, icp_id: icp, icp_version: 1, score_evaluation_id: ev0 });
      expect(await targetRows(campaignId)).toBe(1);
    });
  });

  it('refuses cross-tenant lists, prospects and campaigns', async () => {
    await inRollback(async () => {
      await seedTenants();
      const actor = await newUser();
      const campaignId = await newCampaign(ORG_A);
      const foreignList = await newList(ORG_B, actor, []);
      expect(await codeOf(attach.attachListToCampaign({ organizationId: ORG_A, campaignId, listId: foreignList, actorUserId: actor }))).toBe('not_found');
      const ownList = await newList(ORG_A, actor, []);
      const foreignProspect = await newProspect(ORG_B);
      expect(await codeOf(targets.createCampaignTarget({
        organizationId: ORG_A, campaignId, listId: ownList, prospectId: foreignProspect, selectionEventKey: 'human:k',
        origin: 'human', actorUserId: actor, icpId: null, icpVersion: null, scoreEvaluationId: null,
      }))).toBe('cross_tenant_or_missing_reference');
      expect(await codeOf(selectCampaignTargets({ organizationId: ORG_B, campaignId, selectionKey: 'k', origin: 'human', actorUserId: actor }))).toBe('campaign_not_found');
      expect(await lists.addProspectToList(store, { organizationId: ORG_A, listId: ownList, prospectId: foreignProspect, addedVia: 'manual', actorUserId: actor })).toMatchObject({ ok: false });
    });
  });
});

// ── Enrollment ──────────────────────────────────────────────────────────────

describe('enrollment — one pinned journey per eligible person', () => {
  async function selectedCampaign(actor: string, people: string[], extraListMembers: string[] = []) {
    const campaignId = await newCampaign(ORG_A);
    const l1 = await newList(ORG_A, actor, people);
    await attach.attachListToCampaign({ organizationId: ORG_A, campaignId, listId: l1, actorUserId: actor });
    if (extraListMembers.length) {
      const l2 = await newList(ORG_A, actor, extraListMembers);
      await attach.attachListToCampaign({ organizationId: ORG_A, campaignId, listId: l2, actorUserId: actor });
    }
    await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 's1', origin: 'human', actorUserId: actor });
    return campaignId;
  }

  it('applies the version\'s entry conditions from real facts, previews without writing, pins the published version', async () => {
    await inRollback(async () => {
      await seedTenants();
      const actor = await newUser();
      const ps = [await newProspect(ORG_A), await newProspect(ORG_A), await newProspect(ORG_A)];
      const icp = await newIcp(ORG_A, actor, ['ratified']);
      await evaluate(ORG_A, ps[0], icp, 1, 0.9, 0.9);
      await evaluate(ORG_A, ps[1], icp, 1, 0.9, 0.1);   // overall below the version's 0.5
      const campaignId = await selectedCampaign(actor, ps);
      const { workflowId, versionId } = await newWorkflow(ORG_A, actor, GATED);

      const preview = await enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId, dryRun: true });
      expect(preview).toMatchObject({ population: 3, wouldEnroll: 1, enrolled: 0, excluded: 2, workflowVersionId: versionId });
      expect(Object.keys(preview.exclusionReasons).join(' ')).toMatch(/prospect_score_overall/);
      expect(await journeyRows(campaignId)).toBe(0);

      const real = await enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId });
      expect(real).toMatchObject({ enrolled: 1, excluded: 2 });
      const j = await one('SELECT * FROM public.execution_instances WHERE campaign_id = $1', [campaignId]);
      const t = await one('SELECT id FROM public.prospect_campaign_targets WHERE campaign_id=$1 AND prospect_id=$2', [campaignId, ps[0]]);
      expect(j).toMatchObject({ subject_kind: 'prospect', subject_id: ps[0], workflow_version_id: versionId, target_id: t.id, lifecycle_state: 'created' });
      expect(await count('SELECT count(*) n FROM public.execution_plans WHERE execution_instance_id = $1', [j.id])).toBe(1);
    });
  });

  it('one journey per person across two lists and two selections; repeated and interleaved runs add none', async () => {
    await inRollback(async () => {
      await seedTenants();
      const actor = await newUser();
      const ps = [await newProspect(ORG_A), await newProspect(ORG_A)];
      const campaignId = await selectedCampaign(actor, ps, [ps[0]]);
      await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 's2', origin: 'human', actorUserId: actor });
      expect(await targetRows(campaignId)).toBe(6);
      const { workflowId } = await newWorkflow(ORG_A, actor);
      const [a, b] = await Promise.all([
        enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId }),
        enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId }),
      ]);
      expect(a.enrolled + b.enrolled).toBe(2);
      expect(await journeyRows(campaignId)).toBe(2);
      expect(await enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId })).toMatchObject({ enrolled: 0, alreadyEnrolled: 2, population: 2, targets: 6 });
      expect(await journeyRows(campaignId)).toBe(2);
    });
  });

  it('existing journeys stay pinned when a newer version is published; the journey report reflects the database', async () => {
    await inRollback(async () => {
      await seedTenants();
      const actor = await newUser();
      const p1 = await newProspect(ORG_A);
      const campaignId = await selectedCampaign(actor, [p1]);
      const { workflowId, versionId: v1 } = await newWorkflow(ORG_A, actor);
      await enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId });
      const v2 = await publishVersion(ORG_A, workflowId, actor, { steps: [...STEPS, { key: 'follow', channel: 'internal', delay_after_previous_hours: 24, execution_mode: 'human' }] });
      expect(v2).not.toBe(v1);
      const p2 = await newProspect(ORG_A);
      const listId = String((await one('SELECT list_id FROM public.prospect_campaign_lists WHERE campaign_id=$1', [campaignId])).list_id);
      await lists.addProspectToList(store, { organizationId: ORG_A, listId, prospectId: p2, addedVia: 'manual', actorUserId: actor });
      await selectCampaignTargets({ organizationId: ORG_A, campaignId, selectionKey: 's2', origin: 'human', actorUserId: actor });
      expect(await enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId })).toMatchObject({ enrolled: 1, alreadyEnrolled: 1, workflowVersionId: v2 });
      const pins = (await db.query('SELECT subject_id, workflow_version_id FROM public.execution_instances WHERE campaign_id=$1', [campaignId])).rows;
      expect(Object.fromEntries(pins.map((r) => [r.subject_id, r.workflow_version_id]))).toEqual({ [p1]: v1, [p2]: v2 });

      const report = await buildJourneyReport({ organizationId: ORG_A, workflowId, now: new Date().toISOString() });
      expect(report.runsRead).toBe(2);
      const byVersion = Object.fromEntries(report.versions.map((v: Row) => [v.workflowVersionId, v.enrolled]));
      expect(byVersion).toEqual({ [v1]: 1, [v2]: 1 });
      expect(await buildJourneyReport({ organizationId: ORG_B, workflowId })).toBeNull();
    });
  });

  it('refuses cross-tenant targets, workflows and campaigns, and a target of another campaign', async () => {
    await inRollback(async () => {
      await seedTenants();
      const actor = await newUser();
      const p = await newProspect(ORG_A);
      const campaignId = await selectedCampaign(actor, [p]);
      const t = String((await one('SELECT id FROM public.prospect_campaign_targets WHERE campaign_id=$1', [campaignId])).id);
      const { workflowId } = await newWorkflow(ORG_A, actor);
      const foreignWf = await newWorkflow(ORG_B, actor);
      const campaignB = await newCampaign(ORG_B);
      const create = (o: Row) => instances.createExecutionInstance({ organizationId: ORG_A, campaignId, workflowId, subjectKind: 'prospect', subjectId: p, targetId: t, ...o });
      // Another tenant's target answers exactly like a mismatched one (no existence leak).
      const pB = await newProspect(ORG_B);
      expect(await codeOf(create({ organizationId: ORG_B, campaignId: campaignB, workflowId: foreignWf.workflowId, subjectId: pB }))).toBe('target_mismatch');
      expect(await codeOf(create({ organizationId: ORG_B, campaignId: campaignB, workflowId: foreignWf.workflowId }))).toBe('subject_not_found');
      expect(await codeOf(create({ workflowId: foreignWf.workflowId }))).toBe('workflow_not_found');
      expect(await codeOf(create({ campaignId: await newCampaign(ORG_A) }))).toBe('target_mismatch');
      expect(await codeOf(enrollCampaignTargets({ organizationId: ORG_B, campaignId, workflowId }))).toBe('campaign_not_found');
      expect(await enrollCampaignTargets({ organizationId: ORG_A, campaignId, workflowId: foreignWf.workflowId }))
        .toMatchObject({ enrolled: 0, excluded: 1, exclusionReasons: { no_published_version: 1 } });
      expect(await journeyRows(campaignId)).toBe(0);
    });
  });

  it('where 20261231 has not run: targeting, targets and target enrollment refuse explicitly', async () => {
    await inRollback(async () => {
      await seedTenants();
      const actor = await newUser();
      const p = await newProspect(ORG_A);
      const campaignId = await newCampaign(ORG_A);
      const { workflowId } = await newWorkflow(ORG_A, actor);
      // Transactional DDL, rolled back with the test: the database as it is BEFORE 20261231.
      await db.query('ALTER TABLE public.execution_instances DROP CONSTRAINT execution_instances_target_tenant_fk');
      await db.query('DROP TABLE public.prospect_campaign_targets');
      await db.query('DROP TABLE public.prospect_campaign_lists');
      await db.query('ALTER TABLE public.prospect_campaigns DROP COLUMN targeting_mode CASCADE, DROP COLUMN icp_id CASCADE, DROP COLUMN icp_version CASCADE, DROP COLUMN min_icp_score CASCADE');
      await db.query('ALTER TABLE public.prospect_lists DROP COLUMN icp_id CASCADE');
      expect(await codeOf(instances.createExecutionInstance({
        organizationId: ORG_A, campaignId, workflowId, subjectKind: 'prospect', subjectId: p, targetId: '00000000-0000-4000-8000-0000000000ff',
      }))).toBe('targets_not_installed');
      expect(await codeOf(targets.listCampaignTargets(ORG_A, campaignId))).toBe('targets_schema_missing');
      expect(await codeOf(campaigns.getCampaignTargeting(ORG_A, campaignId))).toBe('targeting_schema_missing');
      expect(await codeOf(store.getListIcp(ORG_A, await newList(ORG_A, actor, [])))).toBe('targeting_schema_missing');
      expect(await campaigns.getProspectCampaign(ORG_A, campaignId)).toMatchObject({ id: campaignId });
      // A journey WITHOUT a target is still possible: 20261228 alone works.
      expect((await instances.createExecutionInstance({ organizationId: ORG_A, campaignId, workflowId, subjectKind: 'prospect', subjectId: p })).targetId).toBeNull();
    });
  });
});

// ── Two sessions racing on the real unique index ────────────────────────────

describe('concurrency — two database sessions create the same journey at once', () => {
  const ORG_C = '00000000-0000-4000-8000-0000000000c3';
  it('exactly one journey exists; the loser sees the unique violation', async () => {
    const other = new Client({ connectionString: process.env.W6_DB_URL });
    await other.connect();
    let actor = '';
    try {
      // Committed fixtures in a dedicated tenant, removed afterwards.
      await db.query('BEGIN');
      await db.query('INSERT INTO public.companies (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [ORG_C, 'Orch race tenant']);
      actor = await newUser();
      const p = await newProspect(ORG_C);
      const campaignId = await newCampaign(ORG_C);
      const listId = await newList(ORG_C, actor, [p]);
      await attach.attachListToCampaign({ organizationId: ORG_C, campaignId, listId, actorUserId: actor });
      await selectCampaignTargets({ organizationId: ORG_C, campaignId, selectionKey: 'race', origin: 'human', actorUserId: actor });
      const t = String((await one('SELECT id FROM public.prospect_campaign_targets WHERE campaign_id=$1', [campaignId])).id);
      const { workflowId } = await newWorkflow(ORG_C, actor);
      await db.query('COMMIT');

      const call ='SELECT public.create_execution_instance(p_organization_id => $1, p_campaign_id => $2, p_workflow_id => $3, p_subject_kind => $4, p_subject_id => $5, p_target_id => $6) AS id';
      const args = [ORG_C, campaignId, workflowId, 'prospect', p, t];
      await db.query('BEGIN');
      await other.query('BEGIN');
      await db.query(call, args);
      const loser = other.query(call, args).then(() => 'ok', (e: { code?: string }) => String(e.code));
      await new Promise((r) => setTimeout(r, 300));        // the second session is now blocked on the index
      await db.query('COMMIT');
      expect(await loser).toBe('23505');
      await other.query('ROLLBACK');
      expect(await journeyRows(campaignId)).toBe(1);
    } finally {
      await other.end();
      await db.query('ROLLBACK').catch(() => undefined);
      // Remove only what this test created: the tenant's rows go with it.
      await db.query('DELETE FROM public.execution_instances WHERE organization_id = $1', [ORG_C]);
      await db.query('DELETE FROM public.prospect_campaign_targets WHERE organization_id = $1', [ORG_C]);
      await db.query('DELETE FROM public.companies WHERE id = $1', [ORG_C]);
      if (actor) await db.query('DELETE FROM public.users WHERE id = $1', [actor]);
    }
    for (const t of ['prospect_campaigns', 'prospect_lists', 'canonical_leads', 'workflows', 'execution_instances', 'prospect_campaign_targets']) {
      const col = t === 'canonical_leads' ? 'company_id' : 'organization_id';
      expect({ t, n: await count(`SELECT count(*) n FROM public.${t} WHERE ${col} = $1`, [ORG_C]) }).toEqual({ t, n: 0 });
    }
  });
});

// ── Routes: membership, then capability, then work ─────────────────────────

describe('routes — membership and ICP-management permission are checked before any write', () => {
  const call = async (route: (req: unknown, res: unknown) => Promise<unknown>, req: Row) => {
    const out = { status: 0, body: null as unknown };
    const res = { status: (n: number) => { out.status = n; return res; }, json: (b: unknown) => { out.body = b; return res; }, setHeader: () => res };
    await route(req, res);
    return out;
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const selectRoute = require('../../../pages/api/prospect-campaigns/[id]/select').default;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const enrollRoute = require('../../../pages/api/prospect-campaigns/[id]/enroll').default;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const targetingRoute = require('../../../pages/api/prospect-campaigns/[id]/targeting').default;

  afterEach(() => { gate.access = null; gate.capability = true; });

  it('a non-member, then a member without the capability, write nothing; an authorized member selects as themself', async () => {
    await inRollback(async () => {
      await seedTenants();
      const actor = await newUser();
      const p = await newProspect(ORG_A);
      const campaignId = await newCampaign(ORG_A);
      const listId = await newList(ORG_A, actor, [p]);
      await attach.attachListToCampaign({ organizationId: ORG_A, campaignId, listId, actorUserId: actor });
      const req = { method: 'POST', query: { id: campaignId, company_id: ORG_A }, body: { selectionKey: 'route', actorUserId: '00000000-0000-4000-8000-000000000bad', company_id: ORG_B } };

      gate.access = null;
      expect((await call(selectRoute, req)).status).toBe(403);
      gate.access = { userId: actor }; gate.capability = false;
      expect((await call(selectRoute, req)).status).toBe(403);
      expect((await call(targetingRoute, { method: 'PUT', query: { id: campaignId, company_id: ORG_A }, body: { mode: 'manual' } })).status).toBe(403);
      expect(await targetRows(campaignId)).toBe(0);

      gate.capability = true;
      const ok = await call(selectRoute, req);
      expect(ok.status).toBe(200);
      const t = await one('SELECT organization_id, actor_user_id, origin FROM public.prospect_campaign_targets WHERE campaign_id=$1', [campaignId]);
      expect(t).toEqual({ organization_id: ORG_A, actor_user_id: actor, origin: 'human' });

      const { workflowId } = await newWorkflow(ORG_A, actor);
      gate.capability = false;
      expect((await call(enrollRoute, { method: 'POST', query: { id: campaignId, company_id: ORG_A }, body: { workflowId } })).status).toBe(403);
      expect(await journeyRows(campaignId)).toBe(0);
      gate.capability = true;
      const enrolled = await call(enrollRoute, { method: 'POST', query: { id: campaignId, company_id: ORG_A }, body: { workflowId } });
      expect(enrolled.status).toBe(200);
      expect(await journeyRows(campaignId)).toBe(1);
    });
  });

  it('a campaign of another tenant is not found through the route', async () => {
    await inRollback(async () => {
      await seedTenants();
      const campaignId = await newCampaign(ORG_A);
      gate.access = { userId: await newUser() };
      const out = await call(selectRoute, { method: 'POST', query: { id: campaignId, company_id: ORG_B }, body: { selectionKey: 'x' } });
      expect(out.status).toBe(404);
    });
  });
});
