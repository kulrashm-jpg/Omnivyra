/**
 * Workstream E — migration 20270108000001_pi_provenance_privacy_and_marketpulse.sql
 * against real PostgreSQL.
 *
 * A green run here concerns a disposable database built from the committed
 * baseline plus replayed migrations. It is NOT evidence about the production
 * database and must not be reported as production verification.
 *
 *   #8  MarketPulse tenant isolation — tenant B processing the same global
 *       signal never changes tenant A's observation or the shared row; the
 *       observation key is per tenant; service_role cannot UPDATE/DELETE.
 *   #10 Privacy redaction preserves the audit trail — after the redaction the
 *       contribution exists, its personal URL / evidence / metadata are gone, a
 *       tombstone exists with reason (value hash retired by 20270109000000) (and never the values),
 *       service_role still cannot UPDATE/DELETE contributions directly,
 *       cross-tenant redaction is refused with nothing changed, the call is
 *       idempotent, and the tombstone survives the contribution's deletion.
 *
 * Conventions follow the other suites: every mutation runs inside `inRollback`;
 * `attempt` returns 'ok' or the SQLSTATE.
 */
jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: () => { throw new Error('the realschema suite talks to PostgreSQL directly'); },
  ownedDbRpc: () => { throw new Error('the realschema suite talks to PostgreSQL directly'); },
}));

import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newLead, newPerson } from './setup';

const PSC = 'public.prospect_source_contributions';
const TOMB = 'public.prospect_source_contribution_redactions';
const OBS = 'public.marketpulse_signal_observations';
const FN = 'public.pi_redact_prospect_source_contributions';

// ── fixtures ────────────────────────────────────────────────────────────────

const PERSONAL_URL = 'https://www.linkedin.com/in/jane-doe-12345';
const PERSONAL_EVIDENCE = { excerpt: 'Jane Doe wrote: we are evaluating vendors', authorHandle: 'janedoe' };
const PERSONAL_META = { contactKey: 'reddit:janedoe', language: 'en' };

async function contribution(org: string, lead: string, ref = 'community:1'): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO ${PSC} (organization_id, canonical_lead_id, contribution_role, source_category, external_ref,
                         platform, source_url, observed_at, evidence, source_metadata)
     VALUES ($1,$2,'contributing','community',$3,'reddit',$4,'2026-10-01T00:00:00Z',$5::jsonb,$6::jsonb) RETURNING id`,
    [org, lead, ref, PERSONAL_URL, JSON.stringify(PERSONAL_EVIDENCE), JSON.stringify(PERSONAL_META)]);
  return rows[0].id;
}
const redact = (org: string, leads: string[], reason = 'person erased: subject request', by = 'person_erasure') =>
  db.query(`SELECT ${FN}($1::uuid, $2::uuid[], $3, $4) AS r`, [org, leads, reason, by]).then((x) => x.rows[0].r);
const pscRow = async (id: string) => (await db.query(`SELECT * FROM ${PSC} WHERE id=$1`, [id])).rows[0];
const tombs = async (where = 'true', p: unknown[] = []) =>
  (await db.query(`SELECT * FROM ${TOMB} WHERE ${where} ORDER BY redacted_at, id`, p)).rows;

async function signal(key: string, title = 'Cloud pricing shift', summary = 'first observer wording'): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.marketpulse_signals (signal_type, signal_category, title, summary, duplicate_key)
     VALUES ('technology','technology',$1,$2,$3) RETURNING id`, [title, summary, key]);
  return rows[0].id;
}
const OBS_INS = `INSERT INTO ${OBS} (company_id, signal_id, observation_key, run_id, finding_id, observed_at, title, summary, source_url, snapshot)
  VALUES ($1,$2,$3,NULL,NULL,$4,$5,$6,$7,$8::jsonb) RETURNING id`;
const observe = (org: string, sig: string, key: string, summary: string, at = '2026-10-29T04:30:00Z') =>
  db.query(OBS_INS, [org, sig, key, at, 'Cloud pricing shift', summary, null, JSON.stringify({ summary })]);

async function asServiceRole<T>(body: () => Promise<T>): Promise<T> {
  await db.query('SET LOCAL ROLE service_role');
  try { return await body(); } finally { await db.query('RESET ROLE'); }
}

// ───────────────────────────────────────────────────────────────────────────

describe('20270108000001 — schema shape and privileges', () => {
  it('both tables: RLS enabled, not forced, exactly one service_role policy', async () => {
    for (const t of ['marketpulse_signal_observations', 'prospect_source_contribution_redactions']) {
      const { rows } = await db.query(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ('public.' || $1)::regclass`, [t]);
      expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: false });
      const pol = await db.query(`SELECT roles::text[] AS roles FROM pg_policies WHERE schemaname='public' AND tablename=$1`, [t]);
      expect(pol.rows).toEqual([{ roles: ['service_role'] }]);
    }
  });

  it('privileges: observations SELECT+INSERT, tombstones SELECT, contributions still SELECT+INSERT; client roles nothing', async () => {
    const priv = async (t: string, role: string) => (await db.query(
      `SELECT array_agg(p ORDER BY p) AS ps FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
        WHERE has_table_privilege($2, $1::regclass, p)`, [t, role])).rows[0].ps;
    expect(await priv(OBS, 'service_role')).toEqual(['INSERT', 'SELECT']);
    expect(await priv(TOMB, 'service_role')).toEqual(['SELECT']);
    expect(await priv(PSC, 'service_role')).toEqual(['INSERT', 'SELECT']);
    for (const t of [OBS, TOMB, PSC]) {
      for (const r of ['anon', 'authenticated']) expect(await priv(t, r)).toBeNull();
    }
  });

  it('function: SECURITY DEFINER, search_path pinned, EXECUTE for service_role only', async () => {
    const { rows } = await db.query(
      `SELECT p.prosecdef, p.proconfig,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authd
         FROM pg_proc p WHERE p.oid = '${FN}(uuid, uuid[], text, text)'::regprocedure`);
    expect(rows[0]).toEqual({ prosecdef: true, proconfig: ['search_path=""'], svc: true, anon: false, authd: false });
  });

  it('as anon / authenticated the function cannot be called (42501)', () => inRollback(async () => {
    await seedTenants();
    for (const role of ['anon', 'authenticated']) {
      await db.query(`SET LOCAL ROLE ${role}`);
      const code = await attempt(`SELECT ${FN}($1::uuid, ARRAY[]::uuid[], 'r', 'x')`, [ORG_A]);
      await db.query('RESET ROLE');
      expect(code).toBe('42501');
    }
  }));
});

describe('acceptance #8 — MarketPulse tenant isolation (real PG)', () => {
  it('tenant B observing the same global signal changes neither tenant A\'s observation nor the shared row', () => inRollback(async () => {
    await seedTenants();
    const sig = await signal('mp-e-1');
    const sharedBefore = (await db.query('SELECT * FROM public.marketpulse_signals WHERE id=$1', [sig])).rows[0];

    await asServiceRole(async () => { await observe(ORG_A, sig, 'finding:a1', 'Tenant A wording'); });
    const aBefore = (await db.query(`SELECT * FROM ${OBS} WHERE company_id=$1`, [ORG_A])).rows;

    // Tenant B: its own observation, and an attempted re-insert of the shared
    // signal by duplicate_key (what the writer does) — refused, row untouched.
    await asServiceRole(async () => { await observe(ORG_B, sig, 'finding:a1', 'Tenant B wording', '2026-10-30T04:30:00Z'); });
    expect(await attempt(
      `INSERT INTO public.marketpulse_signals (signal_type, signal_category, title, summary, duplicate_key)
       VALUES ('technology','technology','Cloud pricing shift','Tenant B wording','mp-e-1')`)).toBe('23505');

    expect((await db.query(`SELECT * FROM ${OBS} WHERE company_id=$1`, [ORG_A])).rows).toEqual(aBefore);
    expect((await db.query('SELECT * FROM public.marketpulse_signals WHERE id=$1', [sig])).rows[0]).toEqual(sharedBefore);
    const all = (await db.query(`SELECT company_id, summary FROM ${OBS} WHERE signal_id=$1 ORDER BY company_id`, [sig])).rows;
    expect(all).toEqual([{ company_id: ORG_A, summary: 'Tenant A wording' }, { company_id: ORG_B, summary: 'Tenant B wording' }]);
  }));

  it('idempotency key is per (tenant, signal): a retry by the same tenant is 23505, the same key by another tenant is fine', () => inRollback(async () => {
    await seedTenants();
    const sig = await signal('mp-e-2');
    await observe(ORG_A, sig, 'finding:x', 'A');
    expect(await attempt(OBS_INS, [ORG_A, sig, 'finding:x', '2026-10-29T00:00:00Z', 't', 'A again', null, '{}'])).toBe('23505');
    expect(await attempt(OBS_INS, [ORG_B, sig, 'finding:x', '2026-10-29T00:00:00Z', 't', 'B', null, '{}'])).toBe('ok');
  }));

  it('as service_role an observation cannot be UPDATEd or DELETEd (42501)', () => inRollback(async () => {
    await seedTenants();
    const sig = await signal('mp-e-3');
    const { rows } = await observe(ORG_A, sig, 'run:r', 'A');
    await db.query('SET LOCAL ROLE service_role');
    const up = await attempt(`UPDATE ${OBS} SET summary='overwritten' WHERE id=$1`, [rows[0].id]);
    const del = await attempt(`DELETE FROM ${OBS} WHERE id=$1`, [rows[0].id]);
    await db.query('RESET ROLE');
    expect([up, del]).toEqual(['42501', '42501']);
  }));

  it('CHECKs: un-namespaced key and non-object snapshot are refused (23514)', () => inRollback(async () => {
    await seedTenants();
    const sig = await signal('mp-e-4');
    expect(await attempt(OBS_INS, [ORG_A, sig, 'nonamespace', '2026-10-29T00:00:00Z', 't', 's', null, '{}'])).toBe('23514');
    expect(await attempt(OBS_INS, [ORG_A, sig, 'run:1', '2026-10-29T00:00:00Z', 't', 's', null, '[]'])).toBe('23514');
  }));

  it('a signal delete cascades to its observations', () => inRollback(async () => {
    await seedTenants();
    const sig = await signal('mp-e-5');
    await observe(ORG_A, sig, 'run:1', 'A');
    await db.query('DELETE FROM public.marketpulse_signals WHERE id=$1', [sig]);
    expect((await db.query(`SELECT count(*)::int n FROM ${OBS} WHERE signal_id=$1`, [sig])).rows[0].n).toBe(0);
  }));
});

describe('acceptance #10 — privacy redaction preserves the audit trail (real PG)', () => {
  it('as service_role: contribution survives, personal data gone, tombstone with reason (no value hash since 20270109000000), never the values', () => inRollback(async () => {
    await seedTenants();
    const person = await newPerson(ORG_A);
    const lead = await newLead(ORG_A, { personId: person });
    const c = await contribution(ORG_A, lead);
    const before = await pscRow(c);

    const r = await asServiceRole(() => redact(ORG_A, [lead]));
    expect(r).toEqual({ redacted: 1, already_redacted: 0, contribution_ids: [c] });

    const after = await pscRow(c);
    expect(after).toBeDefined();                                       // never deleted
    expect(after.source_url).toBeNull();
    const [t] = await tombs('contribution_id=$1', [c]);
    // Closure A (20270109000000): the marker also names the erasure event, and
    // the linkable external_ref is replaced by a non-linkable marker.
    expect(after.evidence).toEqual({ redacted: true, redaction_id: t.id, erasure_id: t.erasure_id });
    expect(after.source_metadata).toEqual({ redacted: true, redaction_id: t.id, erasure_id: t.erasure_id });
    expect(after.external_ref).toBe(`redacted:${c}`);
    // Everything that is not personal is untouched.
    for (const k of ['id', 'organization_id', 'canonical_lead_id', 'contribution_role', 'source_category',
      'platform', 'observed_at', 'created_at', 'ingestion_run_id']) {
      expect(after[k]).toEqual(before[k]);
    }

    expect(t).toMatchObject({
      organization_id: ORG_A, contribution_id: c, canonical_lead_id: lead,
      reason: 'person erased: subject request', requested_by: 'person_erasure', values_sha256: null,
    });
    expect(t.redacted_fields).toEqual([
      'external_ref', 'source_url', 'evidence.authorHandle', 'evidence.excerpt', 'source_metadata.contactKey', 'source_metadata.language',
    ]);
    // The tombstone carries no redacted VALUE anywhere.
    const serialized = JSON.stringify(t);
    for (const v of [PERSONAL_URL, PERSONAL_EVIDENCE.excerpt, PERSONAL_EVIDENCE.authorHandle, PERSONAL_META.contactKey]) {
      expect(serialized).not.toContain(v);
    }
  }));

  it('service_role still cannot UPDATE or DELETE contributions, nor write tombstones directly (42501)', () => inRollback(async () => {
    await seedTenants();
    const lead = await newLead(ORG_A);
    const c = await contribution(ORG_A, lead);
    await redact(ORG_A, [lead]);
    const [t] = await tombs('contribution_id=$1', [c]);
    await db.query('SET LOCAL ROLE service_role');
    const codes = [
      await attempt(`UPDATE ${PSC} SET source_url='https://x' WHERE id=$1`, [c]),
      await attempt(`DELETE FROM ${PSC} WHERE id=$1`, [c]),
      await attempt(`UPDATE ${TOMB} SET reason='edited' WHERE id=$1`, [t.id]),
      await attempt(`DELETE FROM ${TOMB} WHERE id=$1`, [t.id]),
      await attempt(`INSERT INTO ${TOMB} (organization_id, canonical_lead_id, reason, requested_by, redacted_fields, values_sha256)
                     VALUES ($1,$2,'r','x','{}',repeat('a',64))`, [ORG_A, lead]),
    ];
    await db.query('RESET ROLE');
    expect(codes).toEqual(['42501', '42501', '42501', '42501', '42501']);
  }));

  it('cross-tenant redaction is refused (42501) and NOTHING changes — not even the caller\'s own leads', () => inRollback(async () => {
    await seedTenants();
    const leadA = await newLead(ORG_A);
    const leadB = await newLead(ORG_B);
    const cA = await contribution(ORG_A, leadA);
    const cB = await contribution(ORG_B, leadB);
    const beforeA = await pscRow(cA);
    const beforeB = await pscRow(cB);

    await db.query('SET LOCAL ROLE service_role');
    const code = await attempt(`SELECT ${FN}($1::uuid, $2::uuid[], 'r', 'x')`, [ORG_A, [leadA, leadB]]);
    await db.query('RESET ROLE');
    expect(code).toBe('42501');

    expect(await pscRow(cA)).toEqual(beforeA);
    expect(await pscRow(cB)).toEqual(beforeB);
    expect(await tombs()).toEqual([]);
  }));

  it('only the named tenant\'s contributions of the named leads are touched', () => inRollback(async () => {
    await seedTenants();
    const lead1 = await newLead(ORG_A);
    const lead2 = await newLead(ORG_A);
    const c1 = await contribution(ORG_A, lead1);
    const c2 = await contribution(ORG_A, lead2);
    const before2 = await pscRow(c2);
    await redact(ORG_A, [lead1]);
    expect((await pscRow(c1)).source_url).toBeNull();
    expect(await pscRow(c2)).toEqual(before2);
  }));

  it('idempotent: a second call redacts nothing, writes no second tombstone', () => inRollback(async () => {
    await seedTenants();
    const lead = await newLead(ORG_A);
    await contribution(ORG_A, lead, 'community:1');
    await contribution(ORG_A, lead, 'community:2');
    expect(await redact(ORG_A, [lead])).toMatchObject({ redacted: 2, already_redacted: 0 });
    const first = await tombs();
    expect(await redact(ORG_A, [lead], 'second reason')).toEqual({ redacted: 0, already_redacted: 2, contribution_ids: [] });
    expect(await tombs()).toEqual(first);
  }));

  it('a contribution added after the redaction is redacted by the next call', () => inRollback(async () => {
    await seedTenants();
    const lead = await newLead(ORG_A);
    await contribution(ORG_A, lead, 'community:1');
    await redact(ORG_A, [lead]);
    await contribution(ORG_A, lead, 'community:2');
    expect(await redact(ORG_A, [lead])).toMatchObject({ redacted: 1, already_redacted: 1 });
  }));

  it('the tombstone OUTLIVES the contribution: a lead delete cascades the contribution, the audit record stays', () => inRollback(async () => {
    await seedTenants();
    const lead = await newLead(ORG_A);
    const c = await contribution(ORG_A, lead);
    await redact(ORG_A, [lead]);
    await db.query('DELETE FROM public.canonical_leads WHERE id=$1', [lead]);
    expect(await pscRow(c)).toBeUndefined();
    const t = await tombs('canonical_lead_id=$1', [lead]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ contribution_id: null, organization_id: ORG_A, reason: 'person erased: subject request' });
    expect(t[0].values_sha256).toBeNull();   // value hashing retired by 20270109000000
  }));

  it('argument validation: NULL tenant / blank reason / blank requester are 22023; empty lead list is a no-op', () => inRollback(async () => {
    await seedTenants();
    const lead = await newLead(ORG_A);
    expect(await attempt(`SELECT ${FN}(NULL::uuid, $1::uuid[], 'r', 'x')`, [[lead]])).toBe('22023');
    expect(await attempt(`SELECT ${FN}($1::uuid, $2::uuid[], ' ', 'x')`, [ORG_A, [lead]])).toBe('22023');
    expect(await attempt(`SELECT ${FN}($1::uuid, $2::uuid[], 'r', '')`, [ORG_A, [lead]])).toBe('22023');
    expect(await redact(ORG_A, [])).toEqual({ redacted: 0, already_redacted: 0, contribution_ids: [] });
  }));

  it('person erasure order: redact while the lead still names the person, then the person delete SET NULLs the link', () => inRollback(async () => {
    await seedTenants();
    const person = await newPerson(ORG_A);
    const lead = await newLead(ORG_A, { personId: person });
    const c = await contribution(ORG_A, lead);
    // What redactContributionsForPerson reads, tenant first:
    const leads = (await db.query(
      'SELECT id FROM public.canonical_leads WHERE company_id=$1 AND unified_person_id=$2', [ORG_A, person])).rows.map((r) => r.id);
    expect(leads).toEqual([lead]);
    await asServiceRole(() => redact(ORG_A, leads));
    await db.query('DELETE FROM public.unified_persons WHERE id=$1', [person]);
    const after = await pscRow(c);
    expect(after.source_url).toBeNull();
    expect((await db.query('SELECT unified_person_id FROM public.canonical_leads WHERE id=$1', [lead])).rows[0].unified_person_id).toBeNull();
    expect(await tombs('contribution_id=$1', [c])).toHaveLength(1);
  }));
});
