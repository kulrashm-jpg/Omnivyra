/**
 * D1 — the tenant ICP model, against real PostgreSQL.
 *
 * The properties that matter here cannot be mocked, and the unit suite is
 * explicit that it does not prove them:
 *
 *   * that `organization_id` really is a uuid with a real foreign key, so a
 *     tenant that does not exist cannot be named — the failure
 *     `company_profiles` has lived with for 31 rows;
 *   * that the PARTIAL unique index really permits exactly one ratified
 *     version, and that a second one raises `23505` rather than being accepted;
 *   * that a ratified version really is immutable, because the trigger fires —
 *     an application-only guarantee is worth the next person's memory of it;
 *   * that deleting a tenant really cascades;
 *   * that the composite foreign key really refuses a cross-tenant reference.
 *
 * Run via `npm run test:realschema`, which requires `W6_DB_URL` and a
 * disposable PostgreSQL. `setup.ts` refuses a managed host outright.
 */
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt } from './setup';

const CRITERIA = JSON.stringify([{
  id: 'ind', kind: 'required', subject: 'account', attribute: 'industry',
  predicate: { op: 'one_of', values: ['Software'] },
}]);

async function newIcp(org: string, key = 'default'): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.prospect_icps (organization_id, icp_key) VALUES ($1, $2) RETURNING id`,
    [org, key],
  );
  return rows[0].id;
}

const INSERT_VERSION = `INSERT INTO public.prospect_icp_versions
  (organization_id, icp_id, version, status, criteria, ratified_at, ratified_by)
  VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`;

/**
 * Attempt an insert and report the SQLSTATE — 'ok' when the database accepted
 * it.
 *
 * ⚠ THIS LEAVES NO ROW BEHIND. `attempt` wraps the statement in a SAVEPOINT and
 * rolls back to it on EVERY path, success included, so it can prove that an
 * insert is ACCEPTED and it can never make a row exist for a later statement.
 *
 * A test that needs the row to still be there must use `keepVersion` (or
 * `ratifiedVersion`). Getting this wrong does not fail loudly: the follow-up
 * statement simply matches zero rows, an UPDATE reports 'ok' without firing a
 * single trigger, and the assertion passes while proving nothing. That is
 * exactly what happened to the tenant-move test below.
 */
const insVersion = (
  org: string, icp: string, version: number, status: string,
  ratifiedAt: string | null = null, ratifiedBy: string | null = null,
) => attempt(INSERT_VERSION, [org, icp, version, status, CRITERIA, ratifiedAt, ratifiedBy]);

/**
 * Insert an unratified version and KEEP it, for tests whose subject is what
 * happens to an EXISTING row. Uses `db.query` directly, so the row survives
 * until `inRollback` unwinds the whole test.
 */
async function keepVersion(
  org: string, icp: string, version: number, status: 'draft' | 'proposed' = 'draft',
): Promise<string> {
  const { rows } = await db.query(`${INSERT_VERSION} RETURNING id`,
    [org, icp, version, status, CRITERIA, null, null]);
  return rows[0].id;
}

const RATIFIED_AT = '2026-09-01T00:00:00Z';
const RATIFIER = '00000000-0000-4000-8000-0000000000f1';

async function ratifiedVersion(org: string, icp: string, version: number): Promise<string> {
  const { rows } = await db.query(`${INSERT_VERSION} RETURNING id`,
    [org, icp, version, 'ratified', CRITERIA, RATIFIED_AT, RATIFIER]);
  return rows[0].id;
}

// ───────────────────────────────────────────────────────────────────────────
describe('D1 — schema shape', () => {
  it.each(['prospect_icps', 'prospect_icp_versions'])('%s exists with RLS enabled', async (table) => {
    const { rows } = await db.query(`
      SELECT c.relrowsecurity rls,
             (SELECT count(*)::int FROM pg_attribute a
               WHERE a.attrelid=c.oid AND a.attname='organization_id'
                 AND NOT a.attisdropped AND a.attnotnull) tenant
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname=$1`, [table]);
    expect(rows[0].rls).toBe(true);
    expect(rows[0].tenant).toBe(1);
  });

  it.each(['prospect_icps', 'prospect_icp_versions'])(
    '%s: the tenant key is uuid with a REAL foreign key to companies — contract 15', async (table) => {
      const { rows: col } = await db.query(
        `SELECT format_type(atttypid, atttypmod) t FROM pg_attribute
          WHERE attrelid=$1::regclass AND attname='organization_id'`, [`public.${table}`]);
      // NOT `text`. This is the exact shape company_profiles got wrong.
      expect(col[0].t).toBe('uuid');

      const { rows: fk } = await db.query(`
        SELECT pg_get_constraintdef(con.oid) d FROM pg_constraint con
        JOIN pg_class s ON s.oid=con.conrelid JOIN pg_class t ON t.oid=con.confrelid
        WHERE con.contype='f' AND s.relname=$1 AND t.relname='companies'
          AND array_length(con.conkey,1)=1`, [table]);
      expect(fk).toHaveLength(1);
      expect(fk[0].d).toMatch(/FOREIGN KEY \(organization_id\) REFERENCES companies\(id\)/);
      expect(fk[0].d).toMatch(/ON DELETE CASCADE/);
    },
  );

  it('has NO effective-period columns — v1 deliberately omits them', async () => {
    const { rows } = await db.query(
      `SELECT attname FROM pg_attribute
        WHERE attrelid='public.prospect_icp_versions'::regclass AND attnum>0 AND NOT attisdropped`);
    const names = rows.map((r: any) => r.attname);
    for (const forbidden of ['effective_from', 'effective_until', 'company_id', 'is_active', 'active']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('carries the companion (id, organization_id) index on BOTH tables — future tenant-safe FKs', async () => {
    for (const name of ['uq_prospect_icps_id_org', 'uq_prospect_icp_versions_id_org']) {
      const { rows } = await db.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname=$1`, [name]);
      expect(rows).toHaveLength(1);
      expect(rows[0].indexdef).toMatch(/CREATE UNIQUE INDEX/);
      expect(rows[0].indexdef).toMatch(/\(id, organization_id\)/);
    }
  });

  it('the reference to the ICP object is a COMPOSITE tenant-safe foreign key', async () => {
    const { rows } = await db.query(`
      SELECT pg_get_constraintdef(con.oid) d FROM pg_constraint con
      JOIN pg_class s ON s.oid=con.conrelid
      WHERE con.contype='f' AND s.relname='prospect_icp_versions' AND array_length(con.conkey,1)=2`);
    expect(rows).toHaveLength(1);
    expect(rows[0].d).toMatch(/FOREIGN KEY \(icp_id, organization_id\) REFERENCES prospect_icps\(id, organization_id\)/);
    expect(rows[0].d).toMatch(/ON DELETE CASCADE/);
  });

  it('the one-active-version index is PARTIAL — so ON CONFLICT cannot infer it (42P10)', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND indexname='uq_prospect_icp_versions_one_ratified'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/CREATE UNIQUE INDEX/);
    expect(rows[0].indexdef).toMatch(/\(organization_id, icp_id\)/);
    expect(rows[0].indexdef).toMatch(/WHERE \(status = 'ratified'/);
  });

  it('the immutability trigger exists and fires BEFORE UPDATE', async () => {
    const { rows } = await db.query(`
      SELECT tgname, tgtype FROM pg_trigger
       WHERE tgrelid='public.prospect_icp_versions'::regclass
         AND tgname='trg_prospect_icp_versions_immutable' AND NOT tgisinternal`);
    expect(rows).toHaveLength(1);
    // tgtype bit 1 = BEFORE, bit 16 = UPDATE, bit 0 = ROW.
    expect(Number(rows[0].tgtype) & 1).toBe(1);
    expect(Number(rows[0].tgtype) & 16).toBe(16);
  });

  it('ships EMPTY — contract 18 makes "no ICP" a supported state, not a gap to seed', async () => {
    const { rows } = await db.query(`
      SELECT (SELECT count(*)::int FROM public.prospect_icps) icps,
             (SELECT count(*)::int FROM public.prospect_icp_versions) versions`);
    expect(rows[0].icps).toBe(0);
    expect(rows[0].versions).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('D1 — tenancy', () => {
  it('refuses a tenant that does not exist', async () => {
    await inRollback(async () => {
      const ghost = '00000000-0000-4000-8000-0000000000ff';
      expect(await attempt(
        `INSERT INTO public.prospect_icps (organization_id, icp_key) VALUES ($1,'default')`, [ghost],
      )).toBe('23503');
    });
  });

  it('two tenants may hold the SAME icp_key, and neither sees the other', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newIcp(ORG_A, 'default');
      const b = await newIcp(ORG_B, 'default');
      expect(a).not.toBe(b);
      // ...but one tenant may not hold the key twice.
      expect(await attempt(
        `INSERT INTO public.prospect_icps (organization_id, icp_key) VALUES ($1,'default')`, [ORG_A],
      )).toBe('23505');
    });
  });

  it('a CROSS-TENANT reference is refused by the composite foreign key', async () => {
    await inRollback(async () => {
      await seedTenants();
      const icpA = await newIcp(ORG_A);
      // Tenant B naming tenant A's ICP: the PAIR does not exist in the
      // referenced index, so this is 23503 and not a leak.
      expect(await insVersion(ORG_B, icpA, 1, 'draft')).toBe('23503');
      // The same id from its own tenant is fine.
      expect(await insVersion(ORG_A, icpA, 1, 'draft')).toBe('ok');
    });
  });

  it('deleting a tenant CASCADES to its ICPs and their versions', async () => {
    await inRollback(async () => {
      await seedTenants();
      const icp = await newIcp(ORG_A);
      await ratifiedVersion(ORG_A, icp, 1);
      await db.query(`DELETE FROM public.companies WHERE id = $1`, [ORG_A]);

      const { rows } = await db.query(`
        SELECT (SELECT count(*)::int FROM public.prospect_icps WHERE organization_id=$1) icps,
               (SELECT count(*)::int FROM public.prospect_icp_versions WHERE organization_id=$1) versions`,
      [ORG_A]);
      expect(rows[0]).toEqual({ icps: 0, versions: 0 });
    });
  });

  it('deleting an ICP cascades to its versions', async () => {
    await inRollback(async () => {
      await seedTenants();
      const icp = await newIcp(ORG_A);
      await keepVersion(ORG_A, icp, 1, 'draft');
      // Proven to be there BEFORE the delete, so `0` afterwards is a cascade
      // and not the absence of a row that was never inserted.
      const before = await db.query(
        `SELECT count(*)::int c FROM public.prospect_icp_versions WHERE icp_id=$1`, [icp]);
      expect(before.rows[0].c).toBe(1);

      await db.query(`DELETE FROM public.prospect_icps WHERE id=$1`, [icp]);
      const { rows } = await db.query(
        `SELECT count(*)::int c FROM public.prospect_icp_versions WHERE icp_id=$1`, [icp]);
      expect(rows[0].c).toBe(0);
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('D1 contract 15 — exactly one ratified version', () => {
  it('permits ONE ratified version, and a SECOND INSERT raises 23505', async () => {
    await inRollback(async () => {
      await seedTenants();
      const icp = await newIcp(ORG_A);

      expect(await insVersion(ORG_A, icp, 1, 'ratified', RATIFIED_AT, RATIFIER)).toBe('ok');
      await ratifiedVersion(ORG_A, icp, 1);

      // THE assertion. A partial unique index cannot be inferred by
      // ON CONFLICT, so the writer must see exactly this code and handle it.
      expect(await insVersion(ORG_A, icp, 2, 'ratified', RATIFIED_AT, RATIFIER)).toBe('23505');
    });
  });

  it('permits unlimited draft, proposed and superseded versions alongside the one ratified', async () => {
    await inRollback(async () => {
      await seedTenants();
      const icp = await newIcp(ORG_A);
      await ratifiedVersion(ORG_A, icp, 1);

      // KEPT, so all four genuinely COEXIST at the end rather than each being
      // inserted into an otherwise-empty table and rolled back.
      await keepVersion(ORG_A, icp, 2, 'draft');
      await keepVersion(ORG_A, icp, 3, 'proposed');
      // A superseded row carries its original ratification, and does not
      // collide with the live one — that is what makes history representable.
      expect(await attempt(
        `INSERT INTO public.prospect_icp_versions
           (organization_id, icp_id, version, status, criteria, ratified_at, ratified_by,
            superseded_at, superseded_by_version)
         VALUES ($1,$2,4,'superseded',$3::jsonb,$4,$5,$4,5)`,
        [ORG_A, icp, CRITERIA, RATIFIED_AT, RATIFIER],
      )).toBe('ok');
      await db.query(
        `INSERT INTO public.prospect_icp_versions
           (organization_id, icp_id, version, status, criteria, ratified_at, ratified_by,
            superseded_at, superseded_by_version)
         VALUES ($1,$2,4,'superseded',$3::jsonb,$4,$5,$4,5)`,
        [ORG_A, icp, CRITERIA, RATIFIED_AT, RATIFIER]);

      const { rows } = await db.query(
        `SELECT status, count(*)::int c FROM public.prospect_icp_versions
          WHERE organization_id=$1 AND icp_id=$2 GROUP BY status ORDER BY status`, [ORG_A, icp]);
      expect(rows).toEqual([
        { status: 'draft', c: 1 },
        { status: 'proposed', c: 1 },
        { status: 'ratified', c: 1 },     // still exactly ONE, alongside the rest
        { status: 'superseded', c: 1 },
      ]);
    });
  });

  it('each tenant, and each ICP, gets its own ratified version', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a1 = await newIcp(ORG_A, 'default');
      const a2 = await newIcp(ORG_A, 'expansion');
      const b1 = await newIcp(ORG_B, 'default');
      await ratifiedVersion(ORG_A, a1, 1);
      // The index keys on (organization_id, icp_id): a second ICP and a second
      // tenant are each unaffected.
      expect(await insVersion(ORG_A, a2, 1, 'ratified', RATIFIED_AT, RATIFIER)).toBe('ok');
      expect(await insVersion(ORG_B, b1, 1, 'ratified', RATIFIED_AT, RATIFIER)).toBe('ok');
    });
  });

  it('the version number is unique per (organization_id, icp_id)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const icp = await newIcp(ORG_A);
      expect(await insVersion(ORG_A, icp, 1, 'draft')).toBe('ok');
      await db.query(INSERT_VERSION, [ORG_A, icp, 1, 'draft', CRITERIA, null, null]);
      expect(await insVersion(ORG_A, icp, 1, 'proposed')).toBe('23505');
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('D1 contract 16 — ratification coherence and immutability', () => {
  it('a draft or proposed version may NEVER carry a ratifier', async () => {
    await inRollback(async () => {
      await seedTenants();
      const icp = await newIcp(ORG_A);
      for (const status of ['draft', 'proposed']) {
        expect(await insVersion(ORG_A, icp, 1, status, RATIFIED_AT, RATIFIER)).toBe('23514');
        expect(await insVersion(ORG_A, icp, 1, status, RATIFIED_AT, null)).toBe('23514');
      }
    });
  });

  it('a ratified version MUST name who ratified it — a model has no user id', async () => {
    await inRollback(async () => {
      await seedTenants();
      const icp = await newIcp(ORG_A);
      expect(await insVersion(ORG_A, icp, 1, 'ratified', RATIFIED_AT, null)).toBe('23514');
      expect(await insVersion(ORG_A, icp, 1, 'ratified', null, RATIFIER)).toBe('23514');
      expect(await insVersion(ORG_A, icp, 1, 'ratified', RATIFIED_AT, RATIFIER)).toBe('ok');
    });
  });

  it('rejects a status outside the closed lifecycle', async () => {
    await inRollback(async () => {
      await seedTenants();
      const icp = await newIcp(ORG_A);
      for (const bad of ['active', 'live', 'approved', 'published', 'RATIFIED']) {
        expect(await insVersion(ORG_A, icp, 1, bad)).toBe('23514');
      }
    });
  });

  it('THE RATIFIED VERSION IS IMMUTABLE — its content cannot be edited', async () => {
    await inRollback(async () => {
      await seedTenants();
      const icp = await newIcp(ORG_A);
      await ratifiedVersion(ORG_A, icp, 1);

      const upd = (setClause: string, params: unknown[] = []) => attempt(
        `UPDATE public.prospect_icp_versions SET ${setClause}
          WHERE organization_id=$1 AND icp_id=$2 AND version=1`, [ORG_A, icp, ...params]);

      // Every one of these is the change contract 16 forbids: it would rewrite
      // the profile a score was already computed against.
      expect(await upd(`criteria = '[]'::jsonb`)).toBe('23514');
      expect(await upd(`proposal = '{"status":"edited"}'::jsonb`)).toBe('23514');
      expect(await upd(`ratified_by = $3`, ['00000000-0000-4000-8000-0000000000f2'])).toBe('23514');
      expect(await upd(`ratified_at = now()`)).toBe('23514');
      expect(await upd(`version = 9`)).toBe('23514');
      expect(await upd(`proposed_by_model = 'some-model'`)).toBe('23514');
      // ...including demoting it back to a draft. There is no unratify.
      expect(await upd(`status = 'draft'`)).toBe('23514');
      expect(await upd(`status = 'proposed'`)).toBe('23514');
    });
  });

  it('the ONLY permitted transition out of ratified is supersession', async () => {
    await inRollback(async () => {
      await seedTenants();
      const icp = await newIcp(ORG_A);
      await ratifiedVersion(ORG_A, icp, 1);

      expect(await attempt(
        `UPDATE public.prospect_icp_versions
            SET status='superseded', superseded_at=now(), superseded_by_version=2
          WHERE organization_id=$1 AND icp_id=$2 AND version=1`, [ORG_A, icp],
      )).toBe('ok');
    });
  });

  it('a SUPERSEDED version is immutable in every respect', async () => {
    await inRollback(async () => {
      await seedTenants();
      const icp = await newIcp(ORG_A);
      await ratifiedVersion(ORG_A, icp, 1);
      await db.query(
        `UPDATE public.prospect_icp_versions
            SET status='superseded', superseded_at=now(), superseded_by_version=2
          WHERE organization_id=$1 AND icp_id=$2 AND version=1`, [ORG_A, icp]);

      for (const set of [`status='ratified'`, `criteria='[]'::jsonb`, `superseded_by_version=3`]) {
        expect(await attempt(
          `UPDATE public.prospect_icp_versions SET ${set}
            WHERE organization_id=$1 AND icp_id=$2 AND version=1`, [ORG_A, icp],
        )).toBe('23514');
      }
    });
  });

  it('a row can never be moved between tenants', async () => {
    await inRollback(async () => {
      await seedTenants();
      const icp = await newIcp(ORG_A);
      // KEPT, not attempted: the subject is what the trigger does to an
      // EXISTING row, and an UPDATE that matches nothing fires no trigger.
      await keepVersion(ORG_A, icp, 1, 'draft');

      // Even on an UNRATIFIED row, where content is otherwise editable.
      expect(await attempt(
        `UPDATE public.prospect_icp_versions SET organization_id=$3
          WHERE organization_id=$1 AND icp_id=$2 AND version=1`, [ORG_A, icp, ORG_B],
      )).toBe('23514');

      // The other half of tenant isolation on a draft: re-pointing `icp_id` at
      // another tenant's ICP is refused by the composite foreign key, because
      // the (icp, ORG_A) pair it would need does not exist for ORG_B's ICP.
      const icpB = await newIcp(ORG_B);
      expect(await attempt(
        `UPDATE public.prospect_icp_versions SET icp_id=$3
          WHERE organization_id=$1 AND icp_id=$2 AND version=1`, [ORG_A, icp, icpB],
      )).toBe('23503');
    });
  });

  it('an UNRATIFIED version remains freely editable — the lifecycle only closes on ratification', async () => {
    await inRollback(async () => {
      await seedTenants();
      const icp = await newIcp(ORG_A);
      await keepVersion(ORG_A, icp, 1, 'draft');
      expect(await attempt(
        `UPDATE public.prospect_icp_versions SET criteria='[]'::jsonb, status='proposed'
          WHERE organization_id=$1 AND icp_id=$2 AND version=1`, [ORG_A, icp],
      )).toBe('ok');
      // ...and the edit really landed on a real row, rather than an UPDATE
      // matching nothing and reporting success.
      const { rows } = await db.query(
        `UPDATE public.prospect_icp_versions SET status='proposed'
          WHERE organization_id=$1 AND icp_id=$2 AND version=1 RETURNING status`, [ORG_A, icp]);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('proposed');
    });
  });

  it('supersession must be coherent and forward-pointing', async () => {
    await inRollback(async () => {
      await seedTenants();
      const icp = await newIcp(ORG_A);
      // A non-superseded row may not carry supersession columns.
      expect(await attempt(
        `INSERT INTO public.prospect_icp_versions
           (organization_id, icp_id, version, status, criteria, superseded_at)
         VALUES ($1,$2,1,'draft',$3::jsonb, now())`, [ORG_A, icp, CRITERIA],
      )).toBe('23514');
      // ...and a version can never be superseded by itself or an earlier one.
      expect(await attempt(
        `INSERT INTO public.prospect_icp_versions
           (organization_id, icp_id, version, status, criteria, ratified_at, ratified_by,
            superseded_at, superseded_by_version)
         VALUES ($1,$2,5,'superseded',$3::jsonb,$4,$5,$4,5)`,
        [ORG_A, icp, CRITERIA, RATIFIED_AT, RATIFIER],
      )).toBe('23514');
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('D1 — column shape constraints', () => {
  it('criteria must be a JSON ARRAY and proposal a JSON OBJECT', async () => {
    await inRollback(async () => {
      await seedTenants();
      const icp = await newIcp(ORG_A);
      expect(await attempt(
        `INSERT INTO public.prospect_icp_versions (organization_id, icp_id, version, criteria)
         VALUES ($1,$2,1,'{}'::jsonb)`, [ORG_A, icp],
      )).toBe('23514');
      expect(await attempt(
        `INSERT INTO public.prospect_icp_versions (organization_id, icp_id, version, proposal)
         VALUES ($1,$2,1,'[]'::jsonb)`, [ORG_A, icp],
      )).toBe('23514');
    });
  });

  it('the icp_key is a lower-case slug, and the version is at least 1', async () => {
    await inRollback(async () => {
      await seedTenants();
      for (const bad of ['Default', 'my key', '', '-lead', 'a'.repeat(65)]) {
        expect(await attempt(
          `INSERT INTO public.prospect_icps (organization_id, icp_key) VALUES ($1,$2)`, [ORG_A, bad],
        )).toBe('23514');
      }
      const icp = await newIcp(ORG_A);
      expect(await insVersion(ORG_A, icp, 0, 'draft')).toBe('23514');
    });
  });
});
