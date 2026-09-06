/**
 * A4Y — attribute-set work-item identity, against real PostgreSQL.
 *
 * A4T Blocker 3 is a defect about what PostgreSQL considers the same row, so it
 * is asserted against PostgreSQL. Three things can only be proven here:
 *
 *   - the canonical CHECK actually REJECTS a non-canonical insert (a mocked
 *     table can only promise that it would);
 *   - array equality really is order-, duplicate- and whitespace-sensitive,
 *     which is the whole reason canonical form exists;
 *   - the four replaced unique indexes really do admit two different attribute
 *     sets while still admitting only one attempt per set.
 *
 * What is under test:
 *   - `pi_canonical_attribute_set` sorts under COLLATE "C", dedupes, rejects
 *     null/empty/padded elements, and preserves {} rather than returning NULL;
 *   - the CHECK refuses every non-canonical form, including the NULL-return
 *     case that a plain `=` comparison would have silently admitted;
 *   - Case A/B/C/D of the identity matrix;
 *   - attempt numbers are per work item — set A #1 and set B #1 coexist;
 *   - reclaim matches on the attribute set: same set takes over, a different
 *     set, subset or superset does not;
 *   - reclaim moves ownership only, leaving provider_call_state and the
 *     requested set intact.
 *
 * NOT EXECUTED BY THE AUTHOR: this suite requires `W6_DB_URL` and a disposable
 * database (scripts/ci/real-schema-ci.sh). It is written to the same contract as
 * its siblings and has not been run locally.
 */
import { db, seedTenants, newAccount, newPerson, uniqueIndexColumns, constraintDef, ORG_A, ORG_B } from './setup';

const PROVIDER = 'a4y-identity';
const SET_A = '{employee_count}';
const SET_B = '{founded_year}';
const SET_AB = '{employee_count,founded_year}';

const canon = async (input: string | null): Promise<string[] | null> => {
  const { rows } = await db.query(
    `SELECT public.pi_canonical_attribute_set($1::text[]) AS c`, [input],
  );
  return rows[0].c;
};

async function open(org: string, account: string, attrs: string, opts: {
  n?: number; lease?: string | null; startedAgo?: string; state?: string; provider?: string;
} = {}): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.prospect_enrichment_attempts
       (organization_id, account_id, provider_key, requested_attributes, attempt_number,
        correlation_id, started_at, claimed_until, provider_call_state)
     VALUES ($1,$2,$3,$4,$5,'corr-a4y', now() - ($6)::interval, $7, $8)
     RETURNING id`,
    [org, account, opts.provider ?? PROVIDER, attrs, opts.n ?? 1,
      opts.startedAgo ?? '2 hours', opts.lease ?? null, opts.state ?? 'not_called'],
  );
  return rows[0].id;
}

/** The A4Y reclaim statement, exactly as `dbReclaim` now composes it. */
const RECOVER = `
  UPDATE public.prospect_enrichment_attempts
     SET claimed_by = $5, claimed_until = now() + interval '1 minute'
   WHERE organization_id = $1 AND account_id = $2 AND provider_key = $3
     AND requested_attributes = $4::text[]
     AND completed_at IS NULL
     AND claimed_until < now()
   RETURNING id`;

beforeAll(async () => { await seedTenants(); });

afterEach(async () => {
  await db.query(`DELETE FROM public.prospect_enrichment_attempts WHERE provider_key LIKE 'a4y-%'`);
  await db.query(`DELETE FROM public.prospect_accounts WHERE source = 'a4y'`);
  // Case D creates a canonical person, and these suites share one database.
  // Leaving it behind breaks any sibling asserting that a tenant holds none —
  // `b1_social_contact_identity` does exactly that. Same cleanup as A4N's.
  await db.query(`DELETE FROM public.unified_persons WHERE company_id = ANY($1::uuid[])`, [[ORG_A, ORG_B]]);
});

describe('A4Y — array equality is why canonical form exists', () => {
  it('order, duplicates and padding all make arrays unequal', async () => {
    const { rows } = await db.query(`SELECT
      (ARRAY['a','b']::text[] = ARRAY['b','a']::text[]) AS diff_order,
      (ARRAY['a','a']::text[] = ARRAY['a']::text[])     AS dup_vs_single,
      (ARRAY[' a ']::text[]   = ARRAY['a']::text[])     AS padded_vs_clean`);
    expect(rows[0].diff_order).toBe(false);
    expect(rows[0].dup_vs_single).toBe(false);
    expect(rows[0].padded_vs_clean).toBe(false);
  });
});

describe('A4Y — pi_canonical_attribute_set', () => {
  it('sorts and dedupes; both orderings give one value', async () => {
    expect(await canon('{founded_year,employee_count}')).toEqual(['employee_count', 'founded_year']);
    expect(await canon('{employee_count,founded_year}')).toEqual(['employee_count', 'founded_year']);
    expect(await canon('{employee_count,employee_count}')).toEqual(['employee_count']);
  });

  it('rejects padded, empty and null elements by returning NULL', async () => {
    expect(await canon('{" employee_count "}')).toBeNull();
    expect(await canon('{""}')).toBeNull();
    expect(await canon('{NULL}')).toBeNull();
    expect(await canon(null)).toBeNull();
  });

  it('preserves the empty set as {} rather than NULL', async () => {
    expect(await canon('{}')).toEqual([]);
  });

  it('sorts by COLLATE "C", which is UTF-8 byte order', async () => {
    // '_' is 0x5F and 'a' is 0x61.
    expect(await canon('{ax,_x}')).toEqual(['_x', 'ax']);
    const { rows } = await db.query(`SELECT ('_x' < 'ax' COLLATE "C") AS c,
      (convert_to('_x','UTF8') < convert_to('ax','UTF8')) AS b`);
    expect(rows[0].c).toBe(rows[0].b);
  });

  it('is IMMUTABLE, so it may back a CHECK and an index', async () => {
    const { rows } = await db.query(
      `SELECT provolatile FROM pg_proc WHERE proname = 'pi_canonical_attribute_set'`);
    expect(rows[0].provolatile).toBe('i');
  });

  it('knows no vocabulary — an unknown key canonicalises fine', async () => {
    expect(await canon('{zzz_not_an_attribute}')).toEqual(['zzz_not_an_attribute']);
  });
});

describe('A4Y — the CHECK refuses non-canonical rows', () => {
  it('the constraint exists and is fail-closed on NULL', async () => {
    const def = await constraintDef('prospect_enrichment_attempts_attributes_canonical');
    expect(def).toBeTruthy();
    // `IS NOT DISTINCT FROM`, not `=`: a plain `=` yields NULL for malformed
    // input and a CHECK PASSES on NULL — admitting what it exists to refuse.
    //
    // PostgreSQL normalises `x IS NOT DISTINCT FROM y` when it echoes a
    // constraint back, storing it as `NOT (x IS DISTINCT FROM y)`. The stored
    // form is what must be asserted; the two are the same predicate, and the
    // rejection cases below prove the behaviour rather than the spelling.
    expect(def).toMatch(/NOT \(requested_attributes IS DISTINCT FROM/i);
    expect(def).not.toMatch(/requested_attributes = pi_canonical_attribute_set/i);
  });

  it.each([
    ['unsorted', '{founded_year,employee_count}'],
    ['duplicated', '{employee_count,employee_count}'],
    ['padded', '{" employee_count "}'],
    ['empty element', '{""}'],
  ])('a %s set cannot be stored', async (_label, attrs) => {
    const a = await newAccount(ORG_A, { domain: `a4y-chk-${_label.replace(/\W/g, '')}.w6`, source: 'a4y' });
    await expect(open(ORG_A, a, attrs)).rejects.toMatchObject({ code: '23514' });
  });

  it('a canonical set, and the empty set, are storable', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4y-ok.w6', source: 'a4y' });
    await expect(open(ORG_A, a, SET_AB)).resolves.toBeTruthy();
    const b = await newAccount(ORG_A, { domain: 'a4y-empty.w6', source: 'a4y' });
    await expect(open(ORG_A, b, '{}')).resolves.toBeTruthy();
  });
});

describe('A4Y — index definitions carry the attribute set', () => {
  it.each([
    'prospect_enrichment_attempts_person_live',
    'prospect_enrichment_attempts_account_live',
    'prospect_enrichment_attempts_person_unique',
    'prospect_enrichment_attempts_account_unique',
  ])('%s includes requested_attributes and leads with the tenant', async (name) => {
    const cols = await uniqueIndexColumns(name);
    expect(cols).not.toBeNull();
    expect(cols![0]).toBe('organization_id');
    expect(cols).toContain('requested_attributes');
  });

  it('the attempt-number indexes still end with attempt_number', async () => {
    for (const n of ['prospect_enrichment_attempts_person_unique',
      'prospect_enrichment_attempts_account_unique']) {
      const cols = await uniqueIndexColumns(n);
      expect(cols![cols!.length - 1]).toBe('attempt_number');
    }
  });

  it('the live indexes stay partial on completed_at IS NULL', async () => {
    // Scoped to this table: `%_live` alone also matches unrelated indexes such
    // as `idx_source_assertions_live`.
    const { rows } = await db.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='prospect_enrichment_attempts'
          AND indexname LIKE '%_live'`);
    expect(rows).toHaveLength(2);
    rows.forEach((r) => expect(r.indexdef).toMatch(/completed_at IS NULL/));
  });
});

describe('A4Y — identity matrix', () => {
  it('Case A — same tenant/entity/provider/set: the second is refused', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4y-a.w6', source: 'a4y' });
    await open(ORG_A, a, SET_A);
    await expect(open(ORG_A, a, SET_A, { n: 2 })).rejects.toMatchObject({ code: '23505' });
  });

  it('Case B — different sets coexist as two open work items', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4y-b.w6', source: 'a4y' });
    await open(ORG_A, a, SET_A);
    await expect(open(ORG_A, a, SET_B)).resolves.toBeTruthy();
    await expect(open(ORG_A, a, SET_AB)).resolves.toBeTruthy();   // superset too
    const { rows } = await db.query(
      `SELECT count(*)::int n FROM public.prospect_enrichment_attempts
        WHERE account_id = $1 AND completed_at IS NULL`, [a]);
    expect(rows[0].n).toBe(3);
  });

  it('Case C — different tenants never collide', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4y-c1.w6', source: 'a4y' });
    const b = await newAccount(ORG_B, { domain: 'a4y-c2.w6', source: 'a4y' });
    await open(ORG_A, a, SET_A);
    await expect(open(ORG_B, b, SET_A)).resolves.toBeTruthy();
  });

  it('Case D — person and account legs are independent', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4y-d.w6', source: 'a4y' });
    const p = await newPerson(ORG_A);
    await open(ORG_A, a, SET_A);
    await expect(db.query(
      `INSERT INTO public.prospect_enrichment_attempts
         (organization_id, person_id, provider_key, requested_attributes,
          attempt_number, correlation_id, started_at)
       VALUES ($1,$2,$3,$4,1,'corr-a4y', now())`,
      [ORG_A, p, PROVIDER, SET_A],
    )).resolves.toBeTruthy();
  });
});

describe('A4Y — attempt numbers are per work item', () => {
  it('set A #1 and set B #1 coexist', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4y-n1.w6', source: 'a4y' });
    await open(ORG_A, a, SET_A, { n: 1 });
    await expect(open(ORG_A, a, SET_B, { n: 1 })).resolves.toBeTruthy();
  });

  it('the same set cannot reuse an attempt number, even once completed', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4y-n2.w6', source: 'a4y' });
    const id = await open(ORG_A, a, SET_A, { n: 1 });
    await db.query(`UPDATE public.prospect_enrichment_attempts SET completed_at = now() WHERE id = $1`, [id]);
    await expect(open(ORG_A, a, SET_A, { n: 1 })).rejects.toMatchObject({ code: '23505' });
    await expect(open(ORG_A, a, SET_A, { n: 2 })).resolves.toBeTruthy();   // the retry
  });

  it('all four histories coexist: A#1, A#2, B#1, B#2', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4y-n3.w6', source: 'a4y' });
    for (const set of [SET_A, SET_B]) {
      const id = await open(ORG_A, a, set, { n: 1 });
      await db.query(`UPDATE public.prospect_enrichment_attempts SET completed_at = now() WHERE id = $1`, [id]);
      await open(ORG_A, a, set, { n: 2 });
    }
    const { rows } = await db.query(
      `SELECT count(*)::int n FROM public.prospect_enrichment_attempts WHERE account_id = $1`, [a]);
    expect(rows[0].n).toBe(4);
  });
});

describe('A4Y — reclaim matches the work item', () => {
  const stale = async (account: string, attrs: string, state = 'not_called') => {
    const id = await open(ORG_A, account, attrs, { state });
    await db.query(
      `UPDATE public.prospect_enrichment_attempts
          SET claimed_by='dead', claimed_until = now() - interval '1 minute' WHERE id = $1`, [id]);
    return id;
  };

  it('the same set is taken over', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4y-r1.w6', source: 'a4y' });
    await stale(a, SET_A);
    const { rowCount } = await db.query(RECOVER, [ORG_A, a, PROVIDER, SET_A, 'worker-2']);
    expect(rowCount).toBe(1);
  });

  it('the same set in a different ORDER is still the same work item', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4y-r2.w6', source: 'a4y' });
    await stale(a, SET_AB);
    // The caller canonicalises before the predicate, so the reversed request
    // resolves to the stored value rather than missing it.
    const { rows } = await db.query(
      `SELECT public.pi_canonical_attribute_set('{founded_year,employee_count}'::text[]) c`);
    const { rowCount } = await db.query(RECOVER, [ORG_A, a, PROVIDER, rows[0].c, 'worker-2']);
    expect(rowCount).toBe(1);
  });

  it.each([
    ['a different set', SET_B],
    ['a subset', SET_A],
  ])('%s does NOT steal the attempt', async (_label, requested) => {
    const a = await newAccount(ORG_A, { domain: `a4y-r-${_label.replace(/\W/g, '')}.w6`, source: 'a4y' });
    await stale(a, SET_AB);
    const { rowCount } = await db.query(RECOVER, [ORG_A, a, PROVIDER, requested, 'thief']);
    expect(rowCount).toBe(0);
  });

  it('a superset does NOT steal a smaller work item', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4y-r5.w6', source: 'a4y' });
    await stale(a, SET_A);
    const { rowCount } = await db.query(RECOVER, [ORG_A, a, PROVIDER, SET_AB, 'thief']);
    expect(rowCount).toBe(0);
  });

  it('another tenant cannot reclaim, even with the same set', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4y-r6.w6', source: 'a4y' });
    await stale(a, SET_A);
    const { rowCount } = await db.query(RECOVER, [ORG_B, a, PROVIDER, SET_A, 'thief']);
    expect(rowCount).toBe(0);
  });

  it('another provider cannot reclaim, even with the same set', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4y-r7.w6', source: 'a4y' });
    await stale(a, SET_A);
    const { rowCount } = await db.query(RECOVER, [ORG_A, a, 'a4y-other', SET_A, 'thief']);
    expect(rowCount).toBe(0);
  });

  it.each(['not_called', 'called', 'unknown'])(
    'B3 — %s survives reclaim, and the question asked is immutable', async (state) => {
      const a = await newAccount(ORG_A, { domain: `a4y-s-${state}.w6`, source: 'a4y' });
      const id = await stale(a, SET_AB, state);
      await db.query(RECOVER, [ORG_A, a, PROVIDER, SET_AB, 'worker-2']);
      const { rows } = await db.query(
        `SELECT provider_call_state, requested_attributes, correlation_id, attempt_number, claimed_by
           FROM public.prospect_enrichment_attempts WHERE id = $1`, [id]);
      expect(rows[0].provider_call_state).toBe(state);              // never downgraded
      expect(rows[0].requested_attributes).toEqual(['employee_count', 'founded_year']);
      expect(rows[0].correlation_id).toBe('corr-a4y');
      expect(rows[0].attempt_number).toBe(1);
      expect(rows[0].claimed_by).toBe('worker-2');                  // ownership DID move
    });
});
