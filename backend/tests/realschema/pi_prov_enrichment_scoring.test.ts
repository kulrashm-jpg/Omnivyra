/**
 * Closure C on real PostgreSQL — enrichment refresh/applicability and score
 * availability (NULL = unscored, 0 = scored zero), migration
 * 20270109000002_pi_qualification_score_nullable.sql.
 *
 * Real: PostgreSQL, the contribution writer, the LI-2 boundary, the CRM
 * importer's canonical writes, the enrichment applicability readers, and the
 * pure readers (adapters, stats, export, report plugin, audience) fed rows read
 * back from PostgreSQL.
 *
 * Stubbed: the DB transport (`db/supabaseClient` + `db/writeOwner` → the same
 * PostgREST-builder → SQL translator the acceptance suite uses, extended for the
 * `alias:col->key` JSON-path select), side services the CRM importer calls that
 * are not under test (identity resolution returns a fixture person,
 * touchpoints, unified ingestion, provider governor, lead adoption), and the
 * lead plugin's two data ports.
 *
 * A green run here concerns a disposable database built from the committed
 * baseline plus replayed migrations. It is NOT evidence about production.
 */

jest.mock('../../db/supabaseClient', () => {
  type Row = Record<string, unknown>;
  type Filter =
    | { kind: 'cmp'; col: string; op: string; val: unknown }
    | { kind: 'isnull'; col: string; not: boolean }
    | { kind: 'isbool'; col: string; val: boolean }
    | { kind: 'in'; col: string; val: unknown[] }
    | { kind: 'contains'; col: string; val: unknown };
  const pg = () => (require('./setup') as { db: { query: (s: string, p?: unknown[]) => Promise<any> } }).db;

  // Serialise every statement: a SAVEPOINT released out of order would also
  // release a later one, so two in-flight builders must never interleave.
  let lock: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = lock.then(fn, fn);
    lock = p.catch(() => undefined);
    return p;
  };
  let sp = 0;
  const run = (sql: string, params: unknown[]) => serial(async () => {
    const name = `ccs_sp_${++sp}`;
    await pg().query(`SAVEPOINT ${name}`);
    try {
      const res = await pg().query(sql, params);
      await pg().query(`RELEASE SAVEPOINT ${name}`);
      return { res, error: null as null | Row };
    } catch (e: any) {
      await pg().query(`ROLLBACK TO SAVEPOINT ${name}`);
      return {
        res: null as any,
        error: { code: String(e?.code ?? 'unknown'), message: String(e?.message ?? e), details: e?.detail ?? null, hint: e?.hint ?? null },
      };
    }
  });

  const typeCache = new Map<string, Map<string, string>>();
  const colTypes = async (table: string): Promise<Map<string, string>> => {
    const hit = typeCache.get(table);
    if (hit) return hit;
    const r = await run(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table]);
    const m = new Map<string, string>((r.res?.rows ?? []).map((x: Row) => [String(x.column_name), String(x.data_type)]));
    typeCache.set(table, m);
    return m;
  };
  const render = (types: Map<string, string>, col: string, v: unknown): unknown => {
    if (v === null || v === undefined) return null;
    const t = types.get(col) ?? '';
    if (t === 'jsonb' || t === 'json') return JSON.stringify(v);
    if (t === 'ARRAY') return v;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  };
  // PostgREST returns numeric/int8 as JSON numbers and timestamptz as strings.
  const normalize = (fields: Array<{ name: string; dataTypeID: number }>, row: Row): Row => {
    const numeric = new Set(fields.filter((f) => f.dataTypeID === 1700 || f.dataTypeID === 20).map((f) => f.name));
    const out: Row = {};
    for (const [k, v] of Object.entries(row)) {
      if (v instanceof Date) out[k] = v.toISOString();
      else if (numeric.has(k) && typeof v === 'string') out[k] = Number(v);
      else out[k] = v;
    }
    return out;
  };
  // closure C extension: PostgREST's `alias:col->key` JSON-path select (used by
  // listProspects for the scoring marker) is rendered as `"col"->'key' AS "alias"`.
  const cols = (s: string): string => {
    const t = s.trim();
    if (!t || t === '*') return '*';
    if (t.includes('(')) throw new Error(`translator: embedded resources are not supported: ${t}`);
    return t.split(',').map((c) => {
      const m = c.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*):([a-z_][a-z0-9_]*)->([a-zA-Z_][a-zA-Z0-9_]*)$/);
      return m ? `"${m[2]}"->'${m[3]}' AS "${m[1]}"` : `"${c.trim()}"`;
    }).join(', ');
  };

  function from(table: string) {
    const st = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete' | 'upsert',
      selectCols: '*', selected: false,
      payload: null as Row | Row[] | null,
      onConflict: null as string | null, ignoreDuplicates: false,
      filters: [] as Filter[],
      order: [] as Array<{ col: string; asc: boolean }>,
      limit: null as number | null,
      offset: null as number | null,
      mode: 'many' as 'many' | 'single' | 'maybe',
    };
    const where = (types: Map<string, string>, params: unknown[]): string => {
      if (!st.filters.length) return '';
      return ` WHERE ${st.filters.map((f) => {
        if (f.kind === 'isnull') return `"${f.col}" IS ${f.not ? 'NOT ' : ''}NULL`;
        if (f.kind === 'isbool') return `"${f.col}" IS ${f.val ? 'TRUE' : 'FALSE'}`;
        if (f.kind === 'in') { params.push(f.val); return `"${f.col}" = ANY($${params.length})`; }
        if (f.kind === 'contains') {
          const t = types.get(f.col) ?? '';
          params.push(t === 'ARRAY' ? f.val : JSON.stringify(f.val));
          return `"${f.col}" @> $${params.length}${t === 'ARRAY' ? '' : '::jsonb'}`;
        }
        params.push(f.val);
        return `"${f.col}" ${f.op} $${params.length}`;
      }).join(' AND ')}`;
    };
    const exec = async (): Promise<{ data: unknown; error: unknown }> => {
      const types = await colTypes(table);
      const params: unknown[] = [];
      let sql: string;
      const returning = ` RETURNING ${cols(st.selectCols)}`;
      if (st.op === 'insert' || st.op === 'upsert') {
        const rows = Array.isArray(st.payload) ? st.payload : [st.payload ?? {}];
        const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
        const values = rows.map((r) => `(${keys.map((k) => {
          if (!(k in r)) return 'DEFAULT';
          params.push(render(types, k, r[k])); return `$${params.length}`;
        }).join(', ')})`).join(', ');
        sql = `INSERT INTO public."${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES ${values}`;
        if (st.op === 'upsert') {
          const target = st.onConflict ? `(${st.onConflict.split(',').map((c) => `"${c.trim()}"`).join(', ')})` : '';
          sql += st.ignoreDuplicates
            ? ` ON CONFLICT ${target} DO NOTHING`
            : ` ON CONFLICT ${target} DO UPDATE SET ${keys.map((k) => `"${k}" = EXCLUDED."${k}"`).join(', ')}`;
        }
        sql += returning;
      } else if (st.op === 'update') {
        const row = (st.payload ?? {}) as Row;
        const sets = Object.keys(row).map((k) => { params.push(render(types, k, row[k])); return `"${k}" = $${params.length}`; });
        sql = `UPDATE public."${table}" SET ${sets.join(', ')}${where(types, params)}${returning}`;
      } else if (st.op === 'delete') {
        sql = `DELETE FROM public."${table}"${where(types, params)}${returning}`;
      } else {
        sql = `SELECT ${cols(st.selectCols)} FROM public."${table}"${where(types, params)}`;
        if (st.order.length) sql += ` ORDER BY ${st.order.map((o) => `"${o.col}" ${o.asc ? 'ASC' : 'DESC'}`).join(', ')}`;
        if (st.limit !== null) sql += ` LIMIT ${st.limit}`;
        if (st.offset !== null) sql += ` OFFSET ${st.offset}`;
      }
      const r = await run(sql, params);
      if (r.error) return { data: null, error: r.error };
      const rows = (r.res.rows as Row[]).map((x) => normalize(r.res.fields, x));
      if (st.op !== 'select' && !st.selected) return { data: null, error: null };
      if (st.mode === 'many') return { data: rows, error: null };
      if (rows.length > 1 || (st.mode === 'single' && rows.length === 0)) {
        return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `${rows.length} rows`, hint: null } };
      }
      return { data: rows[0] ?? null, error: null };
    };
    const b: Record<string, unknown> = {
      select: (c?: string) => { st.selected = true; if (typeof c === 'string') st.selectCols = c; return b; },
      insert: (p: Row | Row[]) => { st.op = 'insert'; st.payload = p; return b; },
      upsert: (p: Row | Row[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        st.op = 'upsert'; st.payload = p; st.onConflict = o?.onConflict ?? null; st.ignoreDuplicates = !!o?.ignoreDuplicates; return b;
      },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (c: string, v: unknown) => { st.filters.push({ kind: 'cmp', col: c, op: '=', val: v }); return b; },
      neq: (c: string, v: unknown) => { st.filters.push({ kind: 'cmp', col: c, op: '<>', val: v }); return b; },
      gt: (c: string, v: unknown) => { st.filters.push({ kind: 'cmp', col: c, op: '>', val: v }); return b; },
      gte: (c: string, v: unknown) => { st.filters.push({ kind: 'cmp', col: c, op: '>=', val: v }); return b; },
      lt: (c: string, v: unknown) => { st.filters.push({ kind: 'cmp', col: c, op: '<', val: v }); return b; },
      lte: (c: string, v: unknown) => { st.filters.push({ kind: 'cmp', col: c, op: '<=', val: v }); return b; },
      is: (c: string, v: unknown) => {
        if (v === null) st.filters.push({ kind: 'isnull', col: c, not: false });
        else if (typeof v === 'boolean') st.filters.push({ kind: 'isbool', col: c, val: v });
        else throw new Error(`translator: is(${c}, ${String(v)}) unsupported`);
        return b;
      },
      not: (c: string, op: string, v: unknown) => {
        if (op === 'is' && v === null) { st.filters.push({ kind: 'isnull', col: c, not: true }); return b; }
        if (op === 'eq') { st.filters.push({ kind: 'cmp', col: c, op: '<>', val: v }); return b; }
        throw new Error(`translator: not(${c}, ${op}) unsupported`);
      },
      in: (c: string, v: unknown[]) => { st.filters.push({ kind: 'in', col: c, val: v }); return b; },
      contains: (c: string, v: unknown) => { st.filters.push({ kind: 'contains', col: c, val: v }); return b; },
      order: (c: string, o?: { ascending?: boolean }) => { st.order.push({ col: c, asc: o?.ascending !== false }); return b; },
      limit: (n: number) => { st.limit = n; return b; },
      // closure C extension: listProspects pages with .range(from, to).
      range: (from: number, to: number) => { st.offset = from; st.limit = to - from + 1; return b; },
      single: () => { st.mode = 'single'; return b; },
      maybeSingle: () => { st.mode = 'maybe'; return b; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return new Proxy(b, {
      get(target, prop) {
        if (prop in target) return (target as any)[prop];
        if (typeof prop === 'symbol') return undefined;
        throw new Error(`translator: builder method .${String(prop)}() is not supported (table ${table})`);
      },
    });
  }

  async function rpc(fn: string, args: Record<string, unknown>) {
    const keys = Object.keys(args);
    const params = keys.map((k) => { const v = args[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; });
    const r = await run(`SELECT public."${fn}"(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS result`, params);
    if (r.error) return { data: null, error: r.error };
    return { data: r.res.rows[0]?.result ?? null, error: null };
  }

  return {
    __esModule: true,
    supabase: { from, rpc },
    getDbConnectionDiagnostics: () => ({ mode: 'direct', poolerConfigured: false }),
  };
});

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => require('../../db/supabaseClient').supabase.from(table),
  ownedDbRpc: (fn: string, args: Record<string, unknown>) => require('../../db/supabaseClient').supabase.rpc(fn, args),
}));

const fixturePerson = { id: '' };
jest.mock('../../services/identityResolutionService', () => ({
  resolveUnifiedPerson: jest.fn(async () => ({ unifiedPersonId: fixturePerson.id, matchedBy: 'email' })),
}));
jest.mock('../../services/providers/providerCostGovernor', () => ({
  authorizeProviderCall: () => ({ allowed: true }),
  recordProviderUsage: () => undefined,
}));
jest.mock('../../services/touchpointService', () => ({ bulkCreateTouchpoints: async () => ({ created: 0 }) }));
jest.mock('../../services/unifiedIngestionService', () => ({ ingestUnifiedData: async () => ({}) }));
jest.mock('../../services/leadIntelligence/leadIntelligenceRuntime', () => ({ adoptLead: jest.fn() }));
// listProspects' module imports the enrichment execution chain, which reaches a
// `@/config` alias the realschema jest project does not map; never called here.
jest.mock('../../auth/credentialEncryption', () => ({}));
const getLeadStats = jest.fn();
jest.mock('../../services/leadIntelligence/leadIntelligenceReadService', () => ({ getLeadStats: (...a: unknown[]) => getLeadStats(...a) }));
jest.mock('../../services/activationReadinessService', () => ({
  buildActivationReadiness: jest.fn(async () => ({ companyId: 'x', activated: true, generatedAt: '2026-10-30T00:00:00Z', checks: [] })),
}));

import { db, inRollback, seedTenants, attempt, newPerson, newAccount, newLead, ORG_A, ORG_B } from './setup';
import { ingestCrmData } from '../../services/crmIngestionService';
import { recordEnrichmentContribution } from '../../services/prospectProvenance/ingestion/enrichmentContribution';
import { recordSourceContribution } from '../../services/prospectProvenance/contributionWriter';
import { listProspects } from '../../apiHandlers/prospects/prospectIntelligenceRead';
import { projectExistingRow } from '../../../lib/leadIntelligence/readModel';
import { computeLeadStats } from '../../../lib/leadIntelligence';
import { toExportRow, EXPORT_NOT_SCORED } from '../../../lib/leadIntelligence/export';
import { leadPlugin } from '../../services/leadIntelligence/leadIntelligenceSnapshotAdapter';
import { buildAudienceIntelligence } from '../../services/audience/audienceService';
import { QUALIFICATION_SCORE_MARKER } from '../../../lib/prospectProvenance/scoreSemantics';

const q = (sql: string, p: unknown[] = []) => db.query(sql, p);
const contributionsOf = async (org: string, lead: string) =>
  (await q(`SELECT * FROM public.prospect_source_contributions WHERE organization_id=$1 AND canonical_lead_id=$2 ORDER BY created_at, external_ref`, [org, lead])).rows;

async function sourceRecord(org: string, rid: string, opts: { accountId?: string | null; personId?: string | null; entity?: string } = {}): Promise<string> {
  const { rows } = await q(
    `INSERT INTO public.source_records (organization_id, provider, source_entity_type, source_record_id, payload_hash, account_id, person_id)
     VALUES ($1,'ccs-test',$2,$3,repeat('c',64),$4,$5) RETURNING id`,
    [org, opts.entity ?? 'person', rid, opts.accountId ?? null, opts.personId ?? null]);
  return rows[0].id;
}
async function originate(org: string, lead: string, sr: string, ref: string): Promise<void> {
  const out = await recordSourceContribution({
    organizationId: org, canonicalLeadId: lead, leadCreated: true, sourceCategory: 'pi_discovery',
    externalRef: ref, sourceRecordId: sr, platform: 'apollo', observedAt: '2026-08-01T00:00:00Z',
  });
  expect(out).toMatchObject({ status: 'inserted', role: 'originating' });
}

// ═══════════════════════════════════════════════════════════════════════════
describe('migration 20270109000002 — column behaves as designed on real PG', () => {
  it('qualification_score is numeric(5,2), nullable, with no default; the 0..100 CHECK is kept', async () => {
    const { rows } = await q(`SELECT is_nullable, column_default, numeric_precision, numeric_scale
                                FROM information_schema.columns
                               WHERE table_schema='public' AND table_name='canonical_leads' AND column_name='qualification_score'`);
    expect(rows[0]).toEqual({ is_nullable: 'YES', column_default: null, numeric_precision: 5, numeric_scale: 2 });
    const chk = await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='canonical_leads_qualification_score_valid'`);
    expect(chk.rows[0].d).toMatch(/qualification_score >= \(0\)::numeric.*qualification_score <= \(100\)::numeric/);
  });

  it('an INSERT that omits the score stores NULL; 0 and 100 store; -1 / 100.01 are refused (23514)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A, { source: 'ccs' });
      expect((await q(`SELECT qualification_score FROM public.canonical_leads WHERE id=$1`, [lead])).rows[0].qualification_score).toBeNull();
      expect(await attempt(`UPDATE public.canonical_leads SET qualification_score = 0 WHERE id=$1`, [lead])).toBe('ok');
      expect(await attempt(`UPDATE public.canonical_leads SET qualification_score = 100 WHERE id=$1`, [lead])).toBe('ok');
      expect(await attempt(`UPDATE public.canonical_leads SET qualification_score = NULL WHERE id=$1`, [lead])).toBe('ok');
      expect(await attempt(`UPDATE public.canonical_leads SET qualification_score = -1 WHERE id=$1`, [lead])).toBe('23514');
      expect(await attempt(`UPDATE public.canonical_leads SET qualification_score = 100.01 WHERE id=$1`, [lead])).toBe('23514');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CRM resync — attribution preserved, unscored written as NULL', () => {
  it('scored on first sync, unscored on resync: source/created_at/lead_metadata/originating untouched, score NULL (not 0)', async () => {
    await inRollback(async () => {
      await seedTenants();
      fixturePerson.id = await newPerson(ORG_A);
      const row = { externalId: 'CCS-CRM-1', name: 'Ada', email: 'ada@example.com', source: 'webinar', status: 'open',
        // revenue 0: scored by the CRM rule (floor 40) without the revenue-event write path (revenue > 0 only).
        createdAt: '2026-08-01T00:00:00.000Z', metadata: { first: 'evidence' }, revenue: 0 };
      await ingestCrmData({ companyId: ORG_A, rows: [row] } as never);
      const [lead0] = (await q(`SELECT * FROM public.canonical_leads WHERE company_id=$1`, [ORG_A])).rows;
      expect(Number(lead0.qualification_score)).toBe(40);
      const orig0 = await contributionsOf(ORG_A, lead0.id);
      expect(orig0).toHaveLength(1);
      expect(orig0[0]).toMatchObject({ contribution_role: 'originating', source_category: 'crm', external_ref: 'crm:CCS-CRM-1' });

      for (const i of [1, 2]) {
        await ingestCrmData({ companyId: ORG_A, rows: [{ ...row, revenue: null, source: `channel-${i}`, status: `s-${i}`,
          createdAt: `2026-09-0${i}T00:00:00.000Z`, metadata: { overwritten: i } }] } as never);
      }
      const leads = (await q(`SELECT * FROM public.canonical_leads WHERE company_id=$1`, [ORG_A])).rows;
      expect(leads).toHaveLength(1);
      const lead = leads[0];
      expect(lead.qualification_score).toBeNull();                        // unscored, NOT 0, NOT the stale 40
      expect(lead.lead_status).toBe('s-2');
      expect({ source: lead.source, created_at: lead.created_at.toISOString(), lead_metadata: lead.lead_metadata, person: lead.unified_person_id })
        .toEqual({ source: lead0.source, created_at: lead0.created_at.toISOString(), lead_metadata: lead0.lead_metadata, person: lead0.unified_person_id });
      const after = await contributionsOf(ORG_A, lead.id);
      expect(after).toHaveLength(1);                                        // a resync of the same CRM record is one event
      expect(after[0]).toEqual(orig0[0]);
    });
  });

  it('a first sync with no revenue writes NULL (the column is omitted; no default)', async () => {
    await inRollback(async () => {
      await seedTenants();
      fixturePerson.id = await newPerson(ORG_A);
      await ingestCrmData({ companyId: ORG_A, rows: [{ externalId: 'CCS-CRM-2', email: 'b@example.com', source: 'crm', status: 'open' }] } as never);
      const [lead] = (await q(`SELECT qualification_score FROM public.canonical_leads WHERE company_id=$1`, [ORG_A])).rows;
      expect(lead.qualification_score).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('enrichment refresh — content-addressed, idempotent, never an originator', () => {
  const base = { providerId: 'apollo', subject: 'person' as const, observedAt: null, ingestedAt: '2026-10-30T00:00:00.000Z', attributes: ['job_title'] };

  it('identical refresh ⇒ 1 contributing row; changed ⇒ a 2nd; originating + canonical_leads untouched', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const lead = await newLead(ORG_A, { source: 'apollo', personId: person });
      await originate(ORG_A, lead, await sourceRecord(ORG_A, 'disc-1', { personId: person }), 'apollo:ccs-ap-1');
      const leadBefore = (await q(`SELECT source, created_at, lead_metadata, qualification_score FROM public.canonical_leads WHERE id=$1`, [lead])).rows[0];
      const origBefore = (await contributionsOf(ORG_A, lead))[0];
      const enrSr = await sourceRecord(ORG_A, `apollo:person:${person}`, { personId: person });
      const call = (title: string, corr: string) => recordEnrichmentContribution({
        ...base, organizationId: ORG_A, entityId: person, prospectId: lead, sourceRecordId: enrSr, correlationId: corr,
        payloadHash: `h-${corr}`, observedValues: [{ subject: 'person', attribute: 'job_title', value: title }],
      });

      expect(await call('CTO', 'r1')).toMatchObject({ status: 'inserted', role: 'contributing' });
      expect(await call('  cto ', 'r2')).toEqual({ status: 'duplicate', role: null });
      expect((await contributionsOf(ORG_A, lead))).toHaveLength(2);
      expect(await call('VP Engineering', 'r3')).toMatchObject({ status: 'inserted', role: 'contributing' });

      const c = await contributionsOf(ORG_A, lead);
      expect(c).toHaveLength(3);
      expect(c.filter((r: any) => r.contribution_role === 'originating')).toEqual([origBefore]);
      const enr = c.filter((r: any) => r.source_category === 'pi_enrichment');
      expect(enr).toHaveLength(2);
      for (const r of enr) {
        expect(r).toMatchObject({ contribution_role: 'contributing', platform: 'apollo', source_record_id: enrSr });
        expect(r.external_ref).toMatch(new RegExp(`^enrichment_apollo:person:${person}:[0-9a-f]{16}$`));
        expect(r.evidence).toMatchObject({ evidenceLevel: 'person', personId: person, accountId: null });
        expect(JSON.stringify(r.evidence)).not.toMatch(/cto|vp engineering/i);
      }
      expect(new Set(enr.map((r: any) => r.external_ref)).size).toBe(2);
      expect((await q(`SELECT source, created_at, lead_metadata, qualification_score FROM public.canonical_leads WHERE id=$1`, [lead])).rows[0]).toEqual(leadBefore);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('account applicability — evidenced only, marked account-level', () => {
  it('fan-out reaches evidenced prospects only; unrelated + other-tenant + ended-relationship prospects get nothing', async () => {
    await inRollback(async () => {
      await seedTenants();
      const acct = await newAccount(ORG_A, { domain: 'acme.example' });
      const other = await newAccount(ORG_A, { domain: 'other.example' });
      const acctB = await newAccount(ORG_B, { domain: 'acme-b.example' });

      // (1) linked by its person's primary account
      const p1 = await newPerson(ORG_A);
      await q(`UPDATE public.unified_persons SET account_id=$1 WHERE id=$2`, [acct, p1]);
      const l1 = await newLead(ORG_A, { source: 'apollo', personId: p1 });
      // (2) account-only prospect: its ORIGINATING source record names the account
      const l2 = await newLead(ORG_A, { source: 'apollo' });
      await originate(ORG_A, l2, await sourceRecord(ORG_A, 'acc-only', { entity: 'account', accountId: acct }), 'apollo:ccs-acc-only');
      // (3) current relationship
      const p3 = await newPerson(ORG_A);
      await q(`INSERT INTO public.person_account_relationships (organization_id, person_id, account_id) VALUES ($1,$2,$3)`, [ORG_A, p3, acct]);
      const l3 = await newLead(ORG_A, { source: 'csv', personId: p3 });
      // unrelated: another company, plus an ENDED relationship with acct
      const pu = await newPerson(ORG_A);
      await q(`UPDATE public.unified_persons SET account_id=$1 WHERE id=$2`, [other, pu]);
      await q(`INSERT INTO public.person_account_relationships (organization_id, person_id, account_id, started_at, ended_at)
               VALUES ($1,$2,$3,'2024-01-01','2025-01-01')`, [ORG_A, pu, acct]);
      const lu = await newLead(ORG_A, { source: 'csv', personId: pu });
      // other tenant
      const pb = await newPerson(ORG_B);
      await q(`UPDATE public.unified_persons SET account_id=$1 WHERE id=$2`, [acctB, pb]);
      const lb = await newLead(ORG_B, { source: 'csv', personId: pb });

      const enrSr = await sourceRecord(ORG_A, `apollo:account:${acct}`, { entity: 'account', accountId: acct });
      const input = {
        organizationId: ORG_A, providerId: 'apollo', subject: 'account' as const, entityId: acct, sourceRecordId: enrSr,
        observedAt: null, ingestedAt: '2026-10-30T00:00:00.000Z', attributes: ['employee_count'],
        observedValues: [{ subject: 'account' as const, attribute: 'employee_count', value: 120 }],
      };
      const out = await recordEnrichmentContribution(input);
      expect(out).toMatchObject({ status: 'fanout' });

      const rows = (await q(`SELECT canonical_lead_id, contribution_role, evidence FROM public.prospect_source_contributions
                              WHERE source_category='pi_enrichment'`)).rows;
      const byLead = new Map<string, any>(rows.map((r: any) => [r.canonical_lead_id, r]));
      expect(new Set(byLead.keys())).toEqual(new Set([l1, l2, l3]));
      expect(byLead.get(l1).evidence.accountLink).toBe('person_primary_account');
      expect(byLead.get(l2).evidence.accountLink).toBe('originating_source_record');
      expect(byLead.get(l3).evidence.accountLink).toBe('person_account_relationship');
      for (const r of rows) {
        expect(r.contribution_role).toBe('contributing');
        expect(r.evidence).toMatchObject({ subject: 'account', evidenceLevel: 'account', accountId: acct, personId: null });
      }
      expect(byLead.has(lu)).toBe(false);
      expect(byLead.has(lb)).toBe(false);

      // Caller-given unrelated prospect is refused; the repeat fan-out is idempotent.
      expect(await recordEnrichmentContribution({ ...input, prospectId: lu })).toEqual({ status: 'skipped', reason: 'account_link_unevidenced' });
      const again = await recordEnrichmentContribution(input) as any;
      expect(again.targets.map((t: any) => t.outcome.status)).toEqual(['duplicate', 'duplicate', 'duplicate']);
      expect((await q(`SELECT count(*)::int n FROM public.prospect_source_contributions WHERE source_category='pi_enrichment'`)).rows[0].n).toBe(3);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('NULL vs genuine 0, end to end from real rows', () => {
  it('reader (listProspects), view score parts, stats bands, export, report plugin, audience', async () => {
    await inRollback(async () => {
      await seedTenants();
      const unscored = await newLead(ORG_A, { source: 'crm' });                       // NULL (no default)
      const legacy = await newLead(ORG_A, { source: 'crm' });
      await q(`UPDATE public.canonical_leads SET qualification_score=0 WHERE id=$1`, [legacy]);   // pre-migration default shape
      const zero = await newLead(ORG_A, { source: 'crm' });
      await q(`UPDATE public.canonical_leads SET qualification_score=0, lead_metadata = coalesce(lead_metadata, '{}'::jsonb) || $2::jsonb WHERE id=$1`,
        [zero, JSON.stringify({ [QUALIFICATION_SCORE_MARKER]: { scoredBy: 'ccs-test', scoredAt: '2026-10-30T00:00:00Z', scale: 'percent' } })]);
      const high = await newLead(ORG_A, { source: 'crm' });
      await q(`UPDATE public.canonical_leads SET qualification_score=90 WHERE id=$1`, [high]);

      // Reader: the prospect list.
      const list = await listProspects({ organizationId: ORG_A });
      const scored = Object.fromEntries(list.rows.map((r) => [r.prospectId, [r.qualificationScore, r.scored]]));
      expect(scored[unscored]).toEqual([null, false]);
      expect(scored[legacy]).toEqual([0, false]);
      expect(scored[zero]).toEqual([0, true]);
      expect(scored[high]).toEqual([90, true]);

      // Views from the real rows (as leadIntelligenceReadService projects canonical_leads).
      const raw = (await q(`SELECT * FROM public.canonical_leads WHERE company_id=$1`, [ORG_A])).rows
        .map((r: any) => ({ ...r, qualification_score: r.qualification_score === null ? null : Number(r.qualification_score) }));
      const views = Object.fromEntries(raw.map((r: any) => [r.id, projectExistingRow('crm', r, { readFrom: 'canonical_leads' })]));
      expect(views[unscored].scores.total).toBeNull();
      expect(views[legacy].scores.total).toBeNull();
      expect(views[zero].scores.total).toBe(0);
      expect(views[high].scores.total).toBeCloseTo(0.9);

      const stats = computeLeadStats(Object.values(views));
      expect(stats.intentBands).toEqual({ high: 1, medium: 0, low: 1, unscored: 2 });

      expect(toExportRow(views[unscored]).buying_intent).toBe(EXPORT_NOT_SCORED);
      expect(toExportRow(views[legacy]).buying_intent).toBe(EXPORT_NOT_SCORED);
      expect(toExportRow(views[zero]).buying_intent).toBe('0%');

      getLeadStats.mockResolvedValueOnce(stats);
      const plugin = await leadPlugin.provide({ companyId: ORG_A } as never);
      const bi = plugin.modules.find((m) => m.key === 'buying_intent')!;
      expect(bi.score).toBe(Math.round((1 * 100 + 1 * 20) / 2));         // over the 2 scored leads, not all 4
      expect(bi.findings).toContain('2 lead(s) not scored');

      const m = (id: string) => ({ entityId: id, view: views[id], matchedRules: [], evidence: [], confidence: 1 });
      const ai = buildAudienceIntelligence([m(unscored), m(legacy), m(zero), m(high)] as never);
      expect(ai).toMatchObject({ members: 4, scoredMembers: 2, avgIntent: 0.45, intentBands: { high: 1, medium: 0, low: 1, unscored: 2 } });
    });
  });
});
