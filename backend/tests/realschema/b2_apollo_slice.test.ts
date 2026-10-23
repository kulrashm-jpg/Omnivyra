/**
 * B2 — the one-provider vertical slice against real PostgreSQL.
 *
 * The REAL executor, the REAL Apollo adapter, the REAL LI-2 persistence port and
 * the REAL B1b arbitration, writing to the REAL schema. The ONLY thing stubbed is
 * the network: `safeFetch` is mocked, so no Apollo key exists in this process and
 * nothing leaves it.
 *
 * What this proves that a unit test cannot: that a provider observation becomes a
 * `source_records` row, a `source_assertions` row, a canonical column value and a
 * `canonical_attribute_decisions` row — in one pass, under the ratified rules —
 * and that a cross-tenant attempt is refused by the database rather than by a
 * convention in application code.
 */

jest.mock('../../../lib/security/safeFetch', () => ({ safeFetch: jest.fn() }));

import { db, inRollback, seedTenants, ORG_A, ORG_B, newAccount } from './setup';

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const { db: client } = require('./setup') as { db: { query: Function } };
    type Filter = { col: string; op: 'eq' | 'is' | 'in'; val: unknown };
    const st = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete',
      cols: '*', payload: null as Record<string, unknown> | null,
      filters: [] as Filter[], order: null as { col: string; asc: boolean } | null,
      limit: null as number | null, mode: 'many' as 'many' | 'one',
    };
    const normalize = (row: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
      return out;
    };
    const where = (params: unknown[]): string => {
      if (st.filters.length === 0) return '';
      const parts = st.filters.map((f) => {
        if (f.op === 'is' && f.val === null) return `"${f.col}" IS NULL`;
        if (f.op === 'in') {
          const list = (f.val as unknown[]).map((v) => { params.push(v); return `$${params.length}`; });
          return `"${f.col}" IN (${list.join(', ')})`;
        }
        params.push(f.val);
        return `"${f.col}" = $${params.length}`;
      });
      return ` WHERE ${parts.join(' AND ')}`;
    };
    const exec = async () => {
      const params: unknown[] = [];
      let sql: string;
      if (st.op === 'insert') {
        const row = st.payload ?? {};
        const keys = Object.keys(row);
        const cols = keys.map((k) => `"${k}"`).join(', ');
        const vals = keys.map((k) => {
          params.push(row[k] !== null && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k]);
          return `$${params.length}`;
        }).join(', ');
        sql = `INSERT INTO public."${table}" (${cols}) VALUES (${vals}) RETURNING ${st.cols}`;
      } else if (st.op === 'update') {
        const row = st.payload ?? {};
        const sets = Object.keys(row).map((k) => {
          params.push(row[k] !== null && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k]);
          return `"${k}" = $${params.length}`;
        }).join(', ');
        sql = `UPDATE public."${table}" SET ${sets}${where(params)} RETURNING ${st.cols}`;
      } else if (st.op === 'delete') {
        sql = `DELETE FROM public."${table}"${where(params)} RETURNING ${st.cols}`;
      } else {
        sql = `SELECT ${st.cols} FROM public."${table}"${where(params)}`;
        if (st.order) sql += ` ORDER BY "${st.order.col}" ${st.order.asc ? 'ASC' : 'DESC'}`;
        if (st.limit !== null) sql += ` LIMIT ${st.limit}`;
      }
      await client.query('SAVEPOINT pg_adapter');
      try {
        const res = await client.query(sql, params) as { rows: unknown[] };
        await client.query('RELEASE SAVEPOINT pg_adapter');
        const out = (res.rows as Record<string, unknown>[]).map(normalize);
        if (st.mode === 'one') return { data: out[0] ?? null, error: null };
        return { data: out, error: null };
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT pg_adapter');
        return { data: null, error: err };
      }
    };
    const b: Record<string, unknown> = {
      select: (cols?: string) => { if (cols) st.cols = cols; return b; },
      insert: (row: Record<string, unknown>) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Record<string, unknown>) => { st.op = 'update'; st.payload = row; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (col: string, val: unknown) => { st.filters.push({ col, op: 'eq', val }); return b; },
      is: (col: string, val: unknown) => { st.filters.push({ col, op: 'is', val }); return b; },
      in: (col: string, val: unknown[]) => { st.filters.push({ col, op: 'in', val }); return b; },
      order: (col: string, opts?: { ascending?: boolean }) => {
        st.order = { col, asc: opts?.ascending !== false }; return b;
      },
      limit: (n: number) => { st.limit = n; return b; },
      single: () => { st.mode = 'one'; return b; },
      maybeSingle: () => { st.mode = 'one'; return b; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return b;
  },
}));

// Imported AFTER the mocks so the real code picks them up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { safeFetch } = require('../../../lib/security/safeFetch');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { executeEnrichment } = require('../../services/enrichment/providers/execute');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { apolloEnrichmentAdapter } = require('../../services/enrichment/providers/adapters/apollo');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { defaultPersistObservation } = require('../../services/enrichment/providers/persistence');

const fetchMock = safeFetch as jest.Mock;
const SECRET = 'synthetic-tenant-apollo-key';
const NOW = '2026-10-06T12:00:00.000Z';

const ok = (body: unknown) => ({
  ok: true, status: 200, headers: { get: () => null }, json: async () => body,
});

/** The production write path: LI-2's own port, unmodified. */
const ports = (over: Record<string, unknown> = {}) => ({
  async authorizeCost() { return { authorized: true, holdId: 'hold-1', cost: { currency: 'USD', amount: 0 } }; },
  async releaseCost() { /* nothing billable to release in these cases */ },
  async resolveCredential() { return SECRET; },
  async findRecentObservation() { return null; },          // suppression off: exercise the full chain
  persistObservation: defaultPersistObservation,            // REAL -> ingestSourceRecord -> B1b
  now() { return NOW; },
  ...over,
});

const enrich = (org: string, accountId: string, over: Record<string, unknown> = {}) =>
  executeEnrichment({
    organizationId: org,
    subject: 'account',
    entityId: accountId,
    attributes: ['employee_count'],
    selectors: { domain: 'example.com' },
    purpose: 'b2-slice',
    correlationId: 'corr-b2',
  }, 'apollo', ports(over), { adapter: apolloEnrichmentAdapter });

const countOf = async (accountId: string): Promise<number | null> => {
  const { rows } = await db.query(
    'SELECT employee_count FROM public.prospect_accounts WHERE id=$1', [accountId]);
  return rows[0]?.employee_count ?? null;
};

const assertionsFor = async (accountId: string) => {
  const { rows } = await db.query(
    `SELECT id, provider, normalized_value, raw_value, confidence, observed_at, recorded_at,
            superseded_at, applied_reason
       FROM public.source_assertions
      WHERE account_id=$1 AND attribute='employee_count'
      ORDER BY provider, normalized_value`, [accountId]);
  return rows as Array<Record<string, unknown>>;
};

const decisionsFor = async (accountId: string) => {
  const { rows } = await db.query(
    `SELECT value, reason, decided_at FROM public.canonical_attribute_decisions
      WHERE account_id=$1 ORDER BY decided_at, value`, [accountId]);
  return rows as Array<Record<string, unknown>>;
};

/** Evidence from some OTHER source, already on file. Inserted directly: it is the
 *  context for arbitration, not the thing under test. */
async function seedOtherEvidence(
  org: string, accountId: string, provider: string, value: string, observedAt: string | null,
): Promise<void> {
  const { createHash } = require('node:crypto');
  const sr = await db.query(
    `INSERT INTO public.source_records
       (organization_id, provider, source_entity_type, source_record_id, account_id, payload_hash)
     VALUES ($1,$2,'account',$3,$4,$5) RETURNING id`,
    [org, provider, `${provider}-rec`, accountId, createHash('sha256').update(provider).digest('hex')]);
  await db.query(
    `INSERT INTO public.source_assertions
       (organization_id, source_record_id, entity_type, account_id, attribute,
        raw_value, normalized_value, value_hash, provider, observed_at, recorded_at)
     VALUES ($1,$2,'account',$3,'employee_count',$4,$4,$5,$6,$7,'2026-09-01T00:00:00Z')`,
    [org, sr.rows[0].id, accountId, value,
      createHash('sha256').update(value).digest('hex'), provider, observedAt]);
}

beforeAll(async () => { await seedTenants(); });
beforeEach(() => { fetchMock.mockReset(); });

// ════════════════════════════════════════════════════════════════════════════
describe('B2 — provider evidence reaches canonical through the assertion path', () => {
  it('Case A — an empty canonical attribute is populated, with full provenance', async () => {
    await inRollback(async () => {
      const acc = await newAccount(ORG_A, { domain: 'example.com' });
      fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));

      const result = await enrich(ORG_A, acc);

      expect(result.outcome).toBe('enriched');
      expect(result.providerCalled).toBe(true);
      expect(result.sourceRecordId).toBeTruthy();
      expect(await countOf(acc)).toBe(4200);

      // The evidence, with nothing manufactured.
      const assertions = await assertionsFor(acc);
      expect(assertions).toHaveLength(1);
      expect(assertions[0].provider).toBe('apollo');
      expect(assertions[0].normalized_value).toBe('4200');
      expect(assertions[0].confidence).toBeNull();         // Apollo states none
      expect(assertions[0].observed_at).toBeNull();        // Apollo states none
      expect(assertions[0].recorded_at).not.toBeNull();    // D-1's fallback
      expect(assertions[0].applied_reason).toBe('single_uncontested_assertion');

      // The decision, appended once.
      const decisions = await decisionsFor(acc);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({ value: '4200', reason: 'single_uncontested_assertion' });

      // The raw payload is retained on the source record.
      const { rows } = await db.query(
        'SELECT raw_payload, provider FROM public.source_records WHERE id=$1', [result.sourceRecordId]);
      expect(rows[0].provider).toBe('apollo');
      expect(rows[0].raw_payload).toBeTruthy();
    });
  });

  it('Case B — the provider LOSES to newer evidence, and its claim is still retained', async () => {
    await inRollback(async () => {
      const acc = await newAccount(ORG_A, { domain: 'example.com' });
      // Another source observed 5100 LATER than this Apollo call will be recorded.
      await seedOtherEvidence(ORG_A, acc, 'crm', '5100', '2026-12-01T00:00:00Z');
      await db.query('UPDATE public.prospect_accounts SET employee_count=5100 WHERE id=$1', [acc]);

      fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));
      const result = await enrich(ORG_A, acc);

      expect(result.outcome).toBe('enriched');          // the CALL succeeded
      expect(await countOf(acc)).toBe(5100);            // but canonical did not move
      // Apollo's losing claim is live evidence, not a discarded one.
      const apollo = (await assertionsFor(acc)).find((a) => a.provider === 'apollo')!;
      expect(apollo.normalized_value).toBe('4200');
      expect(apollo.superseded_at).toBeNull();
      expect(apollo.applied_reason).toBeNull();          // it never became canonical
      expect(await decisionsFor(acc)).toHaveLength(0);
    });
  });

  it('Case C — the provider CORRECTS a stale but attested canonical value', async () => {
    await inRollback(async () => {
      const acc = await newAccount(ORG_A, { domain: 'example.com' });
      // An old CSV observation, and canonical agrees with it: attested.
      await seedOtherEvidence(ORG_A, acc, 'csv', '900', '2026-01-01T00:00:00Z');
      await db.query('UPDATE public.prospect_accounts SET employee_count=900 WHERE id=$1', [acc]);

      fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));
      const result = await enrich(ORG_A, acc);

      expect(result.outcome).toBe('enriched');
      expect(await countOf(acc)).toBe(4200);            // corrected
      // D-1's fallback did the work: Apollo supplied no observed_at, so its
      // recorded_at competed with the CSV's observation date and was newer.
      const decisions = await decisionsFor(acc);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({ value: '4200', reason: 'newest_observation' });
      // The superseded belief is still on file.
      const csv = (await assertionsFor(acc)).find((a) => a.provider === 'csv')!;
      expect(csv.normalized_value).toBe('900');
      expect(csv.superseded_at).toBeNull();             // a loser is not superseded
    });
  });

  it('Case D — a genuinely unattested incumbent is NOT overwritten', async () => {
    await inRollback(async () => {
      const acc = await newAccount(ORG_A, { domain: 'example.com' });
      await db.query('UPDATE public.prospect_accounts SET employee_count=777 WHERE id=$1', [acc]);

      fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));
      const result = await enrich(ORG_A, acc);

      expect(result.outcome).toBe('enriched');
      expect(result.canonicalWithheld).toEqual([
        { attribute: 'employee_count', reason: 'unattested_incumbent' },
      ]);
      expect(await countOf(acc)).toBe(777);
      expect(await decisionsFor(acc)).toHaveLength(0);
      // Refusing to write is not refusing to record.
      expect(await assertionsFor(acc)).toHaveLength(1);
    });
  });

  it('Case E — identical provider evidence creates no duplicate assertion or decision', async () => {
    await inRollback(async () => {
      const acc = await newAccount(ORG_A, { domain: 'example.com' });
      fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));

      const first = await enrich(ORG_A, acc);
      const second = await enrich(ORG_A, acc);

      expect(first.outcome).toBe('enriched');
      expect(second.outcome).toBe('enriched');
      expect(await countOf(acc)).toBe(4200);
      expect(await assertionsFor(acc)).toHaveLength(1);   // ONE assertion
      expect(await decisionsFor(acc)).toHaveLength(1);    // ONE decision
      // The source record was re-observed rather than duplicated.
      const { rows } = await db.query(
        `SELECT count(*)::int n, max(observation_count) obs FROM public.source_records
          WHERE organization_id=$1 AND provider='apollo'`, [ORG_A]);
      expect(rows[0].n).toBe(1);
      expect(Number(rows[0].obs)).toBeGreaterThan(1);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('B2 — tenant isolation is enforced by the database, not by convention', () => {
  it('a provider result cannot attach to another tenants account', async () => {
    await inRollback(async () => {
      const accB = await newAccount(ORG_B, { domain: 'example.com' });
      fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));

      // ORG_A enriches, naming ORG_B's account. The composite tenant FK on
      // source_records refuses the evidence insert, so nothing lands anywhere.
      let threw: unknown = null;
      try { await enrich(ORG_A, accB); } catch (e) { threw = e; }

      expect(String(threw)).toMatch(/23503|foreign key/i);
      expect(await countOf(accB)).toBeNull();
      expect(await assertionsFor(accB)).toHaveLength(0);
      expect(await decisionsFor(accB)).toHaveLength(0);
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.source_records WHERE organization_id=$1`, [ORG_A]);
      expect(rows[0].n).toBe(0);
    });
  });

  it('two tenants enriching the same domain stay completely separate', async () => {
    await inRollback(async () => {
      const accA = await newAccount(ORG_A, { domain: 'example.com' });
      const accB = await newAccount(ORG_B, { domain: 'example.com' });
      fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));

      await enrich(ORG_A, accA);
      fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 9999 } }));
      await enrich(ORG_B, accB);

      expect(await countOf(accA)).toBe(4200);
      expect(await countOf(accB)).toBe(9999);
      // The same provider record id in two tenants is two independent rows.
      const { rows } = await db.query(
        `SELECT organization_id, count(*)::int n FROM public.source_records
          WHERE provider='apollo' GROUP BY organization_id ORDER BY organization_id`);
      expect(rows).toHaveLength(2);
      for (const r of rows as any[]) expect(r.n).toBe(1);
    });
  });

  it('Drishiq Labs is an ordinary tenant — no identity receives special handling', () => {
    // The slice contains no tenant literal at all: isolation is structural, so
    // there is nowhere for an exemption to live.
    const fs = require('fs');
    const path = require('path');
    for (const file of [
      'services/enrichment/providers/execute.ts',
      'services/enrichment/providers/persistence.ts',
      'services/enrichment/providers/adapters/apollo.ts',
      'services/prospectIdentity/ingestionBoundary.ts',
      'services/prospectIdentity/attributeAuthority.ts',
    ]) {
      const src = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
      expect(src).not.toMatch(/drishiq/i);
      expect(src).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/);
    }
  });
});
