/**
 * W6 — real-schema regression cover for W3 (identity claims) and W4 (prospect
 * accounts).
 *
 * W3 established that a claim is made idempotent by a DATABASE constraint, not
 * by SELECT-then-INSERT, and that the constraint is a PARTIAL index with
 * NULLS NOT DISTINCT — the combination that makes an upsert raise 42P10 and
 * forced W3's insert-and-catch-23505 persistence strategy. W4 established two
 * deterministic account identity keys, neither of which is a company name.
 *
 * These properties are invisible to mocked tests. Here they are executed.
 */
import {
  db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson, newAccount, uniqueIndexColumns,
} from './setup';

describe('W3 — identity claim uniqueness', () => {
  it('is enforced by a partial index with NULLS NOT DISTINCT', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND indexname='uq_identity_claims_tenant_identity'`,
    );
    expect(rows).toHaveLength(1);
    const def: string = rows[0].indexdef;
    expect(def).toMatch(/CREATE UNIQUE INDEX/);
    // platform is NULL for email/phone/domain claims, so without NULLS NOT
    // DISTINCT the index would not deduplicate them at all.
    expect(def).toMatch(/NULLS NOT DISTINCT/i);
    expect(def).toMatch(/revoked_at IS NULL/);
    expect(def).toMatch(/organization_id/);
    expect(def).toMatch(/normalized_value/);
  });

  it('rejects a duplicate claim within a tenant', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const ins = `INSERT INTO public.identity_claims
        (organization_id, person_id, claim_type, platform, normalized_value, source)
        VALUES ($1,$2,'email',NULL,'dup@w6.test','w6')`;
      await db.query(ins, [ORG_A, p]);
      expect(await attempt(ins, [ORG_A, p])).toBe('23505');
    });
  });

  it('deduplicates even when platform is NULL — the NULLS NOT DISTINCT case', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const ins = `INSERT INTO public.identity_claims
        (organization_id, person_id, claim_type, platform, normalized_value, source)
        VALUES ($1,$2,'phone',NULL,'+15550001','w6')`;
      await db.query(ins, [ORG_A, p]);
      expect(await attempt(ins, [ORG_A, p])).toBe('23505');
    });
  });

  it('keeps the same identity separate across tenants', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pa = await newPerson(ORG_A);
      const pb = await newPerson(ORG_B);
      const ins = `INSERT INTO public.identity_claims
        (organization_id, person_id, claim_type, platform, normalized_value, source)
        VALUES ($1,$2,'email',NULL,'same@w6.test','w6')`;
      await db.query(ins, [ORG_A, pa]);
      await expect(db.query(ins, [ORG_B, pb])).resolves.toBeDefined();
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.identity_claims WHERE normalized_value='same@w6.test'`);
      expect(rows[0].n).toBe(2);
    });
  });

  it('allows an unresolved claim (person_id NULL) — W3 relies on this', async () => {
    await inRollback(async () => {
      await seedTenants();
      await expect(db.query(
        `INSERT INTO public.identity_claims
           (organization_id, claim_type, platform, normalized_value, source)
         VALUES ($1,'external_id','linkedin','w6-ext-1','w6')`, [ORG_A],
      )).resolves.toBeDefined();
    });
  });

  it('cannot be upserted on the partial index — the 42P10 trap W3 avoided', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const code = await attempt(
        `INSERT INTO public.identity_claims
           (organization_id, person_id, claim_type, platform, normalized_value, source)
         VALUES ($1,$2,'email',NULL,'upsert@w6.test','w6')
         ON CONFLICT (organization_id, claim_type, platform, normalized_value) DO NOTHING`,
        [ORG_A, p]);
      // Documents WHY canonicalisation.ts inserts and catches 23505 instead of
      // upserting. If this ever starts returning 'ok', the partial index changed.
      expect(code).toBe('42P10');
    });
  });
});

describe('W4 — prospect account identity keys', () => {
  it('has both deterministic keys and neither is a name', async () => {
    const bySource = await uniqueIndexColumns('uq_prospect_accounts_org_source_ref');
    const byDomain = await uniqueIndexColumns('uq_prospect_accounts_org_domain_active');
    expect(bySource).toEqual(expect.arrayContaining(['organization_id', 'source', 'source_reference']));
    expect(byDomain).toEqual(expect.arrayContaining(['organization_id', 'domain_normalized']));

    const { rows } = await db.query(
      `SELECT count(*)::int n FROM pg_indexes
        WHERE schemaname='public' AND tablename='prospect_accounts'
          AND indexdef ILIKE '%UNIQUE%'
          AND (indexdef ILIKE '%(name%' OR indexdef ILIKE '%legal_name%')`);
    expect(rows[0].n).toBe(0);
  });

  it('rejects a duplicate provider reference within a tenant', async () => {
    await inRollback(async () => {
      await seedTenants();
      await newAccount(ORG_A, { source: 'crm', ref: 'W6-1' });
      const code = await attempt(
        `INSERT INTO public.prospect_accounts (organization_id, source, source_reference)
         VALUES ($1,'crm','W6-1')`, [ORG_A]);
      expect(code).toBe('23505');
    });
  });

  it('rejects a duplicate domain within a tenant', async () => {
    await inRollback(async () => {
      await seedTenants();
      await newAccount(ORG_A, { domain: 'w6dup.example' });
      const code = await attempt(
        `INSERT INTO public.prospect_accounts (organization_id, domain_normalized, source)
         VALUES ($1,'w6dup.example','w6')`, [ORG_A]);
      expect(code).toBe('23505');
    });
  });

  it('allows the same provider reference in a different tenant', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newAccount(ORG_A, { source: 'crm', ref: 'W6-SHARED' });
      const b = await newAccount(ORG_B, { source: 'crm', ref: 'W6-SHARED' });
      expect(a).not.toBe(b);
    });
  });

  it('allows the same domain in a different tenant', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newAccount(ORG_A, { domain: 'w6shared.example' });
      const b = await newAccount(ORG_B, { domain: 'w6shared.example' });
      expect(a).not.toBe(b);
    });
  });

  it('does not deduplicate on name — two accounts may share one', async () => {
    await inRollback(async () => {
      await seedTenants();
      await db.query(
        `INSERT INTO public.prospect_accounts (organization_id, name, domain_normalized, source)
         VALUES ($1,'Acme Corp','w6acme-one.example','w6')`, [ORG_A]);
      await expect(db.query(
        `INSERT INTO public.prospect_accounts (organization_id, name, domain_normalized, source)
         VALUES ($1,'Acme Corp','w6acme-two.example','w6')`, [ORG_A],
      )).resolves.toBeDefined();
    });
  });
});
