/**
 * Round 3 (2026-11-03) — the CSV identity cases left open by PI-FIX round 2, on
 * real PostgreSQL. Same harness as r2pi_csv_identity_safety: the REAL
 * `ingestLeadBatch` path, DB transport translated to SQL, telemetry stubbed,
 * egress forbidden. Throwaway DB only; every case runs inside a rollback.
 *
 * BEFORE (b1d65feb, probe evidence kept outside the repo):
 *  - phone match + different email: the second human ATTACHED to the first —
 *    two live names and two live job titles on one person, two prospects on it.
 *  - name-only / disjoint-contact reuse of a reference, and a personal address
 *    with a new name: attached, the new name superseded the old, nothing told
 *    the operator.
 *
 * AFTER: the phone contradiction is refused like C3 (nothing written); the
 * name cases still attach (a correction and a different human look alike —
 * founder decision D-4) but carry an `identityReview` flag. K3 (a reference
 * dropped by last-writer-wins) is CHARACTERISED only: its fix is D-1.
 */

jest.mock('../../db/supabaseClient', () =>
  require('./pgRestTranslator').makeSupabaseModule(() => require('./setup').db, 'r3pi'));
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
const { upsertFeatureFlag } = require('../../services/featureFlagService');
/* eslint-enable @typescript-eslint/no-var-requires */

const DB_URL = process.env.W6_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(DB_URL)) {
  throw new Error('r3pi_csv_identity_open_cases refuses a non-loopback W6_DB_URL');
}

/** Synthetic tenant for a disposable DB. Never a production identifier. */
const ORG = '0eda0896-0000-4000-8000-0000000000c3';
const AT = '2026-11-03T12:00:00.000Z';

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);

async function seed(): Promise<void> {
  await q(`INSERT INTO public.companies (id, name) VALUES ($1, 'R3PI CSV Tenant') ON CONFLICT (id) DO NOTHING`, [ORG]);
  await upsertFeatureFlag({
    organizationId: ORG, flagKey: LEAD_INGESTION_FLAG_KEY, enabled: true,
    rationale: 'r3pi real-schema throwaway DB', createdBy: null,
  });
}

const ingest = (records: Array<Record<string, unknown>>) =>
  ingestLeadBatch({ organizationId: ORG, source: CSV_SOURCE, records, now: AT });

const n = async (table: string, col: string): Promise<number> =>
  (await q(`SELECT count(*)::int n FROM public.${table} WHERE ${col}=$1`, [ORG])).rows[0].n;

const liveNames = async (personId: string): Promise<string[]> =>
  (await q(`SELECT normalized_value FROM public.source_assertions
             WHERE organization_id=$1 AND person_id=$2 AND attribute='full_name' AND superseded_at IS NULL
             ORDER BY normalized_value`, [ORG, personId])).rows.map((r: { normalized_value: string }) => r.normalized_value);

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

describe('r3 — a phone match cannot fold a second human into the first (refused like C3)', () => {
  it('K4: a different email on a shared phone is REFUSED and writes nothing', async () => {
    await inRollback(async () => {
      await seed();
      const first = await ingest([{ email: 'pam@r3pi.test', phone: '+14155550103', fullName: 'Pam Park', jobTitle: 'CEO' }]);
      const second = await ingest([{ email: 'quin@r3pi.test', phone: '+14155550103', fullName: 'Quin Quay', jobTitle: 'CTO' }]);
      const a = first.outcomes[0];
      expect(a.ok).toBe(true);
      expect(second.outcomes[0]).toMatchObject({
        ok: false, rejection: 'identity_conflict',
        identityConflict: { reason: 'phone_match_email_mismatch', conflictingPersonId: a.personId, matchedBy: 'phone' },
      });
      expect(second.outcomes[0].error).not.toMatch(/quin|pam@|Quay/i);
      expect(await n('unified_persons', 'company_id')).toBe(1);
      expect(await n('canonical_leads', 'company_id')).toBe(1);
      expect(await n('source_records', 'organization_id')).toBe(1);
      expect(await liveNames(a.personId)).toEqual(['Pam Park']);
    });
  });

  it('K6: the same contradiction inside ONE batch is refused too', async () => {
    await inRollback(async () => {
      await seed();
      const r = await ingest([
        { email: 'vic@r3pi.test', phone: '+14155550106', fullName: 'Vic Vale' },
        { email: 'wes@r3pi.test', phone: '+14155550106', fullName: 'Wes West' },
      ]);
      expect(r).toMatchObject({ succeeded: 1, failed: 1 });
      expect(r.outcomes[1]).toMatchObject({ rejection: 'identity_conflict', identityConflict: { reason: 'phone_match_email_mismatch' } });
      expect(await liveNames(r.outcomes[0].personId)).toEqual(['Vic Vale']);
    });
  });

  it('K4c (behaviour change, flagged): same name + same phone + a second email is ALSO refused — the operator resubmits', async () => {
    // BEFORE: attached; the second email was stored nowhere (fill-only-when-null) and a second prospect pointed at the person.
    await inRollback(async () => {
      await seed();
      await ingest([{ email: 'tom@r3pi.test', phone: '+14155550105', fullName: 'Tom Tate' }]);
      const r = await ingest([{ email: 'tom.t@r3pi.test', phone: '+14155550105', fullName: 'Tom Tate' }]);
      expect(r.outcomes[0]).toMatchObject({ ok: false, rejection: 'identity_conflict', identityConflict: { reason: 'phone_match_email_mismatch' } });
      expect(await n('unified_persons', 'company_id')).toBe(1);
    });
  });

  it('K4b: a phone match where the person has NO email still attaches and fills (absence is not a contradiction) — flagged when the name differs', async () => {
    await inRollback(async () => {
      await seed();
      const first = await ingest([{ phone: '+14155550104', fullName: 'Ray Ross' }]);
      const second = await ingest([{ email: 'sue@r3pi.test', phone: '+14155550104', fullName: 'Sue Sims' }]);
      expect(second.outcomes[0]).toMatchObject({
        ok: true, personId: first.outcomes[0].personId,
        identityReview: { reason: 'name_mismatch', personId: first.outcomes[0].personId, matchedBy: 'phone' },
      });
      const p = (await q(`SELECT primary_email FROM public.unified_persons WHERE id=$1`, [first.outcomes[0].personId])).rows[0];
      expect(p.primary_email).toBe('sue@r3pi.test');
    });
  });
});

describe('r3 — attached name contradictions are FLAGGED for review, never refused (D-4 open)', () => {
  it('K1: a reused reference with no contact point and a different name attaches with identityReview', async () => {
    await inRollback(async () => {
      await seed();
      const first = await ingest([{ referenceId: '7', email: 'jo@r3pi.test', fullName: 'Jo Jones' }]);
      const second = await ingest([{ referenceId: '7', fullName: 'Kai Kent' }]);
      expect(second.outcomes[0]).toMatchObject({
        ok: true, personId: first.outcomes[0].personId,
        identityReview: { reason: 'name_mismatch', matchedBy: 'external_keys' },
      });
    });
  });

  it('K2: disjoint contact points + a different name attach with identityReview; with the SAME name there is no flag (K2b)', async () => {
    await inRollback(async () => {
      await seed();
      await ingest([{ referenceId: '8', email: 'lou@r3pi.test', fullName: 'Lou Lee' }]);
      const diff = await ingest([{ referenceId: '8', phone: '+14155550101', fullName: 'Max Moe' }]);
      expect(diff.outcomes[0]).toMatchObject({ ok: true, identityReview: { reason: 'name_mismatch', matchedBy: 'external_keys' } });
      await ingest([{ referenceId: '9', email: 'ned@r3pi.test', fullName: 'Ned Nash' }]);
      const same = await ingest([{ referenceId: '9', phone: '+14155550102', fullName: 'Ned Nash' }]);
      expect(same.outcomes[0].ok).toBe(true);
      expect(same.outcomes[0]).not.toHaveProperty('identityReview');
    });
  });

  it('K5: a personal address with a different name attaches with identityReview', async () => {
    await inRollback(async () => {
      await seed();
      await ingest([{ email: 'uma@r3pi.test', fullName: 'Uma Upton' }]);
      const r = await ingest([{ email: 'uma@r3pi.test', fullName: 'Uma Vance' }]);
      expect(r.outcomes[0]).toMatchObject({ ok: true, identityReview: { reason: 'name_mismatch', matchedBy: 'email' } });
    });
  });

  it('a first-time person carries no identityReview', async () => {
    await inRollback(async () => {
      await seed();
      const r = await ingest([{ email: 'new@r3pi.test', fullName: 'New Person' }]);
      expect(r.outcomes[0].ok).toBe(true);
      expect(r.outcomes[0]).not.toHaveProperty('identityReview');
    });
  });
});

describe('r3 — K3 characterisation only (fix is founder decision D-1)', () => {
  it('a personal address re-uploaded under reference B, then reference A alone, SPLITS: an orphan person is created while prospect csv:A stays on the original person', async () => {
    await inRollback(async () => {
      await seed();
      const a1 = (await ingest([{ referenceId: 'A', email: 'oli@r3pi.test', fullName: 'Oli Orr' }])).outcomes[0];
      await ingest([{ referenceId: 'B', email: 'oli@r3pi.test', fullName: 'Oli Orr' }]);
      const keys = (await q(`SELECT external_keys FROM public.unified_persons WHERE id=$1`, [a1.personId])).rows[0].external_keys;
      expect(keys).toEqual({ csv: { external_id: 'B' } });   // last writer wins: reference A is no longer resolvable by external_keys
      const a2 = (await ingest([{ referenceId: 'A', fullName: 'Oli Orr', jobTitle: 'VP' }])).outcomes[0];
      expect(a2.ok).toBe(true);
      expect(a2.prospectId).toBe(a1.prospectId);              // the prospect still resolves by csv:A ...
      expect(a2.personId).not.toBe(a1.personId);              // ... but the person resolver minted a NEW person
      const lead = (await q(`SELECT unified_person_id FROM public.canonical_leads WHERE id=$1`, [a1.prospectId])).rows[0];
      expect(lead.unified_person_id).toBe(a1.personId);       // so the outcome's person and the prospect's person disagree
      expect(await n('unified_persons', 'company_id')).toBe(2);
    });
  });
});
