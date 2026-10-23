/**
 * B3 — outcome → PI lifecycle, against real PostgreSQL.
 *
 * The REAL producer, the REAL interpreter, the REAL lifecycle writer and the REAL
 * reader, writing to the REAL schema. Nothing about the mapping or the write is
 * stubbed, and no network is involved at all — this path contacts no provider.
 *
 * What this proves that a unit test cannot: that one outcome yields exactly one
 * appended transition row, that a replay appends nothing, that the writer's own
 * legal-transition validation still governs, and that a cross-tenant outcome is
 * simply not visible.
 */

import { db, inRollback, seedTenants, ORG_A, ORG_B, newPerson, attempt } from './setup';

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const { db: client } = require('./setup') as { db: { query: Function } };
    type Filter = { col: string; op: 'eq' | 'is' | 'in'; val: unknown };
    const st = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete',
      cols: '*', payload: null as Record<string, unknown> | null,
      filters: [] as Filter[], order: null as { col: string; asc: boolean } | null,
      limit: null as number | null, mode: 'many' as 'many' | 'one',
    };
    const normalize = (row: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
      return out;
    };
    const where = (params: unknown[]): string => {
      if (st.filters.length === 0) return '';
      const parts = st.filters.map((f) => {
        if (f.op === 'is' && f.val === null) return `"${f.col}" IS NULL`;
        if (f.op === 'in') {
          const list = (f.val as unknown[]).map((v) => { params.push(v); return `$${params.length}`; });
          return `"${f.col}" IN (${list.join(', ')})`;
        }
        params.push(f.val);
        return `"${f.col}" = $${params.length}`;
      });
      return ` WHERE ${parts.join(' AND ')}`;
    };
    const exec = async () => {
      const params: unknown[] = [];
      const render = (v: unknown) =>
        (Array.isArray(v) ? v : (v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
      let sql: string;
      if (st.op === 'insert') {
        const row = st.payload ?? {};
        const keys = Object.keys(row);
        sql = `INSERT INTO public."${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (`
          + keys.map((k) => { params.push(render(row[k])); return `$${params.length}`; }).join(', ')
          + `) RETURNING ${st.cols}`;
      } else if (st.op === 'update') {
        const row = st.payload ?? {};
        const sets = Object.keys(row).map((k) => {
          params.push(render(row[k])); return `"${k}" = $${params.length}`;
        }).join(', ');
        sql = `UPDATE public."${table}" SET ${sets}${where(params)} RETURNING ${st.cols}`;
      } else if (st.op === 'delete') {
        sql = `DELETE FROM public."${table}"${where(params)} RETURNING ${st.cols}`;
      } else {
        sql = `SELECT ${st.cols} FROM public."${table}"${where(params)}`;
        if (st.order) sql += ` ORDER BY "${st.order.col}" ${st.order.asc ? 'ASC' : 'DESC'}`;
        if (st.limit !== null) sql += ` LIMIT ${st.limit}`;
      }
      await client.query('SAVEPOINT pg_adapter');
      try {
        const res = await client.query(sql, params) as { rows: unknown[] };
        await client.query('RELEASE SAVEPOINT pg_adapter');
        const out = (res.rows as Record<string, unknown>[]).map(normalize);
        if (st.mode === 'one') return { data: out[0] ?? null, error: null };
        return { data: out, error: null };
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT pg_adapter');
        return { data: null, error: err };
      }
    };
    const b: Record<string, unknown> = {
      select: (cols?: string) => { if (cols) st.cols = cols; return b; },
      insert: (row: Record<string, unknown>) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Record<string, unknown>) => { st.op = 'update'; st.payload = row; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (col: string, val: unknown) => { st.filters.push({ col, op: 'eq', val }); return b; },
      is: (col: string, val: unknown) => { st.filters.push({ col, op: 'is', val }); return b; },
      in: (col: string, val: unknown[]) => { st.filters.push({ col, op: 'in', val }); return b; },
      order: (col: string, opts?: { ascending?: boolean }) => {
        st.order = { col, asc: opts?.ascending !== false }; return b;
      },
      limit: (n: number) => { st.limit = n; return b; },
      single: () => { st.mode = 'one'; return b; },
      maybeSingle: () => { st.mode = 'one'; return b; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return b;
  },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { produceLifecycleFromOutcome } = require('../../services/prospectLifecycle/outcomeLifecycleProducer');
const {
  ensureProspectLifecycleOpen, recordProspectTransition,
} = require('../../services/prospectLifecycle/lifecycleWriter');
/* eslint-enable @typescript-eslint/no-var-requires */

const NOW = '2026-10-06T12:00:00.000Z';
const LATER = '2026-10-07T12:00:00.000Z';
/**
 * `prospect_lifecycle_transitions.actor_user_id` references `users(id)`, so an
 * operator must be a REAL user — a fictional uuid is refused with 23503. Seeded
 * once; the id is read at use.
 */
let ACTOR = '';
async function seedActor(): Promise<string> {
  if (ACTOR) return ACTOR;
  const { rows } = await db.query(
    `INSERT INTO public.users (email) VALUES ($1) RETURNING id`, [`b3-actor-${rnd()}@example.test`]);
  ACTOR = rows[0].id as string;
  return ACTOR;
}

const rnd = () => Math.random().toString(36).slice(2);

async function newProspect(org: string, personId: string | null): Promise<string> {
  const key = `b3-${rnd()}`;
  const { rows: u } = await db.query(
    `INSERT INTO public.canonical_users (company_id, user_type, device, external_user_key)
     VALUES ($1,'known','desktop',$2) RETURNING id`, [org, `${key}-u`]);
  const { rows } = await db.query(
    `INSERT INTO public.canonical_leads (company_id, user_id, source, external_lead_key, unified_person_id)
     VALUES ($1,$2,'b3',$3,$4) RETURNING id`, [org, u[0].id, key, personId]);
  return rows[0].id as string;
}

async function newTask(org: string, personId: string | null): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.outreach_tasks (company_id, lead_id, plan_task_id, channel, action,
        status, planner_version, translation_version, governance_version,
        execution_runtime_version, materialized_at, person_id)
     VALUES ($1,$2,$3,'email','Say hello','pending','p','t','g','r', now(), $4) RETURNING id`,
    [org, `b3-lead-${rnd()}`, `b3-task-${rnd()}`, personId]);
  return rows[0].id as string;
}

async function newOutcome(
  org: string, taskId: string, type: string, over: Record<string, unknown> = {},
): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.outreach_outcomes
       (company_id, task_id, outcome_type, derived, occurred_at, source, provider, provider_event_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [org, taskId, type, over.derived ?? false, over.occurredAt ?? NOW,
      over.source ?? 'manual', over.provider ?? null, over.providerEventId ?? null]);
  return rows[0].id as string;
}

const transitionsFor = async (prospectId: string) => {
  const { rows } = await db.query(
    `SELECT seq, organization_id, state, previous_state, is_initial, origin, evidence_kind,
            evidence_outcome_id, source_event_key, actor_user_id, model_version, reasoning
       FROM public.prospect_lifecycle_transitions
      WHERE prospect_id=$1 ORDER BY seq`, [prospectId]);
  return rows as Array<Record<string, unknown>>;
};

/**
 * Open the ledger at a given state THROUGH THE WRITER.
 *
 * Deliberately not a raw INSERT: `seq` is GENERATED ALWAYS, `evidence_kind` has a
 * six-value CHECK and `previous_state` is the writer's bookkeeping. Hand-rolling
 * the row means fighting the schema and proving less — the writer already knows
 * how to open a ledger and how to move it legally.
 */
async function openAt(org: string, prospectId: string, state: string): Promise<void> {
  const opened = await ensureProspectLifecycleOpen({ organizationId: org, prospectId, now: NOW });
  if (!opened.wrote) throw new Error(`openAt: the ledger did not open for ${prospectId}`);
  if (state === 'identified') return;
  const moved = await recordProspectTransition({
    organizationId: org,
    prospectId,
    to: state,
    origin: 'derived',
    evidence: { kind: 'icp_evaluation', detail: { reason: 'b3_test_setup' } },
    reasoning: 'b3 test setup',
    now: NOW,
  });
  if (!moved.wrote) throw new Error(`openAt: could not reach ${state} (got ${moved.outcome})`);
}


/** The whole chain for one tenant, returning everything the producer needs. */
async function scenario(org: string, type: string, opts: { state?: string | null } = {}) {
  const personId = await newPerson(org);
  const prospectId = await newProspect(org, personId);
  const taskId = await newTask(org, personId);
  const outcomeId = await newOutcome(org, taskId, type);
  if (opts.state !== null) await openAt(org, prospectId, opts.state ?? 'identified');
  return { personId, prospectId, taskId, outcomeId };
}

beforeAll(async () => { await seedTenants(); });

// ════════════════════════════════════════════════════════════════════════════
describe('B3 — a supported outcome produces exactly one transition', () => {
  it('replied -> engaged: one appended row, with the interpreter\'s provenance', async () => {
    await inRollback(async () => {
      const s = await scenario(ORG_A, 'replied');
      const r = await produceLifecycleFromOutcome(
        { organizationId: ORG_A, outcomeId: s.outcomeId, now: NOW });

      expect(r.refusal).toBeNull();
      expect(r.wrote).toBe(true);
      expect(r.outcome).toBe('moved');
      expect(r.state).toBe('engaged');
      expect(r.prospectId).toBe(s.prospectId);

      const rows = await transitionsFor(s.prospectId);
      expect(rows).toHaveLength(2);                 // the opening row, plus ours
      const t = rows[1];
      expect(t.organization_id).toBe(ORG_A);
      expect(t.state).toBe('engaged');
      expect(t.previous_state).toBe('identified');
      expect(t.origin).toBe('derived');
      expect(t.evidence_kind).toBe('outreach_outcome');
      expect(t.evidence_outcome_id).toBe(s.outcomeId);   // cites its cause
      expect(t.source_event_key).toBe(`outcome:${s.outcomeId}`);
      expect(t.actor_user_id).toBeNull();
      expect(t.model_version).toBeTruthy();
      expect(String(t.reasoning)).toMatch(/reply|human response/i);
    });
  });

  it('a REPLAY of the same outcome appends nothing', async () => {
    await inRollback(async () => {
      const s = await scenario(ORG_A, 'replied');
      const first = await produceLifecycleFromOutcome(
        { organizationId: ORG_A, outcomeId: s.outcomeId, now: NOW });
      const second = await produceLifecycleFromOutcome(
        { organizationId: ORG_A, outcomeId: s.outcomeId, now: LATER });

      expect(first.wrote).toBe(true);
      expect(second.wrote).toBe(false);
      // Refused by the INTERPRETER, not by the writer's key suppression: the first
      // transition moved the prospect to `engaged`, and re-reading `replied` from
      // `engaged` proposes nothing. Key-based suppression is the backstop behind
      // that, and it is still in place — both readings mint the same key.
      expect(second.refusal).toBe('no_transition');
      expect(second.prospectId).toBe(s.prospectId);
      expect(await transitionsFor(s.prospectId)).toHaveLength(2);   // nothing appended
      const rows = await transitionsFor(s.prospectId);
      expect(rows[1].source_event_key).toBe(`outcome:${s.outcomeId}`);
    });
  });

  it('unsubscribed -> closed_disqualified', async () => {
    await inRollback(async () => {
      const s = await scenario(ORG_A, 'unsubscribed');
      const r = await produceLifecycleFromOutcome(
        { organizationId: ORG_A, outcomeId: s.outcomeId, now: NOW });
      expect(r.wrote).toBe(true);
      expect(r.state).toBe('closed_disqualified');
      expect((await transitionsFor(s.prospectId))[1].origin).toBe('derived');
    });
  });

  it('rejected needs an operator: refused without one, written as human with one', async () => {
    await inRollback(async () => {
      const a = await scenario(ORG_A, 'rejected', { state: 'engaged' });
      const refused = await produceLifecycleFromOutcome(
        { organizationId: ORG_A, outcomeId: a.outcomeId, now: NOW });
      expect(refused.refusal).toBe('human_origin_requires_actor');
      // Two rows of SETUP (opened at identified, moved to engaged) and none of ours.
      expect(await transitionsFor(a.prospectId)).toHaveLength(2);

      const b = await scenario(ORG_A, 'rejected', { state: 'engaged' });
      const actor = await seedActor();
      const written = await produceLifecycleFromOutcome(
        { organizationId: ORG_A, outcomeId: b.outcomeId, now: NOW, actorUserId: actor });
      expect(written.wrote).toBe(true);
      expect(written.state).toBe('not_interested');
      const bRows = await transitionsFor(b.prospectId);
      expect(bRows).toHaveLength(3);                 // 2 setup + ours
      const t = bRows[2];
      expect(t.origin).toBe('human');
      expect(t.actor_user_id).toBe(actor);           // the DB CHECK demands it
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('B3 — the writer\'s own rules still govern', () => {
  it('a transition out of the terminal state is refused, and nothing is appended', async () => {
    await inRollback(async () => {
      // `closed_disqualified` has no exit. A later reply must not resurrect it.
      const s = await scenario(ORG_A, 'replied', { state: 'closed_disqualified' });
      const r = await produceLifecycleFromOutcome(
        { organizationId: ORG_A, outcomeId: s.outcomeId, now: NOW });

      expect(r.wrote).toBe(false);
      // Two rows of SETUP and none of ours: the close has no exit.
      expect(await transitionsFor(s.prospectId)).toHaveLength(2);
      // Refused by one of the two layers that may refuse it — the interpreter
      // reading the graph, or the writer validating it. Both are acceptable;
      // writing it would not be.
      expect(r.refusal === 'no_transition' || r.outcome === null).toBe(true);
    });
  });

  it('a prospect with NO ledger abstains instead of opening one', async () => {
    await inRollback(async () => {
      const s = await scenario(ORG_A, 'replied', { state: null });
      const r = await produceLifecycleFromOutcome(
        { organizationId: ORG_A, outcomeId: s.outcomeId, now: NOW });
      expect(r.refusal).toBe('no_transition');
      expect(await transitionsFor(s.prospectId)).toHaveLength(0);
    });
  });

  it('the producer is not a second writer — every row it causes carries writer-set provenance', async () => {
    await inRollback(async () => {
      const s = await scenario(ORG_A, 'replied');
      await produceLifecycleFromOutcome({ organizationId: ORG_A, outcomeId: s.outcomeId, now: NOW });
      const rows = await transitionsFor(s.prospectId);
      const t = rows[1];
      // `previous_state` and `is_initial` are the writer's per-prospect bookkeeping;
      // a direct insert by a producer could not have produced a coherent set.
      // `seq` is GENERATED ALWAYS AS IDENTITY and GLOBAL, so its absolute value
      // says nothing about this prospect — only its ordering does.
      expect(Number(rows[1].seq)).toBeGreaterThan(Number(rows[0].seq));
      expect(rows[0].is_initial).toBe(true);
      expect(t.is_initial).toBe(false);
      expect(t.previous_state).toBe('identified');
      expect(t.source_event_key).toBeTruthy();
      expect(t.evidence_kind).toBe('outreach_outcome');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('B3 — non-lifecycle-bearing outcomes, and the delivery axis', () => {
  for (const type of ['opened', 'clicked', 'complaint']) {
    it(`${type} appends nothing`, async () => {
      await inRollback(async () => {
        const s = await scenario(ORG_A, type);
        const r = await produceLifecycleFromOutcome(
          { organizationId: ORG_A, outcomeId: s.outcomeId, now: NOW });
        expect(r.wrote).toBe(false);
        expect(r.refusal).toBe('no_transition');
        expect(await transitionsFor(s.prospectId)).toHaveLength(1);
      });
    });
  }

  it('complaint invents no lifecycle state — the ledger is untouched', async () => {
    await inRollback(async () => {
      const s = await scenario(ORG_A, 'complaint');
      await produceLifecycleFromOutcome({ organizationId: ORG_A, outcomeId: s.outcomeId, now: NOW });
      const rows = await transitionsFor(s.prospectId);
      expect(rows).toHaveLength(1);
      expect(rows[0].state).toBe('identified');     // still where it started
    });
  });

  it('converted raises needs_policy and appends nothing', async () => {
    await inRollback(async () => {
      const s = await scenario(ORG_A, 'converted');
      const r = await produceLifecycleFromOutcome(
        { organizationId: ORG_A, outcomeId: s.outcomeId, now: NOW });
      expect(r.refusal).toBe('needs_policy');
      expect(await transitionsFor(s.prospectId)).toHaveLength(1);
    });
  });

  it('DELIVERY signals cannot even become an outcome — the axes are separate in the schema', async () => {
    await inRollback(async () => {
      const personId = await newPerson(ORG_A);
      const taskId = await newTask(ORG_A, personId);
      // `outreach_outcomes_type_valid` admits only the 9 BUSINESS outcome types.
      // So "delivered means engaged" and "a delivery delay moves the lifecycle"
      // are not merely refused by the producer — they are unrepresentable.
      for (const delivery of ['delivered', 'bounced', 'delivery_delay', 'rejected_by_provider']) {
        expect(await attempt(
          `INSERT INTO public.outreach_outcomes (company_id, task_id, outcome_type, occurred_at)
           VALUES ($1,$2,$3,now())`, [ORG_A, taskId, delivery])).toBe('23514');
      }
      // And the one that IS admitted, for contrast.
      expect(await attempt(
        `INSERT INTO public.outreach_outcomes (company_id, task_id, outcome_type, occurred_at)
         VALUES ($1,$2,'replied',now())`, [ORG_A, taskId])).toBe('ok');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('B3 — tenant isolation and fail-closed resolution', () => {
  it('the cited outcome is tenant-coupled BY THE DATABASE, not only by the producer', async () => {
    await inRollback(async () => {
      // `prospect_lifecycle_outcome_fk` is composite:
      //   (evidence_outcome_id, organization_id) -> outreach_outcomes(id, company_id)
      // So even a direct insert cannot cite another tenant's outcome. The
      // producer's tenant predicate is defence in depth on top of this.
      const a = await scenario(ORG_A, 'replied');
      const b = await scenario(ORG_B, 'replied');
      // `previous_state` is supplied so `prospect_lifecycle_initial_shape` is
      // satisfied and the FOREIGN KEY is what refuses — otherwise a CHECK fires
      // first and the probe would prove the wrong thing.
      const insert = `INSERT INTO public.prospect_lifecycle_transitions
           (organization_id, prospect_id, state, previous_state, is_initial, origin,
            evidence_kind, evidence_outcome_id, transitioned_at)
         VALUES ($1,$2,'engaged','identified',false,'derived','outreach_outcome',$3,now())`;
      expect(await attempt(insert, [ORG_A, a.prospectId, b.outcomeId])).toBe('23503');
      // The prospect leg is composite too, but a non-initial raw row is refused
      // EARLIER by `trg_prospect_lifecycle_guard` ("the first transition for a
      // prospect must be the initial row") — under ORG_A that prospect has no
      // ledger at all. So the leg is isolated with an INITIAL row, where the guard
      // is satisfied and the foreign key is what refuses.
      expect(await attempt(
        `INSERT INTO public.prospect_lifecycle_transitions
           (organization_id, prospect_id, state, previous_state, is_initial, origin,
            evidence_kind, transitioned_at)
         VALUES ($1,$2,'identified',NULL,true,'derived','icp_evaluation',now())`,
        [ORG_A, b.prospectId])).toBe('23503');
      // The same row, citing its OWN tenant's evidence, is accepted.
      expect(await attempt(insert, [ORG_A, a.prospectId, a.outcomeId])).toBe('ok');
    });
  });

  it('a fictional operator is refused — the actor must be a real user', async () => {
    await inRollback(async () => {
      const s = await scenario(ORG_A, 'rejected', { state: 'engaged' });
      await expect(produceLifecycleFromOutcome({
        organizationId: ORG_A, outcomeId: s.outcomeId, now: NOW,
        actorUserId: '77777777-7777-4777-8777-777777777777',
      })).rejects.toThrow(/does not belong to this tenant|foreign key/i);
      expect(await transitionsFor(s.prospectId)).toHaveLength(2);   // setup only
    });
  });

  it('a cross-tenant outcome is simply not visible', async () => {
    await inRollback(async () => {
      const s = await scenario(ORG_B, 'replied');
      // ORG_A names ORG_B's outcome.
      const r = await produceLifecycleFromOutcome(
        { organizationId: ORG_A, outcomeId: s.outcomeId, now: NOW });
      expect(r.refusal).toBe('outcome_not_found');
      expect(r.wrote).toBe(false);
      expect(await transitionsFor(s.prospectId)).toHaveLength(1);   // ORG_B untouched
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.prospect_lifecycle_transitions WHERE organization_id=$1`,
        [ORG_A]);
      expect(rows[0].n).toBe(0);
    });
  });

  it('each tenant\'s own outcome produces its own transition, independently', async () => {
    await inRollback(async () => {
      const a = await scenario(ORG_A, 'replied');
      const b = await scenario(ORG_B, 'replied');
      await produceLifecycleFromOutcome({ organizationId: ORG_A, outcomeId: a.outcomeId, now: NOW });
      await produceLifecycleFromOutcome({ organizationId: ORG_B, outcomeId: b.outcomeId, now: NOW });

      for (const [org, prospectId] of [[ORG_A, a.prospectId], [ORG_B, b.prospectId]] as const) {
        const rows = await transitionsFor(prospectId);
        expect(rows).toHaveLength(2);
        for (const row of rows) expect(row.organization_id).toBe(org);
      }
    });
  });

  it('a person resolving to SEVERAL prospects is refused, never picked', async () => {
    await inRollback(async () => {
      const personId = await newPerson(ORG_A);
      const first = await newProspect(ORG_A, personId);
      const second = await newProspect(ORG_A, personId);    // legal: no unique index
      const taskId = await newTask(ORG_A, personId);
      const outcomeId = await newOutcome(ORG_A, taskId, 'replied');
      await openAt(ORG_A, first, 'identified');
      await openAt(ORG_A, second, 'identified');

      const r = await produceLifecycleFromOutcome(
        { organizationId: ORG_A, outcomeId, now: NOW });
      expect(r.refusal).toBe('prospect_ambiguous');
      expect(await transitionsFor(first)).toHaveLength(1);
      expect(await transitionsFor(second)).toHaveLength(1);
    });
  });

  it('a person with no prospect, and a task with no person, both refuse safely', async () => {
    await inRollback(async () => {
      const orphanPerson = await newPerson(ORG_A);
      const t1 = await newTask(ORG_A, orphanPerson);
      const o1 = await newOutcome(ORG_A, t1, 'replied');
      expect((await produceLifecycleFromOutcome(
        { organizationId: ORG_A, outcomeId: o1, now: NOW })).refusal).toBe('prospect_unresolved');

      const t2 = await newTask(ORG_A, null);
      const o2 = await newOutcome(ORG_A, t2, 'replied');
      expect((await produceLifecycleFromOutcome(
        { organizationId: ORG_A, outcomeId: o2, now: NOW })).refusal).toBe('task_has_no_person');

      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.prospect_lifecycle_transitions WHERE organization_id=$1`,
        [ORG_A]);
      expect(rows[0].n).toBe(0);
    });
  });
});
