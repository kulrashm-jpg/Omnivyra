/**
 * PI WS-3D — `prospect_problem_observations`, against real PostgreSQL.
 *
 * ─── THIS SUITE HAS NOT BEEN RUN ──────────────────────────────────────────
 * It is AUTHORED AND UNEXECUTED. The environment it was written in has no
 * PostgreSQL server and no Docker daemon, and the embedded-Postgres harness is
 * not present in this checkout, so `backend/tests/realschema/setup.ts` cannot
 * connect. Migration `20270105000000_pi_prospect_problem_observations.sql` is
 * likewise AUTHORED AND UNAPPLIED — in this environment, in any local database
 * and in production. Nothing below has been observed to pass, and no claim in
 * this file should be read as evidence until it has been run against a database
 * with that migration applied.
 *
 * It is included anyway because the properties it covers cannot be covered any
 * other way, and the alternative to an unrun suite is no suite at all:
 *
 *   · nine CHECK constraints, including the one-subject pairing that makes
 *     `entity_type` and the populated leg agree;
 *   · the two PARTIAL, subject-aware, time-free unique indexes that make a
 *     replay idempotent rather than a second row, while still letting two
 *     different subjects state the same words in one source record;
 *   · three composite tenant-safe foreign keys, each refused in BOTH
 *     directions, which is what stops a statement naming another tenant's
 *     person;
 *   · ON DELETE CASCADE on the subject legs — the behaviour an erasure request
 *     actually needs, and the reason a referential SET NULL would re-create
 *     DEFECT-008 here;
 *   · ON DELETE RESTRICT on the provenance leg;
 *   · `observed_at` and `confidence` nullable with NO DEFAULT, so an absence
 *     stays an absence;
 *   · RLS enabled (never FORCED) with exactly ONE policy, scoped to exactly
 *     `{service_role}` — not `{public}`, which is what a policy written without
 *     a TO clause silently becomes;
 *   · the TABLE PRIVILEGES, which are the actual control on the server
 *     credential: `service_role` is BYPASSRLS, so the policy is never evaluated
 *     for it. Exactly SELECT + INSERT there — the repository only inserts and
 *     selects — and nothing whatsoever for `anon`, `authenticated` or PUBLIC.
 *
 * The same invariants are MODELLED in `backend/tests/unit/piWs3dProblemObservationCapture.test.ts`
 * so they are pinned somewhere that does run, and so the repository's mapping of
 * each SQLSTATE onto the published refusal vocabulary is tested. A model is not
 * a proof; this file is where the proof will come from.
 */
import {
  db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson, newAccount, constraintDef,
  uniqueIndexColumns,
  effect,
} from './setup';
import { createHash } from 'node:crypto';

const PPO = 'prospect_problem_observations';
const h = (s: string) => createHash('sha256').update(s).digest('hex');
const STATEMENT = 'our three dashboards disagree and nobody can say which one to take to the board';
const OBSERVED_AT = '2026-09-14T08:15:00.000Z';

/** A legal person-attributed row. Every field the writer sets, and nothing else. */
const row = (org: string, personId: string, over: Record<string, unknown> = {}) => ({
  organization_id: org,
  entity_type: 'person',
  person_id: personId,
  account_id: null,
  statement: STATEMENT,
  statement_hash: h(STATEMENT),
  statement_language: 'en',
  origin_store: 'crm_call_notes',
  origin_record_id: 'call-2026-09-14',
  origin: 'provider',
  recorded_by_user_id: null,
  source_record_id: null,
  confidence: 0.7,
  observed_at: OBSERVED_AT,
  ...over,
});

const insertSql = (r: Record<string, unknown>) => {
  const cols = Object.keys(r);
  return {
    sql: `INSERT INTO public.${PPO} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
    params: Object.values(r),
  };
};

async function insert(r: Record<string, unknown>): Promise<string> {
  const { sql, params } = insertSql(r);
  const { rows } = await db.query(sql, params);
  return rows[0].id;
}

async function tryInsert(r: Record<string, unknown>): Promise<string> {
  const { sql, params } = insertSql(r);
  return attempt(sql, params);
}

/**
 * Insert and KEEP the row, reporting 'ok' or the SQLSTATE.
 *
 * `tryInsert` is a probe built on `attempt`, which rolls back on success too —
 * so a test that admits a row through it and then COUNTS rows is counting a
 * state in which that row was never written.
 */
async function keepInsert(r: Record<string, unknown>): Promise<string> {
  const { sql, params } = insertSql(r);
  return effect(sql, params);
}

/** A source record in `org`, for the provenance leg. */
async function newSourceRecord(org: string, ref = 'REC-1'): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.source_records
       (organization_id, provider, source_entity_type, source_record_id, raw_payload, payload_hash)
     VALUES ($1,'testprov','person',$2,'{}'::jsonb,$3) RETURNING id`,
    [org, ref, h(ref)],
  );
  return rows[0].id;
}

/**
 * The privileges `role` actually holds on this relation, alphabetically.
 *
 * Read from `pg_class.relacl` via `aclexplode`, and deliberately NOT from
 * `information_schema.role_table_grants`: that view shows only the grants
 * visible to the enabled session role, so it can read falsely empty and would
 * make a "holds nothing" assertion pass for the wrong reason.
 */
async function privilegesOf(role: string): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT coalesce(array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type), '{}'::text[]) AS privs
       FROM pg_class c
       JOIN pg_namespace ns ON ns.oid = c.relnamespace
       CROSS JOIN LATERAL aclexplode(c.relacl) a
       JOIN pg_roles r ON r.oid = a.grantee
      WHERE ns.nspname = 'public' AND c.relname = $1 AND r.rolname = $2`,
    [PPO, role]);
  return (rows[0]?.privs ?? []) as string[];
}

describe('WS-3D — schema shape', () => {
  it('the relation exists, is tenant-scoped NOT NULL, and has RLS enabled', async () => {
    const { rows } = await db.query(
      `SELECT c.relrowsecurity rls,
              (SELECT count(*)::int FROM pg_attribute a
                WHERE a.attrelid=c.oid AND a.attname='organization_id'
                  AND NOT a.attisdropped AND a.attnotnull) tenant
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=$1`, [PPO]);
    expect(rows).toHaveLength(1);
    expect(rows[0].rls).toBe(true);
    expect(rows[0].tenant).toBe(1);
  });

  it('carries a service-role policy, so RLS is enabled WITH a way in', async () => {
    const { rows } = await db.query(
      `SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=$1`, [PPO]);
    expect(rows.map((r: { policyname: string }) => r.policyname))
      .toContain(`${PPO}_service_role`);
  });

  it('carries exactly ONE policy, scoped to exactly {service_role} — never {public}', async () => {
    const { rows } = await db.query(
      `SELECT policyname, roles::text[] AS roles
         FROM pg_policies WHERE schemaname='public' AND tablename=$1`, [PPO]);
    // Exactly one: a second policy would be another way in that nothing in this
    // migration or this suite reasons about.
    expect(rows).toHaveLength(1);
    expect(rows[0].policyname).toBe(`${PPO}_service_role`);
    // THE POINT OF THIS TEST. A policy written without a TO clause reports
    // roles = {public} and applies to EVERY role, so a default-deny backstop
    // would read as a way in for anon and authenticated. The whole array is
    // compared for that reason — an existence check would pass on the defect.
    expect(rows[0].roles).toEqual(['service_role']);
    expect(rows[0].roles).not.toContain('public');
  });

  it('has RLS ENABLED but NOT FORCED — owner-connection suites must still read', async () => {
    const { rows } = await db.query(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
         FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname='public' AND c.relname=$1`, [PPO]);
    expect(rows).toHaveLength(1);
    expect(rows[0].rls).toBe(true);
    // FORCE would subject the table OWNER too, and this suite connects as the
    // owner — so FORCE would break it for a reason unrelated to the contract.
    expect(rows[0].forced).toBe(false);
  });

  it('grants service_role exactly SELECT + INSERT, and nothing more', async () => {
    // DERIVED FROM THE REPOSITORY, not assumed: problemObservationRepository
    // performs `.insert(row).select(...)` and `.select(...)` and nothing else, so
    // INSERT needs SELECT beside it (the insert asks for its representation
    // back) and no UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER is warranted.
    // Equality, not containment: an extra privilege must fail here.
    expect(await privilegesOf('service_role')).toEqual(['INSERT', 'SELECT']);
  });

  it('leaves anon, authenticated and PUBLIC holding NO privilege at all', async () => {
    // Supabase grants ALL on every new public table to `authenticated`. The
    // REVOKE in the migration runs after CREATE TABLE precisely to withdraw it,
    // and names PUBLIC as well because revoking from PUBLIC does not remove a
    // direct grant and revoking a direct grant does not close the PUBLIC path.
    expect(await privilegesOf('anon')).toEqual([]);
    expect(await privilegesOf('authenticated')).toEqual([]);

    // aclexplode reports a PUBLIC grant with grantee = 0, which joins to no row
    // in pg_roles — so it vanishes from the two checks above unless looked for
    // on its own.
    const { rows } = await db.query(
      `SELECT count(*)::int AS public_grants
         FROM pg_class c
         JOIN pg_namespace ns ON ns.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE ns.nspname='public' AND c.relname=$1 AND a.grantee = 0`, [PPO]);
    expect(rows[0].public_grants).toBe(0);
  });

  it('declares all nine CHECK constraints', async () => {
    const { rows } = await db.query(
      `SELECT con.conname FROM pg_constraint con JOIN pg_class s ON s.oid=con.conrelid
        WHERE con.contype='c' AND s.relname=$1 ORDER BY con.conname`, [PPO]);
    const names = rows.map((r: { conname: string }) => r.conname);
    for (const c of [
      'ppo_confidence_range', 'ppo_entity_type_valid', 'ppo_one_subject', 'ppo_origin_actor',
      'ppo_origin_record_id_not_blank', 'ppo_origin_store_not_blank', 'ppo_origin_valid',
      'ppo_statement_hash_shape', 'ppo_statement_not_blank',
    ]) {
      expect(names).toContain(c);
    }
  });

  it('keeps observed_at and confidence NULLABLE with NO DEFAULT — an absence stays one', async () => {
    const { rows } = await db.query(
      `SELECT attname, attnotnull, atthasdef FROM pg_attribute
        WHERE attrelid=$1::regclass AND attname = ANY($2::text[])`,
      [`public.${PPO}`, ['observed_at', 'confidence']]);
    expect(rows).toHaveLength(2);
    for (const r of rows as Array<{ attnotnull: boolean; atthasdef: boolean }>) {
      expect(r.attnotnull).toBe(false);
      // A default here would state a confidence, or an observation time, that no
      // source ever expressed.
      expect(r.atthasdef).toBe(false);
    }
  });

  it('keeps recorded_at NOT NULL with its own default — OUR clock, always present', async () => {
    const { rows } = await db.query(
      `SELECT attnotnull, atthasdef FROM pg_attribute
        WHERE attrelid=$1::regclass AND attname='recorded_at'`, [`public.${PPO}`]);
    expect(rows[0].attnotnull).toBe(true);
    expect(rows[0].atthasdef).toBe(true);
  });

  it('has NO normalised twin of the statement — a sentence has no canonical form', async () => {
    const { rows } = await db.query(
      `SELECT attname FROM pg_attribute
        WHERE attrelid=$1::regclass AND attnum > 0 AND NOT attisdropped`, [`public.${PPO}`]);
    const cols = rows.map((r: { attname: string }) => r.attname);
    expect(cols).toContain('statement');
    expect(cols).not.toContain('normalized_statement');
    expect(cols).not.toContain('statement_normalized');
    // ...and nothing on this table is a score, a weight or a fit verdict.
    for (const forbidden of ['score', 'fit_score', 'problem_fit', 'weight', 'priority', 'dimension']) {
      expect(cols).not.toContain(forbidden);
    }
  });

  it('has three composite tenant-safe foreign keys, tenant always the second leg', async () => {
    const { rows } = await db.query(
      `SELECT con.conname, pg_get_constraintdef(con.oid) d
         FROM pg_constraint con JOIN pg_class s ON s.oid=con.conrelid
        WHERE con.contype='f' AND s.relname=$1 AND array_length(con.conkey,1)=2
        ORDER BY con.conname`, [PPO]);
    expect(rows).toHaveLength(3);
    for (const r of rows as Array<{ d: string }>) expect(r.d).toMatch(/, organization_id\)/);
  });

  it('CASCADEs both subject legs and RESTRICTs the provenance leg', async () => {
    const person = await constraintDef('ppo_person_tenant_fk');
    expect(person).toContain('FOREIGN KEY (person_id, organization_id)');
    expect(person).toContain('REFERENCES unified_persons(id, company_id)');
    expect(person).toMatch(/ON DELETE CASCADE/);
    // A referential SET NULL would be an UPDATE, and `ppo_one_subject` would
    // refuse it — re-creating DEFECT-008 and making the person undeletable.
    expect(person).not.toMatch(/SET NULL/);

    const account = await constraintDef('ppo_account_tenant_fk');
    expect(account).toContain('FOREIGN KEY (account_id, organization_id)');
    expect(account).toContain('REFERENCES prospect_accounts(id, organization_id)');
    expect(account).toMatch(/ON DELETE CASCADE/);
    expect(account).not.toMatch(/SET NULL/);

    const source = await constraintDef('ppo_source_record_tenant_fk');
    expect(source).toContain('FOREIGN KEY (source_record_id, organization_id)');
    expect(source).toContain('REFERENCES source_records(id, organization_id)');
    expect(source).toMatch(/ON DELETE RESTRICT/);
  });

  it('the idempotency indexes are PARTIAL, subject-aware and time-free', async () => {
    // PARTIALITY IS LOAD-BEARING. Exactly one subject leg is populated, so a
    // single index over both legs would compare a NULL in every row; under the
    // default NULLS DISTINCT that silently removes idempotency for one subject
    // kind while the index still looks correct. One index per leg depends on no
    // NULL semantics at all.
    expect(await uniqueIndexColumns('uq_ppo_person_origin_statement')).toEqual([
      'organization_id', 'origin_store', 'origin_record_id', 'statement_hash', 'person_id',
    ]);
    expect(await uniqueIndexColumns('uq_ppo_account_origin_statement')).toEqual([
      'organization_id', 'origin_store', 'origin_record_id', 'statement_hash', 'account_id',
    ]);

    const defs = async (name: string): Promise<string> => {
      const { rows } = await db.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname=$1`, [name]);
      return String(rows[0].indexdef);
    };
    expect(await defs('uq_ppo_person_origin_statement')).toMatch(/WHERE \(?entity_type = 'person'/);
    expect(await defs('uq_ppo_account_origin_statement')).toMatch(/WHERE \(?entity_type = 'account'/);

    // Neither clock is in either key, deliberately: a re-parsed timestamp must
    // not create a second row for one utterance.
    for (const n of ['uq_ppo_person_origin_statement', 'uq_ppo_account_origin_statement']) {
      expect(await defs(n)).not.toMatch(/observed_at|recorded_at/);
    }

    // The subject-free index is GONE, not merely supplemented.
    const { rows: stale } = await db.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_ppo_origin_statement'`);
    expect(stale).toHaveLength(0);
  });

  it('the two read indexes are PARTIAL, one per subject leg', async () => {
    for (const [name, col] of [
      ['idx_ppo_org_person_observed', 'person_id'],
      ['idx_ppo_org_account_observed', 'account_id'],
    ]) {
      const { rows } = await db.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname=$1`, [name]);
      expect(rows).toHaveLength(1);
      expect(rows[0].indexdef).toMatch(new RegExp(`WHERE \\(${col} IS NOT NULL\\)`));
      expect(rows[0].indexdef).toMatch(/observed_at DESC/);
    }
  });
});

describe('WS-3D — the CHECKs refuse every malformed row', () => {
  it('refuses an unknown entity type', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      expect(await tryInsert(row(ORG_A, p, { entity_type: 'company' }))).toBe('23514');
    });
  });

  it('refuses two subjects, no subject, and a subject disagreeing with the declared type', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A);
      // Both legs populated.
      expect(await tryInsert(row(ORG_A, p, { account_id: a }))).toBe('23514');
      // Neither leg populated.
      expect(await tryInsert(row(ORG_A, p, { person_id: null }))).toBe('23514');
      // Declared account, populated person.
      expect(await tryInsert(row(ORG_A, p, { entity_type: 'account' }))).toBe('23514');
      // Declared person, populated account.
      expect(await tryInsert(row(ORG_A, p, { person_id: null, account_id: a }))).toBe('23514');
      // ...and each legal shape IS legal.
      expect(await tryInsert(row(ORG_A, p))).toBe('ok');
      expect(await tryInsert(row(ORG_A, p, {
        entity_type: 'account', person_id: null, account_id: a, origin_record_id: 'call-2',
      }))).toBe('ok');
    });
  });

  it('refuses a blank statement, a blank origin store and a blank origin record', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      expect(await tryInsert(row(ORG_A, p, { statement: '   ' }))).toBe('23514');
      expect(await tryInsert(row(ORG_A, p, { origin_store: '  ' }))).toBe('23514');
      expect(await tryInsert(row(ORG_A, p, { origin_record_id: '' }))).toBe('23514');
    });
  });

  it('refuses a statement hash that is not a lowercase sha256', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      for (const bad of ['', 'not-a-hash', h(STATEMENT).toUpperCase(), h(STATEMENT).slice(0, 63), `${h(STATEMENT)}a`]) {
        expect(await tryInsert(row(ORG_A, p, { statement_hash: bad }))).toBe('23514');
      }
    });
  });

  it('refuses an unknown origin, and enforces the human/recorder pairing both ways', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const { rows } = await db.query(
        `SELECT id FROM public.users LIMIT 1`);
      const userId: string | null = rows.length ? rows[0].id : null;

      expect(await tryInsert(row(ORG_A, p, { origin: 'robot' }))).toBe('23514');
      // human with nobody recording it — an attested statement is never anonymous.
      expect(await tryInsert(row(ORG_A, p, { origin: 'human' }))).toBe('23514');
      if (userId) {
        // provider with somebody attached — a machine import dressed as an attestation.
        expect(await tryInsert(row(ORG_A, p, { recorded_by_user_id: userId }))).toBe('23514');
        expect(await tryInsert(row(ORG_A, p, {
          origin: 'human', recorded_by_user_id: userId,
        }))).toBe('ok');
      }
    });
  });

  it('refuses a confidence outside 0..1, and accepts 0, 1 and NULL', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      expect(await tryInsert(row(ORG_A, p, { confidence: -0.01 }))).toBe('23514');
      expect(await tryInsert(row(ORG_A, p, { confidence: 1.01 }))).toBe('23514');
      expect(await tryInsert(row(ORG_A, p, { confidence: 0, origin_record_id: 'c0' }))).toBe('ok');
      expect(await tryInsert(row(ORG_A, p, { confidence: 1, origin_record_id: 'c1' }))).toBe('ok');
      expect(await tryInsert(row(ORG_A, p, { confidence: null, origin_record_id: 'cn' }))).toBe('ok');
    });
  });

  it('accepts a statement with NO observation time at the storage layer', async () => {
    // The column is nullable BY DESIGN even though the admission gate refuses a
    // timeless statement: the asymmetry is the gate's decision, not the schema's,
    // and the column matches `source_assertions.observed_at`.
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      expect(await tryInsert(row(ORG_A, p, { observed_at: null }))).toBe('ok');
    });
  });

  it('does NOT forbid an observed_at later than recorded_at — source clocks drift', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      expect(await tryInsert(row(ORG_A, p, {
        observed_at: '2099-01-01T00:00:00.000Z',
      }))).toBe('ok');
    });
  });
});

describe('WS-3D — idempotency is the index, not a lookup', () => {
  it('the same statement from the same source record in the same tenant is ONE row', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await insert(row(ORG_A, p));
      expect(await tryInsert(row(ORG_A, p))).toBe('23505');
      const { rows } = await db.query(`SELECT count(*)::int n FROM public.${PPO}`);
      expect(rows[0].n).toBe(1);
    });
  });

  it('is SUBJECT-AWARE: the same statement for a DIFFERENT subject is a second row', async () => {
    // This asserted the opposite in an earlier revision, on the reasoning that
    // a statement recorded before identity resolved must not duplicate once it
    // did. `ppo_one_subject` makes that unreachable — the declared leg is NOT
    // NULL, so this table never holds a subjectless observation — and the only
    // thing the subject-free key did was discard the second attribution.
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A);
      await insert(row(ORG_A, p));
      await insert(row(ORG_A, p, { entity_type: 'account', person_id: null, account_id: a }));
      const { rows } = await db.query(`SELECT count(*)::int n FROM public.${PPO}`);
      expect(rows[0].n).toBe(2);
    });
  });

  it('two DIFFERENT PEOPLE stating the same words in one source record are two rows', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p1 = await newPerson(ORG_A);
      const p2 = await newPerson(ORG_A);
      await insert(row(ORG_A, p1));
      await insert(row(ORG_A, p2));
      const { rows } = await db.query(
        `SELECT count(*)::int n, count(DISTINCT person_id)::int subjects,
                count(DISTINCT origin_record_id)::int records,
                count(DISTINCT statement_hash)::int statements
           FROM public.${PPO}`);
      expect(rows[0].n).toBe(2);
      expect(rows[0].subjects).toBe(2);
      // Same source record, same words: ONLY the subject differs.
      expect(rows[0].records).toBe(1);
      expect(rows[0].statements).toBe(1);
    });
  });

  it('two DIFFERENT ACCOUNTS stating the same words in one source record are two rows', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a1 = await newAccount(ORG_A);
      const a2 = await newAccount(ORG_A);
      const acct = (id: string) => ({ entity_type: 'account', person_id: null, account_id: id });
      const p = await newPerson(ORG_A);
      await insert(row(ORG_A, p, acct(a1)));
      await insert(row(ORG_A, p, acct(a2)));
      const { rows } = await db.query(`SELECT count(*)::int n FROM public.${PPO}`);
      expect(rows[0].n).toBe(2);
    });
  });

  it('a retry for the SAME subject still collides — idempotency is intact for both legs', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await insert(row(ORG_A, p));
      expect(await tryInsert(row(ORG_A, p))).toBe('23505');

      const a = await newAccount(ORG_A);
      const acct = { entity_type: 'account', person_id: null, account_id: a };
      await insert(row(ORG_A, p, acct));
      // The account leg must dedupe too. A single index over both nullable legs
      // under NULLS DISTINCT would let this second insert through, which is the
      // precise failure the partial-per-leg design exists to prevent.
      expect(await tryInsert(row(ORG_A, p, acct))).toBe('23505');
    });
  });

  it('is time-free: a re-parsed timestamp does not create a second row', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await insert(row(ORG_A, p));
      expect(await tryInsert(row(ORG_A, p, { observed_at: '2026-09-14T08:15:00.999Z' }))).toBe('23505');
    });
  });

  it('two different utterances in one source record are two rows', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await insert(row(ORG_A, p));
      const other = 'renewals slip because nobody owns the handover';
      expect(await tryInsert(row(ORG_A, p, { statement: other, statement_hash: h(other) }))).toBe('ok');
    });
  });

  it('the same words in a different source record, or a different store, are two observations', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await insert(row(ORG_A, p));
      expect(await tryInsert(row(ORG_A, p, { origin_record_id: 'call-2026-10-02' }))).toBe('ok');
      expect(await tryInsert(row(ORG_A, p, { origin_store: 'email_threads' }))).toBe('ok');
    });
  });

  it('the same statement in another tenant is a separate observation', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newPerson(ORG_A);
      const b = await newPerson(ORG_B);
      await insert(row(ORG_A, a));
      // KEEPING insert: the row is the second of the two tenants counted below.
      expect(await keepInsert(row(ORG_B, b))).toBe('ok');
      const { rows } = await db.query(
        `SELECT count(DISTINCT organization_id)::int n FROM public.${PPO}
          WHERE statement_hash=$1`, [h(STATEMENT)]);
      expect(rows[0].n).toBe(2);
    });
  });
});

describe('WS-3D — tenant isolation, in both directions', () => {
  it('a row may not name another tenant\'s person', async () => {
    await inRollback(async () => {
      await seedTenants();
      const b = await newPerson(ORG_B);
      expect(await tryInsert(row(ORG_A, b))).toBe('23503');
    });
  });

  it('a row may not name another tenant\'s account', async () => {
    await inRollback(async () => {
      await seedTenants();
      const accountB = await newAccount(ORG_B);
      const p = await newPerson(ORG_A);
      expect(await tryInsert(row(ORG_A, p, {
        entity_type: 'account', person_id: null, account_id: accountB,
      }))).toBe('23503');
    });
  });

  it('a row may not cite another tenant\'s source record', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const foreign = await newSourceRecord(ORG_B);
      expect(await tryInsert(row(ORG_A, p, { source_record_id: foreign }))).toBe('23503');
      const own = await newSourceRecord(ORG_A);
      expect(await tryInsert(row(ORG_A, p, { source_record_id: own }))).toBe('ok');
    });
  });

  it('the REVERSE direction: a stored row cannot be moved to another tenant', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const id = await insert(row(ORG_A, p));
      expect(await attempt(
        `UPDATE public.${PPO} SET organization_id=$1 WHERE id=$2`, [ORG_B, id])).toBe('23503');
    });
  });

  it('nor can its subject be repointed at another tenant\'s person', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const b = await newPerson(ORG_B);
      const id = await insert(row(ORG_A, p));
      expect(await attempt(
        `UPDATE public.${PPO} SET person_id=$1 WHERE id=$2`, [b, id])).toBe('23503');
    });
  });

  it('refuses a subject that does not exist at all', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await tryInsert(row(ORG_A, '00000000-0000-0000-0000-000000000000'))).toBe('23503');
    });
  });
});

describe('WS-3D — erasure: the words go with the subject', () => {
  it('deleting the person CASCADES the observation away rather than orphaning it', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await insert(row(ORG_A, p));

      // The row IS the personal data. A SET NULL would leave the full text, the
      // tenant and the provenance behind under a nulled subject — an orphan no
      // erasure procedure revisits.
      expect(await effect('DELETE FROM public.unified_persons WHERE id=$1', [p])).toBe('ok');

      const { rows } = await db.query(`SELECT count(*)::int n FROM public.${PPO}`);
      expect(rows[0].n).toBe(0);
    });
  });

  it('the person DELETE is not aborted by ppo_one_subject — DEFECT-008 is not re-created', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await insert(row(ORG_A, p));
      // With a referential SET NULL this would be 23514 and the person would be
      // undeletable. CASCADE removes the row instead of updating it.
      expect(await effect('DELETE FROM public.unified_persons WHERE id=$1', [p])).toBe('ok');
      const { rows } = await db.query(
        'SELECT count(*)::int n FROM public.unified_persons WHERE id=$1', [p]);
      expect(rows[0].n).toBe(0);
    });
  });

  it('deleting the account CASCADES its account-attributed statements', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newAccount(ORG_A);
      await insert(row(ORG_A, '00000000-0000-0000-0000-000000000000', {
        entity_type: 'account', person_id: null, account_id: a,
      }));
      expect(await effect('DELETE FROM public.prospect_accounts WHERE id=$1', [a])).toBe('ok');
      const { rows } = await db.query(`SELECT count(*)::int n FROM public.${PPO}`);
      expect(rows[0].n).toBe(0);
    });
  });

  it('a cited source record CANNOT be deleted while a statement names it', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const sr = await newSourceRecord(ORG_A);
      await insert(row(ORG_A, p, { source_record_id: sr }));
      // The statement is not the source record's to destroy, and the words must
      // stay re-readable.
      expect(await attempt('DELETE FROM public.source_records WHERE id=$1', [sr])).toBe('23503');
    });
  });
});

describe('WS-3D — the two clocks stay two', () => {
  it('recorded_at is the database\'s own and is never the source instant', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const id = await insert(row(ORG_A, p));
      const { rows } = await db.query(
        `SELECT observed_at, recorded_at FROM public.${PPO} WHERE id=$1`, [id]);
      expect(new Date(rows[0].observed_at).toISOString()).toBe(OBSERVED_AT);
      expect(new Date(rows[0].recorded_at).toISOString()).not.toBe(OBSERVED_AT);
    });
  });

  it('an absent source instant is stored as NULL, not as the ingest clock', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const id = await insert(row(ORG_A, p, { observed_at: null }));
      const { rows } = await db.query(
        `SELECT observed_at, recorded_at FROM public.${PPO} WHERE id=$1`, [id]);
      expect(rows[0].observed_at).toBeNull();
      expect(rows[0].recorded_at).not.toBeNull();
    });
  });

  it('an absent confidence is stored as NULL, not as a 0 or a 1', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const id = await insert(row(ORG_A, p, { confidence: null }));
      const { rows } = await db.query(`SELECT confidence FROM public.${PPO} WHERE id=$1`, [id]);
      expect(rows[0].confidence).toBeNull();
    });
  });

  it('updated_at moves on an update while created_at does not', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const id = await insert(row(ORG_A, p));
      const before = await db.query(
        `SELECT created_at, updated_at FROM public.${PPO} WHERE id=$1`, [id]);
      await db.query(`UPDATE public.${PPO} SET statement_language='fr' WHERE id=$1`, [id]);
      const after = await db.query(
        `SELECT created_at, updated_at FROM public.${PPO} WHERE id=$1`, [id]);
      expect(new Date(after.rows[0].created_at).toISOString())
        .toBe(new Date(before.rows[0].created_at).toISOString());
      expect(new Date(after.rows[0].updated_at).getTime())
        .toBeGreaterThanOrEqual(new Date(before.rows[0].updated_at).getTime());
    });
  });
});

describe('WS-3D — the read this relation exists to serve', () => {
  it('returns one subject\'s statements newest first, with unstated times LAST', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await insert(row(ORG_A, p, { origin_record_id: 'r-old', observed_at: '2026-01-01T00:00:00.000Z' }));
      await insert(row(ORG_A, p, { origin_record_id: 'r-new', observed_at: '2026-10-01T00:00:00.000Z' }));
      await insert(row(ORG_A, p, { origin_record_id: 'r-null', observed_at: null }));

      const { rows } = await db.query(
        `SELECT origin_record_id FROM public.${PPO}
          WHERE organization_id=$1 AND entity_type='person' AND person_id=$2
          ORDER BY observed_at DESC NULLS LAST, recorded_at DESC`, [ORG_A, p]);
      expect(rows.map((r: { origin_record_id: string }) => r.origin_record_id))
        .toEqual(['r-new', 'r-old', 'r-null']);
    });
  });

  it('never returns another subject\'s or another tenant\'s statements', async () => {
    await inRollback(async () => {
      await seedTenants();
      const mine = await newPerson(ORG_A);
      const sibling = await newPerson(ORG_A);
      const foreign = await newPerson(ORG_B);
      await insert(row(ORG_A, mine));
      await insert(row(ORG_A, sibling));
      await insert(row(ORG_B, foreign));

      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.${PPO}
          WHERE organization_id=$1 AND entity_type='person' AND person_id=$2`, [ORG_A, mine]);
      expect(rows[0].n).toBe(1);
    });
  });
});
