/**
 * Prospect provenance — ACCEPTANCE TEST #1 against real PostgreSQL:
 * one prospect, THREE sources, THREE distinct contributions, each driven
 * through the REAL ingestion code path (no hand-written provenance inserts).
 *
 *   1. PI discovery   `ingestNormalizedRecord` (leadIngestion/orchestrator) with
 *                     the real Apollo adapter translation → W1 person, W4
 *                     account, WS-1 prospect, LI-2 source record, ORIGINATING
 *                     contribution (`pi_discovery`, `apollo:<id>`).
 *   2. PI enrichment  `executeEnrichment` (enrichment/providers/execute) with the
 *                     real Apollo enrichment adapter and the real
 *                     `defaultPersistObservation` (enrichment/providers/
 *                     persistence) carrying `prospectId` → LI-2 source record +
 *                     CONTRIBUTING contribution (`pi_enrichment`).
 *   3. Community      `bridgeCommunityFeedItem` (prospectProvenance/
 *                     communityBridge) with the production `defaultBridgeDeps`
 *                     for an author VERIFIED to the same person (Workstream B
 *                     rule: one active, linked `identity_claims` external_id
 *                     row) → CONTRIBUTING contribution (`community`).
 *
 * WHAT IS STUBBED, EXACTLY:
 *   - `lib/security/safeFetch` — the network boundary. Only the enrichment
 *     adapter reaches it; it answers one canned Apollo organization payload.
 *   - The enrichment executor's `authorizeCost` / `releaseCost` /
 *     `resolveCredential` / `findRecentObservation` ports (tenant billing,
 *     tenant credential store, duplicate suppression) — supplied in-test, as
 *     b2_apollo_slice does. `persistObservation` is the REAL default port.
 *   - The DB transport: `db/supabaseClient` + `db/writeOwner` are replaced by
 *     a PostgREST-builder → SQL translator on this suite's pg client (the
 *     technique every realschema PI suite uses), one SAVEPOINT per statement
 *     because in production each call is its own request, statements
 *     serialised so concurrent reads (Promise.all in the read service) cannot
 *     interleave savepoints.
 *
 * FIXTURES (inputs to the paths under test, not provenance): tenant rows, the
 * tenant `lead_ingestion` feature_flags row in this throwaway DB, the
 * `lead_signals` + `opportunity_feed_items` rows the listening pipeline would
 * have produced, and the `identity_claims` row that verifies the author.
 *
 * GATE: `ENABLE_LEAD_INGESTION` is set in THIS PROCESS ONLY (restored after);
 * no real flag anywhere is touched.
 *
 * A green run here concerns a disposable database built from the committed
 * baseline plus replayed migrations. It is NOT evidence about production.
 */

jest.mock('../../../lib/security/safeFetch', () => ({ safeFetch: jest.fn() }));

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
    const name = `acc_sp_${++sp}`;
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
  const cols = (s: string): string => {
    const t = s.trim();
    if (!t || t === '*') return '*';
    if (t.includes('(')) throw new Error(`translator: embedded resources are not supported: ${t}`);
    return t.split(',').map((c) => `"${c.trim()}"`).join(', ');
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

import { db, inRollback, seedTenants, ORG_A, ORG_B } from './setup';

/* eslint-disable @typescript-eslint/no-var-requires */
const { safeFetch } = require('../../../lib/security/safeFetch');
const { ingestNormalizedRecord } = require('../../services/leadIngestion/orchestrator');
const { translateApolloPerson } = require('../../services/leadIngestion/adapters/apolloAdapter');
const { executeEnrichment } = require('../../services/enrichment/providers/execute');
const { apolloEnrichmentAdapter } = require('../../services/enrichment/providers/adapters/apollo');
const { defaultPersistObservation } = require('../../services/enrichment/providers/persistence');
const { bridgeCommunityFeedItem } = require('../../services/prospectProvenance/communityBridge');
const { searchLeads, getLeadProfile } = require('../../services/leadIntelligence/leadIntelligenceReadService');
const { leadKeyFor } = require('../../../lib/leadIntelligence/leadKey');
/* eslint-enable @typescript-eslint/no-var-requires */

const DB_URL = process.env.W6_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(DB_URL)) {
  throw new Error(`pi_prov_acceptance_multisource refuses a non-loopback W6_DB_URL: ${DB_URL.replace(/:[^:@]+@/, ':***@')}`);
}

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);
const fetchMock = safeFetch as jest.Mock;

// ── the one person, as each source sees them ──────────────────────────────
const APOLLO_PERSON_ID = 'apollo-person-acc1';
const APOLLO_ORG_ID = 'apollo-org-acc1';
const DOMAIN = 'analytical-engines-acc1.test';
const HANDLE = 'ada_lovelace_acc1';
const DISCOVERY_AT = '2026-10-20T10:00:00.000Z';
/** Earlier than discovery on purpose: "originating first" must come from the ROLE, not the clock. */
const POSTED_AT = '2026-10-01T08:30:00.000Z';
const POST_URL = 'https://www.reddit.com/r/engines/comments/acc1/difference_engine/';

const apolloRaw = (): Record<string, unknown> => ({
  id: APOLLO_PERSON_ID,
  name: 'Ada Lovelace',
  first_name: 'Ada',
  last_name: 'Lovelace',
  title: 'Head of Analytics',
  email: 'Ada.Lovelace@analytical-engines-acc1.test',
  email_status: 'verified',
  city: 'London',
  organization: { id: APOLLO_ORG_ID, name: 'Analytical Engines', primary_domain: DOMAIN, estimated_num_employees: 42 },
});

const apolloOrgResponse = () => ({
  ok: true, status: 200, headers: { get: () => null },
  json: async () => ({ organization: { id: APOLLO_ORG_ID, primary_domain: DOMAIN, estimated_num_employees: 57 } }),
});

// ── fixtures (inputs, not provenance) ─────────────────────────────────────
async function openGate(org: string): Promise<void> {
  await q(
    `INSERT INTO public.feature_flags (organization_id, flag_key, enabled, rationale)
     VALUES ($1, 'lead_ingestion', true, 'pi_prov_acceptance_multisource throwaway DB')
     ON CONFLICT (organization_id, flag_key) DO UPDATE SET enabled = true`, [org]);
}

/** What the listening pipeline would have written: one signal + one feed item by HANDLE. */
async function communityFeedItem(org: string): Promise<Record<string, unknown>> {
  const sig = await q(
    `INSERT INTO public.lead_signals (organization_id, source_type, source_id, platform, platform_user_id,
                                      detected_at, migration_source, metadata, intent_score)
     VALUES ($1, 'listening', 'reddit-post-acc1', 'reddit', $2, $3, 'pi-prov-acceptance', $4::jsonb, 0.8)
     RETURNING id`,
    [org, HANDLE, '2026-10-01T09:00:00.000Z', JSON.stringify({ posted_at: POSTED_AT, content_url: POST_URL, author_handle: 'Ada_Lovelace_ACC1' })]);
  const feed = await q(
    `INSERT INTO public.opportunity_feed_items (organization_id, signal_id, opportunity_type, detected_reason, platform,
                                                author_metadata, source_context, opportunity_score, confidence_score)
     VALUES ($1, $2, 'buying_intent', 'pi-prov-acceptance', 'reddit', $3::jsonb, $4::jsonb, 0.81, 0.7)
     RETURNING *`,
    [org, sig.rows[0].id, JSON.stringify({ platform_user_id: HANDLE, author_handle: 'Ada_Lovelace_ACC1', profile_name: 'Ada L.' }),
      JSON.stringify({ content_url: POST_URL })]);
  const row = feed.rows[0] as Record<string, unknown>;
  // As the feed service hands it on: timestamps as ISO strings.
  for (const [k, v] of Object.entries(row)) if (v instanceof Date) row[k] = v.toISOString();
  return row;
}

/** Workstream B's verification evidence: ONE active, linked external_id claim. */
async function verifyHandle(org: string, personId: string): Promise<void> {
  await q(
    `INSERT INTO public.identity_claims (organization_id, person_id, claim_type, platform, normalized_value, raw_value,
                                         source, verification_state, verified_at)
     VALUES ($1, $2, 'external_id', 'reddit', $3, $3, 'pi-prov-acceptance', 'verified', now())`,
    [org, personId, HANDLE]);
}

// ── the three real paths ──────────────────────────────────────────────────
async function discover(org: string) {
  return ingestNormalizedRecord(translateApolloPerson(apolloRaw(), org), {
    ingestionRunId: 'disc-run-acc1', now: DISCOVERY_AT,
  });
}

const enrichPorts = {
  async authorizeCost() { return { authorized: true, holdId: 'hold-acc1', cost: { currency: 'USD', amount: 0 } }; },
  async releaseCost() { /* nothing billable to release */ },
  async resolveCredential() { return 'synthetic-tenant-apollo-key'; },
  async findRecentObservation() { return null; },  // suppression off: exercise the full chain every time
  persistObservation: defaultPersistObservation,   // REAL → ingestSourceRecord + recordEnrichmentContribution
  now() { return '2026-10-25T12:00:00.000Z'; },
};

async function enrich(org: string, accountId: string, prospectId: string) {
  return executeEnrichment({
    organizationId: org,
    subject: 'account',
    entityId: accountId,
    attributes: ['employee_count'],
    selectors: { domain: DOMAIN },
    purpose: 'pi-prov-acceptance',
    correlationId: 'enrich-corr-acc1',
    prospectId,
  }, 'apollo', enrichPorts, { adapter: apolloEnrichmentAdapter });
}

async function bridge(feed: Record<string, unknown>) {
  return bridgeCommunityFeedItem(feed);
}

// ── reads ─────────────────────────────────────────────────────────────────
const leadsOf = async (org: string) =>
  (await q(`SELECT id, source, created_at, unified_person_id, external_lead_key, lead_metadata
              FROM public.canonical_leads WHERE company_id=$1 ORDER BY id`, [org])).rows;
const contributionsOf = async (org: string) =>
  (await q(`SELECT * FROM public.prospect_source_contributions WHERE organization_id=$1 ORDER BY external_ref`, [org])).rows;
const countWhere = async (table: string, col: string, org: string) =>
  (await q(`SELECT count(*)::int n FROM public.${table} WHERE ${col}=$1`, [org])).rows[0].n as number;

async function scenario(org: string) {
  await openGate(org);
  const d = await discover(org);
  expect(d).toMatchObject({ ok: true });
  const feed = await communityFeedItem(org);
  await verifyHandle(org, d.personId);
  const e = await enrich(org, d.accountId, d.prospectId);
  const b = await bridge(feed);
  return { d, e, b, feed };
}

const saved: { enable?: string } = {};
beforeAll(() => {
  saved.enable = process.env.ENABLE_LEAD_INGESTION;
  process.env.ENABLE_LEAD_INGESTION = 'true'; // THIS PROCESS ONLY
  fetchMock.mockImplementation(async (url: string) => {
    if (!String(url).startsWith('https://api.apollo.io/')) throw new Error(`unexpected egress: ${url}`);
    return apolloOrgResponse();
  });
});
afterAll(() => {
  if (saved.enable === undefined) delete process.env.ENABLE_LEAD_INGESTION;
  else process.env.ENABLE_LEAD_INGESTION = saved.enable;
});

// ═══════════════════════════════════════════════════════════════════════════
describe('acceptance #1 — one prospect, three sources, three contributions (real paths)', () => {
  it('step by step: discovery originates, enrichment and community contribute, nothing is re-originated', async () => {
    await inRollback(async () => {
      await seedTenants();
      await openGate(ORG_A);

      // ── 1. PI discovery ────────────────────────────────────────────────
      const d = await discover(ORG_A);
      expect(d).toMatchObject({ ok: true });
      expect(d.personId).toBeTruthy();
      expect(d.accountId).toBeTruthy();
      expect(d.prospectId).toBeTruthy();

      const [lead] = await leadsOf(ORG_A);
      expect(lead.id).toBe(d.prospectId);
      expect(lead.unified_person_id).toBe(d.personId);
      expect(lead.source).toBe('apollo');
      expect(lead.external_lead_key).toBe(`apollo:${APOLLO_PERSON_ID}`);
      const leadBefore = { source: lead.source, created_at: (lead.created_at as Date).toISOString() };

      let c = await contributionsOf(ORG_A);
      expect(c).toHaveLength(1);
      expect(c[0]).toMatchObject({
        organization_id: ORG_A, canonical_lead_id: d.prospectId, contribution_role: 'originating',
        source_category: 'pi_discovery', platform: 'apollo', external_ref: `apollo:${APOLLO_PERSON_ID}`,
        source_record_id: d.sourceRecordId, ingestion_run_id: 'disc-run-acc1',
      });
      // Apollo states no observation time: the ingestion instant is the honest fallback.
      expect((c[0].observed_at as Date).toISOString()).toBe(DISCOVERY_AT);
      const discSr = (await q(`SELECT * FROM public.source_records WHERE id=$1`, [d.sourceRecordId])).rows[0];
      expect(discSr).toMatchObject({
        organization_id: ORG_A, provider: 'apollo', source_entity_type: 'person', source_record_id: APOLLO_PERSON_ID,
        source_category: 'pi_discovery', platform: 'apollo', person_id: d.personId,
      });

      // ── 2. PI enrichment ───────────────────────────────────────────────
      const e = await enrich(ORG_A, d.accountId, d.prospectId);
      expect(e).toMatchObject({ outcome: 'enriched', providerCalled: true });
      expect(fetchMock).toHaveBeenCalled();
      expect(String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0])).toContain(`domain=${DOMAIN}`);

      c = await contributionsOf(ORG_A);
      expect(c).toHaveLength(2);
      const enr = c.find((r: any) => r.source_category === 'pi_enrichment');
      expect(enr).toMatchObject({
        organization_id: ORG_A, canonical_lead_id: d.prospectId, contribution_role: 'contributing',
        platform: 'apollo', external_ref: expect.stringMatching(new RegExp(`^enrichment_apollo:account:${d.accountId}:[0-9a-f]{16}$`)), ingestion_run_id: 'enrich-corr-acc1',
      });
      expect(enr.observed_at).toBeInstanceOf(Date);
      const enrSr = (await q(`SELECT * FROM public.source_records WHERE id=$1`, [enr.source_record_id])).rows[0];
      expect(enrSr).toMatchObject({
        organization_id: ORG_A, provider: 'apollo', source_entity_type: 'account',
        source_record_id: `apollo:account:${d.accountId}`, source_category: 'pi_enrichment', platform: 'apollo',
        account_id: d.accountId,
      });
      // The enrichment reached the canonical account through LI-2 (proves the path is real end to end).
      expect((await q(`SELECT employee_count FROM public.prospect_accounts WHERE id=$1`, [d.accountId])).rows[0].employee_count)
        .not.toBeNull();
      // Originating untouched; lead identity columns untouched.
      expect(c.find((r: any) => r.contribution_role === 'originating').external_ref).toBe(`apollo:${APOLLO_PERSON_ID}`);
      let [leadNow] = await leadsOf(ORG_A);
      expect({ source: leadNow.source, created_at: (leadNow.created_at as Date).toISOString() }).toEqual(leadBefore);

      // ── 3. Community, author VERIFIED to the same person ───────────────
      const feed = await communityFeedItem(ORG_A);
      await verifyHandle(ORG_A, d.personId);
      const b = await bridge(feed);
      expect(b).toMatchObject({
        status: 'bridged', reason: 'recorded', identityStatus: 'verified', personId: d.personId,
        prospectId: d.prospectId, leadCreated: false, prospectPath: 'existing_person',
        contribution: 'inserted', contributionRole: 'contributing',
      });

      c = await contributionsOf(ORG_A);
      expect(c).toHaveLength(3);
      const com = c.find((r: any) => r.source_category === 'community');
      expect(com).toMatchObject({
        organization_id: ORG_A, canonical_lead_id: d.prospectId, contribution_role: 'contributing',
        platform: 'reddit', external_ref: `community:${feed.id}`, source_url: POST_URL,
        opportunity_feed_item_id: feed.id, lead_signal_id: feed.signal_id,
      });
      expect((com.observed_at as Date).toISOString()).toBe(POSTED_AT);
      expect(com.evidence.identityVerification).toMatchObject({ status: 'verified', reason: 'linked_identity_claim' });
      const comSr = (await q(`SELECT * FROM public.source_records WHERE id=$1`, [com.source_record_id])).rows[0];
      expect(comSr).toMatchObject({
        organization_id: ORG_A, provider: 'community', source_record_id: feed.id,
        source_category: 'community', platform: 'reddit', source_url: POST_URL, person_id: d.personId,
      });

      [leadNow] = await leadsOf(ORG_A);
      expect({ source: leadNow.source, created_at: (leadNow.created_at as Date).toISOString() }).toEqual(leadBefore);
      expect(leadNow.unified_person_id).toBe(d.personId);
    });
  });

  it('end state: 1 prospect, 3 contributions with distinct refs/categories, exactly 1 originating, all tenant-stamped', async () => {
    await inRollback(async () => {
      await seedTenants();
      const { d, feed } = await scenario(ORG_A);

      const leads = await leadsOf(ORG_A);
      expect(leads).toHaveLength(1);
      expect(await countWhere('unified_persons', 'company_id', ORG_A)).toBe(1);

      const c = await contributionsOf(ORG_A);
      expect(c).toHaveLength(3);
      // closure C: the enrichment ref is content-addressed (`…:<16-hex fingerprint>`).
      expect(new Set(c.map((r: any) => String(r.external_ref).replace(/:[0-9a-f]{16}$/, '')))).toEqual(new Set([
        `apollo:${APOLLO_PERSON_ID}`, `enrichment_apollo:account:${d.accountId}`, `community:${feed.id}`,
      ]));
      expect(new Set(c.map((r: any) => r.source_category))).toEqual(new Set(['pi_discovery', 'pi_enrichment', 'community']));
      expect(c.filter((r: any) => r.contribution_role === 'originating').map((r: any) => r.source_category)).toEqual(['pi_discovery']);
      for (const r of c) {
        expect(r.organization_id).toBe(ORG_A);
        expect(r.canonical_lead_id).toBe(leads[0].id);
        expect(r.observed_at).toBeInstanceOf(Date);
        expect(r.source_record_id).toBeTruthy();
      }
      // Every source record a contribution points at is the same tenant's and typed with the same category.
      const { rows: srs } = await q(
        `SELECT c.source_category AS c_cat, sr.source_category AS sr_cat, sr.organization_id
           FROM public.prospect_source_contributions c
           JOIN public.source_records sr ON sr.id = c.source_record_id
          WHERE c.organization_id = $1`, [ORG_A]);
      expect(srs).toHaveLength(3);
      for (const r of srs) { expect(r.sr_cat).toBe(r.c_cat); expect(r.organization_id).toBe(ORG_A); }
    });
  });

  it('replaying all three ingestions changes nothing (idempotency)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const { d, feed } = await scenario(ORG_A);

      const snapshot = async () => ({
        leads: await leadsOf(ORG_A),
        contributions: await contributionsOf(ORG_A),
        persons: await countWhere('unified_persons', 'company_id', ORG_A),
        accounts: await countWhere('prospect_accounts', 'organization_id', ORG_A),
        sourceRecords: (await q(`SELECT id, provider, source_entity_type, source_record_id, source_category, platform
                                    FROM public.source_records WHERE organization_id=$1 ORDER BY id`, [ORG_A])).rows,
        claims: await countWhere('identity_claims', 'organization_id', ORG_A),
        canonicalUsers: await countWhere('canonical_users', 'company_id', ORG_A),
      });
      const before = await snapshot();

      for (let i = 0; i < 2; i++) {
        const d2 = await discover(ORG_A);
        expect(d2).toMatchObject({ ok: true, prospectId: d.prospectId, personId: d.personId, accountId: d.accountId, sourceRecordId: d.sourceRecordId });
        const e2 = await enrich(ORG_A, d.accountId, d.prospectId);
        expect(e2).toMatchObject({ outcome: 'enriched' });
        const b2 = await bridge(feed);
        expect(b2).toMatchObject({ status: 'bridged', reason: 'already_recorded', contribution: 'duplicate', prospectId: d.prospectId });
      }

      expect(await snapshot()).toEqual(before);
    });
  });

  it('a second tenant with identical external ids gets its own prospect and contributions (isolation)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await scenario(ORG_A);
      const aLeads = await leadsOf(ORG_A);
      const aContribs = await contributionsOf(ORG_A);

      const b = await scenario(ORG_B);
      expect(b.b).toMatchObject({ status: 'bridged', leadCreated: false, prospectPath: 'existing_person' });

      const bLeads = await leadsOf(ORG_B);
      expect(bLeads).toHaveLength(1);
      expect(bLeads[0].id).not.toBe(aLeads[0].id);
      expect(bLeads[0].external_lead_key).toBe(aLeads[0].external_lead_key); // same apollo id, separate prospect
      expect(b.d.personId).not.toBe(a.d.personId);
      expect(b.d.accountId).not.toBe(a.d.accountId);

      const bc = await contributionsOf(ORG_B);
      expect(bc).toHaveLength(3);
      expect(bc.filter((r: any) => r.contribution_role === 'originating')).toHaveLength(1);
      for (const r of bc) {
        expect(r.organization_id).toBe(ORG_B);
        expect(r.canonical_lead_id).toBe(bLeads[0].id);
      }
      expect(bc.find((r: any) => r.source_category === 'pi_discovery').external_ref)
        .toBe(aContribs.find((r: any) => r.source_category === 'pi_discovery').external_ref);

      // Tenant A untouched by tenant B's ingestion; no row crosses tenants.
      expect(await leadsOf(ORG_A)).toEqual(aLeads);
      expect(await contributionsOf(ORG_A)).toEqual(aContribs);
      const { rows: cross } = await q(
        `SELECT count(*)::int n FROM public.prospect_source_contributions c
           JOIN public.canonical_leads l ON l.id = c.canonical_lead_id
          WHERE l.company_id <> c.organization_id`);
      expect(cross[0].n).toBe(0);
      const { rows: crossSr } = await q(
        `SELECT count(*)::int n FROM public.prospect_source_contributions c
           JOIN public.source_records sr ON sr.id = c.source_record_id
          WHERE sr.organization_id <> c.organization_id`);
      expect(crossSr[0].n).toBe(0);
    });
  });

  it('the unified reader returns ONE lead with sources.length === 3, originating category first', async () => {
    await inRollback(async () => {
      await seedTenants();
      const { d } = await scenario(ORG_A);
      await scenario(ORG_B); // another tenant's identical prospect must not leak in

      const page = await searchLeads({ companyId: ORG_A, page: { limit: 50, offset: 0 } });
      expect(page.provenance).toBe('ok');
      const mine = page.rows.filter((v: any) => v.sourceRef?.table === 'canonical_leads' && v.sourceRef?.id === d.prospectId);
      expect(mine).toHaveLength(1);
      expect(page.rows.filter((v: any) => v.sourceRef?.table === 'canonical_leads')).toHaveLength(1);
      const view = mine[0];
      expect(view.provenanceStatus).toBe('loaded');
      expect(view.sources).toHaveLength(3);
      expect(view.sources[0]).toMatchObject({ role: 'originating', sourceCategory: 'pi_discovery', platform: 'apollo' });
      expect(view.sources.slice(1).map((s: any) => s.role)).toEqual(['contributing', 'contributing']);
      expect(new Set(view.sources.map((s: any) => s.sourceCategory))).toEqual(new Set(['pi_discovery', 'pi_enrichment', 'community']));
      expect(view.origin).toMatchObject({ category: 'pi_discovery', platform: 'apollo' });
      for (const s of view.sources) expect(s.externalRef).not.toMatch(/^$/);

      const profile = await getLeadProfile(ORG_A, leadKeyFor(view));
      expect(profile).not.toBeNull();
      expect(profile.view.sources).toHaveLength(3);
      expect(profile.view.sources[0]).toMatchObject({ role: 'originating', sourceCategory: 'pi_discovery' });
      const events = profile.timeline.filter((t: any) => t.origin === 'prospect_source_contributions');
      expect(events.map((t: any) => t.eventType).sort()).toEqual(['source_contributed', 'source_contributed', 'source_originated']);

      // The other tenant's key does not resolve here.
      const pageB = await searchLeads({ companyId: ORG_B, page: { limit: 50, offset: 0 } });
      const viewB = pageB.rows.find((v: any) => v.sourceRef?.table === 'canonical_leads');
      expect(viewB.sourceRef.id).not.toBe(d.prospectId);
      expect(await getLeadProfile(ORG_A, leadKeyFor(viewB))).toBeNull();
    });
  });
});
