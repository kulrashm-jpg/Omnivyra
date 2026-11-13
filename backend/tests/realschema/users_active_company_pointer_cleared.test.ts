/**
 * Real-schema cover for 20270217000042_users_active_company_pointer_cleared_on_membership_exit (e1, 2026-11-13; BLOCKING
 * tenancy; e9 ruling "the TRIGGER").
 *
 * users.active_company_id must never point at a company where the user is not ACTIVE. The existing users guard
 * (trg_users_active_company_membership_guard) checks that only when the POINTER is written; this trigger closes the
 * other half - when the MEMBERSHIP stops being active, by ANY writer (app path, governed RPC, bulk cascade).
 * HEAD control: without the migration every "cleared" case below keeps the stale pointer.
 */
import { db, inRollback, seedTenants, ORG_A, ORG_B } from './setup';

const U1 = '00000000-0000-4000-8000-0000000000e1';
const U2 = '00000000-0000-4000-8000-0000000000e2';

async function user(id: string): Promise<void> {
  await db.query(`INSERT INTO public.users (id, email) VALUES ($1, $2)`, [id, `${id.slice(-2)}@rs.example.test`]);
}
async function member(userId: string, org: string, status = 'active'): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.user_company_roles (user_id, company_id, role, status, join_source)
     VALUES ($1, $2, 'COMPANY_ADMIN', $3, 'invited') RETURNING id`,
    [userId, org, status],
  );
  return rows[0].id as string;
}
async function point(userId: string, org: string | null): Promise<void> {
  await db.query(`UPDATE public.users SET active_company_id = $2 WHERE id = $1`, [userId, org]);
}
async function pointer(userId: string): Promise<string | null> {
  const { rows } = await db.query(`SELECT active_company_id FROM public.users WHERE id = $1`, [userId]);
  return (rows[0]?.active_company_id as string | null) ?? null;
}

describe('user_company_roles_clear_active_company_pointer', () => {
  it('is installed, enabled, SECURITY DEFINER with an empty search_path, and not executable by client roles', async () => {
    const t = await db.query(
      `SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.user_company_roles'::regclass
          AND tgname = 'user_company_roles_clear_active_company_pointer' AND NOT tgisinternal`);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].tgenabled).not.toBe('D');
    const f = await db.query(
      `SELECT prosecdef, proconfig, proacl IS NOT NULL AS acl_set,
              has_function_privilege('anon', oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', oid, 'EXECUTE') AS auth
         FROM pg_proc WHERE oid = 'public.users_clear_active_company_on_membership_exit()'::regprocedure`);
    expect(f.rows[0]).toMatchObject({ prosecdef: true, acl_set: true, anon: false, auth: false });
    expect(f.rows[0].proconfig).toContain('search_path=""');
  });

  it('POSITIVE CONTROL on usersMutations Step D: status active -> inactive clears a pointer at that company', async () => {
    await inRollback(async () => {
      await seedTenants(); await user(U1);
      const r = await member(U1, ORG_A); await point(U1, ORG_A);
      // The exact write shape of usersMutations Step D (deactivate a membership by id).
      await db.query(`UPDATE public.user_company_roles SET status = 'inactive', updated_at = now() WHERE id = $1`, [r]);
      expect(await pointer(U1)).toBeNull();
    });
  });

  it('DELETE of the active membership clears the pointer', async () => {
    await inRollback(async () => {
      await seedTenants(); await user(U1);
      const r = await member(U1, ORG_A); await point(U1, ORG_A);
      await db.query(`DELETE FROM public.user_company_roles WHERE id = $1`, [r]);
      expect(await pointer(U1)).toBeNull();
    });
  });

  it('re-homing the membership to another company clears the pointer at the OLD company', async () => {
    await inRollback(async () => {
      await seedTenants(); await user(U1);
      const r = await member(U1, ORG_A); await point(U1, ORG_A);
      await db.query(`UPDATE public.user_company_roles SET company_id = $2 WHERE id = $1`, [r, ORG_B]);
      expect(await pointer(U1)).toBeNull();
    });
  });

  it('a pointer at ANOTHER company is untouched when a different membership is deactivated', async () => {
    await inRollback(async () => {
      await seedTenants(); await user(U1);
      const ra = await member(U1, ORG_A); await member(U1, ORG_B); await point(U1, ORG_B);
      await db.query(`UPDATE public.user_company_roles SET status = 'inactive' WHERE id = $1`, [ra]);
      expect(await pointer(U1)).toBe(ORG_B);
    });
  });

  it('a non-exit update (role change, still active) leaves the pointer alone', async () => {
    await inRollback(async () => {
      await seedTenants(); await user(U1);
      const r = await member(U1, ORG_A); await point(U1, ORG_A);
      await db.query(`UPDATE public.user_company_roles SET role = 'VIEW_ONLY', status = 'active' WHERE id = $1`, [r]);
      expect(await pointer(U1)).toBe(ORG_A);
    });
  });

  it('BULK: the company-disable cascade shape (one statement over many memberships) clears every affected pointer', async () => {
    await inRollback(async () => {
      await seedTenants(); await user(U1); await user(U2);
      await member(U1, ORG_A); await member(U2, ORG_A); await member(U2, ORG_B);
      await point(U1, ORG_A); await point(U2, ORG_B);
      await db.query(`UPDATE public.user_company_roles SET status = 'inactive' WHERE company_id = $1 AND status = 'active'`, [ORG_A]);
      expect(await pointer(U1)).toBeNull();
      expect(await pointer(U2)).toBe(ORG_B); // pointed elsewhere: untouched
    });
  });

  it('deleting the USER (ON DELETE CASCADE to memberships) does not error', async () => {
    await inRollback(async () => {
      await seedTenants(); await user(U1);
      await member(U1, ORG_A); await point(U1, ORG_A);
      await db.query(`DELETE FROM public.users WHERE id = $1`, [U1]);
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.user_company_roles WHERE user_id = $1`, [U1]);
      expect(rows[0].n).toBe(0);
    });
  });

  it('an already-inactive membership changing again (inactive -> expired) is a no-op for the pointer', async () => {
    await inRollback(async () => {
      await seedTenants(); await user(U1);
      await member(U1, ORG_A);
      const rb = await member(U1, ORG_B, 'inactive');
      await point(U1, ORG_A);
      await db.query(`UPDATE public.user_company_roles SET status = 'expired' WHERE id = $1`, [rb]);
      expect(await pointer(U1)).toBe(ORG_A);
    });
  });
});
