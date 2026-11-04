/**
 * OWNER-SELECTABLE option S (20270112000004) — the erased person's legacy
 * leads lose their personal fields in the erasure transaction. Disposable
 * database only; not production evidence. Drop this file with its migration.
 */
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson } from './setup';

const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];

async function lead(org: string, person: string, name: string, email: string): Promise<string> {
  return (await one(`INSERT INTO public.leads (company_id, name, email, phone, metadata, attribution, unified_person_id)
    VALUES ($1,$2,$3,'+15550001111','{"note":"met at fair"}','{"utm_source":"x"}',$4) RETURNING id`, [org, name, email, person])).id;
}

async function erase(org: string, person: string): Promise<any> {
  const r = (await one(`SELECT public.pi_person_erasure_open($1,$2,'dsar','test') r`, [org, person])).r;
  for (const step of ['governance_reanchored', 'governance_revoked', 'evidence_links_cleared']) {
    await db.query('SELECT public.pi_person_erasure_mark($1,$2,$3,$4,0,NULL)', [org, r.request_id, r.lease_token, step]);
  }
  return (await one('SELECT public.pi_person_erasure_finalize($1,$2,$3) r', [org, r.request_id, r.lease_token])).r;
}

describe('option S — legacy lead target redaction', () => {
  it('redacts every legacy lead of the erased person; keeps id/tenant/business facts; others untouched', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const other = await newPerson(ORG_A);
      const pb = await newPerson(ORG_B);
      const l1 = await lead(ORG_A, p, 'Jane Lead', 'jane@example.test');
      const l2 = await lead(ORG_A, p, 'Jane L.', 'jane2@example.test');
      const keep = await lead(ORG_A, other, 'Other', 'other@example.test');
      const keepB = await lead(ORG_B, pb, 'B', 'b@example.test');
      const snap = async (id: string) => (await one('SELECT to_jsonb(l) j FROM public.leads l WHERE id=$1', [id])).j;
      const [k0, kb0] = [await snap(keep), await snap(keepB)];
      const r = await erase(ORG_A, p);
      expect(r.finalize_counts).toMatchObject({ legacy_lead_fields: 'redact', legacy_leads_redacted: 2, legacy_leads_detached: 2 });
      for (const id of [l1, l2]) {
        const row = await one('SELECT * FROM public.leads WHERE id=$1', [id]);
        expect(row).toMatchObject({ name: 'redacted', email: `redacted:${id}`, phone: null, metadata: { redacted: true },
          attribution: {}, visitor_session_id: null, unified_person_id: null, company_id: ORG_A });
        expect(row.person_erased_at).not.toBeNull();
      }
      expect(await snap(keep)).toEqual(k0);
      expect(await snap(keepB)).toEqual(kb0);
    });
  });

  it('the hook is not reachable by a client role, and a failed delete rolls the redaction back', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const l = await lead(ORG_A, p, 'Jane Lead', 'jane@example.test');
      expect((await one(`SELECT has_function_privilege('service_role','public.pi_person_erasure_legacy_lead_policy(uuid,uuid)','EXECUTE') x`)).x).toBe(false);
      const loser = await newPerson(ORG_A);
      await db.query(`UPDATE public.unified_persons SET status='merged', merged_into_id=$2 WHERE id=$1`, [loser, p]);
      const r = (await one(`SELECT public.pi_person_erasure_open($1,$2,'dsar','test') r`, [ORG_A, p])).r;
      for (const step of ['governance_reanchored', 'governance_revoked', 'evidence_links_cleared']) {
        await db.query('SELECT public.pi_person_erasure_mark($1,$2,$3,$4,0,NULL)', [ORG_A, r.request_id, r.lease_token, step]);
      }
      expect(await attempt('SELECT public.pi_person_erasure_finalize($1,$2,$3)', [ORG_A, r.request_id, r.lease_token])).toBe('23503');
      expect((await one('SELECT name, person_erased_at FROM public.leads WHERE id=$1', [l]))).toEqual({ name: 'Jane Lead', person_erased_at: null });
    });
  });
});
