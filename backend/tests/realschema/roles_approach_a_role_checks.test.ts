/**
 * 20270217000010 (invitations_role_check widened) + 20270217000011
 * (user_company_roles_role_check + NOT NULL) - COMMITTED real-schema evidence
 * (05 / e9 rule, 2026-11-12: sandbox-only evidence does not close a unit).
 * The CI replay installs both. Each case runs in a rolled-back transaction.
 */
import { attempt, db, inRollback } from './setup';

const CO = '00000000-0000-4000-8000-0000000010c0';
const U = '00000000-0000-4000-8000-0000000010a1';
const CONTENT_ROLES = ['CONTENT_MANAGER', 'CONTENT_PLANNER', 'CONTENT_ENGAGER', 'VIEWER'];

beforeAll(async () => {
  const defs = await db.query(
    `SELECT conname FROM pg_constraint WHERE conname IN ('invitations_role_check', 'user_company_roles_role_check')`);
  const names = defs.rows.map((r) => r.conname).sort();
  if (names.length !== 2) throw new Error(`role CHECKs not both installed (${names.join(',')}) - refusing to pass vacuously`);
  await db.query(`INSERT INTO public.users (id, email, name) VALUES ($1, 'rc@example.test', 'rc') ON CONFLICT (id) DO NOTHING`, [U]);
  await db.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'role checks') ON CONFLICT (id) DO NOTHING`, [CO]);
});

const membership = (role: string | null) => inRollback(() => attempt(
  `INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, $3, 'active')`, [U, CO, role]));

describe('20270217000011 user_company_roles_role_check', () => {
  it.each(['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'VIEW_ONLY', ...CONTENT_ROLES])(
    'canonical role %s is accepted', async (role) => {
      expect(await membership(role)).toBe('ok');
    });
  it.each(['ADMIN', 'admin', 'company_admin', 'FINANCE_ADMIN', 'nope'])('non-canonical %s is REFUSED', async (role) => {
    expect(await membership(role)).not.toBe('ok');
  });
  it('a NULL role is refused (NOT NULL asserted)', async () => {
    expect(await membership(null)).not.toBe('ok');
  });
  it('the constraint is validated and does not name the ADMIN alias', async () => {
    const r = (await db.query(
      `SELECT convalidated, pg_get_constraintdef(oid) AS d FROM pg_constraint
        WHERE conname = 'user_company_roles_role_check' AND conrelid = 'public.user_company_roles'::regclass`)).rows[0];
    expect(r.convalidated).toBe(true);
    expect(r.d).not.toMatch(/'ADMIN'/);
  });
});

describe('20270217000010 invitations_role_check (widened)', () => {
  const cols = async () => (await db.query(
    `SELECT column_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'invitations'`)).rows as Array<{ column_name: string; is_nullable: string; column_default: string | null }>;

  it('the CHECK names exactly the nine invitable roles and never SUPER_ADMIN / ADMIN', async () => {
    const d = (await db.query(
      `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
        WHERE conname = 'invitations_role_check' AND conrelid = 'public.invitations'::regclass`)).rows[0].d as string;
    for (const r of ['COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'VIEW_ONLY', ...CONTENT_ROLES]) {
      expect(d).toContain(`'${r}'`);
    }
    expect(d).not.toContain('SUPER_ADMIN');
    expect(d).not.toMatch(/'ADMIN'/);
  });

  it('the CHECK BEHAVES: a content-role value passes it, SUPER_ADMIN fails it (evaluated on the row shape)', async () => {
    // Evaluate the live constraint expression directly, independent of the
    // table's other NOT NULL columns.
    const expr = (await db.query(
      `SELECT pg_get_expr(conbin, conrelid) AS e FROM pg_constraint
        WHERE conname = 'invitations_role_check' AND conrelid = 'public.invitations'::regclass`)).rows[0].e as string;
    const check = async (role: string) =>
      (await db.query(`SELECT (${expr.replace(/\brole\b/g, '$1::text')}) AS ok`, [role])).rows[0].ok as boolean;
    for (const r of CONTENT_ROLES) expect(await check(r)).toBe(true);
    expect(await check('SUPER_ADMIN')).toBe(false);
    expect(await check('ADMIN')).toBe(false);
    expect((await cols()).length).toBeGreaterThan(0);
  });
});

afterAll(async () => {
  await db.query(`DELETE FROM public.companies WHERE id = $1`, [CO]).catch(() => undefined);
  await db.query(`DELETE FROM public.users WHERE id = $1`, [U]).catch(() => undefined);
});

