/**
 * PI-LDB-3 — STRUCTURAL acceptance tests for `lead_score_history`.
 *
 * ─── WHAT THIS FILE DOES AND DOES NOT PROVE ────────────────────────────────
 * Every assertion below is about the SCHEMA CONTRACT: the table's shape, its
 * indexes, its CHECK constraints, its tenant-safe foreign key, its privileges
 * and the behaviour of its append-only triggers.
 *
 * NOTHING here proves that score history works. At the commit under test
 * `lead_score_history` has NO WRITER: the identifier appears in exactly two
 * files in the repository, its own migration and its own rollback, and in no
 * service, job, handler, API route or UI. There is no producer, no consumer and
 * no end-to-end path. A green run of this file means "the empty table is built
 * as specified", not "scores are being recorded".
 *
 * Several tests below are therefore CHARACTERIZATION tests, named `characterizes`.
 * They pin down what the schema currently does, including where that is
 * arguably wrong, so that a later decision to change it is a deliberate and
 * visible one. A characterization test is NOT an endorsement of the behaviour
 * it records — see the scale tests in particular.
 */

import {
  db, inRollback, seedTenants, ORG_A, ORG_B, newLead, attempt, effect, constraintDef,
} from './setup';

const T = 'public.lead_score_history';

/** The six CHECK constraints, asserted BY NAME. A bare count would pass for the
 *  wrong six and would break the moment a seventh is legitimately added. */
const EXPECTED_CHECKS = [
  'lead_score_history_inputs_is_object',
  'lead_score_history_kind_valid',
  'lead_score_history_model_version_not_blank',
  'lead_score_history_previous_score_range',
  'lead_score_history_reason_not_blank',
  'lead_score_history_score_range',
];

/** The three non-PRIMARY-KEY indexes the migration creates, by name. */
const EXPECTED_INDEXES = [
  'idx_lead_score_history_lead',
  'idx_lead_score_history_model_version',
  'idx_lead_score_history_org_time',
];

const EXPECTED_TRIGGERS = [
  'lead_score_history_no_direct_delete',
  'lead_score_history_no_update',
];

/** Insert one history row for a prospect, returning its id. */
async function insertRow(
  org: string, leadId: string,
  opts: { kind?: string; score?: number; previous?: number | null; model?: string; reason?: string } = {},
): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.lead_score_history
       (organization_id, lead_id, score_kind, score, previous_score, model_version, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      org, leadId, opts.kind ?? 'qualification', opts.score ?? 72,
      opts.previous === undefined ? null : opts.previous,
      opts.model ?? 'pi-score.1', opts.reason ?? 'structural acceptance test',
    ],
  );
  return rows[0].id;
}

describe('PI-LDB-3 lead_score_history — table and columns', () => {
  it('exists as exactly one base table in public', async () => {
    const { rows } = await db.query(
      `SELECT relkind FROM pg_class WHERE oid = to_regclass($1)`, [T],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].relkind).toBe('r');
  });

  it('carries exactly the twelve declared columns, with their types and nullability', async () => {
    const { rows } = await db.query(
      `SELECT attname, format_type(atttypid, atttypmod) AS t, attnotnull
         FROM pg_attribute
        WHERE attrelid = to_regclass($1) AND attnum > 0 AND NOT attisdropped
        ORDER BY attnum`, [T],
    );
    expect(rows.map((r: any) => `${r.attname} ${r.t} ${r.attnotnull ? 'NOT NULL' : 'NULL'}`)).toEqual([
      'id uuid NOT NULL',
      'organization_id uuid NOT NULL',
      'lead_id uuid NOT NULL',
      'score_kind text NOT NULL',
      'score numeric(5,2) NOT NULL',
      'previous_score numeric(5,2) NULL',
      'model_version text NOT NULL',
      'reason text NOT NULL',
      'inputs jsonb NOT NULL',
      'computed_by uuid NULL',
      'computed_at timestamp with time zone NOT NULL',
      'created_at timestamp with time zone NOT NULL',
    ]);
  });

  it('has a documenting table comment', async () => {
    const { rows } = await db.query(`SELECT obj_description(to_regclass($1), 'pg_class') AS c`, [T]);
    expect(rows[0].c).toMatch(/append-only/i);
  });
});

describe('PI-LDB-3 lead_score_history — indexes', () => {
  it('has exactly the three named non-PK indexes, plus the primary key', async () => {
    const { rows } = await db.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'lead_score_history'
        ORDER BY indexname`,
    );
    const names: string[] = rows.map((r: any) => r.indexname);
    expect(names).toEqual([...EXPECTED_INDEXES, 'lead_score_history_pkey'].sort());
    for (const idx of EXPECTED_INDEXES) expect(names).toContain(idx);
  });

  it('indexes the per-prospect history read newest-first', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_lead_score_history_lead'`,
    );
    expect(rows[0].indexdef).toContain('(organization_id, lead_id, score_kind, computed_at DESC)');
  });

  it('indexes the tenant-wide and model-version reads newest-first', async () => {
    const { rows } = await db.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE indexname IN ('idx_lead_score_history_org_time','idx_lead_score_history_model_version')
        ORDER BY indexname`,
    );
    expect(rows[0].indexdef).toContain('(organization_id, model_version, computed_at DESC)');
    expect(rows[1].indexdef).toContain('(organization_id, computed_at DESC)');
  });

  it('every index is tenant-leading, so no index invites a cross-tenant scan', async () => {
    const { rows } = await db.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='lead_score_history'
          AND indexname <> 'lead_score_history_pkey'`,
    );
    expect(rows.length).toBe(3);
    for (const r of rows as any[]) expect(r.indexdef).toMatch(/USING btree \(organization_id[,)]/);
  });
});

describe('PI-LDB-3 lead_score_history — CHECK constraints', () => {
  it('has exactly the six expected CHECK constraints, by name', async () => {
    const { rows } = await db.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = to_regclass($1) AND contype = 'c' ORDER BY conname`, [T],
    );
    expect(rows.map((r: any) => r.conname)).toEqual(EXPECTED_CHECKS);
  });

  it('constrains score and previous_score to 0..100', async () => {
    expect(await constraintDef('lead_score_history_score_range'))
      .toBe('CHECK (((score >= (0)::numeric) AND (score <= (100)::numeric)))');
    expect(await constraintDef('lead_score_history_previous_score_range'))
      .toBe('CHECK (((previous_score IS NULL) OR ((previous_score >= (0)::numeric) AND (previous_score <= (100)::numeric))))');
  });

  it('admits exactly six score kinds and refuses anything else', async () => {
    const def = await constraintDef('lead_score_history_kind_valid');
    for (const k of ['qualification', 'icp', 'intent', 'urgency', 'confidence', 'total']) {
      expect(def).toContain(`'${k}'::text`);
    }
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      for (const kind of ['engagement', 'opportunity', 'priority', 'fit', '']) {
        expect(await attempt(
          `INSERT INTO public.lead_score_history (organization_id, lead_id, score_kind, score, model_version, reason)
           VALUES ($1,$2,$3,50,'pi-score.1','refused kind')`, [ORG_A, lead, kind],
        )).toBe('23514');
      }
    });
  });

  it('refuses a score outside 0..100 on both bounds', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      for (const bad of [100.01, -0.01, 999]) {
        expect(await attempt(
          `INSERT INTO public.lead_score_history (organization_id, lead_id, score_kind, score, model_version, reason)
           VALUES ($1,$2,'qualification',$3,'pi-score.1','out of range')`, [ORG_A, lead, bad],
        )).toBe('23514');
      }
    });
  });

  it('refuses a blank reason, a blank model_version and a non-object inputs', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      expect(await attempt(
        `INSERT INTO public.lead_score_history (organization_id, lead_id, score_kind, score, model_version, reason)
         VALUES ($1,$2,'qualification',50,'pi-score.1','   ')`, [ORG_A, lead],
      )).toBe('23514');
      expect(await attempt(
        `INSERT INTO public.lead_score_history (organization_id, lead_id, score_kind, score, model_version, reason)
         VALUES ($1,$2,'qualification',50,'  ','why')`, [ORG_A, lead],
      )).toBe('23514');
      for (const notObject of ['[]', '"s"', '3', 'null']) {
        expect(await attempt(
          `INSERT INTO public.lead_score_history (organization_id, lead_id, score_kind, score, model_version, reason, inputs)
           VALUES ($1,$2,'qualification',50,'pi-score.1','why',$3::jsonb)`, [ORG_A, lead, notObject],
        )).toBe('23514');
      }
    });
  });

  it('accepts a NULL previous_score as "first score of its kind", distinct from 0', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      const first = await insertRow(ORG_A, lead, { previous: null });
      const second = await insertRow(ORG_A, lead, { previous: 0 });
      const { rows } = await db.query(
        `SELECT id, previous_score FROM public.lead_score_history
          WHERE id = ANY($1::uuid[]) ORDER BY previous_score NULLS FIRST`,
        [[first, second]],
      );
      expect(rows[0].previous_score).toBeNull();
      expect(Number(rows[1].previous_score)).toBe(0);
    });
  });
});

describe('PI-LDB-3 lead_score_history — tenant safety', () => {
  it('reaches the prospect through a COMPOSITE (lead_id, organization_id) foreign key', async () => {
    expect(await constraintDef('lead_score_history_lead_tenant_fk')).toBe(
      'FOREIGN KEY (lead_id, organization_id) REFERENCES canonical_leads(id, company_id) ON DELETE CASCADE',
    );
  });

  it('refuses a history row citing another tenant’s prospect', async () => {
    await inRollback(async () => {
      await seedTenants();
      const leadA = await newLead(ORG_A);
      expect(await attempt(
        `INSERT INTO public.lead_score_history (organization_id, lead_id, score_kind, score, model_version, reason)
         VALUES ($1,$2,'qualification',50,'pi-score.1','cross tenant')`, [ORG_B, leadA],
      )).toBe('23503');
    });
  });

  it('has NO ON DELETE SET NULL foreign key — the anti-arming invariant', async () => {
    // A SET NULL is an UPDATE, which the append-only guard refuses; the two
    // together would make the referenced parent row permanently undeletable.
    const { rows } = await db.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = to_regclass($1) AND contype = 'f' AND confdeltype = 'n'`, [T],
    );
    expect(rows.map((r: any) => r.conname)).toEqual([]);
  });

  it('carries no foreign key on computed_by, deliberately', async () => {
    const { rows } = await db.query(
      `SELECT conname, pg_get_constraintdef(oid) AS d FROM pg_constraint
        WHERE conrelid = to_regclass($1) AND contype = 'f' ORDER BY conname`, [T],
    );
    expect(rows.map((r: any) => r.conname)).toEqual([
      'lead_score_history_lead_tenant_fk',
      'lead_score_history_organization_id_fkey',
    ]);
    for (const r of rows as any[]) expect(r.d).not.toContain('computed_by');
  });

  it('enables row level security and carries the service_role policy', async () => {
    const { rows: cls } = await db.query(
      `SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass($1)`, [T],
    );
    expect(cls[0].relrowsecurity).toBe(true);
    const { rows: pol } = await db.query(
      `SELECT policyname FROM pg_policies
        WHERE schemaname='public' AND tablename='lead_score_history'`,
    );
    expect(pol.map((r: any) => r.policyname)).toEqual(['lead_score_history_service_role']);
  });
});

describe('PI-LDB-3 lead_score_history — privileges', () => {
  it('grants service_role SELECT and INSERT only, never UPDATE or DELETE', async () => {
    const { rows } = await db.query(
      `SELECT has_table_privilege('service_role', $1, 'SELECT') s,
              has_table_privilege('service_role', $1, 'INSERT') i,
              has_table_privilege('service_role', $1, 'UPDATE') u,
              has_table_privilege('service_role', $1, 'DELETE') d`, [T],
    );
    expect(rows[0]).toEqual({ s: true, i: true, u: false, d: false });
  });

  it('holds no privilege for the client roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await db.query(
        `SELECT has_table_privilege($2, $1, 'SELECT') s, has_table_privilege($2, $1, 'INSERT') i`,
        [T, role],
      );
      expect(rows[0]).toEqual({ s: false, i: false });
    }
  });
});

describe('PI-LDB-3 lead_score_history — append-only behaviour', () => {
  it('has both append-only triggers, bound to the pinned-search_path function', async () => {
    const { rows } = await db.query(
      `SELECT tgname, pg_get_triggerdef(oid) AS d FROM pg_trigger
        WHERE tgrelid = to_regclass($1) AND NOT tgisinternal ORDER BY tgname`, [T],
    );
    expect(rows.map((r: any) => r.tgname)).toEqual(EXPECTED_TRIGGERS);
    expect(rows[0].d).toMatch(
      /BEFORE DELETE ON public\.lead_score_history FOR EACH ROW EXECUTE FUNCTION trg_lead_score_history_append_only\(\)/,
    );
    expect(rows[1].d).toMatch(
      /BEFORE UPDATE ON public\.lead_score_history FOR EACH ROW EXECUTE FUNCTION trg_lead_score_history_append_only\(\)/,
    );

    const { rows: fn } = await db.query(
      `SELECT proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname='trg_lead_score_history_append_only'`,
    );
    expect(fn).toHaveLength(1);
    expect(fn[0].proconfig).toEqual(['search_path=pg_catalog, public']);
  });

  it('REFUSES an UPDATE, with the append-only message, and the row survives', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      const id = await insertRow(ORG_A, lead, { score: 72 });

      let message = '';
      await db.query('SAVEPOINT u');
      try {
        await db.query(`UPDATE public.lead_score_history SET score = 99 WHERE id = $1`, [id]);
      } catch (err: any) {
        message = String(err.message);
      } finally {
        await db.query('ROLLBACK TO SAVEPOINT u');
      }
      // An empty message would mean the UPDATE was ACCEPTED — the guard is gone.
      expect(message).toContain('lead_score_history is append-only');
      expect(message).toContain('Insert a new row instead');

      const { rows } = await db.query(
        `SELECT score FROM public.lead_score_history WHERE id = $1`, [id],
      );
      expect(Number(rows[0].score)).toBe(72);
    });
  });

  it('REFUSES an UPDATE that changes nothing (the guard is on the statement, not on a diff)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      const id = await insertRow(ORG_A, lead);
      expect(await attempt(
        `UPDATE public.lead_score_history SET score = score WHERE id = $1`, [id],
      )).toBe('P0001');
    });
  });

  it('REFUSES a direct DELETE, both by id and unqualified, and the rows survive', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      const id = await insertRow(ORG_A, lead);

      let message = '';
      await db.query('SAVEPOINT d');
      try {
        await db.query(`DELETE FROM public.lead_score_history WHERE id = $1`, [id]);
      } catch (err: any) {
        message = String(err.message);
      } finally {
        await db.query('ROLLBACK TO SAVEPOINT d');
      }
      expect(message).toContain('direct deletes are refused');

      expect(await attempt(`DELETE FROM public.lead_score_history`)).toBe('P0001');

      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.lead_score_history WHERE id = $1`, [id],
      );
      expect(rows[0].n).toBe(1);
    });
  });

  it('ALLOWS the referential cascade from canonical_leads — the parent stays deletable', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      await insertRow(ORG_A, lead);
      // `effect`, not `attempt`: the deletion's EFFECT is what is under test.
      expect(await effect(`DELETE FROM public.canonical_leads WHERE id = $1`, [lead])).toBe('ok');
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.lead_score_history WHERE lead_id = $1`, [lead],
      );
      expect(rows[0].n).toBe(0);
    });
  });

  it('ALLOWS the referential cascade from companies — the tenant stays deletable', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      await insertRow(ORG_A, lead);
      expect(await effect(`DELETE FROM public.companies WHERE id = $1`, [ORG_A])).toBe('ok');
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.lead_score_history WHERE organization_id = $1`, [ORG_A],
      );
      expect(rows[0].n).toBe(0);
    });
  });

  it('characterizes a GAP: TRUNCATE bypasses the append-only guard entirely', async () => {
    // There is no BEFORE TRUNCATE trigger, and a row-level DELETE trigger does
    // not fire for TRUNCATE. Any role holding TRUNCATE on the table can
    // therefore discard the whole history in one statement without tripping the
    // guard. service_role does NOT hold TRUNCATE (only SELECT/INSERT), so this
    // is not currently reachable by the application role — but the guarantee is
    // narrower than "the rows cannot be removed", and this test says so.
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      await insertRow(ORG_A, lead);
      expect(await effect(`TRUNCATE public.lead_score_history CASCADE`)).toBe('ok');
      const { rows } = await db.query(`SELECT count(*)::int n FROM public.lead_score_history`);
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('PI-LDB-3 lead_score_history — idempotency', () => {
  it('characterizes a GAP: there is NO idempotency key, so a retry duplicates history', async () => {
    // The table's only unique index is its primary key on a freshly generated
    // uuid. `prospect_score_evaluations` solves the same problem with
    // `uq_prospect_score_evaluations_identity` over
    // (organization_id, prospect_id, icp_version, rules_version, input_digest)
    // NULLS NOT DISTINCT. Nothing equivalent exists here, so a re-run, a retry
    // or an overlapping scheduler tick would append a fresh row every time.
    const { rows: uniq } = await db.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname='public' AND tablename='lead_score_history'
          AND indexdef LIKE 'CREATE UNIQUE INDEX%' ORDER BY indexname`,
    );
    expect(uniq.map((r: any) => r.indexname)).toEqual(['lead_score_history_pkey']);

    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      const a = await insertRow(ORG_A, lead, { kind: 'qualification', score: 72, reason: 'identical' });
      const b = await insertRow(ORG_A, lead, { kind: 'qualification', score: 72, reason: 'identical' });
      expect(a).not.toBe(b);
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.lead_score_history
          WHERE lead_id = $1 AND score_kind = 'qualification' AND score = 72`, [lead],
      );
      expect(rows[0].n).toBe(2);
    });
  });
});

describe('PI-LDB-3 lead_score_history — score scale (CHARACTERIZATION, NOT endorsement)', () => {
  /**
   * The repository declares its score scales in ONE place,
   * `lib/leadIntelligence/adapters.ts` SOURCE_SCORE_SCALES:
   *   qualification_score -> 'percent'  (0..100)
   *   intent/urgency/icp/confidence/total/opportunity/lead -> 'unit' (0..1)
   *
   * `score_kind` admits five of those UNIT-scale names alongside
   * `qualification`, and applies ONE 0..100 range CHECK to all six. A unit score
   * is inside 0..100, so the CHECK cannot detect a scale error. These tests pin
   * that down. They do NOT assert that storing a unit value here is correct —
   * the canonical scale is an open decision and is not settled by this file.
   */
  it('characterizes: a 0..1 unit score is SILENTLY ACCEPTED by the 0..100 CHECK', async () => {
    const cases: Array<[string, number]> = [
      ['intent', 0.82], ['icp', 1.0], ['urgency', 0.5], ['confidence', 0.0], ['total', 0.735],
    ];
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      for (const [kind, unitValue] of cases) {
        const { rows } = await db.query(
          `INSERT INTO public.lead_score_history (organization_id, lead_id, score_kind, score, model_version, reason)
           VALUES ($1,$2,$3,$4,'pi-score.1','unit-scale value, accepted without complaint')
           RETURNING score`,
          [ORG_A, lead, kind, unitValue],
        );
        expect(rows).toHaveLength(1); // no error: the mismatch does not raise
      }
    });
  });

  it('characterizes: numeric(5,2) cannot round-trip a unit score — 0.735 is stored as 0.74', async () => {
    // `prospect_score_evaluations` uses `double precision` precisely so a stored
    // score can be compared for EQUALITY with a recomputed one. This column's
    // two decimal places leave a unit score only 101 distinct values, so a
    // unit-scale history row is lossy on arrival and parity cannot be proven.
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      const { rows } = await db.query(
        `INSERT INTO public.lead_score_history (organization_id, lead_id, score_kind, score, model_version, reason)
         VALUES ($1,$2,'total',0.735,'pi-score.1','precision characterization')
         RETURNING score::text AS s`,
        [ORG_A, lead],
      );
      expect(rows[0].s).toBe('0.74');
    });
  });

  it('characterizes: the kind vocabulary does NOT match the evaluator’s five dimensions', async () => {
    // backend/services/leadUnderstanding/types.ts:96 —
    //   ScoreDimension = 'intent' | 'icp' | 'urgency' | 'opportunity' | 'priority'
    // `opportunity` and `priority` are real, produced dimensions that this table
    // refuses outright; `qualification` and `total` are admitted here but are not
    // evaluator dimensions. Only intent/icp/urgency are common to both.
    const def = (await constraintDef('lead_score_history_kind_valid')) ?? '';
    expect(def).not.toContain("'opportunity'");
    expect(def).not.toContain("'priority'");
    expect(def).toContain("'qualification'");
    expect(def).toContain("'total'");
  });

  it('records that the sibling table prospect_score_evaluations constrains the SAME dimensions to 0..1', async () => {
    const def = (await constraintDef('prospect_score_evaluations_ranges')) ?? '';
    expect(def).not.toBe('');
    for (const col of ['score_intent', 'score_icp', 'score_urgency', 'score_overall', 'confidence']) {
      expect(def).toContain(col);
    }
    expect(def).toContain('(1)::double precision');
    expect(def).not.toContain('(100)::double precision');
  });
});
