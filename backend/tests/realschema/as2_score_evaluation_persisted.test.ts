/**
 * AS-2 "profile and persisted score evaluation" (Programme Execution Register
 * PI-05) on real PostgreSQL. Until this suite no real-schema test wrote
 * `prospect_score_evaluations`.
 *
 * REAL CODE, END TO END:
 *   1. prospects are created by CSV ingestion through the real orchestrator
 *      (`ingestLeadBatch({ source: CSV_SOURCE })`, as AS-1);
 *   2. an ICP is profiled and RATIFIED through the real D1 persistence
 *      (`ensureIcp` → `createIcpVersion` → `ratifyIcpVersion`) — the functions
 *      the ICP routes call;
 *   3. one cron tick runs `runProspectScoreEvaluationJob` with its DEFAULT
 *      production ports (`productionScoreEvaluationPorts`): the canonical_leads
 *      due-query, `buildProspectIntelligenceContext` with its default seams
 *      (engagement, account intelligence, ratified ICP, person row),
 *      `assembleLeadUnderstanding`, and `persistScoreEvaluation`
 *      (leadUnderstanding/scoreEvaluationStore.ts).
 *
 * ENV: the job reads `PI_SCORE_EVALUATION_ENABLED` (must be exactly `true`) and
 * `PI_SCORE_EVALUATION_ORG_IDS` (comma-separated allow-list) — verified in
 * backend/jobs/prospectScoreEvaluationJob.ts (SCORE_EVALUATION_FLAG /
 * SCORE_EVALUATION_TENANTS). Both, and `ENABLE_LEAD_INGESTION`, are set in THIS
 * PROCESS ONLY around each tick and restored afterwards; the job is invoked
 * with its default `env = process.env`, exactly as the scheduler invokes it.
 *
 * STUBBED, EXACTLY: the DB transport (`db/supabaseClient` + `db/writeOwner` →
 * ./pgRestTranslator, one SAVEPOINT per statement), telemetry, and `safeFetch`
 * (must never be reached; throws).
 *
 * Every test runs inside `inRollback`. A green run concerns a disposable
 * database built from the committed baseline plus replayed migrations. It is
 * NOT evidence about production.
 */

jest.mock('../../db/supabaseClient', () =>
  require('./pgRestTranslator').makeSupabaseModule(() => require('./setup').db, 'as2'));
jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => require('../../db/supabaseClient').supabase.from(table),
  ownedDbRpc: (fn: string, args: Record<string, unknown>) => require('../../db/supabaseClient').supabase.rpc(fn, args),
}));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: jest.fn(async (url: string) => { throw new Error(`unexpected egress from score evaluation: ${url}`); }),
}));

import { db, inRollback } from './setup';

/* eslint-disable @typescript-eslint/no-var-requires */
const { registerBuiltInLeadSources } = require('../../services/leadIngestion');
const { ingestLeadBatch, LEAD_INGESTION_FLAG_KEY } = require('../../services/leadIngestion/orchestrator');
const { CSV_SOURCE } = require('../../services/leadIngestion/adapters/csvAdapter');
const { upsertFeatureFlag } = require('../../services/featureFlagService');
const { ensureIcp, createIcpVersion, ratifyIcpVersion } = require('../../services/prospectIcp/persistence');
const {
  runProspectScoreEvaluationJob, SCORE_EVALUATION_FLAG, SCORE_EVALUATION_TENANTS,
} = require('../../jobs/prospectScoreEvaluationJob');
const { SCORE_EVALUATIONS_TABLE } = require('../../services/leadUnderstanding/scoreEvaluationStore');
/* eslint-enable @typescript-eslint/no-var-requires */

const DB_URL = process.env.W6_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(DB_URL)) {
  throw new Error(`as2_score_evaluation_persisted refuses a non-loopback W6_DB_URL: ${DB_URL.replace(/:[^:@]+@/, ':***@')}`);
}

/** Synthetic tenants for a disposable DB. Never production identifiers. */
const ORG_IN = '0eda0896-0000-4000-8000-0000000000a2';      // allow-listed
const ORG_OUT = '0eda0896-0000-4000-8000-0000000000b2';     // NOT allow-listed
/** A human ratifier id (ratification requires one; `ratified_by` has no FK). */
const RATIFIER = '0eda0896-0000-4000-8000-0000000000e1';

const INGEST_AT = '2026-11-02T08:00:00.000Z';
const RATIFY_AT = '2026-11-02T08:30:00.000Z';
const TICK_1 = '2026-11-02T09:00:00.000Z';
const TICK_2 = '2026-11-02T10:00:00.000Z';   // the next hourly tick
const TICK_3 = '2026-11-02T11:00:00.000Z';

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);

const ROWS = (): Array<Record<string, unknown>> => [
  { referenceId: 'as2-row-001', email: 'grace.hopper@as2-navy.test', fullName: 'Grace Hopper',
    jobTitle: 'Rear Admiral', companyName: 'AS2 Navy', companyDomain: 'as2-navy.test' },
  { referenceId: 'as2-row-002', email: 'alan.turing@as2-bletchley.test', fullName: 'Alan Turing',
    jobTitle: 'Cryptanalyst', companyName: 'AS2 Bletchley', companyDomain: 'as2-bletchley.test' },
  { referenceId: 'as2-row-003', email: 'katherine.johnson@as2-nasa.test', fullName: 'Katherine Johnson',
    jobTitle: 'Mathematician' },
];

const CRITERIA_V1 = [{
  id: 'title', kind: 'required', subject: 'person', attribute: 'job_title',
  predicate: { op: 'one_of', values: ['Rear Admiral', 'Cryptanalyst'] },
}];
const CRITERIA_V2 = [{
  id: 'title', kind: 'required', subject: 'person', attribute: 'job_title',
  predicate: { op: 'one_of', values: ['Mathematician'] },
}];

async function seedTenant(org: string, name: string): Promise<void> {
  await q(`INSERT INTO public.companies (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [org, name]);
}

/** Step 1: prospects, through the real CSV ingestion path. */
async function ingest(org: string): Promise<string[]> {
  await upsertFeatureFlag({
    organizationId: org, flagKey: LEAD_INGESTION_FLAG_KEY, enabled: true,
    rationale: 'as2 real-schema throwaway DB', createdBy: null,
  });
  const result = await ingestLeadBatch({ organizationId: org, source: CSV_SOURCE, records: ROWS(), now: INGEST_AT });
  expect(result).toMatchObject({ total: 3, succeeded: 3, failed: 0 });
  return result.outcomes.map((o: { prospectId: string }) => o.prospectId);
}

/** Step 2: profile + ratify an ICP version through the real D1 persistence. */
async function ratify(org: string, criteria: unknown, ratifiedAt = RATIFY_AT): Promise<{ icpId: string; version: number }> {
  const { icpId } = await ensureIcp(org, 'default', 'AS2 default ICP');
  const { version } = await createIcpVersion({ organizationId: org, icpId, criteria, status: 'proposed' });
  await ratifyIcpVersion({ organizationId: org, icpId, version, ratifiedByUserId: RATIFIER, ratifiedAt });
  return { icpId, version };
}

/** Step 3: one scheduler tick, env set in THIS PROCESS ONLY. */
async function tick(now: string, env: Record<string, string | undefined>) {
  const keys = [SCORE_EVALUATION_FLAG, SCORE_EVALUATION_TENANTS];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) {
    if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
  }
  try {
    return await runProspectScoreEvaluationJob(undefined, undefined, now);
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k] as string;
    }
  }
}
const ON_FOR_IN = () => ({ [SCORE_EVALUATION_FLAG]: 'true', [SCORE_EVALUATION_TENANTS]: ORG_IN });

const evaluations = async (org: string) => (await q(
  `SELECT id, prospect_id, person_id, icp_id, icp_version, rules_version, input_digest,
          scored_at, confidence, score_overall
     FROM public.${SCORE_EVALUATIONS_TABLE} WHERE organization_id=$1 ORDER BY prospect_id, evaluated_at`,
  [org])).rows;

const saved: { enable?: string } = {};
beforeAll(() => {
  saved.enable = process.env.ENABLE_LEAD_INGESTION;
  process.env.ENABLE_LEAD_INGESTION = 'true'; // THIS PROCESS ONLY
  registerBuiltInLeadSources();
});
afterAll(() => {
  if (saved.enable === undefined) delete process.env.ENABLE_LEAD_INGESTION;
  else process.env.ENABLE_LEAD_INGESTION = saved.enable;
});

// ═══════════════════════════════════════════════════════════════════════════
describe('AS-2 — profile and persisted score evaluation (real job, real store)', () => {
  it('one tick after ingestion + ratified ICP writes exactly one evaluation per prospect, keyed on canonical_leads.id, with ICP version and input digest', async () => {
    await inRollback(async () => {
      await seedTenant(ORG_IN, 'AS2 Tenant In');
      const prospects = await ingest(ORG_IN);
      const { icpId, version } = await ratify(ORG_IN, CRITERIA_V1);
      expect(version).toBe(1);

      const report = await tick(TICK_1, ON_FOR_IN());
      expect(report).toMatchObject({ ran: true, tenants: 1, considered: 3, evaluated: 3, written: 3, duplicates: 0, failures: 0 });

      const rows = await evaluations(ORG_IN);
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((r: { prospect_id: string }) => r.prospect_id))).toEqual(new Set(prospects));

      const leads = (await q(
        `SELECT id, unified_person_id FROM public.canonical_leads WHERE company_id=$1`, [ORG_IN])).rows;
      const personOf = new Map(leads.map((l: { id: string; unified_person_id: string }) => [l.id, l.unified_person_id]));
      for (const r of rows) {
        expect(personOf.has(r.prospect_id)).toBe(true);            // keyed on canonical_leads.id
        expect(r.person_id).toBe(personOf.get(r.prospect_id));
        expect(r.icp_id).toBe(icpId);
        expect(r.icp_version).toBe(1);
        expect(r.rules_version).toEqual(expect.any(String));
        expect(r.input_digest).toMatch(/^[0-9a-f]{64}$/);
        expect(new Date(r.scored_at).toISOString()).toBe(TICK_1);
        expect(typeof r.confidence).toBe('number');
      }
    });
  });

  it('a second tick with no input change writes 0 rows (dedupe by digest)', async () => {
    await inRollback(async () => {
      await seedTenant(ORG_IN, 'AS2 Tenant In');
      await ingest(ORG_IN);
      await ratify(ORG_IN, CRITERIA_V1);

      const first = await tick(TICK_1, ON_FOR_IN());
      expect(first.written).toBe(3);
      const afterFirst = await evaluations(ORG_IN);

      const second = await tick(TICK_2, ON_FOR_IN());
      expect(second).toMatchObject({ ran: true, considered: 3, evaluated: 3, written: 0, duplicates: 3, failures: 0 });
      expect(await evaluations(ORG_IN)).toEqual(afterFirst);
    });
  });

  it('a tenant NOT in the allow-list gets no evaluation, even with prospects and a ratified ICP', async () => {
    await inRollback(async () => {
      await seedTenant(ORG_IN, 'AS2 Tenant In');
      await seedTenant(ORG_OUT, 'AS2 Tenant Out');
      await ingest(ORG_IN);
      await ingest(ORG_OUT);
      await ratify(ORG_IN, CRITERIA_V1);
      await ratify(ORG_OUT, CRITERIA_V1);

      const report = await tick(TICK_1, ON_FOR_IN());
      expect(report).toMatchObject({ ran: true, tenants: 1, written: 3 });
      expect(await evaluations(ORG_IN)).toHaveLength(3);
      expect(await evaluations(ORG_OUT)).toHaveLength(0);
    });
  });

  it('flag off (or empty allow-list) reads nothing and writes nothing', async () => {
    await inRollback(async () => {
      await seedTenant(ORG_IN, 'AS2 Tenant In');
      await ingest(ORG_IN);
      await ratify(ORG_IN, CRITERIA_V1);

      expect(await tick(TICK_1, { [SCORE_EVALUATION_TENANTS]: ORG_IN })).toMatchObject({ ran: false, written: 0 });
      expect(await tick(TICK_1, { [SCORE_EVALUATION_FLAG]: 'TRUE ', [SCORE_EVALUATION_TENANTS]: '' })).toMatchObject({ ran: false });
      expect(await evaluations(ORG_IN)).toHaveLength(0);
    });
  });

  it('a changed input (newly ratified ICP version) produces a new evaluation per prospect with a different digest', async () => {
    await inRollback(async () => {
      await seedTenant(ORG_IN, 'AS2 Tenant In');
      await ingest(ORG_IN);
      const v1 = await ratify(ORG_IN, CRITERIA_V1);
      expect((await tick(TICK_1, ON_FOR_IN())).written).toBe(3);
      const v1Rows = await evaluations(ORG_IN);

      const v2 = await ratify(ORG_IN, CRITERIA_V2, '2026-11-02T10:30:00.000Z');
      expect(v2).toEqual({ icpId: v1.icpId, version: 2 });

      const report = await tick(TICK_3, ON_FOR_IN());
      expect(report).toMatchObject({ written: 3, duplicates: 0, failures: 0 });

      const all = await evaluations(ORG_IN);
      expect(all).toHaveLength(6);                                   // history kept, nothing overwritten
      const v2Rows = all.filter((r: { icp_version: number }) => r.icp_version === 2);
      expect(v2Rows).toHaveLength(3);
      for (const r of v2Rows) {
        const prev = v1Rows.find((p: { prospect_id: string }) => p.prospect_id === r.prospect_id);
        expect(prev).toBeDefined();
        expect(r.input_digest).not.toBe(prev.input_digest);
      }
    });
  });
});
