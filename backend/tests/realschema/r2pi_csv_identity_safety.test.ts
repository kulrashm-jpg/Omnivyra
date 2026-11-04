/**
 * PI-FIX round 2 (2026-11-03) — CSV identity SAFETY on real PostgreSQL.
 *
 * Companion to agentg_csv_identity_characterisation.test.ts (whose C1–C5 were
 * re-stated by the same fix). These cases pin the edges of that fix: what it
 * still ACCEPTS, so a refusal never grows into a policy nobody decided, and the
 * `ignoredColumns` report. Same harness: the REAL `ingestLeadBatch` path, DB
 * transport translated to SQL, telemetry stubbed, egress forbidden.
 * Throwaway DB only; every case runs inside a rollback.
 */

jest.mock('../../db/supabaseClient', () =>
  require('./pgRestTranslator').makeSupabaseModule(() => require('./setup').db, 'r2pi'));
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
const { CSV_SOURCE } = require('../../services/leadIngestion/adapters/csvAdapter');
const { MANUAL_SOURCE } = require('../../services/leadIngestion/adapters/manualAdapter');
const { upsertFeatureFlag } = require('../../services/featureFlagService');
/* eslint-enable @typescript-eslint/no-var-requires */

const DB_URL = process.env.W6_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(DB_URL)) {
  throw new Error('r2pi_csv_identity_safety refuses a non-loopback W6_DB_URL');
}

/** Synthetic tenant for a disposable DB. Never a production identifier. */
const ORG = '0eda0896-0000-4000-8000-0000000000c2';
const AT = '2026-11-03T10:00:00.000Z';

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);

async function seed(): Promise<void> {
  await q(`INSERT INTO public.companies (id, name) VALUES ($1, 'R2PI CSV Tenant') ON CONFLICT (id) DO NOTHING`, [ORG]);
  await upsertFeatureFlag({
    organizationId: ORG, flagKey: LEAD_INGESTION_FLAG_KEY, enabled: true,
    rationale: 'r2pi real-schema throwaway DB', createdBy: null,
  });
}

const ingest = (records: Array<Record<string, unknown>>, source: string = CSV_SOURCE) =>
  ingestLeadBatch({ organizationId: ORG, source, records, now: AT });

const n = async (table: string, col: string): Promise<number> =>
  (await q(`SELECT count(*)::int n FROM public.${table} WHERE ${col}=$1`, [ORG])).rows[0].n;

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

describe('PI-FIX r2 — unmapped columns are reported, not silently dropped', () => {
  it('a row whose email arrived under an unmapped header fails AND says which columns were ignored', async () => {
    await inRollback(async () => {
      await seed();
      const r = await ingest([
        { 'E-mail': 'erin@r2pi.test', fullName: 'Erin Eve', Notes: 'met at expo' },
        { email: 'fay@r2pi.test', fullName: 'Fay Fox', 'Lead Owner': 'sam' },
        { email: 'gus@r2pi.test', fullName: 'Gus Gray' },
      ]);
      const [bad, extra, clean] = r.outcomes;
      expect(bad).toMatchObject({ ok: false, rejection: 'normalization_failed', ignoredColumns: ['E-mail', 'Notes'] });
      expect(extra).toMatchObject({ ok: true, ignoredColumns: ['Lead Owner'] });
      expect(clean.ok).toBe(true);
      expect(clean).not.toHaveProperty('ignoredColumns');
      // No other behaviour change: the raw payload still keeps the unmapped column verbatim.
      const raw = (await q(`SELECT raw_payload FROM public.source_records WHERE id=$1`, [extra.sourceRecordId])).rows[0].raw_payload;
      expect(raw['Lead Owner']).toBe('sam');
    });
  });
});

describe('PI-FIX r2 — what the conflict guard still ACCEPTS (no undecided policy enforced)', () => {
  it('a PERSONAL address arriving with two references is still one person (C2 non-role; D-1 namespace rule is open)', async () => {
    await inRollback(async () => {
      await seed();
      const r = await ingest([
        { referenceId: 'r2-A', email: 'hana@r2pi.test', fullName: 'Hana Hall' },
        { referenceId: 'r2-B', email: 'hana@r2pi.test', fullName: 'Hana Hall' },
      ]);
      expect(r).toMatchObject({ succeeded: 2, failed: 0 });
      expect(r.outcomes[0].personId).toBe(r.outcomes[1].personId);
      expect(await n('unified_persons', 'company_id')).toBe(1);
    });
  });

  it('the same person re-uploaded on a role mailbox with the same name is accepted', async () => {
    await inRollback(async () => {
      await seed();
      const r = await ingest([
        { email: 'info@r2pi-acme.test', fullName: 'Ivy Ivers', jobTitle: 'CEO' },
        { email: 'info@r2pi-acme.test', fullName: 'ivy  ivers', jobTitle: 'Founder' },
      ]);
      expect(r).toMatchObject({ succeeded: 2, failed: 0 });
    });
  });

  it('a reused reference whose row carries NO contact point still attaches (absence is not a contradiction)', async () => {
    await inRollback(async () => {
      await seed();
      const first = await ingest([{ referenceId: '7', email: 'jo@r2pi.test', fullName: 'Jo Jones' }]);
      const second = await ingest([{ referenceId: '7', fullName: 'Jo Jones', jobTitle: 'VP' }]);
      expect(second.outcomes[0]).toMatchObject({ ok: true, personId: first.outcomes[0].personId });
    });
  });

  it('manual entry is operator-asserted too: a reused manual reference with a different email is refused', async () => {
    await inRollback(async () => {
      await seed();
      const first = await ingest([{ referenceId: 'm-1', email: 'kim@r2pi.test', fullName: 'Kim Kay' }], MANUAL_SOURCE);
      const second = await ingest([{ referenceId: 'm-1', email: 'lee@r2pi.test', fullName: 'Lee Lam' }], MANUAL_SOURCE);
      expect(first.outcomes[0].ok).toBe(true);
      expect(second.outcomes[0]).toMatchObject({
        ok: false, rejection: 'identity_conflict',
        identityConflict: { reason: 'external_key_contact_mismatch', conflictingPersonId: first.outcomes[0].personId },
      });
      expect(await n('unified_persons', 'company_id')).toBe(1);
    });
  });
});

describe('PI-FIX r2 — C5 keeps same-source legacy compatibility', () => {
  it('a pre-namespacing CSV prospect keyed "42" is still adopted by CSV reference "42"', async () => {
    await inRollback(async () => {
      await seed();
      const u = (await q(`INSERT INTO public.canonical_users (company_id, user_type, device) VALUES ($1,'known','unknown') RETURNING id`, [ORG])).rows[0].id;
      const legacy = (await q(
        `INSERT INTO public.canonical_leads (company_id, user_id, source, external_lead_key) VALUES ($1,$2,'csv','42') RETURNING id`,
        [ORG, u])).rows[0].id;
      const r = await ingest([{ referenceId: '42', email: 'max@r2pi.test', fullName: 'Max Moe' }]);
      expect(r.outcomes[0]).toMatchObject({ ok: true, prospectId: legacy });
      expect(await n('canonical_leads', 'company_id')).toBe(1);
    });
  });
});
