/**
 * LI-1 — canonical attribute surface, against real PostgreSQL.
 *
 * The risk LI-1 introduces is not that attributes fail to store — it is that
 * adding an attribute layer quietly weakens the identity and tenancy guarantees
 * W1–W6 established. So most of what follows asserts that nothing moved:
 * attributes are not identity, they do not create a cross-tenant path, and the
 * deterministic resolution rules still behave exactly as before.
 *
 * The suite also asserts the negative space — that LinkedIn did NOT become a
 * column, and that no attribute acquired a unique constraint — because those
 * are the two ways this layer would turn into a second identity model.
 */
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson, newAccount } from './setup';

const PERSON_COLS = ['full_name', 'first_name', 'last_name', 'job_title', 'department',
  'seniority', 'country_code', 'region', 'city', 'timezone', 'attributes_source', 'attributes_updated_at'];
const ACCOUNT_COLS = ['industry', 'employee_count', 'employee_band', 'country_code',
  'region', 'city', 'description', 'attributes_source', 'attributes_updated_at'];

async function columnsOf(table: string): Promise<Record<string, { type: string; notnull: boolean }>> {
  const { rows } = await db.query(
    `SELECT a.attname, format_type(a.atttypid, a.atttypmod) typ, a.attnotnull
       FROM pg_attribute a
      WHERE a.attrelid = ('public.'||$1)::regclass AND a.attnum > 0 AND NOT a.attisdropped`, [table]);
  return Object.fromEntries(rows.map((r: any) => [r.attname, { type: r.typ, notnull: r.attnotnull }]));
}

describe('LI-1 — person attribute surface exists and is optional', () => {
  it('has all 12 columns, every one nullable', async () => {
    const cols = await columnsOf('unified_persons');
    for (const c of PERSON_COLS) {
      expect(cols[c]).toBeDefined();
      // A required attribute would make it impossible to create a person from
      // identity evidence alone, which is how ingestion must be able to work.
      expect(cols[c].notnull).toBe(false);
    }
  });

  it('stores a full attribute set', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await db.query(
        `UPDATE public.unified_persons SET
           full_name=$2, first_name=$3, last_name=$4, job_title=$5, department=$6,
           seniority=$7, country_code=$8, region=$9, city=$10, timezone=$11,
           attributes_source=$12, attributes_updated_at=now()
         WHERE id=$1`,
        [p, 'Ada Lovelace', 'Ada', 'Lovelace', 'Head of Analytical Engines', 'Engineering',
          'head', 'GB', 'England', 'London', 'Europe/London', 'li1-test']);
      const { rows } = await db.query('SELECT * FROM public.unified_persons WHERE id=$1', [p]);
      expect(rows[0].full_name).toBe('Ada Lovelace');
      expect(rows[0].seniority).toBe('head');
      expect(rows[0].country_code).toBe('GB');
    });
  });

  it('accepts a person with identity but no attributes at all', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const { rows } = await db.query(
        'SELECT full_name, job_title, country_code, attributes_source FROM public.unified_persons WHERE id=$1', [p]);
      expect(rows[0]).toEqual({ full_name: null, job_title: null, country_code: null, attributes_source: null });
    });
  });
});

describe('LI-1 — attributes are constrained, not free text', () => {
  it('rejects a seniority outside the vocabulary', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      expect(await attempt('UPDATE public.unified_persons SET seniority=$2 WHERE id=$1', [p, 'Chief Wizard'])).toBe('23514');
      expect(await attempt('UPDATE public.unified_persons SET seniority=$2 WHERE id=$1', [p, 'director'])).toBe('ok');
    });
  });

  it('rejects a country that is not ISO-3166-1 alpha-2', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      for (const bad of ['United Kingdom', 'gb', 'GBR', 'G']) {
        expect(await attempt('UPDATE public.unified_persons SET country_code=$2 WHERE id=$1', [p, bad])).toBe('23514');
      }
      expect(await attempt('UPDATE public.unified_persons SET country_code=$2 WHERE id=$1', [p, 'GB'])).toBe('ok');
    });
  });

  it('rejects blank strings — an empty attribute must be NULL', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      expect(await attempt('UPDATE public.unified_persons SET full_name=$2 WHERE id=$1', [p, '   '])).toBe('23514');
      expect(await attempt('UPDATE public.unified_persons SET job_title=$2 WHERE id=$1', [p, ''])).toBe('23514');
    });
  });

  it('requires provenance source and timestamp to move together', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      expect(await attempt('UPDATE public.unified_persons SET attributes_source=$2 WHERE id=$1', [p, 'apollo'])).toBe('23514');
      expect(await attempt('UPDATE public.unified_persons SET attributes_updated_at=now() WHERE id=$1', [p])).toBe('23514');
      expect(await attempt(
        'UPDATE public.unified_persons SET attributes_source=$2, attributes_updated_at=now() WHERE id=$1', [p, 'apollo'])).toBe('ok');
    });
  });
});

describe('LI-1 — attributes did NOT become identity', () => {
  it('adds no unique constraint on any attribute column', async () => {
    const { rows } = await db.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename IN ('unified_persons','prospect_accounts')
          AND indexdef LIKE 'CREATE UNIQUE%'`);
    const attrCols = [...new Set([...PERSON_COLS, ...ACCOUNT_COLS])].filter((c) => c !== 'attributes_updated_at');
    for (const r of rows as any[]) {
      for (const c of attrCols) {
        expect(r.indexdef).not.toMatch(new RegExp(`\\(${c}[,)]|, ${c}[,)]`));
      }
    }
  });

  it('did not add a linkedin column — LinkedIn is evidence, not an attribute', async () => {
    const person = await columnsOf('unified_persons');
    const account = await columnsOf('prospect_accounts');
    for (const key of Object.keys(person)) expect(key).not.toMatch(/linkedin/i);
    for (const key of Object.keys(account)) expect(key).not.toMatch(/linkedin/i);
  });

  it('still expresses LinkedIn identity through identity_claims', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      // external_profile + platform is the existing, already-permitted shape.
      expect(await attempt(
        `INSERT INTO public.identity_claims
           (organization_id, person_id, claim_type, platform, normalized_value, source)
         VALUES ($1,$2,'external_profile','linkedin','linkedin.com/in/li1-test','li1')`, [ORG_A, p])).toBe('ok');
    });
  });

  it('two people in one tenant may share a name, title and city', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newPerson(ORG_A);
      const b = await newPerson(ORG_A);
      const set = `full_name='John Smith', job_title='Sales Director', city='London'`;
      await db.query(`UPDATE public.unified_persons SET ${set} WHERE id=$1`, [a]);
      expect(await attempt(`UPDATE public.unified_persons SET ${set} WHERE id=$1`, [b])).toBe('ok');
    });
  });
});

describe('LI-1 — tenant isolation is unchanged', () => {
  it('attributes do not create a cross-tenant path to a person', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pB = await newPerson(ORG_B);
      // The only person→tenant column is company_id, and W5's composite keys
      // still govern it. Writing attributes cannot re-home a person.
      await db.query(`UPDATE public.unified_persons SET full_name='X', attributes_source='li1', attributes_updated_at=now() WHERE id=$1`, [pB]);
      const { rows } = await db.query('SELECT company_id FROM public.unified_persons WHERE id=$1', [pB]);
      expect(rows[0].company_id).toBe(ORG_B);
    });
  });

  it('a tenant-scoped read cannot see another tenant\'s person', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pB = await newPerson(ORG_B);
      await db.query(`UPDATE public.unified_persons SET full_name='Tenant B Person' WHERE id=$1`, [pB]);
      // The application always filters by tenant; this asserts that predicate works.
      const { rows } = await db.query(
        'SELECT id FROM public.unified_persons WHERE company_id=$1 AND id=$2', [ORG_A, pB]);
      expect(rows).toHaveLength(0);
    });
  });

  it('a tenant-scoped update cannot modify another tenant\'s person attributes', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pB = await newPerson(ORG_B);
      const res = await db.query(
        `UPDATE public.unified_persons SET job_title='hijacked' WHERE company_id=$1 AND id=$2`, [ORG_A, pB]);
      expect(res.rowCount).toBe(0);
      const { rows } = await db.query('SELECT job_title FROM public.unified_persons WHERE id=$1', [pB]);
      expect(rows[0].job_title).toBeNull();
    });
  });

  it('a person still cannot be attached to another tenant\'s account', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pA = await newPerson(ORG_A);
      const accB = await newAccount(ORG_B, { domain: 'li1-xt.example' });
      await db.query(`UPDATE public.unified_persons SET job_title='Buyer' WHERE id=$1`, [pA]);
      expect(await attempt('UPDATE public.unified_persons SET account_id=$2 WHERE id=$1', [pA, accB])).toBe('23503');
    });
  });
});

describe('LI-1 — account attribute surface', () => {
  it('has all 9 columns, every one nullable', async () => {
    const cols = await columnsOf('prospect_accounts');
    for (const c of ACCOUNT_COLS) {
      expect(cols[c]).toBeDefined();
      expect(cols[c].notnull).toBe(false);
    }
  });

  it('stores firmographics', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newAccount(ORG_A, { domain: 'li1-firmo.example' });
      await db.query(
        `UPDATE public.prospect_accounts SET industry=$2, employee_count=$3, employee_band=$4,
           country_code=$5, region=$6, city=$7, description=$8,
           attributes_source=$9, attributes_updated_at=now() WHERE id=$1`,
        [a, 'Software', 240, '201-500', 'GB', 'England', 'London', 'A software company', 'li1-test']);
      const { rows } = await db.query('SELECT * FROM public.prospect_accounts WHERE id=$1', [a]);
      expect(rows[0].industry).toBe('Software');
      expect(rows[0].employee_count).toBe(240);
      expect(rows[0].employee_band).toBe('201-500');
    });
  });

  it('rejects an unknown employee band and a negative headcount', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newAccount(ORG_A, { domain: 'li1-band.example' });
      expect(await attempt('UPDATE public.prospect_accounts SET employee_band=$2 WHERE id=$1', [a, 'medium'])).toBe('23514');
      expect(await attempt('UPDATE public.prospect_accounts SET employee_count=$2 WHERE id=$1', [a, -5])).toBe('23514');
      expect(await attempt('UPDATE public.prospect_accounts SET employee_band=$2, employee_count=$3 WHERE id=$1', [a, '51-200', 120])).toBe('ok');
    });
  });

  it('keeps the same domain independent in two tenants, attributes and all', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newAccount(ORG_A, { domain: 'li1-shared.example' });
      const b = await newAccount(ORG_B, { domain: 'li1-shared.example' });
      expect(a).not.toBe(b);
      await db.query(`UPDATE public.prospect_accounts SET industry='Fintech' WHERE id=$1`, [a]);
      await db.query(`UPDATE public.prospect_accounts SET industry='Healthcare' WHERE id=$1`, [b]);
      const { rows } = await db.query(
        `SELECT organization_id, industry FROM public.prospect_accounts WHERE id = ANY($1::uuid[]) ORDER BY industry`, [[a, b]]);
      // Same real-world company, two tenants, two independent opinions of it.
      expect(rows.map((r: any) => r.industry)).toEqual(['Fintech', 'Healthcare']);
      expect(new Set(rows.map((r: any) => r.organization_id)).size).toBe(2);
    });
  });

  it('industry and size did not become identity keys', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newAccount(ORG_A, { domain: 'li1-dup-a.example' });
      const b = await newAccount(ORG_A, { domain: 'li1-dup-b.example' });
      const set = `industry='Software', employee_band='51-200', city='London'`;
      await db.query(`UPDATE public.prospect_accounts SET ${set} WHERE id=$1`, [a]);
      expect(await attempt(`UPDATE public.prospect_accounts SET ${set} WHERE id=$1`, [b])).toBe('ok');
    });
  });
});

describe('LI-1 — identity resolution rules are untouched', () => {
  it('email and phone uniqueness still bind, per tenant', async () => {
    await inRollback(async () => {
      await seedTenants();
      await db.query(`INSERT INTO public.unified_persons (company_id, primary_email) VALUES ($1,'li1@x.test')`, [ORG_A]);
      expect(await attempt(
        `INSERT INTO public.unified_persons (company_id, primary_email) VALUES ($1,'li1@x.test')`, [ORG_A])).toBe('23505');
      // ...and the same address is a different person in another tenant.
      expect(await attempt(
        `INSERT INTO public.unified_persons (company_id, primary_email) VALUES ($1,'li1@x.test')`, [ORG_B])).toBe('ok');
    });
  });

  it('attributes do not participate in uniqueness — same email rule, different attributes', async () => {
    await inRollback(async () => {
      await seedTenants();
      await db.query(
        `INSERT INTO public.unified_persons (company_id, primary_email, job_title) VALUES ($1,'li1b@x.test','CTO')`, [ORG_A]);
      // Changing the title does not create room for a second row.
      expect(await attempt(
        `INSERT INTO public.unified_persons (company_id, primary_email, job_title) VALUES ($1,'li1b@x.test','CEO')`, [ORG_A])).toBe('23505');
    });
  });

  it('leaves external_keys as the resolution surface it was', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await db.query(`UPDATE public.unified_persons SET external_keys=$2, job_title='VP Sales' WHERE id=$1`,
        [p, JSON.stringify({ apollo_id: 'li1-abc' })]);
      const { rows } = await db.query(
        `SELECT id FROM public.unified_persons WHERE company_id=$1 AND external_keys @> $2::jsonb`,
        [ORG_A, JSON.stringify({ apollo_id: 'li1-abc' })]);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(p);
    });
  });
});

describe('LI-1 — no fabricated data', () => {
  it('the migration populated only full_name, and only from a same-tenant lead', async () => {
    // On a fresh CI database unified_persons is empty, so this asserts the
    // invariant rather than a row count: whatever was backfilled must be
    // traceable, and nothing else may have been invented.
    const { rows } = await db.query(`
      SELECT count(*) FILTER (WHERE attributes_source = 'li1_backfill_lead_name')::int backfilled,
             count(*) FILTER (WHERE first_name IS NOT NULL OR last_name IS NOT NULL)::int split,
             count(*) FILTER (WHERE job_title IS NOT NULL OR seniority IS NOT NULL
                              OR department IS NOT NULL OR country_code IS NOT NULL)::int invented
        FROM public.unified_persons`);
    expect(rows[0].split).toBe(0);
    expect(rows[0].invented).toBe(0);

    const untraceable = await db.query(`
      SELECT count(*)::int n FROM public.unified_persons p
       WHERE p.attributes_source = 'li1_backfill_lead_name'
         AND NOT EXISTS (SELECT 1 FROM public.leads l
                          WHERE l.unified_person_id = p.id AND l.company_id = p.company_id
                            AND btrim(l.name) = p.full_name)`);
    expect(untraceable.rows[0].n).toBe(0);
  });

  it('no account attributes were invented — prospect_accounts had no rows to backfill', async () => {
    const { rows } = await db.query(
      `SELECT count(*) FILTER (WHERE attributes_source IS NOT NULL)::int n FROM public.prospect_accounts`);
    expect(rows[0].n).toBe(0);
  });
});
