/**
 * P2A — the prospect_accounts firmographic surface, against real PostgreSQL.
 *
 * The migration's value is entirely in what the DATABASE will accept, so these
 * tests exercise the real constraints rather than a double: that every column
 * is genuinely nullable, that the bounds reject what they claim to reject, and
 * that `technologies` refuses anything that is not an array.
 *
 * It also pins the boundary between P2A and LI-1 — the six columns LI-1 added
 * must still be present and must NOT have been redefined here.
 */
import { db, inRollback, seedTenants, ORG_A, attempt } from './setup';

const P2A_COLUMNS = ['annual_revenue', 'revenue_band', 'founded_year', 'technologies', 'funding_stage', 'last_funding_at'];
const LI1_COLUMNS = ['industry', 'employee_count', 'employee_band', 'country_code', 'region', 'city', 'description'];

/** A minimal account row. Identity columns only — firmographics are added per test. */
const insertAccount = (cols: Record<string, unknown> = {}) => {
  const base: Record<string, unknown> = {
    organization_id: ORG_A,
    domain_normalized: `p2a-${Math.abs(Number(String(Date.now()).slice(-9)))}.test`,
    name: 'P2A Account',
    source: 'manual',
    status: 'active',
  };
  const row = { ...base, ...cols };
  const keys = Object.keys(row);
  const params = keys.map((_, i) => `$${i + 1}`).join(',');
  return attempt(
    `INSERT INTO public.prospect_accounts (${keys.join(',')}) VALUES (${params})`,
    keys.map((k) => row[k]),
  );
};

beforeAll(seedTenants);

describe('P2A — the six columns exist and are typed', () => {
  it('every P2A column is present', async () => {
    const { rows } = await db.query(
      `SELECT attname FROM pg_attribute
        WHERE attrelid='public.prospect_accounts'::regclass AND NOT attisdropped AND attname = ANY($1)`,
      [P2A_COLUMNS],
    );
    expect(rows.map((r) => r.attname).sort()).toEqual([...P2A_COLUMNS].sort());
  });

  it('carries the declared types', async () => {
    const { rows } = await db.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='prospect_accounts' AND column_name = ANY($1)`,
      [P2A_COLUMNS],
    );
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
    expect(byName.annual_revenue).toBe('numeric');
    expect(byName.founded_year).toBe('integer');
    expect(byName.technologies).toBe('jsonb');
    expect(byName.last_funding_at).toBe('timestamp with time zone');
    expect(byName.revenue_band).toBe('text');
    expect(byName.funding_stage).toBe('text');
  });

  it('LI-1 columns survive untouched — P2A completed the surface, it did not replace it', async () => {
    const { rows } = await db.query(
      `SELECT attname FROM pg_attribute
        WHERE attrelid='public.prospect_accounts'::regclass AND NOT attisdropped AND attname = ANY($1)`,
      [LI1_COLUMNS],
    );
    expect(rows).toHaveLength(LI1_COLUMNS.length);
  });

  it('EVERY firmographic column is nullable — a provider need supply none of them', async () => {
    const { rows } = await db.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='prospect_accounts' AND column_name = ANY($1)`,
      [[...P2A_COLUMNS, ...LI1_COLUMNS]],
    );
    expect(rows.every((r) => r.is_nullable === 'YES')).toBe(true);
  });
});

describe('P2A — an account with no firmographics at all is legal', () => {
  it('inserts with every firmographic absent', async () => {
    await inRollback(async () => {
      expect(await insertAccount()).toBe('ok');
    });
  });

  it('accepts a fully-populated firmographic row', async () => {
    await inRollback(async () => {
      expect(await insertAccount({
        annual_revenue: 1250000.50,
        revenue_band: '$1M-$5M',
        founded_year: 2015,
        technologies: JSON.stringify(['postgres', 'nextjs']),
        funding_stage: 'Series B',
        last_funding_at: '2026-01-01T00:00:00Z',
      })).toBe('ok');
    });
  });
});

describe('P2A — the constraints reject what they claim to', () => {
  it('refuses a negative annual_revenue', async () => {
    await inRollback(async () => {
      expect(await insertAccount({ annual_revenue: -1 })).toBe('23514');
    });
  });

  it('accepts zero revenue — a real, stateable fact', async () => {
    await inRollback(async () => {
      expect(await insertAccount({ annual_revenue: 0 })).toBe('ok');
    });
  });

  it.each([[1799], [2201]])('refuses an out-of-range founded_year (%s)', async (year) => {
    await inRollback(async () => {
      expect(await insertAccount({ founded_year: year })).toBe('23514');
    });
  });

  it.each([[1800], [2200], [2026]])('accepts a plausible founded_year (%s)', async (year) => {
    await inRollback(async () => {
      expect(await insertAccount({ founded_year: year })).toBe('ok');
    });
  });

  it.each([['{}'], ['"postgres"'], ['42']])('refuses non-array technologies (%s)', async (bad) => {
    await inRollback(async () => {
      expect(await insertAccount({ technologies: bad })).toBe('23514');
    });
  });

  it('accepts an empty technology list — "we looked and found none" is a fact', async () => {
    await inRollback(async () => {
      expect(await insertAccount({ technologies: '[]' })).toBe('ok');
    });
  });

  it.each([['revenue_band'], ['funding_stage']])('refuses a blank %s', async (col) => {
    await inRollback(async () => {
      expect(await insertAccount({ [col]: '   ' })).toBe('23514');
    });
  });

  it('imposes NO vocabulary on revenue_band or funding_stage', async () => {
    // Deliberate: the repository has no canonical vocabulary, so any provider's
    // own label must be storable verbatim.
    await inRollback(async () => {
      expect(await insertAccount({ revenue_band: 'ARR 10-50M', funding_stage: 'bootstrapped' })).toBe('ok');
    });
  });
});

describe('P2A — indexes are tenant-first', () => {
  it('all four indexes exist', async () => {
    const { rows } = await db.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname = ANY($1)`,
      [['idx_prospect_accounts_org_industry', 'idx_prospect_accounts_org_employee_count',
        'idx_prospect_accounts_org_annual_revenue', 'idx_prospect_accounts_org_country']],
    );
    expect(rows).toHaveLength(4);
  });

  it('every new index leads with organization_id — the existing convention', async () => {
    const { rows } = await db.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname='public' AND indexname LIKE 'idx_prospect_accounts_org_%'`,
    );
    for (const r of rows) {
      expect(r.indexdef).toMatch(/\(organization_id/);
    }
  });

  it('the new attribute indexes are partial on NOT NULL', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname='public'
        AND indexname IN ('idx_prospect_accounts_org_industry','idx_prospect_accounts_org_annual_revenue')`,
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.indexdef).toMatch(/WHERE .* IS NOT NULL/);
  });
});

describe('P2A — tenant integrity is unchanged', () => {
  it('organization_id is still required', async () => {
    await inRollback(async () => {
      const code = await attempt(
        `INSERT INTO public.prospect_accounts (organization_id, name, source, status) VALUES (NULL,'x','manual','active')`,
      );
      expect(code).toBe('23502');
    });
  });

  it('a firmographic column introduces no new tenant path', async () => {
    const { rows } = await db.query(
      `SELECT count(*)::int n FROM information_schema.columns
        WHERE table_schema='public' AND table_name='prospect_accounts'
          AND column_name IN ('company_id','tenant_id')`,
    );
    expect(Number(rows[0].n)).toBe(0);
  });
});
