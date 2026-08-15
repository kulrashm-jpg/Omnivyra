/**
 * LI-4C — person lifecycle and duplicate parking, against real PostgreSQL.
 *
 * The decisive property is one only a database can demonstrate: that a
 * composite self-referencing foreign key makes a CROSS-TENANT MERGE impossible.
 * D-1 says the same human in two tenants is two independent people forever, and
 * that guarantee has to live in the schema — application code can be bypassed,
 * a foreign key cannot.
 */
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson } from './setup';

const CAND = `INSERT INTO public.person_duplicate_candidates
  (organization_id, person_id, candidate_person_id, classification, matched_on)
  VALUES ($1,$2,$3,$4,$5) RETURNING id`;

const candidate = async (org: string, a: string, b: string | null,
  cls = 'definite', on = 'email'): Promise<string> =>
  (await db.query(CAND, [org, a, b, cls, on])).rows[0].id;

const tryCandidate = (org: string, a: string, b: string | null, cls = 'definite', on = 'email') =>
  attempt(
    `INSERT INTO public.person_duplicate_candidates
      (organization_id, person_id, candidate_person_id, classification, matched_on)
     VALUES ($1,$2,$3,$4,$5)`, [org, a, b, cls, on]);

const openCount = async (org: string): Promise<number> => Number((await db.query(
  `SELECT count(*)::int n FROM public.person_duplicate_candidates
    WHERE organization_id=$1 AND status='open'`, [org])).rows[0].n);

beforeAll(seedTenants);

describe('LI-4C — person lifecycle', () => {
  it('every existing person is active, and nothing was merged by the migration', async () => {
    const { rows } = await db.query(`
      SELECT count(*) FILTER (WHERE status <> 'active')        AS non_active,
             count(*) FILTER (WHERE merged_into_id IS NOT NULL) AS merged
        FROM public.unified_persons`);
    expect(Number(rows[0].non_active)).toBe(0);
    expect(Number(rows[0].merged)).toBe(0);
  });

  it('the status vocabulary is exactly the ADR four', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='unified_persons_status_valid'`);
    for (const s of ['active', 'merged', 'suppressed', 'archived']) expect(rows[0].d).toContain(s);
    expect((rows[0].d.match(/'/g) ?? []).length / 2).toBe(4);
  });

  it('rejects a status outside the vocabulary', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      expect(await attempt(`UPDATE public.unified_persons SET status='deleted' WHERE id=$1`, [p])).toBe('23514');
    });
  });

  it('a person may be archived without being merged', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      expect(await attempt(`UPDATE public.unified_persons SET status='archived' WHERE id=$1`, [p])).toBe('ok');
    });
  });

  it('merged REQUIRES a survivor, and a survivor REQUIRES merged', async () => {
    await inRollback(async () => {
      const a = await newPerson(ORG_A);
      const b = await newPerson(ORG_A);
      // merged with no pointer
      expect(await attempt(`UPDATE public.unified_persons SET status='merged' WHERE id=$1`, [a])).toBe('23514');
      // pointer with no merged status
      expect(await attempt(
        `UPDATE public.unified_persons SET merged_into_id=$2 WHERE id=$1`, [a, b])).toBe('23514');
      // both together
      expect(await attempt(
        `UPDATE public.unified_persons SET status='merged', merged_into_id=$2 WHERE id=$1`, [a, b])).toBe('ok');
    });
  });

  it('a person cannot be merged into itself', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      expect(await attempt(
        `UPDATE public.unified_persons SET status='merged', merged_into_id=$1 WHERE id=$1`, [p])).toBe('23514');
    });
  });
});

describe('LI-4C — D-1: cross-tenant merge is impossible at the database level', () => {
  it('the merge FK is composite, tenant-safe, and ON DELETE NO ACTION', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='unified_persons_merge_tenant_fk'`);
    expect(rows[0].d).toMatch(/FOREIGN KEY \(merged_into_id, company_id\)/);
    expect(rows[0].d).toMatch(/REFERENCES unified_persons\(id, company_id\)/);
    // Postgres prints no ON DELETE clause for NO ACTION. Asserting only the
    // absence of SET NULL would also pass for CASCADE, which would delete merged
    // people when a survivor went — so assert no action is present at all.
    expect(rows[0].d).not.toMatch(/ON DELETE/);
    expect(rows[0].d).not.toMatch(/SET NULL/);
  });

  it('merging Tenant A\'s person into Tenant B\'s person is REFUSED — 23503', async () => {
    await inRollback(async () => {
      const a = await newPerson(ORG_A);
      const b = await newPerson(ORG_B);
      expect(await attempt(
        `UPDATE public.unified_persons SET status='merged', merged_into_id=$2 WHERE id=$1`, [a, b])).toBe('23503');
    });
  });

  it('merging within one tenant is permitted', async () => {
    await inRollback(async () => {
      const a = await newPerson(ORG_A);
      const b = await newPerson(ORG_A);
      expect(await attempt(
        `UPDATE public.unified_persons SET status='merged', merged_into_id=$2 WHERE id=$1`, [a, b])).toBe('ok');
    });
  });

  it('deleting a survivor is REFUSED — 23503 — so no orphan can be produced', async () => {
    await inRollback(async () => {
      const survivor = await newPerson(ORG_A);
      const merged = await newPerson(ORG_A);
      await db.query(
        `UPDATE public.unified_persons SET status='merged', merged_into_id=$2 WHERE id=$1`,
        [merged, survivor]);

      // 4/5 — the delete fails, and fails as a referential violation.
      expect(await attempt('DELETE FROM public.unified_persons WHERE id=$1', [survivor])).toBe('23503');

      // 6/7/8/9 — nothing moved.
      const { rows } = await db.query(
        `SELECT id, status, merged_into_id, company_id FROM public.unified_persons
          WHERE id = ANY($1) ORDER BY id::text`, [[survivor, merged]]);
      expect(rows).toHaveLength(2);                          // both remain

      const survivorRow = rows.find((r: { id: string }) => r.id === survivor);
      const mergedRow = rows.find((r: { id: string }) => r.id === merged);
      expect(survivorRow).toBeDefined();                     // survivor remains
      expect(mergedRow.status).toBe('merged');               // status intact
      expect(mergedRow.merged_into_id).toBe(survivor);       // pointer intact
      expect(mergedRow.company_id).toBe(ORG_A);              // tenant intact
    });
  });

  it('an orphaned merged row is UNREACHABLE — the CHECK forbids the state outright', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      // The state ON DELETE SET NULL would have produced cannot be written at all.
      expect(await attempt(
        `UPDATE public.unified_persons SET status='merged', merged_into_id=NULL WHERE id=$1`, [p])).toBe('23514');
    });
  });
});

describe('LI-4C — tenant deletion still cascades (why NO ACTION, not RESTRICT)', () => {
  it('deleting a tenant removes BOTH the survivor and the person merged into it', async () => {
    // Deliberately NOT inRollback: this needs a disposable tenant of its own,
    // deleted at the end, because the point is the companies -> unified_persons
    // CASCADE. RESTRICT would abort this delete; NO ACTION defers the check to
    // end of statement, by which time both rows are gone.
    const org = '00000000-0000-4000-8000-00000000c0de';
    try {
      await db.query(
        `INSERT INTO public.companies (id, name) VALUES ($1, 'LI-4C Cascade Tenant')
         ON CONFLICT (id) DO NOTHING`, [org]);

      const survivor = (await db.query(
        'INSERT INTO public.unified_persons (company_id) VALUES ($1) RETURNING id', [org])).rows[0].id;
      const merged = (await db.query(
        'INSERT INTO public.unified_persons (company_id) VALUES ($1) RETURNING id', [org])).rows[0].id;
      await db.query(
        `UPDATE public.unified_persons SET status='merged', merged_into_id=$2 WHERE id=$1`,
        [merged, survivor]);

      // The merge relationship really is in place before the cascade.
      expect(Number((await db.query(
        `SELECT count(*)::int n FROM public.unified_persons WHERE company_id=$1 AND status='merged'`,
        [org])).rows[0].n)).toBe(1);

      // 4/5 — tenant deletion SUCCEEDS.
      await db.query('DELETE FROM public.companies WHERE id=$1', [org]);

      // 6 — both people went with it.
      const left = Number((await db.query(
        'SELECT count(*)::int n FROM public.unified_persons WHERE id = ANY($1)',
        [[survivor, merged]])).rows[0].n);
      expect(left).toBe(0);
    } finally {
      await db.query('DELETE FROM public.companies WHERE id=$1', [org]).catch(() => {});
    }
  });
});

describe('LI-4C — duplicate candidates', () => {
  it('a candidate cannot pair a person with itself', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      expect(await tryCandidate(ORG_A, p, p)).toBe('23514');
    });
  });

  it('rejects a classification or signal outside the vocabulary', async () => {
    await inRollback(async () => {
      const a = await newPerson(ORG_A);
      const b = await newPerson(ORG_A);
      expect(await tryCandidate(ORG_A, a, b, 'likely')).toBe('23514');
      expect(await tryCandidate(ORG_A, a, b, 'definite', 'fuzzy_name')).toBe('23514');
    });
  });

  it('an unresolved candidate carries no resolution, and a resolved one must carry a reason', async () => {
    await inRollback(async () => {
      const a = await newPerson(ORG_A);
      const b = await newPerson(ORG_A);
      const id = await candidate(ORG_A, a, b);

      // resolved without a reason
      expect(await attempt(
        `UPDATE public.person_duplicate_candidates SET status='retained', resolved_at=now() WHERE id=$1`, [id])).toBe('23514');
      // open but carrying a resolution
      expect(await attempt(
        `UPDATE public.person_duplicate_candidates SET resolution_reason='x' WHERE id=$1`, [id])).toBe('23514');
      // properly resolved
      expect(await attempt(
        `UPDATE public.person_duplicate_candidates
            SET status='retained', resolved_at=now(), resolution_reason='distinct people'
          WHERE id=$1`, [id])).toBe('ok');
    });
  });

  it('a candidate may be parked with no counterpart person — the LI-2 unresolved state', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      expect(await tryCandidate(ORG_A, p, null, 'probable', 'external_key')).toBe('ok');
    });
  });
});

describe('LI-4C — idempotency and concurrency', () => {
  it('one OPEN review per pair, in either direction', async () => {
    await inRollback(async () => {
      const a = await newPerson(ORG_A);
      const b = await newPerson(ORG_A);
      await candidate(ORG_A, a, b);
      expect(await tryCandidate(ORG_A, a, b)).toBe('23505');
      // (B,A) is the same review — least/greatest ordering
      expect(await tryCandidate(ORG_A, b, a)).toBe('23505');
      expect(await openCount(ORG_A)).toBe(1);
    });
  });

  it('ON CONFLICT cannot infer the partial index — 42P10, which is why the writer catches 23505', async () => {
    await inRollback(async () => {
      const a = await newPerson(ORG_A);
      const b = await newPerson(ORG_A);
      await candidate(ORG_A, a, b);
      const code = await attempt(
        `INSERT INTO public.person_duplicate_candidates
           (organization_id, person_id, candidate_person_id, classification, matched_on)
         VALUES ($1,$2,$3,'definite','email')
         ON CONFLICT (organization_id, least(person_id, candidate_person_id),
                      greatest(person_id, candidate_person_id)) DO NOTHING`,
        [ORG_A, a, b]);
      expect(code).toBe('42P10');
    });
  });

  it('a resolved candidate frees the pair, so a later re-detection is expressible', async () => {
    await inRollback(async () => {
      const a = await newPerson(ORG_A);
      const b = await newPerson(ORG_A);
      const id = await candidate(ORG_A, a, b);
      await db.query(
        `UPDATE public.person_duplicate_candidates
            SET status='retained', resolved_at=now(), resolution_reason='reviewed' WHERE id=$1`, [id]);
      expect(await tryCandidate(ORG_A, a, b)).toBe('ok');
    });
  });

  it('two concurrent detections of the same pair yield exactly one open candidate', async () => {
    const { Client } = await import('pg');
    const url = process.env.W6_DB_URL as string;
    const c1 = new Client({ connectionString: url });
    const c2 = new Client({ connectionString: url });
    await Promise.all([c1.connect(), c2.connect()]);
    let a = '';
    let b = '';
    try {
      a = (await c1.query('INSERT INTO public.unified_persons (company_id) VALUES ($1) RETURNING id', [ORG_A])).rows[0].id;
      b = (await c1.query('INSERT INTO public.unified_persons (company_id) VALUES ($1) RETURNING id', [ORG_A])).rows[0].id;

      await c1.query('BEGIN');
      await c2.query('BEGIN');
      const sql = `INSERT INTO public.person_duplicate_candidates
        (organization_id, person_id, candidate_person_id, classification, matched_on)
        VALUES ($1,$2,$3,'definite','email')`;

      await c1.query(sql, [ORG_A, a, b]);

      let settled = false;
      const pending = c2.query(sql, [ORG_A, b, a])       // reversed order, same pair
        .then((r) => { settled = true; return r; })
        .catch((e) => { settled = true; return e; });

      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false);                        // the second BLOCKS on the index

      await c1.query('COMMIT');
      const result = await pending as { code?: string };
      expect(result?.code).toBe('23505');                 // the loser is told, and re-resolves
      await c2.query('ROLLBACK').catch(() => {});

      const n = Number((await c1.query(
        `SELECT count(*)::int n FROM public.person_duplicate_candidates WHERE person_id IN ($1,$2) OR candidate_person_id IN ($1,$2)`,
        [a, b])).rows[0].n);
      expect(n).toBe(1);
    } finally {
      await c1.query('DELETE FROM public.person_duplicate_candidates WHERE organization_id=$1', [ORG_A]).catch(() => {});
      await c1.query('DELETE FROM public.unified_persons WHERE id = ANY($1)', [[a, b]]).catch(() => {});
      await Promise.all([c1.end(), c2.end()]);
    }
  });
});

describe('LI-4C — tenant isolation of the queue', () => {
  it('a candidate pairing two tenants\' people is REFUSED — 23503', async () => {
    await inRollback(async () => {
      const a = await newPerson(ORG_A);
      const b = await newPerson(ORG_B);
      expect(await tryCandidate(ORG_A, a, b)).toBe('23503');
      expect(await tryCandidate(ORG_B, a, b)).toBe('23503');
    });
  });

  it('the same pair may be reviewed independently in each tenant', async () => {
    await inRollback(async () => {
      const a1 = await newPerson(ORG_A);
      const a2 = await newPerson(ORG_A);
      const b1 = await newPerson(ORG_B);
      const b2 = await newPerson(ORG_B);
      await candidate(ORG_A, a1, a2);
      await candidate(ORG_B, b1, b2);
      expect(await openCount(ORG_A)).toBe(1);
      expect(await openCount(ORG_B)).toBe(1);
    });
  });

  it('a candidate cannot claim a tenant its person does not belong to', async () => {
    await inRollback(async () => {
      const a1 = await newPerson(ORG_A);
      const a2 = await newPerson(ORG_A);
      expect(await tryCandidate(ORG_B, a1, a2)).toBe('23503');
    });
  });

  it('the same email in two tenants stays two people and is never a cross-tenant candidate', async () => {
    await inRollback(async () => {
      const a = (await db.query(
        `INSERT INTO public.unified_persons (company_id, primary_email) VALUES ($1,$2) RETURNING id`,
        [ORG_A, 'shared@li4c.test'])).rows[0].id;
      const b = (await db.query(
        `INSERT INTO public.unified_persons (company_id, primary_email) VALUES ($1,$2) RETURNING id`,
        [ORG_B, 'shared@li4c.test'])).rows[0].id;
      expect(a).not.toBe(b);                              // both legal, tenant-scoped index
      expect(await tryCandidate(ORG_A, a, b)).toBe('23503');
    });
  });

  it('the same phone in two tenants stays two people', async () => {
    await inRollback(async () => {
      const a = (await db.query(
        `INSERT INTO public.unified_persons (company_id, primary_phone) VALUES ($1,$2) RETURNING id`,
        [ORG_A, '+15550109999'])).rows[0].id;
      const b = (await db.query(
        `INSERT INTO public.unified_persons (company_id, primary_phone) VALUES ($1,$2) RETURNING id`,
        [ORG_B, '+15550109999'])).rows[0].id;
      expect(a).not.toBe(b);
      expect(await tryCandidate(ORG_A, a, b)).toBe('23503');
    });
  });
});

describe('LI-4C — provenance and RLS', () => {
  it('the queue references evidence rather than copying it', async () => {
    const { rows } = await db.query(`
      SELECT attname FROM pg_attribute
       WHERE attrelid='public.person_duplicate_candidates'::regclass AND attnum>0 AND NOT attisdropped`);
    const names = rows.map((r: { attname: string }) => r.attname);
    expect(names).toContain('source_record_id');
    // No second provenance store: no payload, no raw copy, and no score column.
    for (const forbidden of ['raw_payload', 'payload', 'evidence', 'score', 'confidence', 'similarity']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('RLS is enabled on the queue', async () => {
    const { rows } = await db.query(
      `SELECT relrowsecurity r FROM pg_class WHERE oid='public.person_duplicate_candidates'::regclass`);
    expect(rows[0].r).toBe(true);
  });

  it('all three tenant references are composite', async () => {
    const { rows } = await db.query(`
      SELECT count(*)::int n FROM pg_constraint con JOIN pg_class s ON s.oid=con.conrelid
       WHERE con.contype='f' AND s.relname='person_duplicate_candidates' AND array_length(con.conkey,1)=2`);
    expect(Number(rows[0].n)).toBe(3);
  });
});
