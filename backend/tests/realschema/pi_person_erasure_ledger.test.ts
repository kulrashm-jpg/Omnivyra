/**
 * PI / person erasure — the request ledger (20270112000003), the legacy-leads
 * erasure path (20270112000001) and the score-evaluation redaction path
 * (20270112000002), against real PostgreSQL.
 *
 * WHAT THIS SUITE DOES NOT TELL YOU: a green run here concerns a disposable
 * database built from the committed baseline plus replayed migrations. It is
 * not evidence about the production database.
 *
 * The application half of erasePerson() (steps 3-5: carry governance forward,
 * revoke, clear the employer leg) is emulated in SQL exactly as the PostgREST
 * calls commit it; the database half (open / mark / finalize) is the real
 * function. Most tests run inside `inRollback`; the two-session tests commit
 * into a fresh random tenant and delete it afterwards.
 */
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, effect, newPerson, newLead } from './setup';

type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

const one = async (sql: string, params: unknown[] = [], c: Q = db) => (await c.query(sql, params)).rows[0];
const count = async (sql: string, params: unknown[] = [], c: Q = db) => Number((await one(sql, params, c)).n);

/** Run a statement under a savepoint as service_role (PostgREST's server-key role); return 'ok' or SQLSTATE. */
async function asServiceRole(sql: string, params: unknown[] = []): Promise<string> {
  await db.query('SAVEPOINT sr');
  try {
    await db.query(`SELECT set_config('request.jwt.claim.role', 'service_role', true)`);
    await db.query('SET LOCAL ROLE service_role');
    await db.query(sql, params);
    await db.query('RESET ROLE');
    await db.query('ROLLBACK TO SAVEPOINT sr');
    return 'ok';
  } catch (e: any) {
    await db.query('ROLLBACK TO SAVEPOINT sr');
    return e.code ?? 'unknown';
  }
}

async function legacyLead(org: string, person: string, name = 'Jane Lead', email = 'jane.lead@example.test', c: Q = db): Promise<string> {
  return (await one(
    `INSERT INTO public.leads (company_id, name, email, unified_person_id) VALUES ($1,$2,$3,$4) RETURNING id`,
    [org, name, email, person], c)).id;
}

async function scoreEval(org: string, prospect: string, person: string | null, digest: string, c: Q = db): Promise<string> {
  return (await one(
    `INSERT INTO public.prospect_score_evaluations
       (organization_id, prospect_id, person_id, rules_version, scored_at, score_overall, confidence,
        contributions, evidence, reasoning, facets, context_gaps, input_digest)
     VALUES ($1,$2,$3,'rules-v1',now(),0.5,0.7,
        '[{"dimension":"icp","note":"CTO at Example Corp"}]','[{"kind":"title","value":"CTO"}]',
        '[{"because":["CTO at Example Corp"]}]','{"seniority":"cxo"}','["no_intent"]',$4)
     RETURNING id`, [org, prospect, person, digest], c)).id;
}

async function liveGovernance(org: string, person: string, c: Q = db): Promise<string> {
  await c.query(
    `INSERT INTO public.identity_claims (organization_id, person_id, claim_type, normalized_value, source)
     VALUES ($1,$2,'email',$3,'erasure-ledger-test')`, [org, person, `p-${person.slice(0, 8)}@example.test`]);
  return (await one(
    `INSERT INTO public.contact_governance_records (organization_id, person_id, target_normalized, channel, governance_type, source)
     VALUES ($1,$2,NULL,'email','unsubscribe','erasure-ledger-test') RETURNING id`, [org, person], c)).id;
}

interface Req { request_id: string; lease_token: string; resumed: boolean; attempts: number }

async function open(org: string, person: string, c: Q = db, lease = 600): Promise<Req> {
  return (await one(`SELECT public.pi_person_erasure_open($1,$2,'dsar','test:runner',$3) r`, [org, person, lease], c)).r;
}

/**
 * The application half (steps 3-5), each step committed on its own in
 * production; here each is one statement. Idempotent like the TS: the
 * carried-forward INSERT treats 23505 as already present, the revoke matches
 * only live rows, step 5 matches nothing twice.
 */
async function appSteps(org: string, person: string, req: Req, c: Q = db, stopAfter = 5): Promise<void> {
  const claims = (await c.query(
    `SELECT normalized_value FROM public.identity_claims WHERE organization_id=$1 AND person_id=$2 AND revoked_at IS NULL`,
    [org, person])).rows.map((r: any) => r.normalized_value);
  const live = (await c.query(
    `SELECT id, channel, governance_type FROM public.contact_governance_records
      WHERE organization_id=$1 AND person_id=$2 AND revoked_at IS NULL`, [org, person])).rows;
  let created = 0;
  for (const g of live) {
    for (const t of claims) {
      const exists = await count(
        `SELECT count(*) n FROM public.contact_governance_records WHERE organization_id=$1 AND person_id IS NULL
            AND target_normalized=$2 AND channel=$3 AND governance_type=$4 AND revoked_at IS NULL`,
        [org, t, g.channel, g.governance_type], c);
      if (exists === 0) {
        await c.query(
          `INSERT INTO public.contact_governance_records (organization_id, person_id, target_normalized, channel, governance_type, source)
           VALUES ($1,NULL,$2,$3,$4,'person_erasure')`, [org, t, g.channel, g.governance_type]);
        created++;
      }
    }
  }
  await c.query(`SELECT public.pi_person_erasure_mark($1,$2,$3,'governance_reanchored',$4,NULL)`,
    [org, req.request_id, req.lease_token, created]);
  if (stopAfter === 3) return;
  const rev = await c.query(
    `UPDATE public.contact_governance_records SET revoked_at=now(), revoked_reason='person erased: dsar'
      WHERE organization_id=$1 AND person_id=$2 AND revoked_at IS NULL`, [org, person]);
  await c.query(`SELECT public.pi_person_erasure_mark($1,$2,$3,'governance_revoked',$4,NULL)`,
    [org, req.request_id, req.lease_token, rev.rowCount ?? 0]);
  if (stopAfter === 4) return;
  await c.query(
    `UPDATE public.source_assertions SET account_id=NULL
      WHERE organization_id=$1 AND person_id=$2 AND entity_type='person' AND account_id IS NOT NULL`, [org, person]);
  await c.query(`SELECT public.pi_person_erasure_mark($1,$2,$3,'evidence_links_cleared',NULL,NULL)`,
    [org, req.request_id, req.lease_token]);
}

async function finalize(org: string, req: Req, c: Q = db): Promise<any> {
  return (await one(`SELECT public.pi_person_erasure_finalize($1,$2,$3) r`, [org, req.request_id, req.lease_token], c)).r;
}

async function eraseFully(org: string, person: string): Promise<any> {
  const req = await open(org, person);
  await appSteps(org, person, req);
  return finalize(org, req);
}

const personExists = (id: string) => count('SELECT count(*) n FROM public.unified_persons WHERE id=$1', [id]);

// ───────────────────────────────────────────────────────────────────────────
// Task 2 — legacy leads: NOT NULL vs ON DELETE SET NULL
// ───────────────────────────────────────────────────────────────────────────

describe('legacy leads — the person link is detached, the lead survives', () => {
  it('schema: unified_person_id nullable, guarded by leads_person_or_erased + trigger', async () => {
    const col = await one(`SELECT is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='leads' AND column_name='unified_person_id'`);
    expect(col.is_nullable).toBe('YES');
    const chk = await one(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='leads_person_or_erased'`);
    expect(chk.d).toMatch(/unified_person_id IS NOT NULL\) OR \(person_erased_at IS NOT NULL/);
  });

  it('a person with NO legacy leads erases; detached count 0', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const r = await eraseFully(ORG_A, p);
      expect(r.deleted).toBe(true);
      expect(r.finalize_counts.legacy_leads_detached).toBe(0);
      expect(await personExists(p)).toBe(0);
    });
  });

  it('ONE lead: lead row survives with person NULL and person_erased_at set; fields retained under policy R', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const l = await legacyLead(ORG_A, p);
      const r = await eraseFully(ORG_A, p);
      expect(r.deleted).toBe(true);
      expect(r.finalize_counts.legacy_leads_detached).toBe(1);
      // the owner-selectable hook reports which policy it applied; the row must match it
      expect(['retain', 'redact']).toContain(r.finalize_counts.legacy_lead_fields);
      const row = await one('SELECT unified_person_id, person_erased_at, name, email, company_id FROM public.leads WHERE id=$1', [l]);
      expect(row.unified_person_id).toBeNull();
      expect(row.person_erased_at).not.toBeNull();
      expect(row.company_id).toBe(ORG_A);
      if (r.finalize_counts.legacy_lead_fields === 'retain') expect(row.name).toBe('Jane Lead');  // R: decision NOT made here
      else expect(row.name).not.toBe('Jane Lead');                                                 // S: owner-selected redaction
    });
  });

  it('MANY leads: all of the person\'s leads detached; another person\'s lead untouched byte-for-byte', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const other = await newPerson(ORG_A);
      const ls = [await legacyLead(ORG_A, p, 'L1', 'l1@example.test'), await legacyLead(ORG_A, p, 'L2', 'l2@example.test'),
        await legacyLead(ORG_A, p, 'L3', 'l3@example.test')];
      const keep = await legacyLead(ORG_A, other, 'Other', 'other@example.test');
      const before = (await one('SELECT to_jsonb(l) j FROM public.leads l WHERE id=$1', [keep])).j;
      const r = await eraseFully(ORG_A, p);
      expect(r.finalize_counts.legacy_leads_detached).toBe(3);
      expect(await count(`SELECT count(*) n FROM public.leads WHERE id = ANY($1) AND unified_person_id IS NULL AND person_erased_at IS NOT NULL`, [ls])).toBe(3);
      expect((await one('SELECT to_jsonb(l) j FROM public.leads l WHERE id=$1', [keep])).j).toEqual(before);
    });
  });

  it('a lead-kind person with a prospect too (existing prospect references): both survive, person gone', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const l = await legacyLead(ORG_A, p);
      const prospect = await newLead(ORG_A, { personId: p });
      await scoreEval(ORG_A, prospect, p, 'd-prospect-ref');
      const r = await eraseFully(ORG_A, p);
      expect(r.deleted).toBe(true);
      expect((await one('SELECT unified_person_id FROM public.canonical_leads WHERE id=$1', [prospect])).unified_person_id).toBeNull();
      expect((await one('SELECT lead_metadata FROM public.canonical_leads WHERE id=$1', [prospect])).lead_metadata.redacted).toBe(true);
      expect((await one('SELECT person_erased_at FROM public.leads WHERE id=$1', [l])).person_erased_at).not.toBeNull();
      expect(await count('SELECT count(*) n FROM public.prospect_score_evaluations WHERE prospect_id=$1 AND person_id IS NULL', [prospect])).toBe(1);
    });
  });

  it('cross-tenant: tenant B cannot open, and the detach refuses another tenant\'s person; B\'s leads untouched', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pa = await newPerson(ORG_A);
      await legacyLead(ORG_A, pa);
      const pb = await newPerson(ORG_B);
      const lb = await legacyLead(ORG_B, pb, 'B Lead', 'b@example.test');
      const beforeB = (await one('SELECT to_jsonb(l) j FROM public.leads l WHERE id=$1', [lb])).j;
      expect(await attempt(`SELECT public.pi_person_erasure_open($1,$2,'dsar','t')`, [ORG_B, pa])).toBe('42501');
      expect(await attempt('SELECT public.pi_erasure_detach_legacy_leads($1,$2)', [ORG_B, pa])).toBe('42501');
      // the right tenant with the other tenant's person id detaches nothing
      expect(await attempt('SELECT public.pi_erasure_detach_legacy_leads($1,$2)', [ORG_A, pb])).toBe('42501');
      await eraseFully(ORG_A, pa);
      expect((await one('SELECT to_jsonb(l) j FROM public.leads l WHERE id=$1', [lb])).j).toEqual(beforeB);
    });
  });

  it('the invariant still holds for every writer: no lead without a person unless erased, no born-erased lead', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      expect(await attempt(`INSERT INTO public.leads (company_id,name,email,unified_person_id) VALUES ($1,'x','x@x.test',NULL)`, [ORG_A])).toBe('23514');
      expect(await attempt(`INSERT INTO public.leads (company_id,name,email,unified_person_id,person_erased_at) VALUES ($1,'x','x@x.test',$2,now())`, [ORG_A, p])).toBe('23514');
      const l = await legacyLead(ORG_A, p);
      expect(await attempt('UPDATE public.leads SET unified_person_id=NULL WHERE id=$1', [l])).toBe('23514');
      // a plain delete outside the flow is still refused — never a silent detach
      expect(await attempt('DELETE FROM public.unified_persons WHERE id=$1', [p])).toBe('23514');
    });
  });

  it('person_erased_at: unauthorized set refused (superuser and service_role); permanent; no relink after erasure', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const p2 = await newPerson(ORG_A);
      const l = await legacyLead(ORG_A, p);
      expect(await attempt('UPDATE public.leads SET person_erased_at=now() WHERE id=$1', [l])).toBe('42501');
      await db.query('GRANT UPDATE ON public.leads TO service_role');
      expect(await asServiceRole('UPDATE public.leads SET person_erased_at=now() WHERE id=$1', [l])).toBe('42501');
      // the authorization for ANOTHER person does not cover this lead
      expect(await effect(`SELECT public.pi_erasure_authorize('legacy_leads',$1,$2)`, [ORG_A, p2])).toBe('ok');
      expect(await attempt('UPDATE public.leads SET person_erased_at=now() WHERE id=$1', [l])).toBe('42501');
      // authorized, but bundled with another change: refused
      expect(await effect(`SELECT public.pi_erasure_authorize('legacy_leads',$1,$2)`, [ORG_A, p])).toBe('ok');
      expect(await attempt(`UPDATE public.leads SET person_erased_at=now(), name='changed' WHERE id=$1`, [l])).toBe('23514');
      await db.query(`SELECT public.pi_erasure_release('legacy_leads',$1,$2)`, [ORG_A, p]);
      await db.query(`SELECT public.pi_erasure_release('legacy_leads',$1,$2)`, [ORG_A, p2]);
      await eraseFully(ORG_A, p);
      expect(await attempt('UPDATE public.leads SET person_erased_at=NULL WHERE id=$1', [l])).toBe('23514');
      expect(await attempt('UPDATE public.leads SET unified_person_id=$2 WHERE id=$1', [l, p2])).toBe('23514');
      expect(await count('SELECT count(*) n FROM public.pi_erasure_authorizations')).toBe(0);
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Task 3 — prospect_score_evaluations immutability: one authorized path
// ───────────────────────────────────────────────────────────────────────────

describe('prospect_score_evaluations — append-only except the sanctioned erasure redaction', () => {
  it('unauthorized UPDATE still refused: superuser, service_role (with full table grant), even the exact redaction shape', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const pr = await newLead(ORG_A, { personId: p });
      const e = await scoreEval(ORG_A, pr, p, 'd-unauth');
      const redactShape = `UPDATE public.prospect_score_evaluations SET person_id=NULL, contributions='[]', evidence='[]',
        reasoning='[]', context_gaps='[]', facets=public.pi_score_evaluation_redaction_marker() WHERE id=$1`;
      expect(await attempt('UPDATE public.prospect_score_evaluations SET score_overall=0.9 WHERE id=$1', [e])).toBe('23514');
      expect(await attempt(redactShape, [e])).toBe('23514');
      await db.query('GRANT ALL ON public.prospect_score_evaluations TO service_role');
      expect(await asServiceRole('UPDATE public.prospect_score_evaluations SET score_overall=0.9 WHERE id=$1', [e])).toBe('23514');
      expect(await asServiceRole('UPDATE public.prospect_score_evaluations SET person_id=NULL WHERE id=$1', [e])).toBe('23514');
      expect(await asServiceRole(redactShape, [e])).toBe('23514');
      // and the plain person delete is still blocked by the trigger (never a silent rewrite)
      expect(await attempt('DELETE FROM public.unified_persons WHERE id=$1', [p])).toBe('23514');
    });
  });

  it('no client role can reach the path: service_role cannot execute the redaction, authorize, or touch the authorization table', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      expect(await asServiceRole('SELECT public.pi_erasure_redact_score_evaluations($1,$2)', [ORG_A, p])).toBe('42501');
      expect(await asServiceRole(`SELECT public.pi_erasure_authorize('score_evaluations',$1,$2)`, [ORG_A, p])).toBe('42501');
      expect(await asServiceRole(`INSERT INTO public.pi_erasure_authorizations (scope, organization_id, person_id) VALUES ('score_evaluations',$1,$2)`, [ORG_A, p])).toBe('42501');
      expect(await asServiceRole('SELECT count(*) FROM public.pi_erasure_authorizations')).toBe('42501');
      expect(await asServiceRole('SELECT public.pi_erasure_detach_legacy_leads($1,$2)', [ORG_A, p])).toBe('42501');
      expect(await asServiceRole('SELECT public.pi_person_erasure_legacy_lead_policy($1,$2)', [ORG_A, p])).toBe('42501');
      for (const r of ['anon', 'authenticated']) {
        const priv = await one(`SELECT has_function_privilege($1,'public.pi_person_erasure_finalize(uuid,uuid,uuid)','EXECUTE') f,
          has_table_privilege($1,'public.person_erasure_requests','SELECT') t`, [r]);
        expect(priv).toEqual({ f: false, t: false });
      }
    });
  });

  it('an authorization is bound to its transaction, tenant and person: another txn id / person does not unlock', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const q = await newPerson(ORG_A);
      const pr = await newLead(ORG_A, { personId: p });
      const e = await scoreEval(ORG_A, pr, p, 'd-bound');
      // a stale row of a DIFFERENT transaction id (as if left behind) unlocks nothing
      await db.query(`INSERT INTO public.pi_erasure_authorizations (xact_id, scope, organization_id, person_id)
        VALUES (((pg_current_xact_id()::text::bigint) - 1)::text::xid8, 'score_evaluations', $1, $2)`, [ORG_A, p]);
      const redact = `UPDATE public.prospect_score_evaluations SET person_id=NULL, contributions='[]', evidence='[]',
        reasoning='[]', context_gaps='[]', facets=public.pi_score_evaluation_redaction_marker() WHERE id=$1`;
      expect(await attempt(redact, [e])).toBe('23514');
      // authorization for person q in THIS transaction does not cover p's row
      await db.query(`SELECT public.pi_erasure_authorize('score_evaluations',$1,$2)`, [ORG_A, q]);
      expect(await attempt(redact, [e])).toBe('23514');
      // authorization for the right person but another tenant id does not either
      await db.query(`SELECT public.pi_erasure_authorize('score_evaluations',$1,$2)`, [ORG_B, p]);
      expect(await attempt(redact, [e])).toBe('23514');
      // the right authorization admits ONLY the exact redaction, not a score edit
      await db.query(`SELECT public.pi_erasure_authorize('score_evaluations',$1,$2)`, [ORG_A, p]);
      expect(await attempt(`UPDATE public.prospect_score_evaluations SET person_id=NULL, score_overall=0.1, contributions='[]', evidence='[]',
        reasoning='[]', context_gaps='[]', facets=public.pi_score_evaluation_redaction_marker() WHERE id=$1`, [e])).toBe('23514');
      expect(await attempt(`UPDATE public.prospect_score_evaluations SET person_id=NULL WHERE id=$1`, [e])).toBe('23514');
      expect(await attempt(redact, [e])).toBe('ok');
    });
  });

  it('authorized erasure via finalize: person rows redacted, scores kept, other person / tenant untouched, no authorization left', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const other = await newPerson(ORG_A);
      const pb = await newPerson(ORG_B);
      const pr = await newLead(ORG_A, { personId: p });
      const prO = await newLead(ORG_A, { personId: other });
      const prB = await newLead(ORG_B, { personId: pb });
      const e1 = await scoreEval(ORG_A, pr, p, 'd1');
      await scoreEval(ORG_A, pr, p, 'd2');
      const eo = await scoreEval(ORG_A, prO, other, 'd3');
      const eb = await scoreEval(ORG_B, prB, pb, 'd4');
      const snap = async (id: string) => (await one('SELECT to_jsonb(e) j FROM public.prospect_score_evaluations e WHERE id=$1', [id])).j;
      const [beforeO, beforeB, before1] = [await snap(eo), await snap(eb), await snap(e1)];
      const r = await eraseFully(ORG_A, p);
      expect(r.finalize_counts.score_evaluations_redacted).toBe(2);
      const after1 = await snap(e1);
      expect(after1.person_id).toBeNull();
      expect(after1.contributions).toEqual([]);
      expect(after1.evidence).toEqual([]);
      expect(after1.reasoning).toEqual([]);
      expect(after1.context_gaps).toEqual([]);
      expect(after1.facets).toEqual({ redacted: true, reason: 'person_erased' });
      for (const k of ['score_overall', 'confidence', 'input_digest', 'prospect_id', 'rules_version', 'scored_at', 'organization_id']) {
        expect(after1[k]).toEqual(before1[k]);
      }
      expect(await snap(eo)).toEqual(beforeO);
      expect(await snap(eb)).toEqual(beforeB);
      expect(await count('SELECT count(*) n FROM public.pi_erasure_authorizations')).toBe(0);
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Task 5 — the ledger: interruption, replay, rollback, inconsistency, evidence
// ───────────────────────────────────────────────────────────────────────────

/** A person shaped like a real erasure subject: claim + live person-anchored rule, lead, prospect, score. */
async function richPerson(org: string): Promise<{ p: string; lead: string; prospect: string; evalId: string; gov: string }> {
  const p = await newPerson(org);
  const gov = await liveGovernance(org, p);
  const lead = await legacyLead(org, p);
  const prospect = await newLead(org, { personId: p });
  const evalId = await scoreEval(org, prospect, p, `d-${p}`);
  return { p, lead, prospect, evalId, gov };
}

async function untouchedSince(s: { p: string; lead: string; evalId: string }): Promise<void> {
  expect(await personExists(s.p)).toBe(1);
  expect((await one('SELECT person_erased_at FROM public.leads WHERE id=$1', [s.lead])).person_erased_at).toBeNull();
  expect((await one('SELECT person_id FROM public.prospect_score_evaluations WHERE id=$1', [s.evalId])).person_id).toBe(s.p);
  expect(await count('SELECT count(*) n FROM public.pi_erasure_authorizations')).toBe(0);
}

describe('ledger — interruption at every major step, then resume', () => {
  for (const stopAfter of [0, 3, 4, 5] as const) {
    it(`interrupted after step ${stopAfter === 0 ? 'open' : stopAfter}: finalize refuses, retry resumes the SAME request and completes without duplicates`, async () => {
      await inRollback(async () => {
        await seedTenants();
        const s = await richPerson(ORG_A);
        const r1 = await open(ORG_A, s.p);
        if (stopAfter > 0) await appSteps(ORG_A, s.p, r1, db, stopAfter);
        if (stopAfter < 5) expect(await attempt('SELECT public.pi_person_erasure_finalize($1,$2,$3)', [ORG_A, r1.request_id, r1.lease_token])).toBe('55000');
        // the runner died: it recorded the failure (releases the lease)
        await db.query(`SELECT public.pi_person_erasure_mark($1,$2,$3,'failed',NULL,'injected')`, [ORG_A, r1.request_id, r1.lease_token]);
        await untouchedSince(s);
        const r2 = await open(ORG_A, s.p);
        expect(r2.request_id).toBe(r1.request_id);
        expect(r2.resumed).toBe(true);
        expect(r2.attempts).toBe(2);
        expect(r2.lease_token).not.toBe(r1.lease_token);
        // the old lease is dead
        expect(await attempt(`SELECT public.pi_person_erasure_mark($1,$2,$3,'governance_reanchored',0,NULL)`, [ORG_A, r1.request_id, r1.lease_token])).toBe('55P03');
        await appSteps(ORG_A, s.p, r2);
        const fin = await finalize(ORG_A, r2);
        expect(fin.deleted).toBe(true);
        expect(await count(`SELECT count(*) n FROM public.contact_governance_records WHERE organization_id=$1 AND person_id IS NULL AND source='person_erasure'`, [ORG_A])).toBe(1);
        const req = await one('SELECT * FROM public.person_erasure_requests WHERE id=$1', [r1.request_id]);
        expect(req).toMatchObject({ status: 'completed', person_id: null, attempts: 2, lease_token: null, last_error_code: null });
        // exactly one carried-forward record in total: a resumed run finds it already present and adds 0
        expect(req.reanchored_count).toBe(1);
      });
    });
  }

  it('failure INSIDE step 6 (provenance) rolls back everything in finalize; retry completes', async () => {
    await inRollback(async () => {
      await seedTenants();
      const s = await richPerson(ORG_A);
      const r = await open(ORG_A, s.p);
      await appSteps(ORG_A, s.p, r);
      await db.query(`CREATE FUNCTION pg_temp.boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected 6' USING ERRCODE='XX001'; END $$`);
      await db.query('CREATE TRIGGER zz_boom6 BEFORE INSERT ON public.prospect_provenance_erasures FOR EACH ROW EXECUTE FUNCTION pg_temp.boom()');
      expect(await attempt('SELECT public.pi_person_erasure_finalize($1,$2,$3)', [ORG_A, r.request_id, r.lease_token])).toBe('XX001');
      await untouchedSince(s);
      expect(await count('SELECT count(*) n FROM public.prospect_provenance_erasures WHERE organization_id=$1', [ORG_A])).toBe(0);
      await db.query('DROP TRIGGER zz_boom6 ON public.prospect_provenance_erasures');
      expect((await finalize(ORG_A, r)).deleted).toBe(true);
    });
  });

  it('failure at step 7 (a delete blocker) rolls back 6, 6b, 6c and NAMES the blocker; retry after removal completes', async () => {
    await inRollback(async () => {
      await seedTenants();
      const s = await richPerson(ORG_A);
      // a merged person makes s.p a merge survivor (unified_persons_merge_tenant_fk, NO ACTION)
      const loser = await newPerson(ORG_A);
      await db.query(`UPDATE public.unified_persons SET status='merged', merged_into_id=$2 WHERE id=$1`, [loser, s.p]);
      const r = await open(ORG_A, s.p);
      await appSteps(ORG_A, s.p, r);
      await db.query('SAVEPOINT f7');
      let err: any = null;
      try { await finalize(ORG_A, r); } catch (e) { err = e; }
      await db.query('ROLLBACK TO SAVEPOINT f7');
      expect(err?.code).toBe('23503');
      expect(err?.message).toBe('person_erasure:delete_blocked_by unified_persons_merge_tenant_fk');
      expect(err?.constraint).toBe('unified_persons_merge_tenant_fk');
      await untouchedSince(s);
      expect((await one('SELECT lead_metadata FROM public.canonical_leads WHERE id=$1', [s.prospect])).lead_metadata?.redacted).not.toBe(true);
      await db.query(`UPDATE public.unified_persons SET status='active', merged_into_id=NULL WHERE id=$1`, [loser]);
      expect((await finalize(ORG_A, r)).deleted).toBe(true);
    });
  });

  it('replay of each step: marks are repeatable, finalize twice is a no-op, open after completion is P0002', async () => {
    await inRollback(async () => {
      await seedTenants();
      const s = await richPerson(ORG_A);
      const r = await open(ORG_A, s.p);
      await appSteps(ORG_A, s.p, r);
      await appSteps(ORG_A, s.p, r);                     // replay 3-5: nothing new written
      expect(await count(`SELECT count(*) n FROM public.contact_governance_records WHERE organization_id=$1 AND source='person_erasure'`, [ORG_A])).toBe(1);
      const f1 = await finalize(ORG_A, r);
      const f2 = await finalize(ORG_A, r);
      expect(f1.deleted).toBe(true);
      expect(f2).toMatchObject({ deleted: false, already_completed: true, provenance_erasure_id: f1.provenance_erasure_id });
      expect(await count('SELECT count(*) n FROM public.prospect_provenance_erasures WHERE organization_id=$1', [ORG_A])).toBe(1);
      expect(await attempt(`SELECT public.pi_person_erasure_open($1,$2,'dsar','t')`, [ORG_A, s.p])).toBe('P0002');
      expect(await attempt(`SELECT public.pi_person_erasure_mark($1,$2,$3,'governance_revoked',0,NULL)`, [ORG_A, r.request_id, r.lease_token])).toBe('55000');
    });
  });

  it('tenant safety: mark / finalize of tenant A\'s request with tenant B is refused (42501)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const s = await richPerson(ORG_A);
      const r = await open(ORG_A, s.p);
      expect(await attempt(`SELECT public.pi_person_erasure_mark($1,$2,$3,'governance_reanchored',0,NULL)`, [ORG_B, r.request_id, r.lease_token])).toBe('42501');
      await appSteps(ORG_A, s.p, r);
      expect(await attempt('SELECT public.pi_person_erasure_finalize($1,$2,$3)', [ORG_B, r.request_id, r.lease_token])).toBe('42501');
      await untouchedSince(s);
    });
  });

  it('live person-anchored governance written after step 4 makes finalize refuse (inconsistent partial state detected)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const s = await richPerson(ORG_A);
      const r = await open(ORG_A, s.p);
      await appSteps(ORG_A, s.p, r);
      await db.query(`INSERT INTO public.contact_governance_records (organization_id, person_id, target_normalized, channel, governance_type, source)
        VALUES ($1,$2,NULL,'*','dnc_permanent','late-writer')`, [ORG_A, s.p]);
      const inc = (await db.query('SELECT problem FROM public.pi_person_erasure_inconsistencies($1)', [ORG_A])).rows.map((x: any) => x.problem);
      expect(inc).toContain('live_person_governance_after_revocation');
      expect(await attempt('SELECT public.pi_person_erasure_finalize($1,$2,$3)', [ORG_A, r.request_id, r.lease_token])).toBe('55000');
      await untouchedSince(s);
    });
  });

  it('a person deleted outside the ledger is detected, never reported as completed', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const r = await open(ORG_A, p);
      await appSteps(ORG_A, p, r);
      await db.query('DELETE FROM public.unified_persons WHERE id=$1', [p]);   // superuser, bypassing the flow
      const inc = (await db.query('SELECT request_id, problem FROM public.pi_person_erasure_inconsistencies($1)', [ORG_A])).rows;
      expect(inc).toContainEqual({ request_id: r.request_id, problem: 'person_vanished_outside_ledger' });
      expect(await attempt('SELECT public.pi_person_erasure_finalize($1,$2,$3)', [ORG_A, r.request_id, r.lease_token])).toBe('55000');
      expect((await one('SELECT status FROM public.person_erasure_requests WHERE id=$1', [r.request_id])).status).toBe('pending');
    });
  });

  it('crashed runner (lease expired, no outcome) is reported and can be resumed by another runner', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const r1 = await open(ORG_A, p);
      expect(await attempt(`SELECT public.pi_person_erasure_open($1,$2,'dsar','t')`, [ORG_A, p])).toBe('55P03');
      await db.query(`UPDATE public.person_erasure_requests SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id=$1`, [r1.request_id]);
      const inc = (await db.query('SELECT problem FROM public.pi_person_erasure_inconsistencies($1)', [ORG_A])).rows.map((x: any) => x.problem);
      expect(inc).toContain('lease_expired_without_outcome');
      const r2 = await open(ORG_A, p);
      expect(r2).toMatchObject({ request_id: r1.request_id, resumed: true, attempts: 2 });
      await appSteps(ORG_A, p, r2);
      expect((await finalize(ORG_A, r2)).deleted).toBe(true);
    });
  });

  it('minimal evidence: the completed row holds no person id, no message text; error codes are shape-checked', async () => {
    await inRollback(async () => {
      await seedTenants();
      const s = await richPerson(ORG_A);
      const r = await open(ORG_A, s.p);
      await db.query(`SELECT public.pi_person_erasure_mark($1,$2,$3,'failed',NULL,'Jane Doe <jane@x.test> blew up')`, [ORG_A, r.request_id, r.lease_token]);
      expect((await one('SELECT last_error_code FROM public.person_erasure_requests WHERE id=$1', [r.request_id])).last_error_code).toBe('unclassified');
      expect(await attempt(`UPDATE public.person_erasure_requests SET last_error_code='a message with spaces' WHERE id=$1`, [r.request_id])).toBe('23514');
      const r2 = await open(ORG_A, s.p);
      await appSteps(ORG_A, s.p, r2);
      await finalize(ORG_A, r2);
      const row = await one('SELECT to_jsonb(r) j FROM public.person_erasure_requests r WHERE id=$1', [r.request_id]);
      expect(row.j.person_id).toBeNull();
      expect(JSON.stringify(row.j)).not.toContain(s.p);
      expect(JSON.stringify(row.j)).not.toMatch(/jane/i);
      expect(Object.keys(row.j).sort()).toEqual([
        'attempts', 'completed_at', 'created_at', 'evidence_links_cleared_at', 'finalize_counts', 'governance_reanchored_at',
        'governance_revoked_at', 'id', 'last_attempt_at', 'last_error_code', 'lease_expires_at', 'lease_token',
        'organization_id', 'person_deleted_at', 'person_id', 'provenance_erased_at', 'provenance_erasure_id', 'reanchored_count',
        'reason', 'requested_by', 'revoked_count', 'status',
      ]);
      expect(await attempt(`UPDATE public.person_erasure_requests SET person_id=$2 WHERE id=$1`, [r.request_id, s.p])).not.toBe('ok');
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Two sessions — committed data in a fresh tenant, removed afterwards
// ───────────────────────────────────────────────────────────────────────────

describe('ledger — concurrent requests for the same erasure (two sessions)', () => {
  const ORG_C = randomUUID();
  let c1: Client; let c2: Client;

  beforeAll(async () => {
    c1 = new Client({ connectionString: process.env.W6_DB_URL }); await c1.connect();
    c2 = new Client({ connectionString: process.env.W6_DB_URL }); await c2.connect();
    await c1.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'erasure ledger concurrency')`, [ORG_C]);
  });
  afterAll(async () => {
    await c1.query('DELETE FROM public.person_erasure_requests WHERE organization_id=$1', [ORG_C]);
    await c1.query('DELETE FROM public.prospect_provenance_erasures WHERE organization_id=$1', [ORG_C]).catch(() => undefined);
    await c1.query('DELETE FROM public.contact_governance_records WHERE organization_id=$1', [ORG_C]).catch(() => undefined);
    await c1.query('DELETE FROM public.companies WHERE id=$1', [ORG_C]).catch(() => undefined);
    await c1.end(); await c2.end();
  });

  it('second session: open blocks on the person lock, then sees the lease and is refused; cannot mark with a forged token', async () => {
    const p = (await one('INSERT INTO public.unified_persons (company_id) VALUES ($1) RETURNING id', [ORG_C], c1)).id;
    await liveGovernance(ORG_C, p, c1);
    await c1.query('BEGIN');
    const r1: Req = (await one(`SELECT public.pi_person_erasure_open($1,$2,'dsar','runner-1') r`, [ORG_C, p], c1)).r;
    // session 2 now blocks on the person row lock held by the uncommitted open
    let r2err: any = null;
    const p2 = c2.query(`SELECT public.pi_person_erasure_open($1,$2,'dsar','runner-2') r`, [ORG_C, p]).catch((e) => { r2err = e; });
    await new Promise((res) => setTimeout(res, 300));
    const waiting = await count(`SELECT count(*) n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%runner-2%'`, [], c1);
    expect(waiting).toBe(1);
    await c1.query('COMMIT');
    await p2;
    expect(r2err?.code).toBe('55P03');
    expect(await count('SELECT count(*) n FROM public.person_erasure_requests WHERE organization_id=$1', [ORG_C], c1)).toBe(1);
    let forged: any = null;
    await c2.query(`SELECT public.pi_person_erasure_mark($1,$2,$3,'governance_reanchored',0,NULL)`, [ORG_C, r1.request_id, randomUUID()]).catch((e) => { forged = e; });
    expect(forged?.code).toBe('55P03');
    await appSteps(ORG_C, p, r1, c1);
    // two finalizes at once with the valid lease: exactly one deletes, the other sees completed
    await c2.query('BEGIN');
    await c2.query('SELECT 1 FROM public.person_erasure_requests WHERE id=$1 FOR UPDATE', [r1.request_id]);
    const fA = c1.query('SELECT public.pi_person_erasure_finalize($1,$2,$3) r', [ORG_C, r1.request_id, r1.lease_token]);
    await new Promise((res) => setTimeout(res, 300));
    await c2.query('COMMIT');
    const a = (await fA).rows[0].r;
    const b = (await c2.query('SELECT public.pi_person_erasure_finalize($1,$2,$3) r', [ORG_C, r1.request_id, r1.lease_token])).rows[0].r;
    expect(a.deleted).toBe(true);
    expect(b).toMatchObject({ deleted: false, already_completed: true });
    expect(await count('SELECT count(*) n FROM public.prospect_provenance_erasures WHERE organization_id=$1', [ORG_C], c1)).toBe(1);
    expect(await count(`SELECT count(*) n FROM public.contact_governance_records WHERE organization_id=$1 AND source='person_erasure'`, [ORG_C], c1)).toBe(1);
  });
});
