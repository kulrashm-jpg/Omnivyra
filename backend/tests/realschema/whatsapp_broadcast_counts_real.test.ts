/**
 * whatsapp_refresh_broadcast_counts, against real PostgreSQL (C10, 2026-11-11).
 *
 * The counts are RECOMPUTED from the recipient rows (the truth), so they are asserted
 * against the rows: equal after any number of refreshes, completion only from 'running',
 * the debounce defers and marks dirty, and only service_role may call it.
 * Every call runs as service_role (SET LOCAL ROLE), as it does behind PostgREST.
 */
import { Client } from 'pg';
import { db, seedTenants, ORG_A } from './setup';

const url = process.env.W6_DB_URL as string;
const SA = '00000000-0000-4000-8000-0000000000e1';
const B = '00000000-0000-4000-8000-0000000000e2';
const B_PAUSED = '00000000-0000-4000-8000-0000000000e3';

async function refresh(id: string, minInterval = 0, role = 'service_role'): Promise<string> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query('SELECT public.whatsapp_refresh_broadcast_counts($1, $2) AS out', [id, minInterval]);
    await c.query('COMMIT');
    return r.rows[0].out as string;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    return (e as { code?: string }).code ?? 'error';
  } finally {
    await c.end();
  }
}

const broadcast = async (id = B) =>
  (await db.query('SELECT status, total_recipients, sent_count, delivered_count, read_count, failed_count, open_count, uncertain_count, completed_at, counts_dirty, counts_refreshed_at FROM public.whatsapp_broadcasts WHERE id = $1', [id])).rows[0];

/** total = sent + failed + open + uncertain (delivered/read are subsets of sent, not addends). */
const partitions = (b: Record<string, number>) => b.sent_count + b.failed_count + b.open_count + b.uncertain_count === b.total_recipients;

const recipients = async (broadcastId: string, statuses: string[]) => {
  await db.query('DELETE FROM public.whatsapp_broadcast_recipients WHERE broadcast_id = $1', [broadcastId]);
  for (const [i, st] of statuses.entries()) {
    await db.query(
      `INSERT INTO public.whatsapp_broadcast_recipients (broadcast_id, hashed_phone, encrypted_phone, status)
       VALUES ($1, $2, 'enc', $3)`,
      [broadcastId, `h-${broadcastId}-${i}`, st],
    );
  }
};

beforeAll(async () => {
  await seedTenants();
  await db.query(
    `INSERT INTO public.social_accounts (id, user_id, platform, platform_user_id, account_name, access_token)
     VALUES ($1::uuid, gen_random_uuid(), 'whatsapp', $2::text, 'wbc-test', 'x') ON CONFLICT (id) DO NOTHING`,
    [SA, SA],
  );
  for (const id of [B, B_PAUSED]) {
    await db.query(
      `INSERT INTO public.whatsapp_broadcasts (id, company_id, social_account_id, name, status)
       VALUES ($1, $2, $3, 'wbc', 'running') ON CONFLICT (id) DO NOTHING`,
      [id, ORG_A, SA],
    );
  }
});

beforeEach(async () => {
  await db.query(
    `UPDATE public.whatsapp_broadcasts SET status = 'running', completed_at = NULL, counts_dirty = false, counts_refreshed_at = NULL,
            total_recipients = 0, sent_count = 0, delivered_count = 0, read_count = 0, failed_count = 0
      WHERE id = ANY($1::uuid[])`,
    [[B, B_PAUSED]],
  );
});

describe('counts are recomputed from the recipient rows', () => {
  it('each count equals the rows; send_uncertain counts as none; refreshing again changes nothing', async () => {
    await recipients(B, ['sent', 'delivered', 'read', 'read', 'failed', 'blocked_governance', 'blocked_send_control', 'send_uncertain', 'pending']);
    expect(await refresh(B)).toBe('refreshed');
    const first = await broadcast();
    expect(first).toMatchObject({ total_recipients: 9, sent_count: 4, delivered_count: 3, read_count: 2, failed_count: 3, open_count: 1, uncertain_count: 1, status: 'running', counts_dirty: false });
    expect(partitions(first)).toBe(true);
    expect(await refresh(B)).toBe('refreshed');
    expect(await broadcast()).toMatchObject({ total_recipients: 9, sent_count: 4, delivered_count: 3, read_count: 2, failed_count: 3 });
  });

  it('a running broadcast with nothing pending or sending COMPLETES, with completed_at set once', async () => {
    await recipients(B, ['sent', 'failed', 'send_uncertain']);
    await refresh(B);
    const done = await broadcast();
    expect(done.status).toBe('completed');
    // On completion open = 0, so the gap to total is exactly the unknown outcomes.
    expect(done).toMatchObject({ open_count: 0, uncertain_count: 1 });
    expect(partitions(done)).toBe(true);
    expect(done.completed_at).not.toBeNull();
    await refresh(B);
    expect((await broadcast()).completed_at).toEqual(done.completed_at);
  });

  it('NEGATIVE CONTROL: a row still pending or sending keeps it running', async () => {
    await recipients(B, ['sent', 'sending']);
    await refresh(B);
    expect((await broadcast()).status).toBe('running');
  });

  it('a PAUSED broadcast is never completed (counts still refresh)', async () => {
    await db.query(`UPDATE public.whatsapp_broadcasts SET status = 'paused' WHERE id = $1`, [B_PAUSED]);
    await recipients(B_PAUSED, ['sent', 'sent']);
    await refresh(B_PAUSED);
    expect(await broadcast(B_PAUSED)).toMatchObject({ status: 'paused', sent_count: 2, completed_at: null });
  });

  it('a status in NO bucket raises, naming it (exhaustiveness), and the counts are not touched', async () => {
    await recipients(B, ['sent', 'mystery_status']);
    expect(await refresh(B)).toBe('22023');
    expect((await broadcast()).sent_count).toBe(0);
  });

  it('an unknown broadcast answers missing', async () => {
    expect(await refresh('00000000-0000-4000-8000-0000000000ff')).toBe('missing');
  });
});

describe('the debounce defers and marks dirty; an unconditional refresh clears it', () => {
  it('within the window: deferred, counts untouched, dirty set; then an unconditional refresh recomputes and clears', async () => {
    await recipients(B, ['sent']);
    await refresh(B);                                    // refreshed just now
    await recipients(B, ['sent', 'delivered']);          // rows change
    expect(await refresh(B, 30)).toBe('deferred');
    expect(await broadcast()).toMatchObject({ sent_count: 1, counts_dirty: true });
    expect(await refresh(B)).toBe('refreshed');
    expect(await broadcast()).toMatchObject({ sent_count: 2, delivered_count: 1, counts_dirty: false });
  });

  it('NEGATIVE CONTROL: never refreshed before -> a debounced call still refreshes', async () => {
    await recipients(B, ['sent']);
    expect(await refresh(B, 30)).toBe('refreshed');
    expect((await broadcast()).sent_count).toBe(1);
  });
});

describe('privileges and arguments', () => {
  it.each([['anon'], ['authenticated']])('%s cannot execute it (42501) and nothing changes', async (role) => {
    await recipients(B, ['sent']);
    expect(await refresh(B, 0, role)).toBe('42501');
    expect((await broadcast()).sent_count).toBe(0);
  });

  it('a negative interval is rejected (22023)', async () => {
    expect(await refresh(B, -1)).toBe('22023');
  });
});
