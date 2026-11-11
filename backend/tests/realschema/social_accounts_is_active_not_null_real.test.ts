/**
 * 20270216000002: social_accounts.is_active is NOT NULL DEFAULT true, on the real schema.
 * The migration's own postcondition already ran during the harness replay; this pins the
 * behaviour an application sees: an explicit NULL is refused (23502), an omitted value is true.
 */
import { attempt, db, inRollback, seedTenants, ORG_A } from './setup';
import { newUser } from './helpers/journeyFixtures';

describe('social_accounts.is_active NOT NULL (20270216000002)', () => {
  it('an explicit NULL is refused with 23502; nothing is written', () => inRollback(async () => {
    await seedTenants();
    const user = await newUser();
    expect(await attempt(
      `INSERT INTO public.social_accounts (user_id, platform, platform_user_id, account_name, access_token, company_id, is_active)
       VALUES ($1, 'whatsapp', 'saia-null', 'wa', 't', $2, NULL)`, [user, ORG_A])).toBe('23502');
  }));

  it('an UPDATE to NULL is refused with 23502', () => inRollback(async () => {
    await seedTenants();
    const user = await newUser();
    const r = await db.query(
      `INSERT INTO public.social_accounts (user_id, platform, platform_user_id, account_name, access_token, company_id)
       VALUES ($1, 'whatsapp', 'saia-upd', 'wa', 't', $2) RETURNING id`, [user, ORG_A]);
    expect(await attempt('UPDATE public.social_accounts SET is_active = NULL WHERE id = $1', [r.rows[0].id])).toBe('23502');
  }));

  it('CONTROL: an omitted value is the default true, and false is accepted', () => inRollback(async () => {
    await seedTenants();
    const user = await newUser();
    const r = await db.query(
      `INSERT INTO public.social_accounts (user_id, platform, platform_user_id, account_name, access_token, company_id)
       VALUES ($1, 'whatsapp', 'saia-default', 'wa', 't', $2) RETURNING id, is_active`, [user, ORG_A]);
    expect(r.rows[0].is_active).toBe(true);
    expect(await attempt('UPDATE public.social_accounts SET is_active = false WHERE id = $1', [r.rows[0].id])).toBe('ok');
  }));
});
