/**
 * PI FOUNDATION — the person↔company relationship, against real PostgreSQL.
 *
 * Every property worth having here is enforced by the DATABASE, which is why
 * this file exists rather than a unit suite. A mock can be told that a second
 * current primary is impossible; only Postgres can refuse one. Specifically:
 *
 *   - two partial unique indexes, which a unit test cannot evaluate;
 *   - two composite tenant foreign keys, whose whole point is that the service
 *     layer is not the thing being trusted;
 *   - a CHECK that a historical relationship can never be primary, which the
 *     primary index alone does not express;
 *   - three atomic SQL functions whose entire value is that the relationship and
 *     `unified_persons.account_id` cannot disagree at a committed instant. A
 *     mocked transaction proves nothing about atomicity.
 *
 * Harness notes, both learned the hard way: `attempt()` ROLLS BACK ON SUCCESS,
 * so it answers "would this be refused?" and can never perform an effect to
 * observe afterwards — effects use `db.query`. And pg returns timestamptz as a
 * Date, so timestamps are compared through toISOString().
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson, newAccount,
  constraintDef, uniqueIndexColumns,
} from './setup';

/**
 * Both hash columns carry a `^[a-f0-9]{64}$` CHECK, so a hand-written filler
 * like hex('relationship-cross-tenant') is rejected by the SHAPE constraint — which returns the
 * same 23514 as a coherence violation and would let a test pass for entirely
 * the wrong reason. Derive them instead.
 */
const hex = (seed: string): string => createHash('sha256').update(seed).digest('hex');

const rel = async (org: string, person: string, account: string, over: Record<string, unknown> = {}) => {
  const cols = ['organization_id', 'person_id', 'account_id', ...Object.keys(over)];
  const vals = [org, person, account, ...Object.values(over)];
  const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await db.query(
    `INSERT INTO public.person_account_relationships (${cols.join(', ')}) VALUES (${ph}) RETURNING id`,
    vals,
  );
  return rows[0].id as string;
};

const pointer = async (person: string): Promise<string | null> => {
  const { rows } = await db.query('SELECT account_id FROM public.unified_persons WHERE id = $1', [person]);
  return rows[0]?.account_id ?? null;
};

/**
 * The error MESSAGE a statement raises, or '' when it succeeded.
 *
 * `attempt` returns only the SQLSTATE, which cannot tell "the function refused
 * this deliberately" apart from "the function went ahead and a CHECK stopped
 * it". For the atomic writer that difference matters: the repository surfaces
 * `error.message` to its caller, and a constraint-violation string is not an
 * answer a caller can act on.
 */
const failureMessage = async (sql: string, params: unknown[] = []): Promise<string> => {
  await db.query('SAVEPOINT fm');
  try {
    await db.query(sql, params);
    await db.query('ROLLBACK TO SAVEPOINT fm');
    return '';
  } catch (err: unknown) {
    await db.query('ROLLBACK TO SAVEPOINT fm');
    return String((err as { message?: unknown })?.message ?? '');
  }
};

const primaryOf = async (org: string, person: string): Promise<string | null> => {
  const { rows } = await db.query(
    `SELECT account_id FROM public.person_account_relationships
      WHERE organization_id=$1 AND person_id=$2 AND is_primary AND ended_at IS NULL`,
    [org, person],
  );
  return rows[0]?.account_id ?? null;
};

// ═══════════════════════════════════════════════════════════════════════════
describe('PAR — the schema contract', () => {
  it('both uniques are PARTIAL, which is what permits history at all', async () => {
    await inRollback(async () => {
      expect(await uniqueIndexColumns('uq_par_live')).toEqual(['organization_id', 'person_id', 'account_id']);
      expect(await uniqueIndexColumns('uq_par_one_primary')).toEqual(['organization_id', 'person_id']);

      const { rows } = await db.query(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname='public' AND indexname IN ('uq_par_live','uq_par_one_primary')`,
      );
      for (const r of rows) {
        // Without the WHERE clause these would forbid a second historical
        // relationship to the same account, and a demoted primary.
        expect(r.indexdef).toMatch(/WHERE /i);
      }
    });
  });

  it('a historical relationship can never be primary — a CHECK, not just an index', async () => {
    await inRollback(async () => {
      const def = await constraintDef('par_primary_is_current');
      expect(def).toBeTruthy();
      expect(def).toMatch(/is_primary/);
      expect(def).toMatch(/ended_at/);
    });
  });

  it('both tenant FKs are composite and carry organization_id as the second leg', async () => {
    await inRollback(async () => {
      for (const name of ['par_person_tenant_fk', 'par_account_tenant_fk']) {
        const def = await constraintDef(name);
        expect(def).toBeTruthy();
        expect(def).toMatch(/, organization_id\)/);
      }
    });
  });

  it('the composite parent key exists, so a future relationship_id can be tenant-safe', async () => {
    await inRollback(async () => {
      expect(await uniqueIndexColumns('uq_par_id_org')).toEqual(['id', 'organization_id']);
    });
  });
});

describe('PAR — cardinality: one person, many companies', () => {
  it('A. one person + one account', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'a-one.test' });
      await rel(ORG_A, p, a);
      const { rows } = await db.query(
        'SELECT count(*)::int n FROM public.person_account_relationships WHERE person_id=$1', [p]);
      expect(rows[0].n).toBe(1);
    });
  });

  it('B/E. a SECOND company gives two relationships and still ONE person', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a1 = await newAccount(ORG_A, { domain: 'b-one.test' });
      const a2 = await newAccount(ORG_A, { domain: 'b-two.test' });
      await rel(ORG_A, p, a1);
      await rel(ORG_A, p, a2, { relationship_type: 'advisor' });

      const { rows: r } = await db.query(
        `SELECT count(*)::int n FROM public.person_account_relationships
          WHERE person_id=$1 AND ended_at IS NULL`, [p]);
      expect(r[0].n).toBe(2);

      const { rows: ppl } = await db.query(
        'SELECT count(*)::int n FROM public.unified_persons WHERE id=$1', [p]);
      expect(ppl[0].n).toBe(1);
    });
  });

  it('C. a duplicate CURRENT relationship to the same account is refused', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'c-dupe.test' });
      await rel(ORG_A, p, a);
      expect(await attempt(
        `INSERT INTO public.person_account_relationships (organization_id, person_id, account_id)
         VALUES ($1,$2,$3)`, [ORG_A, p, a],
      )).toBe('23505');
    });
  });

  it('D. the same pair may recur across TIME once the first has ended', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'd-rehire.test' });
      await rel(ORG_A, p, a, { ended_at: '2020-01-01T00:00:00Z' });
      await rel(ORG_A, p, a, { ended_at: '2022-01-01T00:00:00Z' });
      await rel(ORG_A, p, a); // current again — a genuine re-hire
      const { rows } = await db.query(
        `SELECT count(*)::int total, count(*) FILTER (WHERE ended_at IS NULL)::int live
           FROM public.person_account_relationships WHERE person_id=$1`, [p]);
      expect(rows[0].total).toBe(3);
      expect(rows[0].live).toBe(1);
    });
  });
});

describe('PAR — primary is independent of currency', () => {
  it('F. a second CURRENT primary is refused', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a1 = await newAccount(ORG_A, { domain: 'f-one.test' });
      const a2 = await newAccount(ORG_A, { domain: 'f-two.test' });
      await rel(ORG_A, p, a1, { is_primary: true });
      expect(await attempt(
        `INSERT INTO public.person_account_relationships (organization_id, person_id, account_id, is_primary)
         VALUES ($1,$2,$3,true)`, [ORG_A, p, a2],
      )).toBe('23505');
    });
  });

  it('G. primary + ended is refused outright (23514, not merely unindexed)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'g-ended.test' });
      expect(await attempt(
        `INSERT INTO public.person_account_relationships (organization_id, person_id, account_id, is_primary, ended_at)
         VALUES ($1,$2,$3,true,now())`, [ORG_A, p, a],
      )).toBe('23514');
    });
  });

  it('several HISTORICAL rows may coexist — only primary-and-current is limited', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a1 = await newAccount(ORG_A, { domain: 'h-one.test' });
      const a2 = await newAccount(ORG_A, { domain: 'h-two.test' });
      await rel(ORG_A, p, a1, { ended_at: '2021-01-01T00:00:00Z' });
      await rel(ORG_A, p, a2, { ended_at: '2022-01-01T00:00:00Z' });
      await rel(ORG_A, p, a1, { is_primary: true });
      expect(await primaryOf(ORG_A, p)).toBe(a1);
    });
  });
});

describe('PAR — tenant isolation is a database guarantee', () => {
  it('H. tenant A person + tenant B account is refused (23503)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pa = await newPerson(ORG_A);
      const ab = await newAccount(ORG_B, { domain: 'x-b.test' });
      expect(await attempt(
        `INSERT INTO public.person_account_relationships (organization_id, person_id, account_id)
         VALUES ($1,$2,$3)`, [ORG_A, pa, ab],
      )).toBe('23503');
    });
  });

  it('I. tenant B person + tenant A account is refused (23503)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pb = await newPerson(ORG_B);
      const aa = await newAccount(ORG_A, { domain: 'x-a.test' });
      expect(await attempt(
        `INSERT INTO public.person_account_relationships (organization_id, person_id, account_id)
         VALUES ($1,$2,$3)`, [ORG_B, pb, aa],
      )).toBe('23503');
    });
  });

  it('a relationship row cannot claim a tenant that owns neither side', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pa = await newPerson(ORG_A);
      const aa = await newAccount(ORG_A, { domain: 'x-claim.test' });
      expect(await attempt(
        `INSERT INTO public.person_account_relationships (organization_id, person_id, account_id)
         VALUES ($1,$2,$3)`, [ORG_B, pa, aa],
      )).toBe('23503');
    });
  });
});

describe('PAR — the six-value vocabulary', () => {
  it('O. all six are accepted and anything else is refused', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'o-types.test' });
      const six = ['employee', 'advisor', 'contractor', 'founder', 'former_employee', 'unknown'];
      for (const [i, t] of six.entries()) {
        await rel(ORG_A, p, a, { relationship_type: t, ended_at: `20${10 + i}-01-01T00:00:00Z` });
      }
      const { rows } = await db.query(
        `SELECT count(DISTINCT relationship_type)::int n FROM public.person_account_relationships WHERE person_id=$1`, [p]);
      expect(rows[0].n).toBe(6);

      for (const bad of ['board_member', 'partner', 'vendor', 'investor', '', 'Employee']) {
        expect(await attempt(
          `INSERT INTO public.person_account_relationships (organization_id, person_id, account_id, relationship_type, ended_at)
           VALUES ($1,$2,$3,$4,'2030-01-01')`, [ORG_A, p, a, bad],
        )).toBe('23514');
      }
    });
  });

  it('seniority and buying_role reuse the person vocabularies verbatim', async () => {
    await inRollback(async () => {
      const sen = await constraintDef('par_seniority_valid');
      const personSen = await constraintDef('unified_persons_seniority_valid');
      for (const v of ['intern', 'entry', 'senior', 'manager', 'head', 'director', 'vp', 'partner', 'c_suite', 'founder', 'owner', 'other']) {
        expect(sen).toContain(`'${v}'`);
        expect(personSen).toContain(`'${v}'`);
      }
      const role = await constraintDef('par_buying_role_valid');
      for (const v of ['decision_maker', 'economic_buyer', 'champion', 'influencer', 'evaluator', 'blocker', 'unknown']) {
        expect(role).toContain(`'${v}'`);
      }
    });
  });
});

describe('PAR — relationship-scoped attributes are isolated per employer', () => {
  it('K. a title at A is untouched by a title at B', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a1 = await newAccount(ORG_A, { domain: 'k-one.test' });
      const a2 = await newAccount(ORG_A, { domain: 'k-two.test' });
      await rel(ORG_A, p, a1, { job_title: 'VP Sales', seniority: 'vp', department: 'Sales' });
      await rel(ORG_A, p, a2, { job_title: 'CTO', seniority: 'c_suite', department: 'Engineering' });

      const { rows } = await db.query(
        `SELECT account_id, job_title, seniority, department
           FROM public.person_account_relationships WHERE person_id=$1 ORDER BY job_title`, [p]);
      expect(rows.map((r: any) => [r.job_title, r.seniority, r.department]))
        .toEqual([['CTO', 'c_suite', 'Engineering'], ['VP Sales', 'vp', 'Sales']]);
      // This is the whole point: under the old model these were one field and
      // b1b.1 would have let the newer observation overwrite the other.
    });
  });

  it('T. an ended relationship keeps its title — history stays recoverable', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 't-hist.test' });
      await rel(ORG_A, p, a, { job_title: 'Former VP', ended_at: '2021-06-01T00:00:00Z' });
      const { rows } = await db.query(
        `SELECT job_title, ended_at FROM public.person_account_relationships WHERE person_id=$1`, [p]);
      expect(rows[0].job_title).toBe('Former VP');
      expect(new Date(rows[0].ended_at).toISOString()).toBe('2021-06-01T00:00:00.000Z');
    });
  });
});

describe('PAR — the atomic writer: primary and the pointer cannot disagree', () => {
  it('U/V. promoting a relationship moves unified_persons.account_id with it', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a1 = await newAccount(ORG_A, { domain: 'v-one.test' });
      const a2 = await newAccount(ORG_A, { domain: 'v-two.test' });
      await rel(ORG_A, p, a1);
      await rel(ORG_A, p, a2);

      await db.query('SELECT public.pi_relationship_set_primary($1,$2,$3)', [ORG_A, p, a1]);
      expect(await primaryOf(ORG_A, p)).toBe(a1);
      expect(await pointer(p)).toBe(a1);

      await db.query('SELECT public.pi_relationship_set_primary($1,$2,$3)', [ORG_A, p, a2]);
      expect(await primaryOf(ORG_A, p)).toBe(a2);
      expect(await pointer(p)).toBe(a2);

      // The demotion happened too — not two primaries, and not zero.
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.person_account_relationships
          WHERE person_id=$1 AND is_primary AND ended_at IS NULL`, [p]);
      expect(rows[0].n).toBe(1);
    });
  });

  it('W. clearing the primary NULLs the pointer and keeps the relationship current', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'w-clear.test' });
      await rel(ORG_A, p, a);
      await db.query('SELECT public.pi_relationship_set_primary($1,$2,$3)', [ORG_A, p, a]);
      expect(await pointer(p)).toBe(a);

      await db.query('SELECT public.pi_relationship_clear_primary($1,$2)', [ORG_A, p]);
      expect(await pointer(p)).toBeNull();
      expect(await primaryOf(ORG_A, p)).toBeNull();

      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.person_account_relationships
          WHERE person_id=$1 AND ended_at IS NULL`, [p]);
      expect(rows[0].n).toBe(1); // still current, just not the one we pursue
    });
  });

  it('ending the PRIMARY relationship clears the pointer in the same call', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'end-primary.test' });
      await rel(ORG_A, p, a);
      await db.query('SELECT public.pi_relationship_set_primary($1,$2,$3)', [ORG_A, p, a]);
      await db.query('SELECT public.pi_relationship_end($1,$2,$3,$4)', [ORG_A, p, a, '2024-01-01T00:00:00Z']);

      expect(await pointer(p)).toBeNull();
      expect(await primaryOf(ORG_A, p)).toBeNull();
      const { rows } = await db.query(
        `SELECT ended_at, is_primary FROM public.person_account_relationships WHERE person_id=$1`, [p]);
      expect(rows[0].is_primary).toBe(false);
      expect(new Date(rows[0].ended_at).toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });
  });

  it('ending a NON-primary relationship leaves the pointer alone', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a1 = await newAccount(ORG_A, { domain: 'np-one.test' });
      const a2 = await newAccount(ORG_A, { domain: 'np-two.test' });
      await rel(ORG_A, p, a1);
      await rel(ORG_A, p, a2);
      await db.query('SELECT public.pi_relationship_set_primary($1,$2,$3)', [ORG_A, p, a1]);
      await db.query('SELECT public.pi_relationship_end($1,$2,$3)', [ORG_A, p, a2]);
      expect(await pointer(p)).toBe(a1);
      expect(await primaryOf(ORG_A, p)).toBe(a1);
    });
  });

  it('G2. the writer refuses to make a HISTORICAL relationship primary', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'g2-hist.test' });
      await rel(ORG_A, p, a, { ended_at: '2020-01-01T00:00:00Z' });
      // Not merely "it failed": the function must refuse it itself. Letting the
      // historical row through and relying on par_primary_is_current to catch
      // the UPDATE would also fail, but with a constraint string the caller
      // cannot act on — and it would mean the guard had stopped working.
      expect(await failureMessage('SELECT public.pi_relationship_set_primary($1,$2,$3)', [ORG_A, p, a]))
        .toMatch(/no current relationship for this tenant\/person\/account/);
      expect(await pointer(p)).toBeNull();
    });
  });

  it('the writer cannot be used across tenants, and leaves the pointer untouched', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'xt-writer.test' });
      await rel(ORG_A, p, a);
      await db.query('SELECT public.pi_relationship_set_primary($1,$2,$3)', [ORG_A, p, a]);
      // ORG_B asking about ORG_A's person finds no relationship and refuses.
      expect(await failureMessage('SELECT public.pi_relationship_set_primary($1,$2,$3)', [ORG_B, p, a]))
        .toMatch(/no current relationship for this tenant\/person\/account/);
      expect(await pointer(p)).toBe(a);
    });
  });

  it('re-promoting the SAME relationship is idempotent', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'idem.test' });
      await rel(ORG_A, p, a);
      await db.query('SELECT public.pi_relationship_set_primary($1,$2,$3)', [ORG_A, p, a]);
      await db.query('SELECT public.pi_relationship_set_primary($1,$2,$3)', [ORG_A, p, a]);
      expect(await pointer(p)).toBe(a);
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.person_account_relationships
          WHERE person_id=$1 AND is_primary AND ended_at IS NULL`, [p]);
      expect(rows[0].n).toBe(1);
    });
  });
});

describe('PAR — human assertion provenance', () => {
  const srcRecord = async (org: string, person: string, seed: string) => {
    const { rows } = await db.query(
      `INSERT INTO public.source_records
         (organization_id, provider, source_entity_type, source_record_id, person_id, raw_payload, payload_hash)
       VALUES ($1,'apollo','person',$2,$3,'{}'::jsonb,$4) RETURNING id`,
      [org, `rec:${seed}`, person, hex(seed)],
    );
    return rows[0].id as string;
  };

  it('R. origin=human requires an actor, and provider must not name one', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const sr = await srcRecord(ORG_A, p, 'h1');
      const { rows: u } = await db.query(
        `INSERT INTO public.users (email, is_email_verified, has_password, status, onboarding_state)
         VALUES ('par-actor@test.local',true,true,'active','active') RETURNING id`);
      const actor = u[0].id;

      // human + actor: accepted
      await db.query(
        `INSERT INTO public.source_assertions
           (organization_id, source_record_id, entity_type, person_id, attribute, normalized_value, value_hash, provider, recorded_at, origin, asserted_by_user_id)
         VALUES ($1,$2,'person',$3,'job_title','HumanTitle',$4,'human',now(),'human',$5)`,
        [ORG_A, sr, p, hex('human-with-actor'), actor]);

      // human without actor: refused
      expect(await attempt(
        `INSERT INTO public.source_assertions
           (organization_id, source_record_id, entity_type, person_id, attribute, normalized_value, value_hash, provider, recorded_at, origin)
         VALUES ($1,$2,'person',$3,'job_title','NoActor',$4,'human',now(),'human')`,
        [ORG_A, sr, p, hex('human-without-actor')])).toBe('23514');

      // provider WITH an actor: refused
      expect(await attempt(
        `INSERT INTO public.source_assertions
           (organization_id, source_record_id, entity_type, person_id, attribute, normalized_value, value_hash, provider, recorded_at, origin, asserted_by_user_id)
         VALUES ($1,$2,'person',$3,'job_title','Y',$4,'apollo',now(),'provider',$5)`,
        [ORG_A, sr, p, hex('provider-with-actor'), actor])).toBe('23514');
    });
  });

  it('every pre-existing assertion remains valid, defaulted to provider', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const sr = await srcRecord(ORG_A, p, 'd1');
      // An insert that names no origin at all — the shape all existing code uses.
      await db.query(
        `INSERT INTO public.source_assertions
           (organization_id, source_record_id, entity_type, person_id, attribute, normalized_value, value_hash, provider, recorded_at)
         VALUES ($1,$2,'person',$3,'job_title','Legacy',$4,'apollo',now())`,
        [ORG_A, sr, p, hex('legacy-provider-default')]);
      const { rows } = await db.query(
        `SELECT origin, asserted_by_user_id FROM public.source_assertions WHERE value_hash=$1`, [hex('legacy-provider-default')]);
      expect(rows[0].origin).toBe('provider');
      expect(rows[0].asserted_by_user_id).toBeNull();
    });
  });

  it('Q. a human assertion cannot be filed across tenants', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pa = await newPerson(ORG_A);
      const srA = await srcRecord(ORG_A, pa, 'cross-tenant-human');
      const { rows: u } = await db.query(
        `INSERT INTO public.users (email) VALUES ('par-actor-b@test.local') RETURNING id`);
      const actor = u[0].id;
      // Tenant B filing against tenant A's source record and person. The actor
      // FK is not tenant-scoped, so the tenant guarantee here comes from the
      // source record's own composite key -- which is the point of testing it.
      expect(await attempt(
        `INSERT INTO public.source_assertions
           (organization_id, source_record_id, entity_type, person_id, attribute, normalized_value, value_hash, provider, recorded_at, origin, asserted_by_user_id)
         VALUES ($1,$2,'person',$3,'job_title','Hijack',$4,'human',now(),'human',$5)`,
        [ORG_B, srA, pa, hex('hijack'), actor])).toBe('23503');
    });
  });

  it('S. a relationship subject is expressible, tenant-safe, and coherent', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 's-subj.test' });
      const r = await rel(ORG_A, p, a);
      const sr = await srcRecord(ORG_A, p, 'f1');

      // same tenant: accepted
      await db.query(
        `INSERT INTO public.source_assertions
           (organization_id, source_record_id, entity_type, relationship_id, attribute, normalized_value, value_hash, provider, recorded_at)
         VALUES ($1,$2,'relationship',$3,'job_title','RelTitle',$4,'apollo',now())`,
        [ORG_A, sr, r, hex('relationship-same-tenant')]);

      // entity_type=relationship without a relationship_id: refused.
      //
      // Since migration 20261125000000 this is the TRIGGER's refusal (P0001),
      // not the CHECK's (23514). The NOT NULL half moved to an INSERT guard so
      // that the erasure cascade can later detach a recorded assertion, and a
      // BEFORE INSERT trigger is evaluated ahead of the table's constraints.
      // The guarantee is unchanged; only which layer speaks first is.
      expect(await attempt(
        `INSERT INTO public.source_assertions
           (organization_id, source_record_id, entity_type, attribute, normalized_value, value_hash, provider, recorded_at)
         VALUES ($1,$2,'relationship','job_title','Z',$3,'apollo',now())`,
        [ORG_A, sr, hex('relationship-missing-id')])).toBe('P0001');

      // ...and the CHECK still refuses a relationship assertion that names a
      // person, which is the half that did NOT move.
      expect(await attempt(
        `INSERT INTO public.source_assertions
           (organization_id, source_record_id, entity_type, relationship_id, person_id, attribute, normalized_value, value_hash, provider, recorded_at)
         VALUES ($1,$2,'relationship',$3,$4,'job_title','Z',$5,'apollo',now())`,
        [ORG_A, sr, r, p, hex('relationship-names-person')])).toBe('23514');

      // another tenant naming this relationship: refused by the composite FK
      const pb = await newPerson(ORG_B);
      const srB = await srcRecord(ORG_B, pb, 'f2');
      expect(await attempt(
        `INSERT INTO public.source_assertions
           (organization_id, source_record_id, entity_type, relationship_id, attribute, normalized_value, value_hash, provider, recorded_at)
         VALUES ($1,$2,'relationship',$3,'job_title','X',$4,'apollo',now())`,
        [ORG_B, srB, r, hex('relationship-cross-tenant')])).toBe('23503');
    });
  });
});

describe('PAR — concurrency, where the database is the only arbiter', () => {
  it('two concurrent identical relationships: one commits, one gets 23505', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'conc-one.test' });
      await rel(ORG_A, p, a);
      // The second writer's INSERT is what a lost race looks like; the repository
      // catches this exact SQLSTATE and re-resolves onto the winner.
      expect(await attempt(
        `INSERT INTO public.person_account_relationships (organization_id, person_id, account_id)
         VALUES ($1,$2,$3)`, [ORG_A, p, a])).toBe('23505');
    });
  });

  it('two concurrent primaries: the index refuses the second, whichever order', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a1 = await newAccount(ORG_A, { domain: 'conc-p1.test' });
      const a2 = await newAccount(ORG_A, { domain: 'conc-p2.test' });
      await rel(ORG_A, p, a1);
      await rel(ORG_A, p, a2);
      await db.query('SELECT public.pi_relationship_set_primary($1,$2,$3)', [ORG_A, p, a1]);
      // A second writer promoting the other one WITHOUT demoting is refused.
      expect(await attempt(
        `UPDATE public.person_account_relationships SET is_primary=true
          WHERE organization_id=$1 AND person_id=$2 AND account_id=$3`, [ORG_A, p, a2])).toBe('23505');
      // Through the function it succeeds, because the function demotes first.
      await db.query('SELECT public.pi_relationship_set_primary($1,$2,$3)', [ORG_A, p, a2]);
      expect(await primaryOf(ORG_A, p)).toBe(a2);
      expect(await pointer(p)).toBe(a2);
    });
  });
});

describe('PAR — the negative guarantees', () => {
  it('11. suppression gains NO account dimension from this work', async () => {
    await inRollback(async () => {
      // `contact_governance_records` is person-and-target scoped by design, and
      // must stay that way: an employer dimension would let a suppression
      // recorded against one relationship fail to suppress another.
      const { rows } = await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='contact_governance_records'`);
      const cols = rows.map((r: any) => r.column_name);
      expect(cols).not.toContain('account_id');
      expect(cols).not.toContain('relationship_id');
      expect(cols).toContain('person_id');
    });
  });

  it('23. canonical_leads identity is untouched — no account, no relationship', async () => {
    await inRollback(async () => {
      const { rows } = await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='canonical_leads'`);
      const cols = rows.map((r: any) => r.column_name);
      expect(cols).not.toContain('account_id');
      expect(cols).not.toContain('relationship_id');
      // the source key remains the prospect's identity
      expect(cols).toContain('external_lead_key');
    });
  });

  it('1/X. an employer change never duplicates the person', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a1 = await newAccount(ORG_A, { domain: 'id-one.test' });
      const a2 = await newAccount(ORG_A, { domain: 'id-two.test' });
      await rel(ORG_A, p, a1);
      await db.query('SELECT public.pi_relationship_set_primary($1,$2,$3)', [ORG_A, p, a1]);
      await db.query('SELECT public.pi_relationship_end($1,$2,$3)', [ORG_A, p, a1]);
      await rel(ORG_A, p, a2);
      await db.query('SELECT public.pi_relationship_set_primary($1,$2,$3)', [ORG_A, p, a2]);

      const { rows } = await db.query(
        'SELECT count(*)::int n FROM public.unified_persons WHERE id=$1', [p]);
      expect(rows[0].n).toBe(1);
      expect(await pointer(p)).toBe(a2);
      // and the former employment is still on the record
      const { rows: hist } = await db.query(
        `SELECT count(*)::int n FROM public.person_account_relationships
          WHERE person_id=$1 AND ended_at IS NOT NULL`, [p]);
      expect(hist[0].n).toBe(1);
    });
  });
});

describe('PAR — currentness is DERIVED, never stored', () => {
  it('there is no is_current column, and ended_at is the only currency signal', async () => {
    await inRollback(async () => {
      const { rows } = await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='person_account_relationships'`);
      const cols = rows.map((r: any) => r.column_name);
      // A stored flag is a second source of truth for the same fact, and the
      // two drift the moment anything writes one without the other.
      expect(cols).not.toContain('is_current');
      expect(cols).not.toContain('current');
      expect(cols).toContain('ended_at');
    });
  });

  it('N. a person with NO employer is a perfectly valid prospect', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const { rows: person } = await db.query(
        'SELECT id, account_id FROM public.unified_persons WHERE id = $1', [p]);
      expect(person).toHaveLength(1);
      expect(person[0].account_id).toBeNull();
      const { rows: r } = await db.query(
        'SELECT count(*)::int n FROM public.person_account_relationships WHERE person_id=$1', [p]);
      expect(r[0].n).toBe(0);
      // And clearing a primary that was never set is not an error.
      expect(await attempt('SELECT public.pi_relationship_clear_primary($1,$2)', [ORG_A, p])).toBe('ok');
    });
  });
});

describe('PAR — the backfill, executed from the migration itself', () => {
  /**
   * These run the migration's OWN backfill statement, sliced out of the file,
   * rather than a copy of it. A copy would keep passing after the migration
   * stopped doing this, which is the one thing the test exists to prevent.
   */
  const backfillSql = (): string => {
    const file = readFileSync(
      join(__dirname, '..', '..', '..', 'supabase', 'migrations',
        '20261122000000_pi_person_account_relationships.sql'), 'utf8');
    const from = file.indexOf('-- 8. BACKFILL.');
    const to = file.indexOf('-- 9. POSTCONDITIONS');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const slice = file.slice(from, to);
    expect(slice).toMatch(/INSERT INTO public\.person_account_relationships/);
    return slice;
  };

  const personWithEmployer = async (org: string, account: string, over: Record<string, string> = {}) => {
    const { rows } = await db.query(
      `INSERT INTO public.unified_persons (company_id, account_id, job_title, department, seniority)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [org, account, over.job_title ?? 'VP Sales', over.department ?? 'Sales', over.seniority ?? 'vp']);
    return rows[0].id as string;
  };

  it('L. an existing employer pointer becomes one primary, current, employee relationship', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newAccount(ORG_A, { domain: 'backfill-one.test' });
      const p = await personWithEmployer(ORG_A, a);

      await db.query(backfillSql());

      const { rows } = await db.query(
        `SELECT account_id, relationship_type, is_primary, started_at, ended_at,
                job_title, department, seniority, attributes_source, attributes_updated_at
           FROM public.person_account_relationships WHERE person_id=$1`, [p]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        account_id: a, relationship_type: 'employee', is_primary: true,
        job_title: 'VP Sales', department: 'Sales', seniority: 'vp',
      });
      // Dates are NOT invented: nothing recorded when these employments began.
      expect(rows[0].started_at).toBeNull();
      expect(rows[0].ended_at).toBeNull();
      // Provenance stays NULL, so a backfilled title is an UNATTESTED incumbent
      // and B1b may re-decide it rather than treating it as a human assertion.
      expect(rows[0].attributes_source).toBeNull();
      expect(rows[0].attributes_updated_at).toBeNull();
    });
  });

  it('M. re-running the backfill creates no duplicate', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newAccount(ORG_A, { domain: 'backfill-idem.test' });
      const p = await personWithEmployer(ORG_A, a);
      const sql = backfillSql();
      await db.query(sql);
      await db.query(sql);
      await db.query(sql);
      const { rows } = await db.query(
        'SELECT count(*)::int n FROM public.person_account_relationships WHERE person_id=$1', [p]);
      expect(rows[0].n).toBe(1);
    });
  });

  it('the backfill respects tenants and skips people with no employer', async () => {
    await inRollback(async () => {
      await seedTenants();
      const aa = await newAccount(ORG_A, { domain: 'bf-a.test' });
      const ab = await newAccount(ORG_B, { domain: 'bf-b.test' });
      const pa = await personWithEmployer(ORG_A, aa);
      const pb = await personWithEmployer(ORG_B, ab);
      const none = await newPerson(ORG_A);

      await db.query(backfillSql());

      const { rows } = await db.query(
        `SELECT person_id, organization_id FROM public.person_account_relationships
          WHERE person_id = ANY($1::uuid[]) ORDER BY organization_id`, [[pa, pb, none]]);
      expect(rows).toHaveLength(2);
      expect(rows.map((r: any) => [r.person_id, r.organization_id]))
        .toEqual([[pa, ORG_A], [pb, ORG_B]]);
    });
  });

  it('a backfilled relationship satisfies the pointer invariant immediately', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newAccount(ORG_A, { domain: 'bf-pointer.test' });
      const p = await personWithEmployer(ORG_A, a);
      await db.query(backfillSql());
      expect(await primaryOf(ORG_A, p)).toBe(a);
      expect(await pointer(p)).toBe(a);
    });
  });
});

describe('PAR — Y. prospect identity semantics are untouched', () => {
  it('canonical_leads still keys on its source external key', async () => {
    await inRollback(async () => {
      const { rows } = await db.query(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname='public' AND tablename='canonical_leads'`);
      const defs = rows.map((r: any) => r.indexdef).join('\n');
      expect(defs).toMatch(/external_lead_key/);
      // Nothing in this gate may have made prospect identity depend on an
      // employer: that would make a job change a new prospect.
      expect(defs).not.toMatch(/relationship_id/);
      expect(defs).not.toMatch(/\baccount_id\b/);
    });
  });

  it('unified_persons identity does not depend on the employer pointer', async () => {
    await inRollback(async () => {
      const { rows } = await db.query(
        `SELECT indexdef FROM pg_indexes
          WHERE schemaname='public' AND tablename='unified_persons' AND indexdef LIKE '%UNIQUE%'`);
      const defs = rows.map((r: any) => r.indexdef).join('\n');
      expect(defs).not.toMatch(/relationship_id/);
      // account_id may appear only as the (id, company_id)-style tenant key or
      // not at all — never as part of what makes a person unique.
      for (const d of rows.map((r: any) => r.indexdef as string)) {
        if (/account_id/.test(d)) {
          throw new Error(`unified_persons uniqueness must not involve account_id: ${d}`);
        }
      }
    });
  });
});
