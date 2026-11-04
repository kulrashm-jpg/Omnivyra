/**
 * Agent G (2026-11-03) — CSV identity CHARACTERISATION on real PostgreSQL.
 *
 * Records what the candidate (d1c342c2) ACTUALLY does for the CSV identity
 * cases that the founder's design A vs B decision has to rule on. Nothing here
 * is a ratified contract: every assertion pins CURRENT behaviour so the
 * decision is taken against measured facts, not against a reading of the code.
 * When A or B is ratified, the cases that contradict it must be re-stated.
 *
 * Same harness and stubs as as1_csv_ingestion_canonical.test.ts: the REAL
 * `ingestLeadBatch({ source: CSV_SOURCE })` path, DB transport translated to
 * SQL, telemetry stubbed, egress forbidden. Throwaway DB only.
 */

jest.mock('../../db/supabaseClient', () =>
  require('./pgRestTranslator').makeSupabaseModule(() => require('./setup').db, 'agentg'));
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
const { ingestLeadBatch, LEAD_INGESTION_FLAG_KEY } = require('../../services/leadIngestion/orchestrator');
const { CSV_SOURCE, csvExternalId } = require('../../services/leadIngestion/adapters/csvAdapter');
const { upsertFeatureFlag } = require('../../services/featureFlagService');
/* eslint-enable @typescript-eslint/no-var-requires */

const DB_URL = process.env.W6_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(DB_URL)) {
  throw new Error('agentg_csv_identity_characterisation refuses a non-loopback W6_DB_URL');
}

/** Synthetic tenant for a disposable DB. Never a production identifier. */
const ORG = '0eda0896-0000-4000-8000-0000000000c1';
const AT = '2026-11-03T09:00:00.000Z';

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);

async function seed(): Promise<void> {
  await q(`INSERT INTO public.companies (id, name) VALUES ($1, 'AgentG CSV Tenant') ON CONFLICT (id) DO NOTHING`, [ORG]);
  await upsertFeatureFlag({
    organizationId: ORG, flagKey: LEAD_INGESTION_FLAG_KEY, enabled: true,
    rationale: 'agentg real-schema throwaway DB', createdBy: null,
  });
}

const ingest = (records: Array<Record<string, unknown>>) =>
  ingestLeadBatch({ organizationId: ORG, source: CSV_SOURCE, records, now: AT });

const n = async (table: string, col: string): Promise<number> =>
  (await q(`SELECT count(*)::int n FROM public.${table} WHERE ${col}=$1`, [ORG])).rows[0].n;

const leadPerson = async (prospectId: string): Promise<string | null> =>
  (await q(`SELECT unified_person_id FROM public.canonical_leads WHERE id=$1 AND company_id=$2`, [prospectId, ORG])).rows[0]?.unified_person_id ?? null;

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

describe('Agent G — CSV identity characterisation (ACTUAL behaviour after PI-FIX round 2, not a contract)', () => {
  // ── PI-FIX round 2 (2026-11-03) ──────────────────────────────────────────
  // C1–C5 below were re-stated after the fix on fix/pi-csv-identity-safety. The
  // ORIGINAL characterisation is kept in each test's comment so the before/after
  // is readable in one place. Policy decisions D-1, D-3 and D-4 remain OPEN: the
  // fix only makes ingestion REFUSE (with a reported reason) where it used to
  // attach silently. It changes no key format and no stored key.

  it('C1 role address, no reference: a second, differently-named human on info@ is REFUSED (identity_conflict), not fused', async () => {
    // BEFORE: same digest, 1 person, 1 prospect, Bob's CTO superseded Alice's CEO, nothing parked.
    await inRollback(async () => {
      await seed();
      const r = await ingest([
        { email: 'info@agentg-acme.test', fullName: 'Alice Able', jobTitle: 'CEO' },
        { email: 'info@agentg-acme.test', fullName: 'Bob Baker', jobTitle: 'CTO' },
      ]);
      expect(r).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
      const [a, b] = r.outcomes;
      expect(a.ok).toBe(true);
      expect(b).toMatchObject({
        ok: false, rejection: 'identity_conflict',
        identityConflict: { reason: 'role_address_name_mismatch', conflictingPersonId: a.personId, matchedBy: 'email' },
      });
      expect(await n('canonical_leads', 'company_id')).toBe(1);
      expect(await n('unified_persons', 'company_id')).toBe(1);
      expect(await n('source_records', 'organization_id')).toBe(1);
      // Alice's claims are intact: Bob's row wrote nothing.
      const titles = (await q(
        `SELECT normalized_value, superseded_at IS NOT NULL AS superseded FROM public.source_assertions
          WHERE organization_id=$1 AND attribute='job_title' ORDER BY recorded_at, id`, [ORG])).rows;
      expect(titles).toEqual([{ normalized_value: 'CEO', superseded: false }]);
    });
  });

  it('C2 role address WITH distinct references: the second named person is REFUSED; the first keeps its reference', async () => {
    // BEFORE: 1 person carrying 2 prospects; external_keys.csv overwritten to 'agentg-B'; nothing parked.
    await inRollback(async () => {
      await seed();
      const r = await ingest([
        { referenceId: 'agentg-A', email: 'sales@agentg-acme.test', fullName: 'Alice Able' },
        { referenceId: 'agentg-B', email: 'sales@agentg-acme.test', fullName: 'Bob Baker' },
      ]);
      expect(r).toMatchObject({ succeeded: 1, failed: 1 });
      const [a, b] = r.outcomes;
      expect(b).toMatchObject({ rejection: 'identity_conflict', identityConflict: { reason: 'role_address_name_mismatch' } });
      expect(await n('canonical_leads', 'company_id')).toBe(1);
      expect(await n('unified_persons', 'company_id')).toBe(1);
      expect(await leadPerson(a.prospectId)).toBe(a.personId);
      const keys = (await q(`SELECT external_keys FROM public.unified_persons WHERE id=$1`, [a.personId])).rows[0].external_keys;
      expect(keys).toEqual({ csv: { external_id: 'agentg-A' } });
    });
  });

  it('C3 reference reuse with a DIFFERENT email: the later row is REFUSED (identity_conflict) instead of merged into the first person', async () => {
    // BEFORE: matched Alice via external_keys, Bob's email stored nowhere, Bob's name a live claim on Alice, nothing parked.
    await inRollback(async () => {
      await seed();
      const first = await ingest([{ referenceId: '1', email: 'alice@agentg-one.test', fullName: 'Alice Able' }]);
      const second = await ingest([{ referenceId: '1', email: 'bob@agentg-two.test', fullName: 'Bob Baker' }]);
      const a = first.outcomes[0];
      const b = second.outcomes[0];
      expect(a.ok).toBe(true);
      expect(b).toMatchObject({
        ok: false, externalId: '1', rejection: 'identity_conflict',
        identityConflict: { reason: 'external_key_contact_mismatch', conflictingPersonId: a.personId, matchedBy: 'external_keys' },
      });
      expect(b.error).not.toMatch(/bob|alice@|Baker/i);   // ids and reason only
      expect(await n('canonical_leads', 'company_id')).toBe(1);
      expect(await n('unified_persons', 'company_id')).toBe(1);
      expect(await n('source_records', 'organization_id')).toBe(1);
      const names = (await q(
        `SELECT normalized_value, superseded_at IS NULL AS live FROM public.source_assertions
          WHERE organization_id=$1 AND person_id=$2 AND attribute='full_name'`, [ORG, a.personId])).rows;
      expect(names).toEqual([{ normalized_value: 'Alice Able', live: true }]);
      // Re-uploading Alice's own row with the same reference still converges.
      const replay = await ingest([{ referenceId: '1', email: 'alice@agentg-one.test', fullName: 'Alice Able' }]);
      expect(replay.outcomes[0]).toMatchObject({ ok: true, personId: a.personId, prospectId: a.prospectId });
    });
  });

  it('C4 an operator reference in the platform csv: namespace is REFUSED (normalization_failed), so it cannot land on an id-less row\'s prospect', async () => {
    // BEFORE: accepted verbatim; a different person landed on the id-less row's prospect.
    await inRollback(async () => {
      await seed();
      const anon = { email: 'anon@agentg-x.test', fullName: 'Anon Row' };
      const digest = csvExternalId({ ...anon, organizationId: ORG });
      expect(digest).toMatch(/^csv:[0-9a-f]{32}$/);
      const first = await ingest([anon]);
      const second = await ingest([{ referenceId: digest, email: 'carol@agentg-y.test', fullName: 'Carol Cole' }]);
      expect(first.outcomes[0].ok).toBe(true);
      expect(second.outcomes[0]).toMatchObject({ ok: false, rejection: 'normalization_failed' });
      expect(second.outcomes[0].error).toMatch(/may not begin with 'csv:'/);
      expect(await n('canonical_leads', 'company_id')).toBe(1);
      expect(await n('unified_persons', 'company_id')).toBe(1);
    });
  });

  it('C5 legacy raw key fallback is confined to the same source: CSV reference "42" no longer adopts a pre-namespacing CRM prospect keyed "42"', async () => {
    // BEFORE: matched the crm prospect (source-blind); it stayed person-less.
    await inRollback(async () => {
      await seed();
      const u = (await q(`INSERT INTO public.canonical_users (company_id, user_type, device) VALUES ($1,'known','unknown') RETURNING id`, [ORG])).rows[0].id;
      const legacy = (await q(
        `INSERT INTO public.canonical_leads (company_id, user_id, source, external_lead_key) VALUES ($1,$2,'crm','42') RETURNING id`,
        [ORG, u])).rows[0].id;
      const r = await ingest([{ referenceId: '42', email: 'dave@agentg-z.test', fullName: 'Dave Dunn' }]);
      expect(r.outcomes[0].ok).toBe(true);
      expect(r.outcomes[0].prospectId).not.toBe(legacy);
      const created = (await q(`SELECT source, external_lead_key, unified_person_id FROM public.canonical_leads WHERE id=$1`, [r.outcomes[0].prospectId])).rows[0];
      expect(created).toEqual({ source: 'csv', external_lead_key: 'csv:42', unified_person_id: r.outcomes[0].personId });
      expect(await leadPerson(legacy)).toBeNull();   // the CRM prospect is untouched
    });
  });

  it('C6 an email-only row and a phone-only row for the same human stay TWO persons and TWO prospects', async () => {
    await inRollback(async () => {
      await seed();
      const r = await ingest([
        { email: 'erin@agentg-w.test', fullName: 'Erin Eve' },
        { phone: '+14155550123', fullName: 'Erin Eve' },
      ]);
      expect(r).toMatchObject({ succeeded: 2 });
      expect(r.outcomes[0].personId).not.toBe(r.outcomes[1].personId);
      expect(r.outcomes[0].prospectId).not.toBe(r.outcomes[1].prospectId);
      expect(r.outcomes[0].duplicatesParked + r.outcomes[1].duplicatesParked).toBe(0);
    });
  });
});
