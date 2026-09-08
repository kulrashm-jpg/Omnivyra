/**
 * A7P-C14C — tenant-owned provider credentials, against real PostgreSQL.
 *
 * These exist because a green unit suite coexisted with a write path that could
 * never work. `upsertProviderCredentials` issued
 *
 *   ON CONFLICT (company_id, provider_key, credential_key)
 *
 * against an index that is PARTIAL (`WHERE company_id IS NOT NULL`). PostgreSQL
 * refuses to infer a partial index as an arbiter unless the statement restates
 * its predicate, and PostgREST's `on_conflict=` cannot express one — so every
 * provider credential write failed at PLAN time with `42P10`, in every tenant,
 * for every provider. The table had never held a single provider-scoped row.
 *
 * No unit test could have caught it: they all mock the driver, so the SQL never
 * reaches a planner. That is the whole reason this file talks to a real one.
 *
 * The statements below are the ones the service now issues, in the same order.
 */
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt } from './setup';

/** Shaped like `encryptCredential` output: iv:tag:ciphertext, all hex. */
const cipher = (marker: string) =>
  `${'a'.repeat(24)}:${'b'.repeat(32)}:${Buffer.from(marker).toString('hex')}`;

/** Exactly the INSERT the service issues for a provider credential. */
const insertProvider = (org: string, provider: string, key: string, value: string) =>
  db.query(
    `INSERT INTO public.integration_credentials
       (company_id, provider_key, connection_id, credential_key, encrypted_value, rotated_at)
     VALUES ($1, $2, NULL, $3, $4, now()) RETURNING id, rotated_at`,
    [org, provider, key, value]);

/** Exactly the UPDATE the service issues on 23505. */
const updateProvider = (org: string, provider: string, key: string, value: string) =>
  db.query(
    `UPDATE public.integration_credentials
        SET encrypted_value = $4, rotated_at = now()
      WHERE company_id = $1 AND provider_key = $2 AND credential_key = $3
      RETURNING id, rotated_at`,
    [org, provider, key, value]);

describe('A7P-C14C — the arbiter defect this fix exists for', () => {
  it('a bare ON CONFLICT on the partial index is rejected at PLAN time (42P10)', async () => {
    // The exact statement the old `.upsert()` produced. EXPLAIN plans without
    // executing, so this asserts the refusal without writing anything.
    await inRollback(async () => {
      await seedTenants();
      expect(await attempt(
        `EXPLAIN INSERT INTO public.integration_credentials
           (company_id, provider_key, connection_id, credential_key, encrypted_value, rotated_at)
         VALUES ($1,'apollo',NULL,'api_key','x',now())
         ON CONFLICT (company_id, provider_key, credential_key)
         DO UPDATE SET encrypted_value = excluded.encrypted_value`, [ORG_A])).toBe('42P10');
    });
  });

  it('the same statement WITH the index predicate is accepted — proving the index is fine', async () => {
    // The index is not the defect; the inference is. Restating the predicate is
    // impossible through PostgREST, which is why the service uses INSERT/UPDATE.
    await inRollback(async () => {
      await seedTenants();
      expect(await attempt(
        `EXPLAIN INSERT INTO public.integration_credentials
           (company_id, provider_key, connection_id, credential_key, encrypted_value, rotated_at)
         VALUES ($1,'apollo',NULL,'api_key','x',now())
         ON CONFLICT (company_id, provider_key, credential_key) WHERE company_id IS NOT NULL
         DO UPDATE SET encrypted_value = excluded.encrypted_value`, [ORG_A])).toBe('ok');
    });
  });

  it('the provider index is partial and the connection one is a plain unique constraint', async () => {
    // The asymmetry that made one path work and the other impossible. If a
    // future migration made the provider index non-partial, this fails and the
    // service comment explaining the INSERT/UPDATE shape stops being true.
    const { rows: idx } = await db.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND indexname='integration_credentials_provider_unique'`);
    expect(idx[0].indexdef).toMatch(/WHERE \(company_id IS NOT NULL\)/);

    const { rows: con } = await db.query(
      `SELECT contype FROM pg_constraint
        WHERE conrelid='public.integration_credentials'::regclass
          AND conname='integration_credentials_connection_key_unique'`);
    expect(con[0].contype).toBe('u');
  });
});

describe('A7P-C14C — provider credential storage and rotation', () => {
  it('stores one row, correctly scoped, on a first write', async () => {
    await inRollback(async () => {
      await seedTenants();
      await insertProvider(ORG_A, 'apollo', 'api_key', cipher('first'));

      const { rows } = await db.query(
        `SELECT company_id, provider_key, credential_key, connection_id, encrypted_value
           FROM public.integration_credentials WHERE company_id=$1`, [ORG_A]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        company_id: ORG_A,
        provider_key: 'apollo',
        credential_key: 'api_key',
        connection_id: null,            // provider rows are never connection-scoped
      });
      expect(rows[0].encrypted_value).toBe(cipher('first'));
    });
  });

  it('never stores the plaintext credential', async () => {
    await inRollback(async () => {
      await seedTenants();
      const plaintext = 'sk-synthetic-not-a-real-key';
      await insertProvider(ORG_A, 'apollo', 'api_key', cipher(plaintext));

      const { rows } = await db.query(
        `SELECT encrypted_value FROM public.integration_credentials WHERE company_id=$1`, [ORG_A]);
      expect(rows[0].encrypted_value).not.toBe(plaintext);
      expect(rows[0].encrypted_value).not.toContain(plaintext);
      // iv:tag:ciphertext — the shape encryptCredential produces.
      expect(rows[0].encrypted_value).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    });
  });

  it('ROTATION: a second write conflicts, then updates in place', async () => {
    await inRollback(async () => {
      await seedTenants();
      const first = await insertProvider(ORG_A, 'apollo', 'api_key', cipher('first'));
      const firstRotatedAt = first.rows[0].rotated_at;

      // The service's INSERT attempt on a rotation — the constraint arbitrates.
      expect(await attempt(
        `INSERT INTO public.integration_credentials
           (company_id, provider_key, connection_id, credential_key, encrypted_value, rotated_at)
         VALUES ($1,'apollo',NULL,'api_key',$2,now())`, [ORG_A, cipher('second')])).toBe('23505');

      // …so the service takes the UPDATE branch.
      const updated = await updateProvider(ORG_A, 'apollo', 'api_key', cipher('second'));
      expect(updated.rows).toHaveLength(1);          // the branch must match a row
      expect(updated.rows[0].id).toBe(first.rows[0].id);

      const { rows } = await db.query(
        `SELECT encrypted_value, rotated_at FROM public.integration_credentials WHERE company_id=$1`,
        [ORG_A]);
      expect(rows).toHaveLength(1);                              // still ONE row
      expect(rows[0].encrypted_value).toBe(cipher('second'));    // the value moved
      expect(rows[0].encrypted_value).not.toBe(cipher('first')); // the old secret is gone
      expect(new Date(rows[0].rotated_at).getTime())
        .toBeGreaterThanOrEqual(new Date(firstRotatedAt).getTime());
    });
  });

  it('is provider-neutral — Clearbit stores beside Apollo without collision', async () => {
    await inRollback(async () => {
      await seedTenants();
      await insertProvider(ORG_A, 'apollo', 'api_key', cipher('apollo'));
      await insertProvider(ORG_A, 'clearbit', 'api_key', cipher('clearbit'));

      const { rows } = await db.query(
        `SELECT provider_key, encrypted_value FROM public.integration_credentials
          WHERE company_id=$1 ORDER BY provider_key`, [ORG_A]);
      expect(rows.map((r: { provider_key: string }) => r.provider_key)).toEqual(['apollo', 'clearbit']);
      expect(rows[0].encrypted_value).not.toBe(rows[1].encrypted_value);
    });
  });

  it('TENANT ISOLATION: the same provider and key in two tenants are two rows', async () => {
    await inRollback(async () => {
      await seedTenants();
      await insertProvider(ORG_A, 'apollo', 'api_key', cipher('tenant-a'));
      // Must NOT conflict: the tenant is the first column of the index.
      expect(await attempt(
        `INSERT INTO public.integration_credentials
           (company_id, provider_key, connection_id, credential_key, encrypted_value, rotated_at)
         VALUES ($1,'apollo',NULL,'api_key',$2,now())`, [ORG_B, cipher('tenant-b')])).toBe('ok');

      await insertProvider(ORG_B, 'apollo', 'api_key', cipher('tenant-b'));
      const { rows } = await db.query(
        `SELECT company_id FROM public.integration_credentials
          WHERE provider_key='apollo' ORDER BY company_id`);
      expect(rows).toHaveLength(2);

      // And a rotation in one tenant cannot reach the other's row.
      await updateProvider(ORG_A, 'apollo', 'api_key', cipher('rotated-a'));
      const { rows: b } = await db.query(
        `SELECT encrypted_value FROM public.integration_credentials
          WHERE company_id=$1 AND provider_key='apollo'`, [ORG_B]);
      expect(b[0].encrypted_value).toBe(cipher('tenant-b'));
    });
  });

  it('the one-owner CHECK still refuses a row that is both connection- and provider-scoped', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await attempt(
        `INSERT INTO public.integration_credentials
           (company_id, provider_key, connection_id, credential_key, encrypted_value, rotated_at)
         VALUES ($1,'apollo',gen_random_uuid(),'api_key','x',now())`, [ORG_A])).toBe('23514');
    });
  });
});

describe('A7P-C14C — the connection-scoped path is untouched', () => {
  it('still upserts through its own non-partial unique constraint', async () => {
    await inRollback(async () => {
      await seedTenants();
      const { rows: site } = await db.query(
        `INSERT INTO public.websites (company_id, name, canonical_url)
         VALUES ($1,'W6 Site','https://w6.example') RETURNING id`, [ORG_A]);
      const { rows: conn } = await db.query(
        `INSERT INTO public.website_connections (website_id, provider)
         VALUES ($1,'w6-test') RETURNING id`, [site[0].id]);
      const connectionId = conn[0].id;

      // The connection path's real statement — ON CONFLICT works here because
      // its arbiter is a plain UNIQUE constraint, not a partial index.
      const upsert = `
        INSERT INTO public.integration_credentials
          (connection_id, credential_key, encrypted_value, rotated_at)
        VALUES ($1,'api_key',$2,now())
        ON CONFLICT (connection_id, credential_key)
        DO UPDATE SET encrypted_value = excluded.encrypted_value, rotated_at = now()`;
      expect(await attempt(upsert, [connectionId, cipher('conn-first')])).toBe('ok');

      await db.query(upsert, [connectionId, cipher('conn-first')]);
      await db.query(upsert, [connectionId, cipher('conn-second')]);

      const { rows } = await db.query(
        `SELECT company_id, provider_key, encrypted_value FROM public.integration_credentials
          WHERE connection_id=$1`, [connectionId]);
      expect(rows).toHaveLength(1);                              // upsert, not duplicate
      expect(rows[0].encrypted_value).toBe(cipher('conn-second'));
      expect(rows[0].company_id).toBeNull();                     // still connection-scoped
      expect(rows[0].provider_key).toBeNull();
    });
  });
});
