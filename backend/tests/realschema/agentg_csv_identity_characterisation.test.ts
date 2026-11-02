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

describe('Agent G — CSV identity characterisation (ACTUAL behaviour, not a contract)', () => {
  it('C1 role address, no reference: two different humans on info@ collapse into ONE person and ONE prospect', async () => {
    await inRollback(async () => {
      await seed();
      const r = await ingest([
        { email: 'info@agentg-acme.test', fullName: 'Alice Able', jobTitle: 'CEO' },
        { email: 'info@agentg-acme.test', fullName: 'Bob Baker', jobTitle: 'CTO' },
      ]);
      expect(r).toMatchObject({ total: 2, succeeded: 2, failed: 0 });
      const [a, b] = r.outcomes;
      expect(a.externalId).toBe(b.externalId);          // same csv:<digest>, the name is not in the digest
      expect(a.prospectId).toBe(b.prospectId);
      expect(a.personId).toBe(b.personId);
      expect(await n('canonical_leads', 'company_id')).toBe(1);
      expect(await n('unified_persons', 'company_id')).toBe(1);
      expect(a.duplicatesParked + b.duplicatesParked).toBe(0);  // nothing surfaces the collapse
      // Bob's row re-observes the SAME source record; Alice's claims are superseded.
      const titles = (await q(
        `SELECT normalized_value, superseded_at IS NOT NULL AS superseded FROM public.source_assertions
          WHERE organization_id=$1 AND attribute='job_title' ORDER BY recorded_at, id`, [ORG])).rows;
      expect(titles.map((t: { normalized_value: string }) => t.normalized_value).sort()).toEqual(['CEO', 'CTO']);
      expect(titles.filter((t: { superseded: boolean }) => !t.superseded).map((t: { normalized_value: string }) => t.normalized_value)).toEqual(['CTO']);
    });
  });

  it('C2 role address WITH distinct references: ONE person carrying TWO prospects; no duplicate is parked', async () => {
    await inRollback(async () => {
      await seed();
      const r = await ingest([
        { referenceId: 'agentg-A', email: 'sales@agentg-acme.test', fullName: 'Alice Able' },
        { referenceId: 'agentg-B', email: 'sales@agentg-acme.test', fullName: 'Bob Baker' },
      ]);
      expect(r).toMatchObject({ succeeded: 2, failed: 0 });
      const [a, b] = r.outcomes;
      expect(a.personId).toBe(b.personId);
      expect(a.prospectId).not.toBe(b.prospectId);
      expect(await n('canonical_leads', 'company_id')).toBe(2);
      expect(await n('unified_persons', 'company_id')).toBe(1);
      expect(await leadPerson(a.prospectId)).toBe(a.personId);
      expect(await leadPerson(b.prospectId)).toBe(a.personId);
      // external_keys.csv.external_id is a SCALAR: the second reference overwrote the first.
      const keys = (await q(`SELECT external_keys FROM public.unified_persons WHERE id=$1`, [a.personId])).rows[0].external_keys;
      expect(keys).toEqual({ csv: { external_id: 'agentg-B' } });
    });
  });

  it('C3 one reference namespace per tenant: a later upload reusing reference "1" for a DIFFERENT email is MERGED into the first person, and the new email is discarded', async () => {
    await inRollback(async () => {
      await seed();
      const first = await ingest([{ referenceId: '1', email: 'alice@agentg-one.test', fullName: 'Alice Able' }]);
      const second = await ingest([{ referenceId: '1', email: 'bob@agentg-two.test', fullName: 'Bob Baker' }]);
      const a = first.outcomes[0];
      const b = second.outcomes[0];
      expect(b.ok).toBe(true);
      // Email misses, so W1 falls through to external_keys {csv:{external_id:'1'}} and matches ALICE.
      expect(b.personId).toBe(a.personId);
      expect(b.prospectId).toBe(a.prospectId);
      expect(await n('canonical_leads', 'company_id')).toBe(1);
      expect(await n('unified_persons', 'company_id')).toBe(1);
      // primary_email is fill-only-when-null, so Bob's address is stored NOWHERE on the spine.
      const p = (await q(`SELECT primary_email FROM public.unified_persons WHERE id=$1`, [a.personId])).rows[0];
      expect(p.primary_email).toBe('alice@agentg-one.test');
      expect(b.duplicatesParked).toBe(0);               // nothing surfaces the conflict
      // Bob's name is now a live claim about Alice; Alice's is superseded.
      const names = (await q(
        `SELECT normalized_value, superseded_at IS NULL AS live FROM public.source_assertions
          WHERE organization_id=$1 AND person_id=$2 AND attribute='full_name'`, [ORG, a.personId])).rows;
      expect(names.filter((r: { live: boolean }) => r.live).map((r: { normalized_value: string }) => r.normalized_value)).toEqual(['Bob Baker']);
      expect(b.sourceRecordId).toBe(a.sourceRecordId);
    });
  });

  it('C4 an operator reference that equals a synthesised digest is accepted verbatim and lands on the id-less row\'s prospect', async () => {
    await inRollback(async () => {
      await seed();
      const anon = { email: 'anon@agentg-x.test', fullName: 'Anon Row' };
      const digest = csvExternalId({ ...anon, organizationId: ORG });
      expect(digest).toMatch(/^csv:[0-9a-f]{32}$/);
      const first = await ingest([anon]);
      const second = await ingest([{ referenceId: digest, email: 'carol@agentg-y.test', fullName: 'Carol Cole' }]);
      expect(second.outcomes[0].personId).not.toBe(first.outcomes[0].personId);
      expect(second.outcomes[0].prospectId).toBe(first.outcomes[0].prospectId);
    });
  });

  it('C5 legacy raw key fallback is source-blind: CSV reference "42" matches a pre-namespacing prospect of ANOTHER source keyed "42"', async () => {
    await inRollback(async () => {
      await seed();
      const u = (await q(`INSERT INTO public.canonical_users (company_id, user_type, device) VALUES ($1,'known','unknown') RETURNING id`, [ORG])).rows[0].id;
      const legacy = (await q(
        `INSERT INTO public.canonical_leads (company_id, user_id, source, external_lead_key) VALUES ($1,$2,'crm','42') RETURNING id`,
        [ORG, u])).rows[0].id;
      const r = await ingest([{ referenceId: '42', email: 'dave@agentg-z.test', fullName: 'Dave Dunn' }]);
      expect(r.outcomes[0].ok).toBe(true);
      expect(r.outcomes[0].prospectId).toBe(legacy);
      // A person-less legacy prospect is NOT anchored by ingestion (only reconciliation attaches).
      expect(await leadPerson(legacy)).toBeNull();
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
