/**
 * WS-4A — `attested_engagement_identities`, against real PostgreSQL.
 *
 * This registry is the only thing in the product that can answer "is this
 * engagement author one of OURS?", and it answers only NEGATIVELY: a listed
 * identity is not a prospect. Everything downstream of that answer — whether a
 * message becomes admissible evidence that a prospect said something — rests on
 * properties no mocked test can establish: that the partial unique index really
 * is partial, that the identity column really is not case-folded, that the
 * CHECKs really refuse the rows the writer believes it cannot store, and that
 * the relation really is unreachable by the public roles.
 *
 * So those properties are asserted here against a live database, from the
 * catalog and from real SQLSTATEs.
 *
 * TWO PROPERTIES ARE LOAD-BEARING AND EASY TO "FIX" WRONGLY, and each has a test
 * whose name says so:
 *
 *  1. `platform` is forced lower-case; `platform_user_id` is NOT. The registry
 *     holds ENGAGEMENT-namespace identifiers, which are profile URLs and
 *     handles, and those are case-significant. Folding the identity would
 *     collapse two different people into one row and reject the second as a
 *     replay of the first.
 *  2. The unique index is PARTIAL on `revoked_at IS NULL`. Make it total and an
 *     identity could be claimed, withdrawn, and then never claimed again, while
 *     a second revocation becomes unstorable — destroying the history the table
 *     exists to keep.
 *
 * And one absence is load-bearing: NO foreign key to `users`, and no CHECK
 * naming either actor column. That pair is DEFECT-008 — an actor FK with ON
 * DELETE SET NULL fires a referential UPDATE, PostgreSQL re-evaluates the
 * table's CHECKs, and the user's own deletion aborts. The combination cannot be
 * assembled from what this table declares, and that is asserted, not assumed.
 */
import {
  db,
  ORG_A,
  ORG_B,
  inRollback,
  attempt,
  effect,
  seedTenants,
} from './setup';

const AEI = 'attested_engagement_identities';

/** An actor id. Deliberately NOT a `users` row: there is no foreign key. */
const ACTOR = '00000000-0000-4000-8000-0000000000a1';

/** A real LinkedIn profile URL shape — mixed case, because that is the point. */
const IDENTITY = 'https://www.linkedin.com/in/Jane-Doe';

const row = (org: string, over: Record<string, unknown> = {}) => ({
  organization_id: org,
  platform: 'linkedin',
  platform_user_id: IDENTITY,
  attested_as: 'tenant_own',
  statement: 'this LinkedIn profile belongs to our own sales team',
  evidence: JSON.stringify({}),
  attested_by_user_id: ACTOR,
  ...over,
});

const insertSql = (r: Record<string, unknown>) => {
  const cols = Object.keys(r);
  return {
    sql: `INSERT INTO public.${AEI} (${cols.join(',')})
          VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
    params: Object.values(r),
  };
};

/** Insert, keeping the row; throws on refusal. */
async function insert(r: Record<string, unknown>): Promise<string> {
  const { sql, params } = insertSql(r);
  const { rows } = await db.query(sql, params);
  return rows[0].id;
}

/** Probe whether a row would be admitted; the database is left unchanged. */
async function tryInsert(r: Record<string, unknown>): Promise<string> {
  const { sql, params } = insertSql(r);
  return attempt(sql, params);
}

/** Insert and KEEP the row, reporting 'ok' or the SQLSTATE. */
async function keepInsert(r: Record<string, unknown>): Promise<string> {
  const { sql, params } = insertSql(r);
  return effect(sql, params);
}

/**
 * Run one statement as another database role, then restore.
 *
 * The savepoint is what makes this safe: a refused statement aborts the
 * transaction, and rolling back to the savepoint both recovers it and undoes
 * the `SET LOCAL ROLE`.
 */
async function asRole(role: string, sql: string): Promise<{ code: string; rows: number }> {
  await db.query('SAVEPOINT role_probe');
  let code = 'ok';
  let rows = 0;
  try {
    await db.query(`SET LOCAL ROLE ${role}`);
    const r = await db.query(sql);
    rows = r.rowCount ?? 0;
  } catch (err: any) {
    code = err.code ?? 'unknown';
  }
  await db.query('ROLLBACK TO SAVEPOINT role_probe');
  return { code, rows };
}

async function revoke(id: string, reason = 'left the company'): Promise<void> {
  await db.query(
    `UPDATE public.${AEI}
        SET revoked_at = now(), revoked_reason = $2, revoked_by_user_id = $3
      WHERE id = $1`,
    [id, reason, ACTOR],
  );
}

describe('WS-4A — schema shape', () => {
  it('exists, is tenant-scoped NOT NULL, and has RLS enabled', async () => {
    const { rows } = await db.query(
      `SELECT c.relrowsecurity, a.attnotnull
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id'
        WHERE n.nspname = 'public' AND c.relname = $1`, [AEI]);
    expect(rows).toHaveLength(1);
    expect(rows[0].relrowsecurity).toBe(true);
    expect(rows[0].attnotnull).toBe(true);
  });

  it('has RLS enabled WITH a way in — a service-role policy, and only that', async () => {
    // RLS with no policy at all denies everyone, including the writer, which
    // would make the registry unwritable rather than private.
    const { rows } = await db.query(
      `SELECT policyname, qual, with_check FROM pg_policies
        WHERE schemaname = 'public' AND tablename = $1`, [AEI]);
    expect(rows).toHaveLength(1);
    expect(rows[0].qual).toContain('service_role');
    expect(rows[0].with_check).toContain('service_role');
  });

  it('scopes that one policy to EXACTLY {service_role} — not {public}', async () => {
    // A policy written without a TO clause has roles = {public}, which applies
    // to every role, `authenticated` included. A catalog check asking only
    // whether 'authenticated' is IN the role set can never see that, because
    // the array says {public}; so the whole array is compared instead.
    const { rows } = await db.query(
      `SELECT policyname, roles::text[] AS roles FROM pg_policies
        WHERE schemaname = 'public' AND tablename = $1
        ORDER BY policyname`, [AEI]);
    expect(rows).toHaveLength(1);
    expect(rows[0].policyname).toBe(`${AEI}_service_role`);
    expect(rows[0].roles).toEqual(['service_role']);
    expect(rows[0].roles).not.toContain('public');
  });

  it('enables row level security WITHOUT forcing it', async () => {
    // FORCE would subject the table OWNER too, which is the connection these
    // suites use — the registry would read as empty for its own owner.
    const { rows } = await db.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1`, [AEI]);
    expect(rows).toHaveLength(1);
    expect(rows[0].relrowsecurity).toBe(true);
    expect(rows[0].relforcerowsecurity).toBe(false);
  });

  it('has EXACTLY ONE foreign key, and it is the tenant, CASCADEd', async () => {
    const { rows } = await db.query(
      `SELECT con.conname, pg_get_constraintdef(con.oid) d
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1 AND con.contype = 'f'`, [AEI]);
    expect(rows).toHaveLength(1);
    expect(rows[0].d).toMatch(/FOREIGN KEY \(organization_id\) REFERENCES companies\(id\) ON DELETE CASCADE/);
  });

  it('has NO foreign key to users — DEFECT-008 cannot be assembled here', async () => {
    const { rows } = await db.query(
      `SELECT con.conname, pg_get_constraintdef(con.oid) d
         FROM pg_constraint con
         JOIN pg_class c  ON c.oid  = con.conrelid
         JOIN pg_class rc ON rc.oid = con.confrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1
          AND con.contype = 'f' AND rc.relname = 'users'`, [AEI]);
    expect(rows).toEqual([]);
  });

  it('has NO CHECK naming either actor column — the other half of DEFECT-008', async () => {
    // `platform_user_id` IS named by a CHECK and also ends in `user_id`, so the
    // actor columns are matched by their exact names rather than by a suffix.
    const { rows } = await db.query(
      `SELECT con.conname, pg_get_constraintdef(con.oid) d
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1 AND con.contype = 'c'`, [AEI]);
    expect(rows.length).toBeGreaterThanOrEqual(7);
    const offenders = rows
      .filter((r: any) => /\b(attested_by_user_id|revoked_by_user_id)\b/.test(r.d))
      .map((r: any) => r.conname);
    expect(offenders).toEqual([]);
  });

  it('requires the attesting actor and leaves the revoking actor optional', async () => {
    const { rows } = await db.query(
      `SELECT attname, attnotnull FROM pg_attribute
        WHERE attrelid = $1::regclass
          AND attname IN ('attested_by_user_id','revoked_by_user_id')
        ORDER BY attname`, [`public.${AEI}`]);
    expect(rows).toEqual([
      { attname: 'attested_by_user_id', attnotnull: true },
      { attname: 'revoked_by_user_id', attnotnull: false },
    ]);
  });

  it('keys one ACTIVE attestation per identity: UNIQUE, PARTIAL, and NOT case-folded', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'uq_aei_active_identity'`);
    expect(rows).toHaveLength(1);
    const def: string = rows[0].indexdef;
    expect(def).toMatch(/CREATE UNIQUE INDEX/);
    expect(def).toMatch(/\(organization_id, platform, platform_user_id\)/);
    // The partiality and the absence of folding are the two properties a
    // well-meaning later edit is most likely to remove.
    expect(def).toMatch(/WHERE \(revoked_at IS NULL\)/);
    expect(def).not.toContain('lower(');
  });

  it('carries the registry read index', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_aei_org_attested_at'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/\(organization_id, attested_at DESC\)/);
  });
});

describe('WS-4A — the CHECKs refuse every malformed row', () => {
  it('refuses a blank, untrimmed or upper-case platform', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await tryInsert(row(ORG_A, { platform: '   ' }))).toBe('23514');
      expect(await tryInsert(row(ORG_A, { platform: ' linkedin' }))).toBe('23514');
      expect(await tryInsert(row(ORG_A, { platform: 'LinkedIn' }))).toBe('23514');
      expect(await tryInsert(row(ORG_A, { platform: 'linkedin' }))).toBe('ok');
    });
  });

  it('refuses a blank or untrimmed identity but KEEPS ITS CASE — the deliberate contrast', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await tryInsert(row(ORG_A, { platform_user_id: '  ' }))).toBe('23514');
      expect(await tryInsert(row(ORG_A, { platform_user_id: ` ${IDENTITY}` }))).toBe('23514');

      // A mixed-case profile URL is admitted UNCHANGED. This is the property
      // that makes the registry able to match the authors it is about; folding
      // it would make it match nothing.
      const id = await insert(row(ORG_A, { platform_user_id: IDENTITY }));
      const { rows } = await db.query(
        `SELECT platform_user_id FROM public.${AEI} WHERE id = $1`, [id]);
      expect(rows[0].platform_user_id).toBe(IDENTITY);
    });
  });

  it('refuses an attestation kind outside the vocabulary', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await tryInsert(row(ORG_A, { attested_as: 'partner_owned' }))).toBe('23514');
      expect(await tryInsert(row(ORG_A, { attested_as: 'tenant_own' }))).toBe('ok');
    });
  });

  it('refuses a blank statement — an attestation that states nothing is not one', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await tryInsert(row(ORG_A, { statement: '   ' }))).toBe('23514');
    });
  });

  it('refuses evidence that is not a small JSON object', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await tryInsert(row(ORG_A, { evidence: JSON.stringify([1, 2]) }))).toBe('23514');
      expect(await tryInsert(row(ORG_A, { evidence: JSON.stringify('note') }))).toBe('23514');
      expect(await tryInsert(row(ORG_A, {
        evidence: JSON.stringify({ blob: 'x'.repeat(20000) }),
      }))).toBe('23514');
      expect(await tryInsert(row(ORG_A, {
        evidence: JSON.stringify({ ticket: 'OPS-12' }),
      }))).toBe('ok');
    });
  });

  it('refuses an incoherent revocation in BOTH directions', async () => {
    await inRollback(async () => {
      await seedTenants();
      const t = '2026-10-20T00:00:00.000Z';
      // A withdrawal with no reason, and a reason with no withdrawal.
      expect(await tryInsert(row(ORG_A, { revoked_at: t }))).toBe('23514');
      expect(await tryInsert(row(ORG_A, { revoked_reason: 'gone' }))).toBe('23514');
      // A withdrawal whose reason is whitespace states nothing.
      expect(await tryInsert(row(ORG_A, { revoked_at: t, revoked_reason: '  ' }))).toBe('23514');
      expect(await tryInsert(row(ORG_A, {
        revoked_at: t, revoked_reason: 'gone', attested_at: t,
      }))).toBe('ok');
    });
  });

  it('refuses a revocation that precedes the statement it withdraws, and allows equality', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await tryInsert(row(ORG_A, {
        attested_at: '2026-10-20T00:00:00.000Z',
        revoked_at: '2026-10-19T00:00:00.000Z',
        revoked_reason: 'gone',
      }))).toBe('23514');
      // Attested and withdrawn inside one transaction: the two share now().
      expect(await tryInsert(row(ORG_A, {
        attested_at: '2026-10-20T00:00:00.000Z',
        revoked_at: '2026-10-20T00:00:00.000Z',
        revoked_reason: 'gone',
      }))).toBe('ok');
    });
  });

  it('refuses a tenant that does not exist', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await tryInsert(row('00000000-0000-0000-0000-000000000000'))).toBe('23503');
    });
  });
});

describe('WS-4A — one active claim, and a history that stays writable', () => {
  it('refuses a second ACTIVE attestation of the same identity in the same tenant', async () => {
    await inRollback(async () => {
      await seedTenants();
      await insert(row(ORG_A));
      expect(await tryInsert(row(ORG_A))).toBe('23505');
    });
  });

  it('is case-SIGNIFICANT: a differently-cased identity is a DIFFERENT identity', async () => {
    await inRollback(async () => {
      await seedTenants();
      await insert(row(ORG_A));
      // Under a lower()-folded key this would be rejected as a replay of the
      // row above. These are two different profile URLs and two rows.
      expect(await keepInsert(row(ORG_A, {
        platform_user_id: 'https://www.linkedin.com/in/jane-doe',
      }))).toBe('ok');
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.${AEI} WHERE organization_id = $1`, [ORG_A]);
      expect(rows[0].n).toBe(2);
    });
  });

  it('scopes the claim to the tenant: another tenant may attest the same identity', async () => {
    await inRollback(async () => {
      await seedTenants();
      await insert(row(ORG_A));
      expect(await keepInsert(row(ORG_B))).toBe('ok');
      const { rows } = await db.query(
        `SELECT count(DISTINCT organization_id)::int n FROM public.${AEI}
          WHERE platform_user_id = $1`, [IDENTITY]);
      expect(rows[0].n).toBe(2);
    });
  });

  it('lets a WITHDRAWN identity be attested again — this is why the index is partial', async () => {
    await inRollback(async () => {
      await seedTenants();
      const first = await insert(row(ORG_A));
      await revoke(first);
      // A total unique index would make this 23505 for ever: claimed once,
      // withdrawn, and never claimable again.
      expect(await keepInsert(row(ORG_A))).toBe('ok');
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.${AEI}
          WHERE organization_id = $1 AND revoked_at IS NULL`, [ORG_A]);
      expect(rows[0].n).toBe(1);
    });
  });

  it('keeps a SECOND withdrawal of the same identity storable — the history survives', async () => {
    await inRollback(async () => {
      await seedTenants();
      const first = await insert(row(ORG_A));
      await revoke(first, 'first withdrawal');
      const second = await insert(row(ORG_A));
      await revoke(second, 'second withdrawal');
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.${AEI}
          WHERE organization_id = $1 AND revoked_at IS NOT NULL`, [ORG_A]);
      expect(rows[0].n).toBe(2);
    });
  });
});

describe('WS-4A — the actor columns carry no referential hazard', () => {
  it('accepts NULLING the revoking actor on a withdrawn row — no CHECK pairs them', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await insert(row(ORG_A));
      await revoke(id);
      // THIS IS THE DEFECT-008 REHEARSAL. A future `users` reference with ON
      // DELETE SET NULL would perform exactly this update as a side effect of
      // deleting a user. Because no CHECK names the column, it is accepted —
      // so such an FK could never abort the user's deletion with 23514.
      expect(await effect(
        `UPDATE public.${AEI} SET revoked_by_user_id = NULL WHERE id = $1`, [id],
      )).toBe('ok');
      const { rows } = await db.query(
        `SELECT revoked_at IS NOT NULL AS still_revoked, revoked_by_user_id
           FROM public.${AEI} WHERE id = $1`, [id]);
      expect(rows[0].still_revoked).toBe(true);
      expect(rows[0].revoked_by_user_id).toBeNull();
    });
  });

  it('refuses to null the ATTESTING actor — the trade this table makes knowingly', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await insert(row(ORG_A));
      // NOT NULL, so a SET NULL foreign key here would abort a user delete with
      // 23502. That is precisely why there is no foreign key on this column:
      // the actor is required by the single writer instead.
      expect(await attempt(
        `UPDATE public.${AEI} SET attested_by_user_id = NULL WHERE id = $1`, [id],
      )).toBe('23502');
    });
  });
});

describe('WS-4A — erasure follows the tenant', () => {
  it('CASCADEs every attestation away when the tenant is deleted', async () => {
    await inRollback(async () => {
      await seedTenants();
      await insert(row(ORG_A));
      const revoked = await insert(row(ORG_A, { platform_user_id: `${IDENTITY}-2` }));
      await revoke(revoked);

      expect(await effect('DELETE FROM public.companies WHERE id = $1', [ORG_A])).toBe('ok');

      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.${AEI} WHERE organization_id = $1`, [ORG_A]);
      expect(rows[0].n).toBe(0);
    });
  });

  it('leaves the OTHER tenant\'s attestations untouched', async () => {
    await inRollback(async () => {
      await seedTenants();
      await insert(row(ORG_A));
      await insert(row(ORG_B));
      expect(await effect('DELETE FROM public.companies WHERE id = $1', [ORG_A])).toBe('ok');
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.${AEI} WHERE organization_id = $1`, [ORG_B]);
      expect(rows[0].n).toBe(1);
    });
  });
});

describe('WS-4A — the granted privileges are exactly the ones the writer uses', () => {
  /**
   * WHY THE CATALOG AND NOT information_schema.
   *
   * `information_schema.role_table_grants` shows only the grants visible to the
   * enabled session role. It can therefore read EMPTY on a relation that is in
   * fact granted, which would make "anon holds nothing" an assertion that
   * cannot fail. `pg_class.relacl` is the authoritative ACL and `aclexplode`
   * expands it row-per-(grantee, privilege), so the same source answers both
   * the positive and the negative question.
   *
   * A PUBLIC grant appears in that expansion with `grantee = 0`, which joins to
   * no row in `pg_roles` — so it is queried separately, below. It matters: a
   * privilege held by PUBLIC is held by every role, which is why the migration
   * revokes from `PUBLIC`, `anon` AND `authenticated` rather than any subset.
   */
  const privilegesOf = async (role: string): Promise<string[]> => {
    const { rows } = await db.query(
      `SELECT DISTINCT a.privilege_type AS p
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(c.relacl) a
         JOIN pg_roles r ON r.oid = a.grantee
        WHERE n.nspname = 'public' AND c.relname = $1 AND r.rolname = $2
        ORDER BY a.privilege_type`, [AEI, role]);
    return rows.map((r: any) => r.p as string);
  };

  it('grants service_role exactly SELECT, INSERT and UPDATE — no DELETE', async () => {
    // Derived from the single repository module: it inserts, selects, and
    // updates. A revocation WITHDRAWS a row (revoked_at / revoked_reason /
    // revoked_by_user_id) instead of deleting it, which is both why UPDATE is
    // required and why DELETE must not be granted — with DELETE available, a
    // bug could erase the history this table exists to keep.
    expect(await privilegesOf('service_role')).toEqual(['INSERT', 'SELECT', 'UPDATE']);
  });

  it('grants anon and authenticated nothing at all', async () => {
    expect(await privilegesOf('anon')).toEqual([]);
    expect(await privilegesOf('authenticated')).toEqual([]);
  });

  it('grants PUBLIC nothing — the inheritance path every role would follow', async () => {
    const { rows } = await db.query(
      `SELECT a.privilege_type AS p
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE n.nspname = 'public' AND c.relname = $1 AND a.grantee = 0
        ORDER BY a.privilege_type`, [AEI]);
    expect(rows.map((r: any) => r.p)).toEqual([]);
  });
});

describe('WS-4A — the relation is unreachable by the public roles', () => {
  /**
   * THE INVARIANT IS CLOSURE. THE MECHANISM IS NOT THE INVARIANT.
   *
   * An earlier revision of this test asserted SQLSTATE `42501` for both roles,
   * which passed only because the cluster it was written against had no grants
   * on this relation at all: the request stopped at the PRIVILEGE layer and
   * never reached policy evaluation. That made the assertion a statement about
   * the harness, not about the relation — and it broke the moment the same
   * database was given the grants a managed Supabase project supplies itself.
   *
   * Worse, it invited the wrong conclusion. "anon is denied" via a missing
   * grant and "anon is denied" via the policy are different facts with
   * different production consequences, and the committed schema establishes
   * NEITHER grant: see the migration headers on
   * `20261026000000_close_anon_rls_exposure.sql`, which revoked the table
   * defaults for `anon` but only TRUNCATE for `authenticated`.
   *
   * So what is asserted here is the property that must hold either way —
   * neither public role obtains a row, and neither writes one — and the
   * mechanism is captured alongside it rather than fixed in advance. Both
   * mechanisms are legitimate closure; a `SELECT` that merely returns no rows
   * is the policy filtering, and `42501` is one of the two layers refusing.
   * `rls.branches.test.ts` in the PostgREST harness isolates the branches.
   */
  it('is CLOSED to anon and authenticated, by whichever layer answers', async () => {
    await inRollback(async () => {
      await seedTenants();
      await insert(row(ORG_A));

      const mechanisms: Record<string, string> = {};

      for (const role of ['anon', 'authenticated']) {
        const read = await asRole(role, `SELECT * FROM public.${AEI}`);
        // Either refused outright, or allowed through to a policy that returns
        // nothing. What may never happen is a row coming back.
        expect(read.rows).toBe(0);
        expect(['42501', 'ok']).toContain(read.code);
        mechanisms[`${role}:read`] = read.code === '42501' ? 'privilege' : 'policy';

        const write = await asRole(
          role,
          `INSERT INTO public.${AEI}
             (organization_id, platform, platform_user_id, statement, attested_by_user_id)
           VALUES ('${ORG_A}', 'linkedin', 'https://example.com/x', 'mine', '${ACTOR}')`,
        );
        // A write is always refused, and always with the same SQLSTATE
        // whichever layer refuses it.
        expect(write.code).toBe('42501');
        mechanisms[`${role}:write`] = '42501';
      }

      // The relation is closed to both roles on both operations. Recorded so a
      // reader of the run can see WHICH layer answered in this database.
      expect(Object.keys(mechanisms)).toHaveLength(4);
    });
  });

  it('still admits the owner, so the registry is private and not merely broken', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await insert(row(ORG_A));
      const { rows } = await db.query(
        `SELECT id FROM public.${AEI} WHERE id = $1`, [id]);
      expect(rows).toHaveLength(1);
    });
  });
});
