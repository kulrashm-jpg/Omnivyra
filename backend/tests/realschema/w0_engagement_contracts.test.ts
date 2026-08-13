/**
 * W6 — real-schema regression cover for the W0 / W0.1 / W0.2 production failures.
 *
 * These three were live incidents, not hypotheticals:
 *   W0    42703 — engagement_threads was missing window_open / window_expires_at
 *   W0.1  42P10 — the thread upsert named a conflict target PostgREST could not
 *                 infer, because the unique index was PARTIAL
 *   W0.2  42P10 — the message upsert named (platform, platform_message_id),
 *                 which no unique index backed
 *
 * A mocked Supabase client reproduces none of them. The tests below execute the
 * real ON CONFLICT statements against real indexes, so if somebody later makes
 * one of these indexes partial again, or renames a conflict target, CI fails.
 */
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt } from './setup';

describe('W0 — engagement_threads window columns', () => {
  it('has window_open and window_expires_at', async () => {
    const { rows } = await db.query(
      `SELECT attname, format_type(atttypid, atttypmod) typ
         FROM pg_attribute
        WHERE attrelid = 'public.engagement_threads'::regclass
          AND attname IN ('window_open','window_expires_at')
          AND NOT attisdropped`,
    );
    const found = Object.fromEntries(rows.map((r) => [r.attname, r.typ]));
    expect(found.window_open).toMatch(/boolean/);
    expect(found.window_expires_at).toMatch(/timestamp with time zone/);
  });

  it('can select them — the exact query that raised 42703', async () => {
    await expect(db.query(
      `SELECT id, window_open, window_expires_at FROM public.engagement_threads LIMIT 1`,
    )).resolves.toBeDefined();
  });

  it('keeps the partial window index', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND indexname='idx_eng_threads_window'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/window_expires_at/);
    expect(rows[0].indexdef).toMatch(/WHERE \(window_open = true\)/i);
  });
});

describe('W0.1 — thread upsert conflict target is inferable', () => {
  it('has a NON-PARTIAL unique index on (platform, platform_thread_id, organization_id)', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND indexname='idx_engagement_threads_platform_thread_org'`,
    );
    expect(rows).toHaveLength(1);
    // The whole point of W0.1: a partial index cannot be inferred by ON CONFLICT.
    expect(rows[0].indexdef).toMatch(/CREATE UNIQUE INDEX/);
    expect(rows[0].indexdef).not.toMatch(/\bWHERE\b/);
  });

  it('accepts the real ON CONFLICT statement — the one that raised 42P10', async () => {
    await inRollback(async () => {
      await seedTenants();
      const sql = `
        INSERT INTO public.engagement_threads (organization_id, platform, platform_thread_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (platform, platform_thread_id, organization_id)
        DO UPDATE SET updated_at = now()
        RETURNING id`;
      const first = await db.query(sql, [ORG_A, 'whatsapp', 'w6-thread-1']);
      expect(first.rows).toHaveLength(1);

      // Replaying the same inbound event must resolve to the same thread.
      const again = await db.query(sql, [ORG_A, 'whatsapp', 'w6-thread-1']);
      expect(again.rows[0].id).toBe(first.rows[0].id);

      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.engagement_threads
          WHERE platform_thread_id = 'w6-thread-1'`,
      );
      expect(rows[0].n).toBe(1);
    });
  });

  it('keeps the same platform thread id separate across tenants', async () => {
    await inRollback(async () => {
      await seedTenants();
      const sql = `
        INSERT INTO public.engagement_threads (organization_id, platform, platform_thread_id)
        VALUES ($1,$2,$3)
        ON CONFLICT (platform, platform_thread_id, organization_id) DO UPDATE SET updated_at = now()
        RETURNING id`;
      const a = await db.query(sql, [ORG_A, 'whatsapp', 'w6-shared']);
      const b = await db.query(sql, [ORG_B, 'whatsapp', 'w6-shared']);
      expect(a.rows[0].id).not.toBe(b.rows[0].id);
    });
  });
});

describe('W0.2 — message upsert conflict target', () => {
  it('has a unique index backing (thread_id, platform_message_id)', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='engagement_messages'
          AND indexdef LIKE 'CREATE UNIQUE INDEX%'`,
    );
    const backing = rows.filter((r: any) => /\(thread_id, platform_message_id\)/.test(r.indexdef)
      && !/\bWHERE\b/.test(r.indexdef));
    expect(backing.length).toBeGreaterThan(0);
  });

  it('accepts ON CONFLICT (thread_id, platform_message_id) and is idempotent', async () => {
    await inRollback(async () => {
      await seedTenants();
      const t = await db.query(
        `INSERT INTO public.engagement_threads (organization_id, platform, platform_thread_id)
         VALUES ($1,'whatsapp','w6-msg-thread') RETURNING id`, [ORG_A]);
      const threadId = t.rows[0].id;
      const sql = `
        INSERT INTO public.engagement_messages (thread_id, platform, platform_message_id, direction, content)
        VALUES ($1,'whatsapp',$2,'inbound','w6 body')
        ON CONFLICT (thread_id, platform_message_id) DO UPDATE SET content = EXCLUDED.content
        RETURNING id`;
      const first = await db.query(sql, [threadId, 'w6-message-1']);
      const again = await db.query(sql, [threadId, 'w6-message-1']);
      expect(again.rows[0].id).toBe(first.rows[0].id);
    });
  });

  it('rejects the OLD conflict target that caused 42P10', async () => {
    await inRollback(async () => {
      await seedTenants();
      const t = await db.query(
        `INSERT INTO public.engagement_threads (organization_id, platform, platform_thread_id)
         VALUES ($1,'whatsapp','w6-bad-target') RETURNING id`, [ORG_A]);
      // (platform, platform_message_id) has no unique index — this is the exact
      // statement W0.2 replaced, and it must still be rejected.
      const code = await attempt(
        `INSERT INTO public.engagement_messages (thread_id, platform, platform_message_id, direction, content)
         VALUES ($1,'whatsapp','w6-m2','inbound','x')
         ON CONFLICT (platform, platform_message_id) DO NOTHING`, [t.rows[0].id]);
      expect(code).toBe('42P10');
    });
  });
});
