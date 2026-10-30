/**
 * closure-B — identity ORDERING reconciliation against real PostgreSQL.
 *
 * One person, seen by community listening (a handle) and by PI discovery
 * (Apollo), in BOTH orders, with verification arriving last through an
 * `identity_claims` row (Workstream B's rule: one active, linked external_id
 * claim in this tenant). Every write goes through the REAL code paths:
 *
 *   community   `bridgeCommunityFeedItem` (prospectProvenance/communityBridge)
 *               with the production `defaultBridgeDeps` (gate, verification,
 *               closure-B reconciliation, WS-1, LI-2, provenance writer);
 *   discovery   `ingestNormalizedRecord` (leadIngestion/orchestrator) with the
 *               real Apollo adapter translation, including its closure-B hook
 *               (`reconcileVerifiedPersonIdentities`);
 *   operations  the real `operationalCoreService` (+ `resolveOperationalAliases`
 *               → the real unified read service) — notes written under the
 *               absorbed prospect's key BEFORE reconciliation;
 *   reader      `leadIntelligenceReadService.searchLeads` / `getLeadProfile`.
 *
 * Each ordering must end with ONE canonical prospect as seen by the reader
 * (the absorbed one recorded as an ALIAS of the survivor, both rows kept), every
 * contribution preserved and visible on the survivor, no person created from
 * the handle before verification, operations history continuous, no
 * cross-tenant alias/merge (tenant B: identical external ids, no verification),
 * and alias cycle / chain / cross-tenant attempts refused by the database.
 *
 * STUBBED: `lib/security/safeFetch` (network boundary; any call fails the test),
 * `telemetry/telemetryDispatcher.trackEvent` (in-process metrics sink), and the
 * DB transport (`db/supabaseClient` + `db/writeOwner` → PostgREST-builder-to-SQL
 * translator on this suite's pg client, copied from
 * pi_prov_acceptance_multisource). FIXTURES (inputs, not provenance): tenants,
 * the tenant `lead_ingestion` feature_flags row in this throwaway DB, the
 * `lead_signals` + `opportunity_feed_items` rows the listening pipeline writes,
 * and the verifying `identity_claims` row.
 *
 * GATE: `ENABLE_LEAD_INGESTION` is set in THIS PROCESS ONLY (restored after).
 * A green run concerns a disposable database built from the committed
 * baseline plus replayed migrations. It is NOT evidence about production.
 */

jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));
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

import { db, inRollback, seedTenants, attempt, ORG_A, ORG_B } from './setup';

/* eslint-disable @typescript-eslint/no-var-requires */
const { safeFetch } = require('../../../lib/security/safeFetch');
const { ingestNormalizedRecord } = require('../../services/leadIngestion/orchestrator');
const { translateApolloPerson } = require('../../services/leadIngestion/adapters/apolloAdapter');
const { bridgeCommunityFeedItem } = require('../../services/prospectProvenance/communityBridge');
const { reconcileVerifiedSocialIdentity } = require('../../services/prospectProvenance/identityReconciliation');
const { searchLeads, getLeadProfile } = require('../../services/leadIntelligence/leadIntelligenceReadService');
const ops = require('../../services/operations/operationalCoreService');
const { leadKeyFor } = require('../../../lib/leadIntelligence/leadKey');
/* eslint-enable @typescript-eslint/no-var-requires */

const DB_URL = process.env.W6_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(DB_URL)) {
  throw new Error(`pi_prov_identity_ordering refuses a non-loopback W6_DB_URL: ${DB_URL.replace(/:[^:@]+@/, ':***@')}`);
}

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);
const fetchMock = safeFetch as jest.Mock;

const APOLLO_PERSON_ID = 'apollo-person-cb1';
const HANDLE = 'grace_hopper_cb1';
const DISCOVERY_AT = '2026-10-20T10:00:00.000Z';

const apolloRaw = (): Record<string, unknown> => ({
  id: APOLLO_PERSON_ID,
  name: 'Grace Hopper',
  first_name: 'Grace',
  last_name: 'Hopper',
  title: 'Rear Admiral of Compilers',
  email: 'Grace.Hopper@cobol-cb1.test',
  email_status: 'verified',
  organization: { id: 'apollo-org-cb1', name: 'COBOL Works', primary_domain: 'cobol-cb1.test', estimated_num_employees: 12 },
});

async function openGate(org: string): Promise<void> {
  await q(
    `INSERT INTO public.feature_flags (organization_id, flag_key, enabled, rationale)
     VALUES ($1, 'lead_ingestion', true, 'pi_prov_identity_ordering throwaway DB')
     ON CONFLICT (organization_id, flag_key) DO UPDATE SET enabled = true`, [org]);
}

/** What the listening pipeline would have written: one signal + one feed item by HANDLE. */
async function communityFeedItem(org: string, n: number, postedAt: string): Promise<Record<string, unknown>> {
  const url = `https://www.reddit.com/r/compilers/comments/cb1_${n}/`;
  const sig = await q(
    `INSERT INTO public.lead_signals (organization_id, source_type, source_id, platform, platform_user_id,
                                      detected_at, migration_source, metadata, intent_score)
     VALUES ($1, 'listening', $2, 'reddit', $3, $4, 'pi-prov-identity-ordering', $5::jsonb, 0.8)
     RETURNING id`,
    [org, `reddit-post-cb1-${n}`, HANDLE, postedAt, JSON.stringify({ posted_at: postedAt, content_url: url, author_handle: 'Grace_Hopper_CB1' })]);
  const feed = await q(
    `INSERT INTO public.opportunity_feed_items (organization_id, signal_id, opportunity_type, detected_reason, platform,
                                                author_metadata, source_context, opportunity_score, confidence_score)
     VALUES ($1, $2, 'buying_intent', 'pi-prov-identity-ordering', 'reddit', $3::jsonb, $4::jsonb, 0.81, 0.7)
     RETURNING *`,
    [org, sig.rows[0].id, JSON.stringify({ platform_user_id: HANDLE, author_handle: 'Grace_Hopper_CB1' }), JSON.stringify({ content_url: url })]);
  const row = feed.rows[0] as Record<string, unknown>;
  for (const [k, v] of Object.entries(row)) if (v instanceof Date) row[k] = v.toISOString();
  return row;
}

/** Workstream B's verification evidence: ONE active, linked external_id claim. */
async function verifyHandle(org: string, personId: string): Promise<void> {
  await q(
    `INSERT INTO public.identity_claims (organization_id, person_id, claim_type, platform, normalized_value, raw_value,
                                         source, verification_state, verified_at)
     VALUES ($1, $2, 'external_id', 'reddit', $3, $3, 'pi-prov-identity-ordering', 'verified', now())`,
    [org, personId, HANDLE]);
}

const discover = (org: string) => ingestNormalizedRecord(translateApolloPerson(apolloRaw(), org), { ingestionRunId: 'disc-run-cb1', now: DISCOVERY_AT });
const bridge = (feed: Record<string, unknown>) => bridgeCommunityFeedItem(feed);

const leadsOf = async (org: string) =>
  (await q(`SELECT id, source, unified_person_id, external_lead_key, lead_metadata FROM public.canonical_leads WHERE company_id=$1 ORDER BY external_lead_key`, [org])).rows;
const contributionsOf = async (org: string) =>
  (await q(`SELECT id, canonical_lead_id, contribution_role, source_category, external_ref, organization_id FROM public.prospect_source_contributions
             WHERE organization_id=$1 ORDER BY external_ref`, [org])).rows;
const aliasesOf = async (org: string) =>
  (await q(`SELECT organization_id, alias_lead_id, survivor_lead_id, reason, rule_version, evidence FROM public.prospect_aliases WHERE organization_id=$1`, [org])).rows;
const count = async (table: string, col: string, org: string) =>
  (await q(`SELECT count(*)::int n FROM public.${table} WHERE ${col}=$1`, [org])).rows[0].n as number;

/** The reader's canonical views of a tenant. */
const canonicalViews = async (org: string) =>
  (await searchLeads({ companyId: org, page: { limit: 100, offset: 0 } })).rows.filter((v: any) => v.sourceRef?.table === 'canonical_leads');

const noteRef = (org: string, key: string) => ({ companyId: org, entityType: 'canonical_lead', entityId: key });

interface Ordered {
  survivor: string;
  absorbed: string;
  personId: string;
  absorbedKey: string;
  feeds: Array<Record<string, unknown>>;
}

/**
 * (a) community → discovery → verification. The trigger after verification is
 * a REPLAY of discovery (the orchestrator's closure-B hook).
 */
async function orderingA(org: string, verify = true): Promise<Ordered> {
  await openGate(org);
  const feed1 = await communityFeedItem(org, 1, '2026-10-01T08:00:00.000Z');
  const b1 = await bridge(feed1);
  expect(b1).toMatchObject({ status: 'bridged', identityStatus: 'unverified', personId: null, prospectPath: 'created', leadCreated: true });
  // A handle alone creates NO person and NO claim.
  expect(await count('unified_persons', 'company_id', org)).toBe(0);
  expect(await count('identity_claims', 'organization_id', org)).toBe(0);
  const [absorbedView] = await canonicalViews(org);
  const absorbedKey = leadKeyFor(absorbedView);
  await ops.addNote(noteRef(org, absorbedKey), { userId: null }, { body: 'note under the community prospect key' });

  const d = await discover(org);
  expect(d).toMatchObject({ ok: true });
  expect(d.prospectId).not.toBe(b1.prospectId); // WS-1 keys by apollo:<id>: a second prospect, as before
  if (verify) {
    await verifyHandle(org, d.personId);
    const again = await discover(org); // replay → closure-B hook reconciles
    expect(again).toMatchObject({ ok: true, prospectId: d.prospectId, personId: d.personId });
  }
  const feed2 = await communityFeedItem(org, 2, '2026-10-22T08:00:00.000Z');
  const b2 = await bridge(feed2);
  if (verify) {
    expect(b2).toMatchObject({ status: 'bridged', identityStatus: 'verified', prospectId: d.prospectId, prospectPath: 'existing_person', leadCreated: false });
  }
  return { survivor: d.prospectId, absorbed: b1.prospectId, personId: d.personId, absorbedKey, feeds: [feed1, feed2] };
}

/**
 * (b) discovery → community → verification. The trigger after verification is
 * the author's NEXT community post (the bridge's closure-B reconciliation).
 */
async function orderingB(org: string): Promise<Ordered> {
  await openGate(org);
  const d = await discover(org);
  expect(d).toMatchObject({ ok: true });
  const personsBefore = await count('unified_persons', 'company_id', org);
  const feed1 = await communityFeedItem(org, 1, '2026-10-21T08:00:00.000Z');
  const b1 = await bridge(feed1);
  // Unverified: the existing person is NOT matched by handle; a person-less prospect is created.
  expect(b1).toMatchObject({ status: 'bridged', identityStatus: 'unverified', personId: null, prospectPath: 'created' });
  expect(b1.prospectId).not.toBe(d.prospectId);
  expect(await count('unified_persons', 'company_id', org)).toBe(personsBefore);
  const absorbedView = (await canonicalViews(org)).find((v: any) => v.sourceRef.id === b1.prospectId);
  const absorbedKey = leadKeyFor(absorbedView);
  await ops.addNote(noteRef(org, absorbedKey), { userId: null }, { body: 'note under the community prospect key' });

  await verifyHandle(org, d.personId);
  const feed2 = await communityFeedItem(org, 2, '2026-10-22T08:00:00.000Z');
  const b2 = await bridge(feed2);
  expect(b2).toMatchObject({
    status: 'bridged', identityStatus: 'verified', reconciliation: 'reconciled',
    prospectId: d.prospectId, prospectPath: 'existing_person', leadCreated: false, contributionRole: 'contributing',
  });
  // Replaying the first post: idempotent on the absorbed prospect, never given the person.
  const replay = await bridge(feed1);
  expect(replay).toMatchObject({ status: 'bridged', reason: 'already_recorded', prospectId: b1.prospectId, aliasOf: d.prospectId, personAttached: false });
  return { survivor: d.prospectId, absorbed: b1.prospectId, personId: d.personId, absorbedKey, feeds: [feed1, feed2] };
}

/** The end state both orderings must reach. */
async function expectOneCanonicalProspect(org: string, o: Ordered): Promise<void> {
  // Both rows kept; the absorbed one is an ALIAS of the survivor (append-only, audited).
  const leads = await leadsOf(org);
  expect(leads.map((l: any) => l.id).sort()).toEqual([o.absorbed, o.survivor].sort());
  expect(leads.find((l: any) => l.id === o.absorbed).unified_person_id).toBeNull(); // never re-anchored
  expect(leads.find((l: any) => l.id === o.survivor).unified_person_id).toBe(o.personId);
  expect(await count('unified_persons', 'company_id', org)).toBe(1);
  const aliases = await aliasesOf(org);
  expect(aliases).toEqual([expect.objectContaining({
    organization_id: org, alias_lead_id: o.absorbed, survivor_lead_id: o.survivor, reason: 'verified_identity', rule_version: 'cb.reconcile.1',
  })]);
  expect(aliases[0].evidence).toMatchObject({ platform: 'reddit', verification: 'linked_identity_claim' });
  // Alias rows are append-only, so they must never hold erasable personal data.
  expect(aliases[0].evidence).not.toHaveProperty('platformUserId');
  expect(aliases[0].evidence).not.toHaveProperty('personId');
  expect(JSON.stringify(aliases[0].evidence)).not.toContain(HANDLE);

  // Every contribution preserved where it was written; exactly one originating per lead.
  const c = await contributionsOf(org);
  expect(c.map((r: any) => [r.external_ref, r.canonical_lead_id, r.contribution_role, r.source_category])).toEqual([
    [`apollo:${APOLLO_PERSON_ID}`, o.survivor, 'originating', 'pi_discovery'],
    [`community:${o.feeds[0].id}`, o.absorbed, 'originating', 'community'],
    [`community:${o.feeds[1].id}`, o.survivor, 'contributing', 'community'],
  ].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)));
  for (const r of c) expect(r.organization_id).toBe(org);

  // The reader: ONE canonical lead, carrying all three contributions; survivor's origin first.
  const views = await canonicalViews(org);
  expect(views).toHaveLength(1);
  const v = views[0];
  expect(v.sourceRef.id).toBe(o.survivor);
  expect(v.absorbedProspectIds).toEqual([o.absorbed]);
  expect(v.aliasKeys).toContain(o.absorbedKey);
  expect(v.provenanceStatus).toBe('loaded');
  // Survivor's originating first; then by observedAt (feed 1 was posted before feed 2 in both orderings).
  expect(v.sources.map((s: any) => [s.externalRef, s.role])).toEqual([
    [`apollo:${APOLLO_PERSON_ID}`, 'originating'],
    [`community:${o.feeds[0].id}`, 'originating'], // the absorbed prospect's own originating row, kept as recorded
    [`community:${o.feeds[1].id}`, 'contributing'],
  ]);
  expect(v.origin).toMatchObject({ category: 'pi_discovery', platform: 'apollo' });
  const page = await searchLeads({ companyId: org, page: { limit: 100, offset: 0 } });
  expect(page.prospectAliasMerge).toEqual({ status: 'ok', merged: 1 });

  // The absorbed prospect's key resolves to the survivor's profile, with every source.
  const profile = await getLeadProfile(org, o.absorbedKey);
  expect(profile).not.toBeNull();
  expect(profile.leadKey).toBe(leadKeyFor(v));
  expect(profile.view.sources).toHaveLength(3);
  expect(profile.timeline.filter((t: any) => t.origin === 'prospect_source_contributions')).toHaveLength(3);

  // Operations: the note written under the OLD key is on the canonical lead; new writes use the canonical key.
  const [ref] = await ops.resolveOperationalAliases([noteRef(org, leadKeyFor(v))]);
  expect(ref).toMatchObject({ entityId: leadKeyFor(v), aliasEntityIds: [o.absorbedKey] });
  const before = await ops.getOperationalOverlay(ref);
  expect(before.notes.map((n: any) => n.body)).toEqual(['note under the community prospect key']);
  const [viaOld] = await ops.resolveOperationalAliases([noteRef(org, o.absorbedKey)]);
  expect(viaOld.entityId).toBe(leadKeyFor(v));
  await ops.addNote(viaOld, { userId: null }, { body: 'note after reconciliation' });
  const notes = (await q(`SELECT entity_id, body FROM public.operational_notes WHERE company_id=$1 ORDER BY body`, [org])).rows;
  expect(notes).toEqual([
    { entity_id: leadKeyFor(v), body: 'note after reconciliation' },
    { entity_id: o.absorbedKey, body: 'note under the community prospect key' },
  ]);
  expect((await ops.getOperationalOverlay(viaOld)).notes).toHaveLength(2);
}

const saved: { enable?: string } = {};
beforeAll(() => {
  saved.enable = process.env.ENABLE_LEAD_INGESTION;
  process.env.ENABLE_LEAD_INGESTION = 'true'; // THIS PROCESS ONLY
  fetchMock.mockImplementation(async (url: string) => { throw new Error(`unexpected egress: ${url}`); });
});
afterAll(() => {
  if (saved.enable === undefined) delete process.env.ENABLE_LEAD_INGESTION;
  else process.env.ENABLE_LEAD_INGESTION = saved.enable;
});

// ═══════════════════════════════════════════════════════════════════════════
describe('closure-B — one verified identity ⇒ ONE canonical prospect, either ordering (real paths)', () => {
  it('(a) community → discovery → verification', async () => {
    await inRollback(async () => {
      await seedTenants();
      const o = await orderingA(ORG_A);
      await expectOneCanonicalProspect(ORG_A, o);
      // Idempotent: replaying every ingestion records nothing new.
      const snap = async () => ({ leads: await leadsOf(ORG_A), c: await contributionsOf(ORG_A), a: await aliasesOf(ORG_A) });
      const s0 = await snap();
      await discover(ORG_A);
      for (const f of o.feeds) await bridge(f);
      expect(await snap()).toEqual(s0);
    });
  });

  it('(b) discovery → community → verification', async () => {
    await inRollback(async () => {
      await seedTenants();
      const o = await orderingB(ORG_A);
      await expectOneCanonicalProspect(ORG_A, o);
      const snap = async () => ({ leads: await leadsOf(ORG_A), c: await contributionsOf(ORG_A), a: await aliasesOf(ORG_A) });
      const s0 = await snap();
      await discover(ORG_A);
      for (const f of o.feeds) await bridge(f);
      expect(await snap()).toEqual(s0);
    });
  });

  it('before verification nothing merges: two prospects, no alias, no person from the handle', async () => {
    await inRollback(async () => {
      await seedTenants();
      const o = await orderingA(ORG_A, false);
      expect(await aliasesOf(ORG_A)).toEqual([]);
      expect((await canonicalViews(ORG_A)).map((v: any) => v.sourceRef.id).sort()).toEqual([o.absorbed, o.survivor].sort());
      // An explicit reconciliation call on the unverified handle is a no-op.
      expect(await reconcileVerifiedSocialIdentity(ORG_A, { platform: 'reddit', platformUserId: HANDLE })).toMatchObject({ status: 'unverified', aliased: [] });
      expect(await aliasesOf(ORG_A)).toEqual([]);
      const handleLead = (await leadsOf(ORG_A)).find((l: any) => l.id === o.absorbed);
      expect(handleLead.unified_person_id).toBeNull();
    });
  });

  it('a second tenant with identical external ids and handle stays separate (no cross-tenant alias or merge)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await orderingB(ORG_A);
      const aSnap = { leads: await leadsOf(ORG_A), c: await contributionsOf(ORG_A), al: await aliasesOf(ORG_A) };
      // Tenant B: same Apollo ids, same handle, same order — but its handle is NOT verified in B.
      await openGate(ORG_B);
      const dB = await discover(ORG_B);
      const fB = await communityFeedItem(ORG_B, 1, '2026-10-21T08:00:00.000Z');
      const bB = await bridge(fB);
      expect(bB).toMatchObject({ status: 'bridged', identityStatus: 'unverified', prospectPath: 'created' });
      // Tenant A's claim does not verify tenant B's author; nothing is aliased in B.
      expect(await reconcileVerifiedSocialIdentity(ORG_B, { platform: 'reddit', platformUserId: HANDLE })).toMatchObject({ status: 'unverified' });
      expect(await aliasesOf(ORG_B)).toEqual([]);
      expect((await canonicalViews(ORG_B))).toHaveLength(2);
      expect([dB.prospectId, bB.prospectId]).not.toContain(a.survivor);
      // Tenant A unchanged; no alias row anywhere crosses tenants.
      expect({ leads: await leadsOf(ORG_A), c: await contributionsOf(ORG_A), al: await aliasesOf(ORG_A) }).toEqual(aSnap);
      const { rows: crossRows } = await q(
        `SELECT count(*)::int n FROM public.prospect_aliases pa
           JOIN public.canonical_leads al ON al.id = pa.alias_lead_id
           JOIN public.canonical_leads sl ON sl.id = pa.survivor_lead_id
          WHERE al.company_id <> pa.organization_id OR sl.company_id <> pa.organization_id`);
      expect(crossRows[0].n).toBe(0);
      // The database itself refuses a cross-tenant alias (composite FK): a fresh,
      // unaliased tenant-A lead pointed at tenant B's prospect, in either direction.
      const freshA = (await q(
        `INSERT INTO public.canonical_leads (company_id, user_id, source)
         SELECT company_id, user_id, 'w6-closure-b' FROM public.canonical_leads WHERE id = $1 RETURNING id`, [a.survivor])).rows[0].id;
      const cross = (org: string, alias: string, survivor: string) => attempt(
        `INSERT INTO public.prospect_aliases (organization_id, alias_lead_id, survivor_lead_id, reason, rule_version)
         VALUES ($1, $2, $3, 'verified_identity', 'test')`, [org, alias, survivor]);
      expect(await cross(ORG_A, freshA, dB.prospectId)).toBe('23503');
      expect(await cross(ORG_B, bB.prospectId, freshA)).toBe('23503');
      // Operations: tenant B cannot resolve tenant A's key.
      const [refB] = await ops.resolveOperationalAliases([noteRef(ORG_B, a.absorbedKey)]);
      expect(refB).toEqual(noteRef(ORG_B, a.absorbedKey));
      expect((await ops.getOperationalOverlay(refB)).notes).toEqual([]);
    });
  });

  it('alias cycles, chains, self-aliases, re-pointing and updates are refused by the database', async () => {
    await inRollback(async () => {
      await seedTenants();
      const o = await orderingB(ORG_A);
      // A third prospect of the tenant (a different person) to attempt chains with.
      const other = (await q(
        `INSERT INTO public.canonical_leads (company_id, user_id, source)
         SELECT company_id, user_id, 'w6-closure-b' FROM public.canonical_leads WHERE id = $1 RETURNING id`, [o.survivor])).rows[0].id;
      const ins = (alias: string, survivor: string) => attempt(
        `INSERT INTO public.prospect_aliases (organization_id, alias_lead_id, survivor_lead_id, reason, rule_version)
         VALUES ($1, $2, $3, 'verified_identity', 'test')`, [ORG_A, alias, survivor]);
      expect(await ins(o.survivor, o.absorbed)).toBe('23514');   // cycle: survivor would point at its own alias
      expect(await ins(other, o.absorbed)).toBe('23514');        // survivor is itself an alias (not terminal)
      expect(await ins(o.survivor, other)).toBe('23514');        // alias already absorbed others (chain)
      expect(await ins(other, other)).toBe('23514');             // self
      expect(await ins(o.absorbed, other)).toBe('23505');        // re-pointing an existing alias
      expect(await attempt(`UPDATE public.prospect_aliases SET survivor_lead_id = $1 WHERE alias_lead_id = $2`, [other, o.absorbed])).toBe('23514');
      // Through the real writer: an outcome, never a throw; nothing changed.
      expect(await reconcileVerifiedSocialIdentity(ORG_A, { platform: 'reddit', platformUserId: HANDLE })).toMatchObject({ status: 'no_change', alreadyAliased: [o.absorbed] });
      expect(await aliasesOf(ORG_A)).toHaveLength(1);
      // Privileges: append-only for service_role; nothing for anon/authenticated.
      const { rows: priv } = await q(
        `SELECT has_table_privilege('service_role', 'public.prospect_aliases', 'UPDATE') su,
                has_table_privilege('service_role', 'public.prospect_aliases', 'DELETE') sd,
                has_table_privilege('service_role', 'public.prospect_aliases', 'INSERT') si,
                has_table_privilege('anon', 'public.prospect_aliases', 'SELECT') a,
                has_table_privilege('authenticated', 'public.prospect_aliases', 'SELECT') au`);
      expect(priv[0]).toEqual({ su: false, sd: false, si: true, a: false, au: false });
    });
  });
});
