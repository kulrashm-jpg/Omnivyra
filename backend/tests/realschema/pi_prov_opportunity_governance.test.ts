/**
 * Closure-D — opportunity lifecycle governance against real PostgreSQL.
 *
 * Migration exercised: 20270109000003_pi_opportunity_governance.sql
 * (snooze-terminal guard, append-only opportunity_dispositions, composite
 * tenant FKs on opportunity_lifecycle_states / opportunity_notes), on top of
 * 20270107000000 and 20270108000000.
 *
 * A green run here concerns a disposable database built from the committed
 * baseline plus replayed migrations. It is NOT evidence about production.
 *
 * WHAT IS REAL. Constraint/trigger behaviour is measured with plain SQL. The
 * application side runs the shipped services (`snoozeOpportunity`,
 * `assignOpportunity`, `transitionLifecycle`, `initialiseLifecycleForOpportunity`,
 * `readCurrentLifecycleState`, `addOpportunityNote`) through the same
 * `ownedDbTable` → SQL translator technique as
 * pi_prov_opportunity_lifecycle.test.ts (one SAVEPOINT per call, because in
 * production each call is its own request; `clock_timestamp()` stamps so rows
 * of one test get distinct times like production requests do).
 *
 * CONCURRENCY. Two-session tests cannot use inRollback(): a second session
 * only sees committed work. They commit fixtures under a throwaway tenant
 * created per test and remove it by deleting the tenant — which is itself the
 * proof that the tenant cascade through the append-only dispositions works.
 * Those fixtures carry no lifecycle rows (lifecycle rows block a tenant delete
 * by design, 20260520) except in the terminal-race test, which leaves its
 * throwaway tenant behind and says so.
 */

import { Client } from 'pg';
import { db, inRollback, seedTenants, newLead, ORG_A, ORG_B } from './setup';

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const { db: client } = require('./setup') as {
      db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };
    };
    type Filter = { col: string; op: '=' | 'is' | '<=' | 'in'; val: unknown };
    const st = {
      op: 'select' as 'select' | 'insert' | 'update',
      cols: '*',
      payload: null as Record<string, unknown> | null,
      filters: [] as Filter[],
      order: [] as Array<{ col: string; asc: boolean }>,
      limit: null as number | null,
    };
    const STAMP: Record<string, string> = {
      opportunity_lifecycle_states: 'transitioned_at',
      opportunity_assignments: 'created_at',
      opportunity_dispositions: 'created_at',
      opportunity_notes: 'created_at',
    };
    let sp = 0;
    const where = (params: unknown[]): string => {
      if (st.filters.length === 0) return '';
      return ` WHERE ${st.filters.map((f) => {
        if (f.op === 'is') return `"${f.col}" IS NULL`;
        params.push(f.val);
        if (f.op === 'in') return `"${f.col}" = ANY($${params.length})`;
        return `"${f.col}" ${f.op} $${params.length}`;
      }).join(' AND ')}`;
    };
    const run = async (sql: string, params: unknown[]) => {
      const name = `og_sp_${++sp}_${Math.random().toString(36).slice(2, 8)}`;
      await client.query(`SAVEPOINT ${name}`);
      try {
        const res = await client.query(sql, params);
        await client.query(`RELEASE SAVEPOINT ${name}`);
        return { rows: res.rows, error: null as null | { code: string; message: string } };
      } catch (e: unknown) {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        return {
          rows: [] as Array<Record<string, unknown>>,
          error: {
            code: String((e as { code?: unknown })?.code ?? 'unknown'),
            message: String((e as { message?: unknown })?.message ?? 'unknown'),
          },
        };
      }
    };
    const normalize = (row: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
      return out;
    };
    const exec = async (mode: 'many' | 'maybe' | 'single'): Promise<Record<string, unknown>> => {
      const params: unknown[] = [];
      if (st.op === 'insert') {
        const payload = { ...(st.payload ?? {}) };
        const keys = Object.keys(payload);
        const cols = keys.map((k) => `"${k}"`);
        const vals = keys.map((k) => {
          const v = payload[k];
          params.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
          return `$${params.length}`;
        });
        const stamp = STAMP[table];
        if (stamp && !(stamp in payload)) { cols.push(`"${stamp}"`); vals.push('clock_timestamp()'); }
        const r = await run(`INSERT INTO public."${table}" (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING *`, params);
        if (r.error) return { data: null, error: r.error };
        return { data: normalize(r.rows[0] ?? {}), error: null };
      }
      if (st.op === 'update') {
        const payload = st.payload ?? {};
        const sets = Object.keys(payload).map((k) => { params.push(payload[k]); return `"${k}" = $${params.length}`; });
        const r = await run(`UPDATE public."${table}" SET ${sets.join(', ')}${where(params)} RETURNING *`, params);
        if (r.error) return { data: null, error: r.error };
        const rows = r.rows.map(normalize);
        return { data: mode === 'many' ? rows : (rows[0] ?? null), error: null };
      }
      const clause = where(params);
      const cols = st.cols === '*' ? '*' : st.cols.split(',').map((c) => `"${c.trim()}"`).join(', ');
      const order = st.order.length ? ` ORDER BY ${st.order.map((o) => `"${o.col}" ${o.asc ? 'ASC' : 'DESC'}`).join(', ')}` : '';
      const limit = st.limit != null ? ` LIMIT ${st.limit}` : (mode === 'many' ? '' : ' LIMIT 1');
      const r = await run(`SELECT ${cols} FROM public."${table}"${clause}${order}${limit}`, params);
      if (r.error) return { data: null, error: r.error };
      const rows = r.rows.map(normalize);
      if (mode === 'many') return { data: rows, error: null };
      return { data: rows[0] ?? null, error: null };
    };
    const b: Record<string, unknown> = {
      select: (cols?: string) => { if (typeof cols === 'string' && st.op === 'select') st.cols = cols; return b; },
      insert: (p: Record<string, unknown>) => { st.op = 'insert'; st.payload = p; return b; },
      update: (p: Record<string, unknown>) => { st.op = 'update'; st.payload = p; return b; },
      eq: (c: string, v: unknown) => { st.filters.push({ col: c, op: '=', val: v }); return b; },
      is: (c: string, v: unknown) => { if (v !== null) throw new Error('translator: only is(col, null)'); st.filters.push({ col: c, op: 'is', val: null }); return b; },
      lte: (c: string, v: unknown) => { st.filters.push({ col: c, op: '<=', val: v }); return b; },
      in: (c: string, v: unknown[]) => { st.filters.push({ col: c, op: 'in', val: v }); return b; },
      order: (c: string, o?: { ascending?: boolean }) => { st.order.push({ col: c, asc: o?.ascending !== false }); return b; },
      limit: (n: number) => { st.limit = n; return b; },
      maybeSingle: () => exec('maybe'),
      single: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

import {
  initialiseLifecycleForOpportunity,
  readCurrentLifecycleState,
  transitionLifecycle,
} from '../../services/opportunityLifecycleService';
import {
  addOpportunityNote,
  assignOpportunity,
  readOpportunitySnooze,
  setOpportunityDisposition,
  snoozeOpportunity,
} from '../../services/opportunityWorkflowService';
import { classifyLifecycleGuardError } from '../../services/lifecycleGuardErrors';
import { OpportunitySnoozeRefusedError, SNOOZE_TERMINAL_LIFECYCLE_STATES } from '../../../lib/prospectOpportunity/snooze';
import type { LifecycleState } from '../../types/opportunityLifecycle';

const DB_URL = process.env.W6_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(DB_URL)) {
  throw new Error(`pi_prov_opportunity_governance refuses a non-loopback W6_DB_URL: ${DB_URL.replace(/:[^:@]+@/, ':***@')}`);
}

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);
const rnd = () => Math.random().toString(36).slice(2, 10);
const LATER = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

async function user(tag: string, c: { query: typeof q } = { query: q }): Promise<string> {
  const { rows } = await c.query(`INSERT INTO public.users (email) VALUES ($1) RETURNING id`, [`og-${tag}-${rnd()}@example.test`]);
  return rows[0].id;
}
async function feed(org: string, type = 'buying_intent', c: { query: typeof q } = { query: q }): Promise<string> {
  const { rows: s } = await c.query(
    `INSERT INTO public.lead_signals (organization_id, source_type, source_id, platform, detected_at, migration_source)
     VALUES ($1,'listening',$2,'reddit',now(),'pi-prov-og') RETURNING id`, [org, `og-${rnd()}`]);
  const { rows } = await c.query(
    `INSERT INTO public.opportunity_feed_items (organization_id, signal_id, opportunity_type, detected_reason, platform)
     VALUES ($1,$2,$3,'pi-prov-og','reddit') RETURNING id`, [org, s[0].id, type]);
  return rows[0].id;
}

/** Attempt and return 'ok' or `${sqlstate}:${constraint}`. */
async function violated(sql: string, p: unknown[] = []): Promise<string> {
  await q('SAVEPOINT v');
  try {
    await q(sql, p);
    await q('RELEASE SAVEPOINT v');
    return 'ok';
  } catch (e: any) {
    await q('ROLLBACK TO SAVEPOINT v');
    return `${e.code}:${e.constraint ?? ''}`;
  }
}
/** Attempt and return the raw error (or null). */
async function capture(sql: string, p: unknown[] = []): Promise<any> {
  await q('SAVEPOINT c');
  try {
    await q(sql, p);
    await q('RELEASE SAVEPOINT c');
    return null;
  } catch (e: any) {
    await q('ROLLBACK TO SAVEPOINT c');
    return e;
  }
}

async function driveTo(org: string, item: string, target: LifecycleState, actor: string): Promise<void> {
  const paths: Record<LifecycleState, LifecycleState[]> = {
    detected: [], triaged: ['triaged'], reviewing: ['triaged', 'reviewing'], qualified: ['triaged', 'qualified'],
    monitoring: ['triaged', 'qualified', 'monitoring'], outreach_planned: ['triaged', 'qualified', 'outreach_planned'],
    converted: ['triaged', 'qualified', 'monitoring', 'converted'], dismissed: ['dismissed'], archived: ['archived'],
  };
  await initialiseLifecycleForOpportunity({ organizationId: org, opportunityFeedItemId: item });
  for (const to of paths[target]) await transitionLifecycle({ organizationId: org, opportunityFeedItemId: item, to, actorUserId: actor, reasoning: 'og' });
}

const snoozeSql = `INSERT INTO public.opportunity_dispositions (organization_id, opportunity_feed_item_id, disposition, snoozed_until)
                   VALUES ($1,$2,'revisit_later', now() + interval '1 day')`;

// ─── Context ────────────────────────────────────────────────────────────────

describe('context — the objects this suite relies on', () => {
  it('all four workflow tables carry a validated composite tenant FK ON DELETE CASCADE', async () => {
    const { rows } = await q(
      `SELECT c.conname, cl.relname, c.convalidated, c.confdeltype, pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid
        WHERE c.conname IN ('opp_lifecycle_item_tenant_fk','opp_notes_item_tenant_fk','opp_dispositions_item_tenant_fk','opp_assignments_item_tenant_fk')
        ORDER BY c.conname`);
    expect(rows.map((r) => [r.conname, r.relname, r.convalidated, r.confdeltype])).toEqual([
      ['opp_assignments_item_tenant_fk', 'opportunity_assignments', true, 'c'],
      ['opp_dispositions_item_tenant_fk', 'opportunity_dispositions', true, 'c'],
      ['opp_lifecycle_item_tenant_fk', 'opportunity_lifecycle_states', true, 'c'],
      ['opp_notes_item_tenant_fk', 'opportunity_notes', true, 'c'],
    ]);
    for (const r of rows) expect(r.def).toMatch(/^FOREIGN KEY \(opportunity_feed_item_id, organization_id\) REFERENCES (public\.)?opportunity_feed_items\(id, organization_id\) ON DELETE CASCADE$/);
  });

  it('dispositions carry three BEFORE row triggers; the lifecycle guards are unchanged', async () => {
    const trig = async (rel: string) => (await q(
      `SELECT tgname, (tgtype & 2) <> 0 AS before, (tgtype & 1) <> 0 AS row_level, tgenabled
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = $1 AND NOT t.tgisinternal ORDER BY tgname`, [rel])).rows;
    const d = await trig('opportunity_dispositions');
    expect(d.map((r) => r.tgname)).toEqual(['opp_disposition_block_delete', 'opp_disposition_block_update', 'opp_disposition_snooze_guard']);
    for (const r of d) expect([r.before, r.row_level, r.tgenabled]).toEqual([true, true, 'O']);
    expect((await trig('opportunity_lifecycle_states')).map((r) => r.tgname)).toEqual(['opp_lifecycle_block_delete', 'opp_lifecycle_block_update']);
  });
});

// ─── Tenant isolation ───────────────────────────────────────────────────────

describe('cross-tenant references are refused by PostgreSQL (23503)', () => {
  it('lifecycle states, notes, dispositions and assignments', async () => {
    await inRollback(async () => {
      await seedTenants();
      const u = await user('x');
      const fA = await feed(ORG_A);
      expect(await violated(
        `INSERT INTO public.opportunity_lifecycle_states (organization_id, opportunity_feed_item_id, state, is_initial) VALUES ($1,$2,'detected',TRUE)`,
        [ORG_B, fA])).toBe('23503:opp_lifecycle_item_tenant_fk');
      expect(await violated(
        `INSERT INTO public.opportunity_notes (organization_id, opportunity_feed_item_id, body, visibility) VALUES ($1,$2,'x','internal')`,
        [ORG_B, fA])).toBe('23503:opp_notes_item_tenant_fk');
      expect(await violated(
        `INSERT INTO public.opportunity_dispositions (organization_id, opportunity_feed_item_id, disposition) VALUES ($1,$2,'qualified')`,
        [ORG_B, fA])).toBe('23503:opp_dispositions_item_tenant_fk');
      expect(await violated(
        `INSERT INTO public.opportunity_assignments (organization_id, opportunity_feed_item_id, assigned_to_user_id, role) VALUES ($1,$2,$3,'owner')`,
        [ORG_B, fA, u])).toBe('23503:opp_assignments_item_tenant_fk');
      // Same rows in the right tenant are fine.
      expect(await violated(
        `INSERT INTO public.opportunity_notes (organization_id, opportunity_feed_item_id, body, visibility) VALUES ($1,$2,'x','internal')`,
        [ORG_A, fA])).toBe('ok');
    });
  });

  it('through the shipped services: a cross-tenant init, note or snooze fails; nothing is written', async () => {
    await inRollback(async () => {
      await seedTenants();
      const fA = await feed(ORG_A);
      await expect(initialiseLifecycleForOpportunity({ organizationId: ORG_B, opportunityFeedItemId: fA }))
        .rejects.toThrow(/lifecycle_init_failed:.*opp_lifecycle_item_tenant_fk/);
      await expect(addOpportunityNote({ organizationId: ORG_B, opportunityFeedItemId: fA, authorUserId: null, body: 'x', visibility: 'internal' }))
        .rejects.toThrow(/^opportunity_not_found$/); // OPS-C e14b462a: FK 23503 on the item maps to OpportunityNotInTenantError
      await expect(snoozeOpportunity({ organizationId: ORG_B, opportunityFeedItemId: fA, until: LATER(), setByUserId: null, reason: null }))
        .rejects.toThrow(/^opportunity_not_found$/); // OPS-C e14b462a
      for (const t of ['opportunity_lifecycle_states', 'opportunity_notes', 'opportunity_dispositions']) {
        expect(Number((await q(`SELECT count(*) n FROM public.${t} WHERE opportunity_feed_item_id = $1`, [fA])).rows[0].n)).toBe(0);
      }
    });
  });
});

// ─── Terminal snooze ────────────────────────────────────────────────────────

describe('snooze refused on a terminal opportunity — database AND application agree', () => {
  it.each(SNOOZE_TERMINAL_LIFECYCLE_STATES.map((s) => [s]))('%s: raw INSERT is 23514 and the service throws the same error', async (state) => {
    await inRollback(async () => {
      await seedTenants();
      const u = await user('t');
      const f = await feed(ORG_A);
      await driveTo(ORG_A, f, state as LifecycleState, u);
      const err = await capture(snoozeSql, [ORG_A, f]);
      expect(err?.code).toBe('23514');
      expect(err?.constraint).toBe('opp_disposition_snooze_not_terminal');
      expect(err?.message).toContain(`is ${state};`);
      const svc = await snoozeOpportunity({ organizationId: ORG_A, opportunityFeedItemId: f, until: LATER(), setByUserId: u, reason: null }).catch((e) => e);
      expect(svc).toBeInstanceOf(OpportunitySnoozeRefusedError);
      expect(svc).toMatchObject({ reason: 'terminal', state, source: 'application' });
      expect(Number((await q(`SELECT count(*) n FROM public.opportunity_dispositions WHERE opportunity_feed_item_id = $1`, [f])).rows[0].n)).toBe(0);
    });
  });

  it.each(['detected', 'triaged', 'reviewing', 'qualified', 'monitoring', 'outreach_planned'].map((s) => [s]))(
    '%s: allowed by both, and the status is unchanged', async (state) => {
      await inRollback(async () => {
        await seedTenants();
        const u = await user('n');
        const f = await feed(ORG_A);
        await driveTo(ORG_A, f, state as LifecycleState, u);
        expect(await violated(snoozeSql, [ORG_A, f])).toBe('ok');
        await expect(snoozeOpportunity({ organizationId: ORG_A, opportunityFeedItemId: f, until: LATER(), setByUserId: u, reason: null }))
          .resolves.toMatchObject({ disposition: 'revisit_later' });
        expect(await readCurrentLifecycleState(ORG_A, f)).toMatchObject({ kind: 'present', state });
      });
    });

  it('no lifecycle history: allowed by both; untimed revisit_later and other dispositions stay allowed on a terminal item', async () => {
    await inRollback(async () => {
      await seedTenants();
      const u = await user('m');
      const fNone = await feed(ORG_A);
      expect(await violated(snoozeSql, [ORG_A, fNone])).toBe('ok');
      await expect(snoozeOpportunity({ organizationId: ORG_A, opportunityFeedItemId: fNone, until: LATER(), setByUserId: u, reason: null })).resolves.toBeTruthy();
      const fArch = await feed(ORG_A);
      await driveTo(ORG_A, fArch, 'archived', u);
      expect(await violated(`INSERT INTO public.opportunity_dispositions (organization_id, opportunity_feed_item_id, disposition) VALUES ($1,$2,'revisit_later')`, [ORG_A, fArch])).toBe('ok');
      await expect(setOpportunityDisposition({ organizationId: ORG_A, opportunityFeedItemId: fArch, disposition: 'not_relevant', reason: null, setByUserId: u }))
        .resolves.toMatchObject({ disposition: 'not_relevant' });
    });
  });

  it('the revisit_later CHECK still applies first-class (23514 on its own constraint name)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const f = await feed(ORG_A);
      expect(await violated(
        `INSERT INTO public.opportunity_dispositions (organization_id, opportunity_feed_item_id, disposition, snoozed_until) VALUES ($1,$2,'qualified', now() + interval '1 day')`,
        [ORG_A, f])).toBe('23514:opp_disposition_snooze_requires_revisit_later');
    });
  });

  it('a transitioned_at tie with a terminal row fails closed in the database (L3b)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const f = await feed(ORG_A);
      // Two rows at the same instant (storable today: no tiebreaker), one terminal.
      await q(`INSERT INTO public.opportunity_lifecycle_states (organization_id, opportunity_feed_item_id, state, is_initial, transitioned_at)
               VALUES ($1,$2,'detected',TRUE,'2026-10-01T00:00:00Z'),
                      ($1,$2,'triaged',FALSE,'2026-10-02T00:00:00Z'),
                      ($1,$2,'dismissed',FALSE,'2026-10-02T00:00:00Z')`, [ORG_A, f]);
      const err = await capture(snoozeSql, [ORG_A, f]);
      expect(err?.code).toBe('23514');
      expect(err?.message).toContain('is dismissed;');
    });
  });

  it('a dismissed opportunity reopened to triaged can be snoozed again', async () => {
    await inRollback(async () => {
      await seedTenants();
      const u = await user('r');
      const f = await feed(ORG_A);
      await driveTo(ORG_A, f, 'dismissed', u);
      await transitionLifecycle({ organizationId: ORG_A, opportunityFeedItemId: f, to: 'triaged', actorUserId: u, reasoning: 'reopen' });
      await expect(snoozeOpportunity({ organizationId: ORG_A, opportunityFeedItemId: f, until: LATER(), setByUserId: u, reason: null })).resolves.toBeTruthy();
    });
  });

  it('expiry is still by time alone (no job), and snooze never writes a lifecycle row', async () => {
    await inRollback(async () => {
      await seedTenants();
      const u = await user('e');
      const f = await feed(ORG_A);
      await driveTo(ORG_A, f, 'qualified', u);
      const now = new Date().toISOString();
      const until = new Date(Date.now() + 3_600_000).toISOString();
      const before = Number((await q(`SELECT count(*) n FROM public.opportunity_lifecycle_states WHERE opportunity_feed_item_id = $1`, [f])).rows[0].n);
      await snoozeOpportunity({ organizationId: ORG_A, opportunityFeedItemId: f, until, setByUserId: u, reason: null, now });
      expect(await readOpportunitySnooze(ORG_A, f, now)).toMatchObject({ kind: 'active', until });
      expect(await readOpportunitySnooze(ORG_A, f, until)).toMatchObject({ kind: 'expired', until });
      expect(Number((await q(`SELECT count(*) n FROM public.opportunity_lifecycle_states WHERE opportunity_feed_item_id = $1`, [f])).rows[0].n)).toBe(before);
    });
  });
});

// ─── Append-only dispositions ───────────────────────────────────────────────

describe('opportunity_dispositions is append-only', () => {
  it('UPDATE and DELETE are refused (42501, classified as append_only_violation); the row is unchanged', async () => {
    await inRollback(async () => {
      await seedTenants();
      const u = await user('a');
      const f = await feed(ORG_A);
      const d = await snoozeOpportunity({ organizationId: ORG_A, opportunityFeedItemId: f, until: LATER(), setByUserId: u, reason: 'r' });
      for (const sql of [
        `UPDATE public.opportunity_dispositions SET snoozed_until = now() + interval '30 days' WHERE id = $1`,
        `UPDATE public.opportunity_dispositions SET reason = 'edited' WHERE id = $1`,
        `UPDATE public.opportunity_dispositions SET set_by_user_id = NULL WHERE id = $1`, // not a referential action: user still exists
        `DELETE FROM public.opportunity_dispositions WHERE id = $1`,
      ]) {
        const err = await capture(sql, [d.id]);
        expect(err?.code).toBe('42501');
        expect(classifyLifecycleGuardError(err)).toMatchObject({ kind: 'append_only_violation', sqlstate: '42501' });
      }
      const { rows } = await q(`SELECT reason, set_by_user_id, snoozed_until FROM public.opportunity_dispositions WHERE id = $1`, [d.id]);
      expect(rows[0]).toMatchObject({ reason: 'r', set_by_user_id: u });
      expect(new Date(rows[0].snoozed_until).toISOString()).toBe(d.snoozed_until);
    });
  });

  it('a feed-item delete (the statement retention issues) cascades through the guard', async () => {
    await inRollback(async () => {
      await seedTenants();
      const f = await feed(ORG_A);
      await setOpportunityDisposition({ organizationId: ORG_A, opportunityFeedItemId: f, disposition: 'qualified', reason: null, setByUserId: null });
      await snoozeOpportunity({ organizationId: ORG_A, opportunityFeedItemId: f, until: LATER(), setByUserId: null, reason: null });
      await addOpportunityNote({ organizationId: ORG_A, opportunityFeedItemId: f, authorUserId: null, body: 'n', visibility: 'internal' });
      expect(await violated(`DELETE FROM public.opportunity_feed_items WHERE id = $1 AND organization_id = $2`, [f, ORG_A])).toBe('ok');
      for (const t of ['opportunity_dispositions', 'opportunity_notes']) {
        expect(Number((await q(`SELECT count(*) n FROM public.${t} WHERE opportunity_feed_item_id = $1`, [f])).rows[0].n)).toBe(0);
      }
    });
  });

  it('a lifecycle-bearing feed item is still refused by the LIFECYCLE guard (unchanged, P0001), dispositions survive with it', async () => {
    await inRollback(async () => {
      await seedTenants();
      const f = await feed(ORG_A);
      await initialiseLifecycleForOpportunity({ organizationId: ORG_A, opportunityFeedItemId: f });
      await setOpportunityDisposition({ organizationId: ORG_A, opportunityFeedItemId: f, disposition: 'qualified', reason: null, setByUserId: null });
      const err = await capture(`DELETE FROM public.opportunity_feed_items WHERE id = $1`, [f]);
      expect(err?.code).toBe('P0001');
      expect(err?.message).toContain('opportunity_lifecycle_states is append-only');
      expect(Number((await q(`SELECT count(*) n FROM public.opportunity_dispositions WHERE opportunity_feed_item_id = $1`, [f])).rows[0].n)).toBe(1);
    });
  });

  it('deleting a user nulls set_by_user_id (ON DELETE SET NULL is admitted) and changes nothing else', async () => {
    await inRollback(async () => {
      await seedTenants();
      const u = await user('del');
      const f = await feed(ORG_A);
      const d = await setOpportunityDisposition({ organizationId: ORG_A, opportunityFeedItemId: f, disposition: 'low_priority', reason: 'keep', setByUserId: u });
      expect(await violated(`DELETE FROM public.users WHERE id = $1`, [u])).toBe('ok');
      const { rows } = await q(`SELECT set_by_user_id, reason, disposition FROM public.opportunity_dispositions WHERE id = $1`, [d.id]);
      expect(rows[0]).toEqual({ set_by_user_id: null, reason: 'keep', disposition: 'low_priority' });
    });
  });

  it('a tenant delete cascades through dispositions, notes and assignments (no lifecycle rows)', async () => {
    await inRollback(async () => {
      const org = (await q(`INSERT INTO public.companies (name) VALUES ('og-tenant-del') RETURNING id`)).rows[0].id;
      const u = await user('td');
      const f = await feed(org);
      await setOpportunityDisposition({ organizationId: org, opportunityFeedItemId: f, disposition: 'qualified', reason: null, setByUserId: u });
      await addOpportunityNote({ organizationId: org, opportunityFeedItemId: f, authorUserId: u, body: 'n', visibility: 'team' });
      await assignOpportunity({ organizationId: org, opportunityFeedItemId: f, assignedToUserId: u, assignedByUserId: null, role: 'owner' });
      expect(await violated(`DELETE FROM public.companies WHERE id = $1`, [org])).toBe('ok');
      for (const t of ['opportunity_dispositions', 'opportunity_notes', 'opportunity_assignments']) {
        expect(Number((await q(`SELECT count(*) n FROM public.${t} WHERE organization_id = $1`, [org])).rows[0].n)).toBe(0);
      }
    });
  });
});

// ─── Prospect identity vs opportunity lifecycle ─────────────────────────────

describe('one prospect, several independent opportunities', () => {
  it('terminal on one opportunity does not block snoozing another; the prospect row is untouched', async () => {
    await inRollback(async () => {
      await seedTenants();
      const u = await user('p');
      const lead = await newLead(ORG_A);
      const leadBefore = (await q(`SELECT to_jsonb(l) j FROM public.canonical_leads l WHERE id = $1`, [lead])).rows[0].j;
      const f1 = await feed(ORG_A, 'buying_intent');
      const f2 = await feed(ORG_A, 'hiring_signal');
      for (const [f, t] of [[f1, 'community:og1'], [f2, 'community:og2']]) {
        await q(`INSERT INTO public.prospect_source_contributions
                   (organization_id, canonical_lead_id, contribution_role, source_category, external_ref, observed_at, platform, opportunity_feed_item_id)
                 VALUES ($1,$2,$3,'community',$4,now(),'reddit',$5)`, [ORG_A, lead, t === 'community:og1' ? 'originating' : 'contributing', t, f]);
      }
      await driveTo(ORG_A, f1, 'converted', u);
      await driveTo(ORG_A, f2, 'qualified', u);
      await expect(snoozeOpportunity({ organizationId: ORG_A, opportunityFeedItemId: f1, until: LATER(), setByUserId: u, reason: null }))
        .rejects.toThrow('snooze_refused_terminal:converted');
      await expect(snoozeOpportunity({ organizationId: ORG_A, opportunityFeedItemId: f2, until: LATER(), setByUserId: u, reason: null }))
        .resolves.toMatchObject({ opportunity_feed_item_id: f2 });
      // Prospect identity is a different entity: no lifecycle/workflow write touched it.
      expect((await q(`SELECT to_jsonb(l) j FROM public.canonical_leads l WHERE id = $1`, [lead])).rows[0].j).toEqual(leadBefore);
      const { rows } = await q(
        `SELECT count(DISTINCT opportunity_feed_item_id)::int n FROM public.prospect_source_contributions WHERE canonical_lead_id = $1`, [lead]);
      expect(rows[0].n).toBe(2);
      // Neither workflow table references the prospect: lifecycle is per opportunity.
      const cols = await q(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name IN ('opportunity_lifecycle_states','opportunity_dispositions','opportunity_assignments','opportunity_notes')
            AND column_name IN ('canonical_lead_id','prospect_id','unified_person_id')`);
      expect(cols.rows).toEqual([]);
    });
  });
});

// ─── Concurrency (two real sessions) ────────────────────────────────────────

describe('concurrency — two sessions', () => {
  const url = DB_URL;
  async function pair(): Promise<[Client, Client]> {
    const c1 = new Client({ connectionString: url });
    const c2 = new Client({ connectionString: url });
    await Promise.all([c1.connect(), c2.connect()]);
    return [c1, c2];
  }
  async function throwawayTenant(): Promise<string> {
    const { rows } = await q(`INSERT INTO public.companies (name) VALUES ($1) RETURNING id`, [`og-conc-${rnd()}`]);
    return rows[0].id;
  }

  it('one active owner per (item, role): the concurrent second assignment is refused (23505)', async () => {
    const org = await throwawayTenant();
    const [c1, c2] = await pair();
    try {
      const u1 = await user('c1');
      const u2 = await user('c2');
      const f = await feed(org);
      const ins = `INSERT INTO public.opportunity_assignments (organization_id, opportunity_feed_item_id, assigned_to_user_id, role) VALUES ($1,$2,$3,'owner')`;
      await c1.query('BEGIN');
      await c2.query('BEGIN');
      await c1.query(ins, [org, f, u1]);
      let settled = false;
      const pending = c2.query(ins, [org, f, u2]).then(() => { settled = true; return 'ok'; }, (e) => { settled = true; return `${e.code}:${e.constraint}`; });
      await new Promise((r) => setTimeout(r, 400));
      const blocked = !settled;
      await c1.query('COMMIT');
      expect(await pending).toBe('23505:uq_opp_assignment_one_active');
      await c2.query('ROLLBACK');
      expect(blocked).toBe(true);
      const { rows } = await q(`SELECT count(*)::int n FROM public.opportunity_assignments WHERE opportunity_feed_item_id = $1 AND unassigned_at IS NULL`, [f]);
      expect(rows[0].n).toBe(1);
    } finally {
      await Promise.all([c1.end(), c2.end()]);
      await q(`DELETE FROM public.companies WHERE id = $1`, [org]); // cascades assignments, feed item, signals
    }
  });

  it('a snooze racing a terminal transition observes it after the transition commits (23514, not a stale allow)', async () => {
    // Leaves this throwaway tenant behind: its lifecycle rows block the tenant
    // delete by design (append-only lifecycle, 20260520).
    const org = await throwawayTenant();
    const [c1, c2] = await pair();
    try {
      const f = await feed(org);
      await q(`INSERT INTO public.opportunity_lifecycle_states (organization_id, opportunity_feed_item_id, state, is_initial) VALUES ($1,$2,'detected',TRUE)`, [org, f]);
      await c1.query('BEGIN');
      await c2.query('BEGIN');
      await c1.query(
        `INSERT INTO public.opportunity_lifecycle_states (organization_id, opportunity_feed_item_id, state, previous_state, is_initial, transitioned_at)
         VALUES ($1,$2,'archived','detected',FALSE, clock_timestamp())`, [org, f]);
      let settled = false;
      const pending = c2.query(snoozeSql, [org, f]).then(() => { settled = true; return 'ok'; }, (e) => { settled = true; return `${e.code}:${e.constraint}`; });
      await new Promise((r) => setTimeout(r, 400));
      const blocked = !settled;
      await c1.query('COMMIT');
      expect(await pending).toBe('23514:opp_disposition_snooze_not_terminal');
      await c2.query('ROLLBACK');
      expect(blocked).toBe(true);
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
  });

  it('the service reassignment stays at exactly one active owner after two sequential calls', async () => {
    await inRollback(async () => {
      await seedTenants();
      const u1 = await user('s1');
      const u2 = await user('s2');
      const f = await feed(ORG_A);
      await assignOpportunity({ organizationId: ORG_A, opportunityFeedItemId: f, assignedToUserId: u1, assignedByUserId: null, role: 'owner' });
      await assignOpportunity({ organizationId: ORG_A, opportunityFeedItemId: f, assignedToUserId: u2, assignedByUserId: null, role: 'owner' });
      const { rows } = await q(`SELECT assigned_to_user_id FROM public.opportunity_assignments WHERE opportunity_feed_item_id = $1 AND unassigned_at IS NULL`, [f]);
      expect(rows).toEqual([{ assigned_to_user_id: u2 }]);
    });
  });
});
