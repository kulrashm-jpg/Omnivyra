/**
 * P2B — the normalised firmographics are actually accepted by the columns.
 *
 * The unit suite proves the normalisers produce the right SHAPES. This proves
 * PostgreSQL agrees: that the text LI-2 writes coerces into numeric, integer,
 * jsonb and timestamptz, and that the P2A constraints do not reject values the
 * normalisers consider valid.
 *
 * That pairing is the whole point. A normaliser that emits `'a,b'` for a jsonb
 * column passes every unit test and fails at the first real insert.
 */
import { db, inRollback, seedTenants, ORG_A, attempt } from './setup';
import { toAccountAttributes } from '../../services/prospectIdentity/attributes';

/**
 * Write attributes the way LI-2 does: every canonical value travels as TEXT
 * through `source_assertions.normalized_value`, so the update is parameterised
 * with strings and PostgreSQL performs the coercion.
 */
const updateSql = (cols: Record<string, unknown>) => {
  const keys = Object.keys(cols);
  return {
    sql: `UPDATE public.prospect_accounts SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
    values: keys.map((k) => (cols[k] == null ? null : String(cols[k]))),
  };
};

/**
 * A DURABLE write, for the cases that read the row back afterwards.
 *
 * `attempt()` wraps its statement in a SAVEPOINT and rolls back even when the
 * statement SUCCEEDS — it exists to capture an error code, not to persist. Using
 * it here made every assertion read a NULL column, which `Number(null)` then
 * turned into a silent `0`.
 */
const applyAsText = async (accountId: string, cols: Record<string, unknown>): Promise<'ok'> => {
  const { sql, values } = updateSql(cols);
  await db.query(sql, [accountId, ...values]);
  return 'ok';
};

/** The same write, but expected to FAIL — returns the SQLSTATE. */
const tryApplyAsText = (accountId: string, cols: Record<string, unknown>) => {
  const { sql, values } = updateSql(cols);
  return attempt(sql, [accountId, ...values]);
};

const newAccount = async (): Promise<string> => {
  const { rows } = await db.query(
    `INSERT INTO public.prospect_accounts (organization_id, domain_normalized, name, source, status)
     VALUES ($1, $2, 'P2B Account', 'manual', 'active') RETURNING id`,
    [ORG_A, `p2b-${Math.random().toString(36).slice(2, 10)}.test`],
  );
  return rows[0].id as string;
};

beforeAll(seedTenants);

describe('P2B — normalised values coerce into their columns', () => {
  it('a full firmographic set applies as TEXT, exactly as LI-2 writes it', async () => {
    await inRollback(async () => {
      const id = await newAccount();
      const attrs = toAccountAttributes({
        industry: 'SaaS', employeeCount: '250', employeeBand: '201-500',
        countryCode: 'gb', region: 'London', city: 'London',
        annualRevenue: '12500000.50', revenueBand: '$10M-$50M', foundedYear: '2015',
        technologies: ['postgres', 'nextjs'], fundingStage: 'Series B',
        lastFundingAt: '2026-01-01T00:00:00Z',
      });

      expect(await applyAsText(id, {
        industry: attrs.industry,
        employee_count: attrs.employeeCount,
        employee_band: attrs.employeeBand,
        country_code: attrs.countryCode,
        annual_revenue: attrs.annualRevenue,
        revenue_band: attrs.revenueBand,
        founded_year: attrs.foundedYear,
        technologies: attrs.technologies,
        funding_stage: attrs.fundingStage,
        last_funding_at: attrs.lastFundingAt,
      })).toBe('ok');

      const { rows } = await db.query(
        `SELECT annual_revenue, revenue_band, founded_year, technologies, funding_stage, last_funding_at,
                industry, employee_count
           FROM public.prospect_accounts WHERE id = $1`, [id]);
      const r = rows[0];
      expect(Number(r.annual_revenue)).toBe(12500000.5);
      expect(r.revenue_band).toBe('$10M-$50M');
      expect(r.founded_year).toBe(2015);
      expect(r.technologies).toEqual(['postgres', 'nextjs']);   // real jsonb array
      expect(r.funding_stage).toBe('Series B');
      expect(new Date(r.last_funding_at).toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(r.industry).toBe('SaaS');
      expect(r.employee_count).toBe(250);
    });
  });

  it('the technologies normaliser produces jsonb the column ACCEPTS', async () => {
    await inRollback(async () => {
      const id = await newAccount();
      const value = toAccountAttributes({ technologies: ['postgres'] }).technologies;
      expect(await applyAsText(id, { technologies: value })).toBe('ok');
    });
  });

  it('a RAW array would have been rejected — which is why the normaliser serialises', async () => {
    await inRollback(async () => {
      const id = await newAccount();
      // String(['postgres','nextjs']) === 'postgres,nextjs' — not JSON.
      expect(await tryApplyAsText(id, { technologies: 'postgres,nextjs' })).toBe('22P02');
    });
  });

  it('an empty technology list round-trips as an empty array', async () => {
    await inRollback(async () => {
      const id = await newAccount();
      expect(await applyAsText(id, { technologies: toAccountAttributes({ technologies: [] }).technologies })).toBe('ok');
      const { rows } = await db.query('SELECT technologies FROM public.prospect_accounts WHERE id=$1', [id]);
      expect(rows[0].technologies).toEqual([]);
    });
  });
});

describe('P2B — the normalisers never emit a value the constraints reject', () => {
  it('every value toAccountAttributes returns is storable', async () => {
    await inRollback(async () => {
      const id = await newAccount();
      // Deliberately hostile input: each field is something a provider might
      // really send. Whatever survives normalisation must be storable.
      const attrs = toAccountAttributes({
        annualRevenue: -5,          // refused by the normaliser
        foundedYear: 1_700_000_000, // a timestamp in the wrong field
        technologies: '{"a":1}',    // an object, not a list
        revenueBand: '   ',         // blank
        fundingStage: '  Series A  ',
        lastFundingAt: 'not-a-date',
      });
      expect(attrs.annualRevenue).toBeNull();
      expect(attrs.foundedYear).toBeNull();
      expect(attrs.technologies).toBeNull();
      expect(attrs.revenueBand).toBeNull();

      expect(await applyAsText(id, {
        annual_revenue: attrs.annualRevenue,
        founded_year: attrs.foundedYear,
        technologies: attrs.technologies,
        revenue_band: attrs.revenueBand,
        funding_stage: attrs.fundingStage,
        last_funding_at: attrs.lastFundingAt,
      })).toBe('ok');
    });
  });

  it('the database still refuses what the normaliser would have refused', async () => {
    await inRollback(async () => {
      const id = await newAccount();
      expect(await tryApplyAsText(id, { annual_revenue: '-1' })).toBe('23514');
      expect(await tryApplyAsText(id, { founded_year: '1799' })).toBe('23514');
      expect(await tryApplyAsText(id, { revenue_band: '   ' })).toBe('23514');
    });
  });
});

describe('P2B — tenant integrity is untouched', () => {
  it('firmographics do not let an account escape its tenant', async () => {
    await inRollback(async () => {
      const id = await newAccount();
      await applyAsText(id, { industry: 'SaaS', annual_revenue: '1' });
      const { rows } = await db.query(
        'SELECT organization_id FROM public.prospect_accounts WHERE id=$1', [id]);
      expect(rows[0].organization_id).toBe(ORG_A);
    });
  });
});
