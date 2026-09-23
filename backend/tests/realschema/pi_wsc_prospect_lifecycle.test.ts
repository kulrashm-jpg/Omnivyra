/**
 * PI WS-C — `prospect_lifecycle_transitions` against real PostgreSQL.
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║ NOT RUN. AUTHORED ONLY.                                                ║
 * ║                                                                        ║
 * ║ This suite has NEVER been executed. The WS-C worktree has no local     ║
 * ║ PostgreSQL and no Docker, and the migration it asserts against         ║
 * ║ (20261027000000_pi_prospect_lifecycle_state.sql) has been AUTHORED AND ║
 * ║ NEVER APPLIED — not locally, not in staging, not in production. No     ║
 * ║ expectation below has been observed to pass or to fail.                ║
 * ║                                                                        ║
 * ║ To run it: scripts/ci/real-schema-ci.sh, which provisions a disposable ║
 * ║ database from the baseline plus the replayed migrations and sets       ║
 * ║ W6_DB_URL. Until someone does that, treat every assertion here as a    ║
 * ║ CLAIM about the migration, not as evidence about it.                   ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * Why it must exist anyway: the properties this contract actually rests on are
 * the ones that cannot be mocked — that the append-only trigger refuses an
 * UPDATE, that the chain trigger refuses a `previous_state` that never was,
 * that both partial unique indexes are partial (so `ON CONFLICT` cannot infer
 * them), that the CHECK vocabulary is closed in the database and not only in
 * TypeScript, and that a reassessment row (`state = previous_state`) is
 * ACCEPTED — the gap PI-ADR-004 §3 required fixing rather than inheriting.
 * A unit test asserting any of those would be asserting its own mock.
 */
import { db, inRollback, seedTenants, attempt, constraintDef, ORG_A, ORG_B } from './setup';

const TABLE = 'prospect_lifecycle_transitions';

const INS = `INSERT INTO public.${TABLE}
  (organization_id, prospect_id, state, previous_state, is_initial, origin,
   evidence_kind, evidence_outcome_id, evidence_source_record_id, source_event_key, actor_user_id)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`;

interface InsOpts {
  previous?: string | null;
  initial?: boolean;
  origin?: string;
  kind?: string;
  outcomeId?: string | null;
  sourceRecordId?: string | null;
  eventKey?: string | null;
  actor?: string | null;
}

const params = (org: string, prospect: string, state: string, o: InsOpts = {}) => [
  org, prospect, state,
  o.previous === undefined ? null : o.previous,
  o.initial ?? false,
  o.origin ?? 'derived',
  o.kind ?? 'icp_evaluation',
  o.outcomeId ?? null,
  o.sourceRecordId ?? null,
  o.eventKey ?? null,
  o.actor ?? null,
];

const tryInsert = (org: string, prospect: string, state: string, o: InsOpts = {}) =>
  attempt(INS, params(org, prospect, state, o));

async function insert(org: string, prospect: string, state: string, o: InsOpts = {}): Promise<string> {
  const { rows } = await db.query(`${INS} RETURNING id`, params(org, prospect, state, o));
  return rows[0].id;
}

/**
 * A prospect in `canonical_leads`, with the `canonical_users` row its composite
 * foreign key requires. `user_type` and `device` are NOT NULL with CHECKs.
 */
async function newProspect(org: string, key = `wsc-${Math.random().toString(36).slice(2)}`): Promise<string> {
  const { rows: u } = await db.query(
    `INSERT INTO public.canonical_users (company_id, user_type, device, external_user_key)
     VALUES ($1,'known','desktop',$2) RETURNING id`,
    [org, `wsc-user-${key}`],
  );
  const { rows } = await db.query(
    `INSERT INTO public.canonical_leads (company_id, user_id, source, external_lead_key)
     VALUES ($1,$2,'wsc-test',$3) RETURNING id`,
    [org, u[0].id, key],
  );
  return rows[0].id;
}

/** Open the ledger so a chain exists to test against. */
const open = (org: string, prospect: string) =>
  insert(org, prospect, 'identified', { initial: true, previous: null });

describe('PI WS-C — schema shape', () => {
  it('exists, is tenant-scoped by uuid, and has RLS enabled', async () => {
    const { rows } = await db.query(`
      SELECT c.relrowsecurity rls,
             (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
               WHERE attrelid = c.oid AND attname = 'organization_id') tenant_type
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = $1`, [TABLE]);
    expect(rows).toHaveLength(1);
    expect(rows[0].rls).toBe(true);
    expect(rows[0].tenant_type).toBe('uuid');
  });

  it('anchors the prospect with a COMPOSITE tenant foreign key to canonical_leads', async () => {
    const def = await constraintDef('prospect_lifecycle_prospect_fk');
    expect(def).toMatch(/FOREIGN KEY \(prospect_id, organization_id\) REFERENCES canonical_leads\(id, company_id\)/);
  });

  it('cites its evidence with composite tenant foreign keys, not bare ids', async () => {
    expect(await constraintDef('prospect_lifecycle_outcome_fk'))
      .toMatch(/FOREIGN KEY \(evidence_outcome_id, organization_id\) REFERENCES outreach_outcomes\(id, company_id\)/);
    expect(await constraintDef('prospect_lifecycle_source_record_fk'))
      .toMatch(/FOREIGN KEY \(evidence_source_record_id, organization_id\) REFERENCES source_records\(id, organization_id\)/);
  });

  it('has no current-state column anywhere — the latest row IS the state', async () => {
    const { rows } = await db.query(
      `SELECT attname FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped`,
      [`public.${TABLE}`]);
    const names = rows.map((r: any) => r.attname);
    for (const forbidden of ['current_state', 'status', 'lead_status', 'suppressed', 'is_suppressed',
      'outreach_ready', 'assigned_to_user_id', 'note', 'company_id']) {
      expect(names).not.toContain(forbidden);
    }
    expect(names).toEqual(expect.arrayContaining(['seq', 'origin', 'evidence_kind', 'source_event_key', 'is_initial']));
  });

  it('orders by an identity column, not by a clock or a uuid', async () => {
    const { rows } = await db.query(
      `SELECT attidentity FROM pg_attribute WHERE attrelid = $1::regclass AND attname = 'seq'`, [`public.${TABLE}`]);
    expect(rows[0].attidentity).toBe('a');   // GENERATED ALWAYS
  });
});

describe('PI WS-C — the CHECK vocabulary is in the database', () => {
  it('refuses a state outside the seven', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newProspect(ORG_A);
      await open(ORG_A, p);
      for (const bad of ['outreach_active', 'suppressed', 'outreach_ready', 'no_response',
        'candidate', 'proposal', 'won']) {
        expect(await tryInsert(ORG_A, p, bad, { previous: 'identified' })).toBe('23514');
      }
    });
  });

  it('refuses a previous_state outside the seven — BOTH columns are constrained', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newProspect(ORG_A);
      await open(ORG_A, p);
      expect(await tryInsert(ORG_A, p, 'qualified', { previous: 'working' })).toBe('23514');
    });
  });

  it('refuses an origin outside human|derived, and a human row with no actor', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newProspect(ORG_A);
      await open(ORG_A, p);
      expect(await tryInsert(ORG_A, p, 'qualified', { previous: 'identified', origin: 'robot' })).toBe('23514');
      expect(await tryInsert(ORG_A, p, 'qualified', { previous: 'identified', origin: 'human' })).toBe('23514');
    });
  });

  it('refuses a citation whose kind and foreign key disagree', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newProspect(ORG_A);
      await open(ORG_A, p);
      // claims an outcome, names none
      expect(await tryInsert(ORG_A, p, 'engaged', { previous: 'identified', kind: 'outreach_outcome' })).toBe('23514');
      // claims a kind with no row, yet names one
      expect(await tryInsert(ORG_A, p, 'engaged', {
        previous: 'identified', kind: 'icp_evaluation', outcomeId: '00000000-0000-4000-8000-0000000000ff',
      })).toBe('23514');
    });
  });

  it('refuses a `::` composite as the source event key — DECISION D, enforced not asserted', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newProspect(ORG_A);
      await open(ORG_A, p);
      for (const bad of [
        'id::apollo::contacts::4711',
        'up::apollo::a@b.com::2026-09-23T10:00:00.000Z',
        'evidence:up::apollo::a@b.com::2026-09-23T10:00:00.000Z',
        'leadkey:abc',
        'outcome:',
      ]) {
        expect(await tryInsert(ORG_A, p, 'qualified', { previous: 'identified', eventKey: bad })).toBe('23514');
      }
      expect(await tryInsert(ORG_A, p, 'qualified', {
        previous: 'identified', eventKey: 'derivation:9f2ab1c4',
      })).toBe('ok');
    });
  });
});

describe('PI WS-C — append-only, enforced by trigger', () => {
  it('refuses UPDATE', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newProspect(ORG_A);
      const id = await open(ORG_A, p);
      expect(await attempt(`UPDATE public.${TABLE} SET state = 'qualified' WHERE id = $1`, [id])).toBe('42501');
      expect(await attempt(`UPDATE public.${TABLE} SET reasoning = 'edited' WHERE id = $1`, [id])).toBe('42501');
    });
  });

  it('refuses DELETE', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newProspect(ORG_A);
      const id = await open(ORG_A, p);
      expect(await attempt(`DELETE FROM public.${TABLE} WHERE id = $1`, [id])).toBe('42501');
    });
  });

  it('the trigger exists on UPDATE, DELETE and INSERT', async () => {
    const { rows } = await db.query(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal ORDER BY tgname`,
      [`public.${TABLE}`]);
    expect(rows.map((r: any) => r.tgname)).toEqual([
      'prospect_lifecycle_block_delete', 'prospect_lifecycle_block_update', 'prospect_lifecycle_chain',
    ]);
  });

  it('the guard function is NOT security definer — it must not become a cross-tenant read primitive', async () => {
    const { rows } = await db.query(
      `SELECT prosecdef FROM pg_proc WHERE proname = 'trg_prospect_lifecycle_guard'`);
    expect(rows[0].prosecdef).toBe(false);
  });
});

describe('PI WS-C — the chain invariant', () => {
  it('refuses a first row that is not the initial row', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newProspect(ORG_A);
      expect(await tryInsert(ORG_A, p, 'qualified', { previous: 'identified' })).toBe('23514');
    });
  });

  it('refuses a previous_state that the prospect was never in', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newProspect(ORG_A);
      await open(ORG_A, p);
      expect(await tryInsert(ORG_A, p, 'engaged', { previous: 'nurture' })).toBe('23514');
      expect(await tryInsert(ORG_A, p, 'qualified', { previous: 'identified' })).toBe('ok');
    });
  });

  it('refuses an initial row whose previous_state is set, and a later row whose is null', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newProspect(ORG_A);
      expect(await tryInsert(ORG_A, p, 'identified', { initial: true, previous: 'qualified' })).toBe('23514');
      await open(ORG_A, p);
      expect(await tryInsert(ORG_A, p, 'qualified', { previous: null })).toBe('23514');
    });
  });

  it('ACCEPTS a reassessment row — state = previous_state. This is the PI-ADR-004 §3 gap, fixed', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newProspect(ORG_A);
      await open(ORG_A, p);
      await insert(ORG_A, p, 'nurture', { previous: 'identified' });
      expect(await tryInsert(ORG_A, p, 'nurture', {
        previous: 'nurture', eventKey: 'derivation:aa11bb22',
      })).toBe('ok');
    });
  });
});

describe('PI WS-C — the partial unique indexes', () => {
  it('both idempotency indexes are PARTIAL, so ON CONFLICT cannot infer them (42P10)', async () => {
    const { rows } = await db.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN ('uq_prospect_lifecycle_initial', 'uq_prospect_lifecycle_source_event')
        ORDER BY indexname`);
    expect(rows).toHaveLength(2);
    for (const r of rows as any[]) {
      expect(r.indexdef).toMatch(/CREATE UNIQUE INDEX/);
      expect(r.indexdef).toMatch(/ WHERE /);
    }
    expect((rows[0] as any).indexdef).toMatch(/\(organization_id, prospect_id\)[\s\S]*WHERE is_initial/);
    expect((rows[1] as any).indexdef).toMatch(/\(organization_id, prospect_id, source_event_key\)/);
  });

  it('a prospect can be initialised exactly once', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newProspect(ORG_A);
      await open(ORG_A, p);
      expect(await tryInsert(ORG_A, p, 'identified', { initial: true, previous: null })).toBe('23505');
    });
  });

  it('a repeated source event cannot produce a second transition', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newProspect(ORG_A);
      await open(ORG_A, p);
      const key = 'derivation:7c1e9a3b';
      await insert(ORG_A, p, 'qualified', { previous: 'identified', eventKey: key });
      expect(await tryInsert(ORG_A, p, 'nurture', { previous: 'qualified', eventKey: key })).toBe('23505');
      // ...while a DIFFERENT event on the same prospect is fine.
      expect(await tryInsert(ORG_A, p, 'nurture', { previous: 'qualified', eventKey: 'derivation:7c1e9a3c' })).toBe('ok');
    });
  });

  it('the event key is scoped to the prospect, so two prospects may share one cause', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newProspect(ORG_A, 'wsc-a');
      const b = await newProspect(ORG_A, 'wsc-b');
      await open(ORG_A, a);
      await open(ORG_A, b);
      const key = 'derivation:5d5d5d5d';
      await insert(ORG_A, a, 'qualified', { previous: 'identified', eventKey: key });
      expect(await tryInsert(ORG_A, b, 'qualified', { previous: 'identified', eventKey: key })).toBe('ok');
    });
  });

  it('a null event key is never deduplicated — the index is partial for a reason', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newProspect(ORG_A);
      await open(ORG_A, p);
      await insert(ORG_A, p, 'qualified', { previous: 'identified', eventKey: null });
      expect(await tryInsert(ORG_A, p, 'nurture', { previous: 'qualified', eventKey: null })).toBe('ok');
    });
  });
});

describe('PI WS-C — tenant isolation', () => {
  it('refuses another tenant\'s prospect — the composite foreign key, not a pre-check', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newProspect(ORG_A);
      expect(await tryInsert(ORG_B, p, 'identified', { initial: true, previous: null })).toBe('23503');
    });
  });

  it('two tenants may hold the same state for their own prospects without interfering', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newProspect(ORG_A, 'iso-a');
      const b = await newProspect(ORG_B, 'iso-b');
      await open(ORG_A, a);
      await open(ORG_B, b);
      const { rows } = await db.query(
        `SELECT organization_id, count(*)::int n FROM public.${TABLE} GROUP BY 1 ORDER BY 1`);
      expect(rows).toHaveLength(2);
    });
  });
});

describe('PI WS-C — deterministic state reconstruction, in the database', () => {
  it('the latest row by seq is the state, and the history replays to it', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newProspect(ORG_A);
      await open(ORG_A, p);
      await insert(ORG_A, p, 'qualified', { previous: 'identified' });
      await insert(ORG_A, p, 'nurture', { previous: 'qualified' });
      await insert(ORG_A, p, 'nurture', { previous: 'nurture', eventKey: 'derivation:1a1a1a1a' });
      await insert(ORG_A, p, 'qualified', { previous: 'nurture' });       // reactivation

      const { rows } = await db.query(
        `SELECT state, previous_state FROM public.${TABLE}
          WHERE organization_id = $1 AND prospect_id = $2 ORDER BY seq`, [ORG_A, p]);
      expect(rows.map((r: any) => r.state)).toEqual(
        ['identified', 'qualified', 'nurture', 'nurture', 'qualified']);

      const { rows: latest } = await db.query(
        `SELECT state FROM public.${TABLE}
          WHERE organization_id = $1 AND prospect_id = $2 ORDER BY seq DESC LIMIT 1`, [ORG_A, p]);
      expect(latest[0].state).toBe('qualified');
    });
  });

  it('seq is strictly increasing, so "latest" never depends on a clock', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newProspect(ORG_A);
      await open(ORG_A, p);
      // Identical business time on every row. Written as separate statements on
      // purpose: the chain trigger reads the rows already there, and a BEFORE
      // ROW trigger inside a multi-row INSERT is not guaranteed to see its
      // earlier siblings.
      const stamped = `INSERT INTO public.${TABLE}
        (organization_id, prospect_id, state, previous_state, origin, evidence_kind, transitioned_at)
        VALUES ($1,$2,$3,$4,'derived','icp_evaluation','2026-01-01T00:00:00Z')`;
      await db.query(stamped, [ORG_A, p, 'qualified', 'identified']);
      await db.query(stamped, [ORG_A, p, 'nurture', 'qualified']);
      const { rows } = await db.query(
        `SELECT seq FROM public.${TABLE} WHERE prospect_id = $1 ORDER BY seq`, [p]);
      const seqs = rows.map((r: any) => Number(r.seq));
      expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
      expect(new Set(seqs).size).toBe(seqs.length);
    });
  });
});
