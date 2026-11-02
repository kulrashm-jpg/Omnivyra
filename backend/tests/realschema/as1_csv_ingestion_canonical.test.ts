/**
 * AS-1 "CSV in" (Programme Execution Register PI-01) on real PostgreSQL.
 *
 * Drives the REAL production path the CSV route uses —
 * `pages/api/lead-ingestion/csv.ts` → `registerBuiltInLeadSources()` +
 * `resolveLeadIngestionGate()` + `ingestLeadBatch({ source: CSV_SOURCE })` —
 * i.e. csvAdapter.translate → W1 identity → W4 account → WS-1 prospect
 * (`canonical_leads`) → LI-2 provenance (`source_records`/`source_assertions`)
 * → LI-4C duplicate parking. Nothing about ingestion is reimplemented here.
 *
 * The route's HTTP shell (method check, `enforceCompanyAccess`,
 * `requireCapability`, body-shape checks, telemetry) is NOT exercised: it is
 * authorization and envelope validation in front of exactly the calls above,
 * and needs a signed-in principal this suite does not have.
 *
 * VOCABULARY. A CSV row's own id is `referenceId` (the `CsvLeadInput` /
 * `ManualLeadInput` field); the adapter maps it to the normalized record's
 * `externalId`. "A row with externalId" below therefore means a row that
 * carries `referenceId`.
 *
 * STUBBED, EXACTLY: the DB transport (`db/supabaseClient` + `db/writeOwner` →
 * the PostgREST-builder → SQL translator in ./pgRestTranslator, one SAVEPOINT
 * per statement), telemetry, and the network boundary (`safeFetch`, which this
 * path must never reach — it throws if it is).
 *
 * GATE: `ENABLE_LEAD_INGESTION` is set in THIS PROCESS ONLY (restored after);
 * the per-tenant `lead_ingestion` flag is written with the production writer
 * `featureFlagService.upsertFeatureFlag` into this throwaway DB, and read back
 * by the production `evaluateFeatureFlag`.
 *
 * Every test runs inside `inRollback`. A green run concerns a disposable
 * database built from the committed baseline plus replayed migrations. It is
 * NOT evidence about production.
 */

jest.mock('../../db/supabaseClient', () =>
  require('./pgRestTranslator').makeSupabaseModule(() => require('./setup').db, 'as1'));
jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => require('../../db/supabaseClient').supabase.from(table),
  ownedDbRpc: (fn: string, args: Record<string, unknown>) => require('../../db/supabaseClient').supabase.rpc(fn, args),
}));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: jest.fn(async (url: string) => { throw new Error(`unexpected egress from CSV ingestion: ${url}`); }),
}));

import { db, inRollback } from './setup';

/* eslint-disable @typescript-eslint/no-var-requires */
const { registerBuiltInLeadSources } = require('../../services/leadIngestion');
const {
  ingestLeadBatch, isLeadIngestionEnabled, resolveLeadIngestionGate, LEAD_INGESTION_FLAG_KEY,
} = require('../../services/leadIngestion/orchestrator');
const { CSV_SOURCE } = require('../../services/leadIngestion/adapters/csvAdapter');
const { upsertFeatureFlag } = require('../../services/featureFlagService');
/* eslint-enable @typescript-eslint/no-var-requires */

const DB_URL = process.env.W6_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(DB_URL)) {
  throw new Error(`as1_csv_ingestion_canonical refuses a non-loopback W6_DB_URL: ${DB_URL.replace(/:[^:@]+@/, ':***@')}`);
}

/** Synthetic test tenant for a disposable DB. Never a production identifier. */
const AS1_ORG = '0eda0896-0000-4000-8000-0000000000a1';
const AT = '2026-11-02T09:00:00.000Z';
const RUN_ID = '0eda0896-0000-4000-8000-00000000c5a1';

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);

async function seedTenant(org: string, name: string): Promise<void> {
  await q(`INSERT INTO public.companies (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [org, name]);
}

/** The tenant flag, written by the SAME service the gate reads it through. */
async function setTenantFlag(org: string, enabled: boolean): Promise<void> {
  await upsertFeatureFlag({
    organizationId: org,
    flagKey: LEAD_INGESTION_FLAG_KEY,
    enabled,
    rationale: 'as1 real-schema throwaway DB',
    createdBy: null,
  });
}

/** Rows as the client posts them after parsing the spreadsheet (W02 design). */
const ROWS_WITH_ID = (): Array<Record<string, unknown>> => [
  { referenceId: 'as1-row-001', email: 'grace.hopper@as1-navy.test', firstName: 'Grace', lastName: 'Hopper',
    jobTitle: 'Rear Admiral', companyName: 'AS1 Navy', companyDomain: 'as1-navy.test' },
  { referenceId: 'as1-row-002', email: 'alan.turing@as1-bletchley.test', firstName: 'Alan', lastName: 'Turing',
    jobTitle: 'Cryptanalyst', companyName: 'AS1 Bletchley', companyDomain: 'as1-bletchley.test' },
  { referenceId: 'as1-row-003', email: 'katherine.johnson@as1-nasa.test', fullName: 'Katherine Johnson',
    jobTitle: 'Mathematician' },
];
/** A row with an email but NO referenceId (no source externalId). */
const ROW_NO_ID = (): Record<string, unknown> =>
  ({ email: 'no.reference@as1-anon.test', fullName: 'No Reference', jobTitle: 'Analyst' });
/** A row with no referenceId, no email and no phone: carries no identity at all. */
const ROW_NO_IDENTITY = (): Record<string, unknown> => ({ fullName: 'Nobody Atall', jobTitle: 'Ghost' });

const count = async (table: string, tenantCol: string, org: string): Promise<number> =>
  (await q(`SELECT count(*)::int n FROM public.${table} WHERE ${tenantCol}=$1`, [org])).rows[0].n;

async function snapshot(org: string) {
  return {
    canonical_leads: await count('canonical_leads', 'company_id', org),
    unified_persons: await count('unified_persons', 'company_id', org),
    source_records: await count('source_records', 'organization_id', org),
    source_assertions: await count('source_assertions', 'organization_id', org),
  };
}

/** Exactly what the CSV route does after authorization. */
async function csvIngest(org: string, records: Array<Record<string, unknown>>) {
  return ingestLeadBatch({
    organizationId: org,
    source: CSV_SOURCE,
    records,
    ingestionRunId: RUN_ID,
    now: AT,
  });
}

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
describe('AS-1 — CSV in: rows become canonical records with provenance (real path)', () => {
  it('each row with externalId + email yields exactly one canonical_leads row linked to one unified_persons row, with source_records + source_assertions', async () => {
    await inRollback(async () => {
      await seedTenant(AS1_ORG, 'AS1 Tenant');
      await setTenantFlag(AS1_ORG, true);
      const before = await snapshot(AS1_ORG);

      const result = await csvIngest(AS1_ORG, ROWS_WITH_ID());
      expect(result).toMatchObject({ source: CSV_SOURCE, total: 3, succeeded: 3, failed: 0 });

      for (const row of ROWS_WITH_ID()) {
        const o = result.outcomes.find((x: { externalId: string }) => x.externalId === row.referenceId);
        expect(o).toMatchObject({ ok: true });
        expect(o.prospectId).toEqual(expect.any(String));
        expect(o.personId).toEqual(expect.any(String));
        expect(o.sourceRecordId).toEqual(expect.any(String));

        // ONE canonical prospect for this row, tenant-scoped, linked to ONE person.
        const leads = (await q(
          `SELECT id, unified_person_id, source FROM public.canonical_leads
            WHERE company_id=$1 AND unified_person_id=$2`, [AS1_ORG, o.personId])).rows;
        expect(leads).toHaveLength(1);
        expect(leads[0].id).toBe(o.prospectId);
        const persons = (await q(
          `SELECT id FROM public.unified_persons WHERE company_id=$1 AND id=$2`, [AS1_ORG, o.personId])).rows;
        expect(persons).toHaveLength(1);

        // Provenance: the source record names this row and this person …
        const recs = (await q(
          `SELECT id, provider, source_entity_type, person_id FROM public.source_records
            WHERE organization_id=$1 AND provider=$2 AND source_record_id=$3 AND source_entity_type='person'`,
          [AS1_ORG, CSV_SOURCE, row.referenceId])).rows;
        expect(recs).toHaveLength(1);
        expect(recs[0].id).toBe(o.sourceRecordId);
        expect(recs[0].person_id).toBe(o.personId);
        // … and carries at least one assertion (job_title was supplied on every row).
        const assertions = (await q(
          `SELECT attribute FROM public.source_assertions WHERE organization_id=$1 AND source_record_id=$2`,
          [AS1_ORG, o.sourceRecordId])).rows.map((r: { attribute: string }) => r.attribute);
        expect(assertions).toContain('job_title');
      }

      const after = await snapshot(AS1_ORG);
      expect(after.canonical_leads - before.canonical_leads).toBe(3);
      expect(after.unified_persons - before.unified_persons).toBe(3);
      expect(after.source_records - before.source_records).toBeGreaterThanOrEqual(3);
      expect(after.source_assertions - before.source_assertions).toBeGreaterThanOrEqual(3);

      // Three distinct people → three distinct prospects (no accidental merge).
      const ids = new Set(result.outcomes.map((o: { prospectId: string }) => o.prospectId));
      expect(ids.size).toBe(3);
    });
  });

  // PENDING FOUNDER DECISION (CSV identity, design A vs B) — this case is NOT
  // an approved contract. It records design A (mandatory source external ID);
  // design B (provisional identity with evidence status) would keep the
  // current digest behaviour. Re-state or remove this case once decided.
  // Design-A expectation: a row without externalId produces NO prospect (WS-1
  // `insufficient_evidence`) and is reported, not silently dropped.
  // Production: the CSV adapter never lets a row reach the orchestrator without
  // an externalId. `csvExternalId` (backend/services/leadIngestion/adapters/
  // csvAdapter.ts:89-99) synthesises `csv:<sha256(org|email|phone)>` when no
  // referenceId is given, `toNormalizedCsvRecord` (csvAdapter.ts:115) stamps it
  // as `externalId`, and `resolveOrCreateProspect` (prospectIdentity/
  // prospectResolution.ts:234-236) then CREATES a canonical_leads row keyed on
  // that digest. The orchestrator's insufficient_evidence branch
  // (leadIngestion/orchestrator.ts:346-381) is therefore unreachable from CSV.
  // The digest is deterministic, so this does NOT break replay idempotency
  // (asserted in the next test) — but it differs from design A.
  it.failing('PENDING CSV-IDENTITY DECISION (design A): a row without externalId yields no prospect (insufficient_evidence) and is reported', async () => {
    await inRollback(async () => {
      await seedTenant(AS1_ORG, 'AS1 Tenant');
      await setTenantFlag(AS1_ORG, true);
      const before = await snapshot(AS1_ORG);

      const result = await csvIngest(AS1_ORG, [ROW_NO_ID()]);
      expect(result.total).toBe(1);
      expect(result.outcomes).toHaveLength(1);           // reported, not dropped
      expect(result.outcomes[0].prospectId ?? null).toBeNull();
      expect((await snapshot(AS1_ORG)).canonical_leads).toBe(before.canonical_leads);
    });
  });

  it('ACTUAL (characterisation): a row without referenceId is reported and keyed on a deterministic csv:<digest>, so it is replay-stable', async () => {
    await inRollback(async () => {
      await seedTenant(AS1_ORG, 'AS1 Tenant');
      await setTenantFlag(AS1_ORG, true);

      const first = await csvIngest(AS1_ORG, [ROW_NO_ID()]);
      expect(first.outcomes).toHaveLength(1);
      expect(first.outcomes[0]).toMatchObject({ ok: true });
      expect(first.outcomes[0].externalId).toMatch(/^csv:[0-9a-f]{32}$/);
      expect(first.outcomes[0].prospectId).toEqual(expect.any(String));
      const mid = await snapshot(AS1_ORG);

      const again = await csvIngest(AS1_ORG, [ROW_NO_ID()]);
      expect(again.outcomes[0].externalId).toBe(first.outcomes[0].externalId);
      expect(again.outcomes[0].prospectId).toBe(first.outcomes[0].prospectId);
      const end = await snapshot(AS1_ORG);
      expect(end.canonical_leads).toBe(mid.canonical_leads);
      expect(end.unified_persons).toBe(mid.unified_persons);
      expect(end.source_assertions).toBe(mid.source_assertions);
    });
  });

  it('a row with no identity at all (no referenceId, email or phone) is reported as failed and writes nothing — never silently dropped', async () => {
    await inRollback(async () => {
      await seedTenant(AS1_ORG, 'AS1 Tenant');
      await setTenantFlag(AS1_ORG, true);
      const before = await snapshot(AS1_ORG);

      const result = await csvIngest(AS1_ORG, [...ROWS_WITH_ID().slice(0, 1), ROW_NO_IDENTITY()]);
      expect(result).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
      expect(result.outcomes).toHaveLength(2);
      const bad = result.outcomes.find((o: { ok: boolean }) => !o.ok);
      expect(bad).toMatchObject({ ok: false, rejection: 'normalization_failed', externalId: null });
      expect(String(bad.error)).toMatch(/email, a phone or a reference id/);

      const after = await snapshot(AS1_ORG);
      // Only the good row landed.
      expect(after.canonical_leads - before.canonical_leads).toBe(1);
      expect(after.unified_persons - before.unified_persons).toBe(1);
    });
  });

  it('replaying the same batch adds 0 rows to canonical_leads, unified_persons, source_records and source_assertions', async () => {
    await inRollback(async () => {
      await seedTenant(AS1_ORG, 'AS1 Tenant');
      await setTenantFlag(AS1_ORG, true);

      const first = await csvIngest(AS1_ORG, ROWS_WITH_ID());
      expect(first.succeeded).toBe(3);
      const afterFirst = await snapshot(AS1_ORG);

      const replay = await csvIngest(AS1_ORG, ROWS_WITH_ID());
      expect(replay).toMatchObject({ total: 3, succeeded: 3, failed: 0 });
      // Same prospect, same person, same source record for every row.
      for (const o of replay.outcomes) {
        const prev = first.outcomes.find((x: { externalId: string }) => x.externalId === o.externalId);
        expect(o.prospectId).toBe(prev.prospectId);
        expect(o.personId).toBe(prev.personId);
        expect(o.sourceRecordId).toBe(prev.sourceRecordId);
      }

      const afterReplay = await snapshot(AS1_ORG);
      expect(afterReplay).toEqual(afterFirst);
    });
  });

  describe('the ingestion gate (ENABLE_LEAD_INGESTION AND the tenant lead_ingestion flag)', () => {
    const withKillSwitch = async (value: string | undefined, body: () => Promise<void>) => {
      const prev = process.env.ENABLE_LEAD_INGESTION;
      if (value === undefined) delete process.env.ENABLE_LEAD_INGESTION;
      else process.env.ENABLE_LEAD_INGESTION = value;
      try { await body(); } finally {
        if (prev === undefined) delete process.env.ENABLE_LEAD_INGESTION;
        else process.env.ENABLE_LEAD_INGESTION = prev;
      }
    };

    const expectBlocked = async (reason: string | RegExp) => {
      const before = await snapshot(AS1_ORG);
      const gate = await resolveLeadIngestionGate(AS1_ORG);
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toMatch(reason);

      const result = await csvIngest(AS1_ORG, ROWS_WITH_ID());
      expect(result).toMatchObject({ total: 3, succeeded: 0, failed: 3 });
      for (const o of result.outcomes) expect(o).toMatchObject({ ok: false, rejection: 'ingestion_disabled' });
      expect(await snapshot(AS1_ORG)).toEqual(before);
    };

    it('kill switch OFF (unset) blocks even a tenant whose flag is on — before any DB read', async () => {
      await inRollback(async () => {
        await seedTenant(AS1_ORG, 'AS1 Tenant');
        await setTenantFlag(AS1_ORG, true);
        await withKillSwitch(undefined, async () => {
          expect(isLeadIngestionEnabled()).toBe(false);
          await expectBlocked(/^global_kill_switch_off$/);
        });
        await withKillSwitch('false', async () => {
          expect(isLeadIngestionEnabled()).toBe(false);
          await expectBlocked(/^global_kill_switch_off$/);
        });
      });
    });

    it('kill switch ON but NO tenant flag row blocks (fails closed)', async () => {
      await inRollback(async () => {
        await seedTenant(AS1_ORG, 'AS1 Tenant');
        await expectBlocked(/^tenant_flag:no_flag_row$/);
      });
    });

    it('kill switch ON but tenant flag DISABLED blocks', async () => {
      await inRollback(async () => {
        await seedTenant(AS1_ORG, 'AS1 Tenant');
        await setTenantFlag(AS1_ORG, false);
        await expectBlocked(/^tenant_flag:flag_disabled$/);
      });
    });

    it('both on → allowed, and the same batch then ingests', async () => {
      await inRollback(async () => {
        await seedTenant(AS1_ORG, 'AS1 Tenant');
        await setTenantFlag(AS1_ORG, true);
        const gate = await resolveLeadIngestionGate(AS1_ORG);
        expect(gate).toEqual({ allowed: true, reason: 'tenant_flag:flag_enabled_full_rollout' });
        const result = await csvIngest(AS1_ORG, ROWS_WITH_ID());
        expect(result.succeeded).toBe(3);
      });
    });
  });
});
