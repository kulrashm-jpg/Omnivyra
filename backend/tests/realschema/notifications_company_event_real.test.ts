/**
 * notifications on the REAL schema after 20270217000035 (6f). Five writers used to insert company events with
 * columns that do not exist, so PostgREST refused every insert and the writers dropped the error: those alerts were
 * never delivered. This holds the real table to both halves of the repair:
 *   - the exact row shape notifyCompanyEvent builds (user_id, company_id, type, title, message, metadata, is_read,
 *     created_at) INSERTS;
 *   - the old shapes are REFUSED (42703 undefined column) - the defect, pinned, so a fake can never be kinder than this;
 *   - company_id is nullable (per-user notices) and its FK refuses an unknown company;
 *   - message_reads / message_mentions accept company_id.
 */
import { db, inRollback, seedTenants, ORG_A } from './setup';

const U = '6f6f6f6f-0000-4000-8000-0000000000aa';
async function user() {
  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'notif-6f@example.test') ON CONFLICT (id) DO NOTHING`, [U]);
}

it('the notifyCompanyEvent row shape inserts, with company_id', async () => {
  await inRollback(async () => {
    await seedTenants();
    await user();
    const { rows } = await db.query(
      `INSERT INTO public.notifications (user_id, company_id, type, title, message, metadata, is_read, created_at)
       VALUES ($1, $2, 'campaign_auto_paused', 'Campaign auto-paused', '"X" was paused', '{"campaign_id":"c1"}'::jsonb, false, now())
       RETURNING company_id, is_read`, [U, ORG_A]);
    expect(rows[0]).toEqual({ company_id: ORG_A, is_read: false });
  });
});

it('a per-user notice keeps company_id NULL (the column is nullable)', async () => {
  await inRollback(async () => {
    await user();
    const { rows } = await db.query(
      `INSERT INTO public.notifications (user_id, type, title, message) VALUES ($1, 'post_published', 't', 'm') RETURNING company_id`, [U]);
    expect(rows[0].company_id).toBeNull();
  });
});

it.each([
  ['company_id + body + read, no user_id (scheduler / health / recovery / approve)', `INSERT INTO public.notifications (company_id, type, title, body, read) VALUES ('${ORG_A}', 't', 'x', 'b', false)`],
  ['organization_id + category + read (credit alerts)', `INSERT INTO public.notifications (organization_id, type, category, message, read) VALUES ('${ORG_A}', 'credit_alert', 'c', 'm', false)`],
])('the OLD shape is refused: %s', async (_n, sql) => {
  await inRollback(async () => {
    await seedTenants();
    await expect(db.query(sql)).rejects.toMatchObject({ code: '42703' });
  });
});

it('company_id must name a real company (FK)', async () => {
  await inRollback(async () => {
    await user();
    await expect(db.query(
      `INSERT INTO public.notifications (user_id, company_id, type, title) VALUES ($1, '99999999-9999-4999-8999-999999999999', 't', 'x')`, [U],
    )).rejects.toMatchObject({ code: '23503' });
  });
});

it('message_reads and message_mentions accept company_id', async () => {
  await inRollback(async () => {
    await seedTenants();
    await db.query(`INSERT INTO public.message_reads (message_id, message_source, user_id, company_id) VALUES (gen_random_uuid(), 'campaign', $1, $2)`, [U, ORG_A]);
    await db.query(`INSERT INTO public.message_mentions (message_id, message_source, mentioned_user_id, company_id) VALUES (gen_random_uuid(), 'campaign', $1, $2)`, [U, ORG_A]);
    const { rows } = await db.query(`SELECT (SELECT count(*) FROM public.message_reads WHERE company_id = $1)::int AS r, (SELECT count(*) FROM public.message_mentions WHERE company_id = $1)::int AS m`, [ORG_A]);
    expect(rows[0]).toEqual({ r: 1, m: 1 });
  });
});
