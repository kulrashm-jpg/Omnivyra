/**
 * LI-5B Phase 1 — the claims-based external-identity lookup, against real
 * PostgreSQL.
 *
 * The unit suite proves the shadow logic. This proves the database facts it
 * rests on: that `(organization_id, claim_type, platform, normalized_value)` is
 * atomically unique per tenant, that the same identifier is legitimately
 * reusable across tenants and across platforms, and that a person may hold many
 * identifiers at once.
 */
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson } from './setup';

const CLAIM = `INSERT INTO public.identity_claims
  (organization_id, person_id, claim_type, platform, normalized_value, source, observed_at, recorded_at, verification_state, evidence)
  VALUES ($1,$2,$3,$4,$5,'li5b-test',now(),now(),'unverified','{}'::jsonb) RETURNING id`;

const insertClaim = async (org: string, person: string | null, type: string, platform: string | null, value: string) =>
  (await db.query(CLAIM, [org, person, type, platform, value])).rows[0].id;

const tryClaim = (org: string, person: string | null, type: string, platform: string | null, value: string) =>
  attempt(
    `INSERT INTO public.identity_claims
      (organization_id, person_id, claim_type, platform, normalized_value, source, observed_at, recorded_at, verification_state, evidence)
     VALUES ($1,$2,$3,$4,$5,'li5b-test',now(),now(),'unverified','{}'::jsonb)`,
    [org, person, type, platform, value]);

beforeAll(seedTenants);

describe('LI-5B — the external identity key', () => {
  it('is (organization_id, claim_type, platform, normalized_value), active-only, NULLS NOT DISTINCT', async () => {
    const { rows } = await db.query(
      `SELECT indexdef d FROM pg_indexes WHERE indexname='uq_identity_claims_tenant_identity'`);
    expect(rows[0].d).toMatch(/\(organization_id, claim_type, platform, normalized_value\)/);
    expect(rows[0].d).toMatch(/NULLS NOT DISTINCT/);
    expect(rows[0].d).toMatch(/WHERE \(revoked_at IS NULL\)/);
  });

  it('the platform rule forces external claims to name a provider', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      // external_id with no platform is refused...
      expect(await tryClaim(ORG_A, p, 'external_id', null, 'a-1')).toBe('23514');
      // ...and email with a platform is refused too.
      expect(await tryClaim(ORG_A, p, 'email', 'apollo', 'a@x.test')).toBe('23514');
      expect(await tryClaim(ORG_A, p, 'external_id', 'apollo', 'a-1')).toBe('ok');
    });
  });

  it('values must already be normalised — the database refuses uppercase', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      expect(await tryClaim(ORG_A, p, 'external_id', 'apollo', 'A-1')).toBe('23514');
    });
  });
});

describe('LI-5B — uniqueness semantics', () => {
  it('the same tenant + platform + value twice is refused', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      await insertClaim(ORG_A, p, 'external_id', 'apollo', 'a-123');
      expect(await tryClaim(ORG_A, p, 'external_id', 'apollo', 'a-123')).toBe('23505');
    });
  });

  it('the SAME value in two tenants is allowed — identity stays tenant-scoped', async () => {
    await inRollback(async () => {
      const a = await newPerson(ORG_A);
      const b = await newPerson(ORG_B);
      await insertClaim(ORG_A, a, 'external_id', 'apollo', 'a-123');
      expect(await tryClaim(ORG_B, b, 'external_id', 'apollo', 'a-123')).toBe('ok');
    });
  });

  it('the same value on a DIFFERENT platform is a distinct identity', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      await insertClaim(ORG_A, p, 'external_id', 'apollo', 'shared-123');
      expect(await tryClaim(ORG_A, p, 'external_id', 'linkedin', 'shared-123')).toBe('ok');
    });
  });

  it('external_id and external_profile are distinct claim types for one value', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      await insertClaim(ORG_A, p, 'external_id', 'apollo', 'a-123');
      // Q-3 is unresolved; the schema permits both, which is why the shadow observes both.
      expect(await tryClaim(ORG_A, p, 'external_profile', 'apollo', 'a-123')).toBe('ok');
    });
  });

  it('a revoked claim frees the key, so re-claiming is expressible', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      const id = await insertClaim(ORG_A, p, 'external_id', 'apollo', 'a-123');
      await db.query(`UPDATE public.identity_claims SET revoked_at=now(), revoked_reason='test' WHERE id=$1`, [id]);
      expect(await tryClaim(ORG_A, p, 'external_id', 'apollo', 'a-123')).toBe('ok');
    });
  });

  it('ON CONFLICT cannot infer the partial index — 42P10, so the writer must catch 23505', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      await insertClaim(ORG_A, p, 'external_id', 'apollo', 'a-123');
      const code = await attempt(
        `INSERT INTO public.identity_claims
          (organization_id, person_id, claim_type, platform, normalized_value, source, observed_at, recorded_at, verification_state, evidence)
         VALUES ($1,$2,'external_id','apollo','a-123','li5b-test',now(),now(),'unverified','{}'::jsonb)
         ON CONFLICT (organization_id, claim_type, platform, normalized_value) DO NOTHING`,
        [ORG_A, p]);
      expect(code).toBe('42P10');
    });
  });
});

describe('LI-5B — one person, many identifiers', () => {
  it('a person may hold Apollo, LinkedIn and CRM identifiers simultaneously', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      for (const [platform, value] of [['apollo', 'a-1'], ['linkedin', 'l-1'], ['crm', 'c-1']]) {
        expect(await tryClaim(ORG_A, p, 'external_id', platform, value)).toBe('ok');
      }
      await insertClaim(ORG_A, p, 'external_id', 'apollo', 'a-1');
      await insertClaim(ORG_A, p, 'external_id', 'linkedin', 'l-1');
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.identity_claims WHERE person_id=$1 AND claim_type='external_id'`, [p]);
      expect(Number(rows[0].n)).toBe(2);
    });
  });

  it('a claim may exist with NO person — the parked state the shadow must not promote', async () => {
    await inRollback(async () => {
      expect(await tryClaim(ORG_A, null, 'external_id', 'linkedin', 'unresolved-1')).toBe('ok');
    });
  });
});

describe('LI-5B — cross-tenant attachment is refused by the database', () => {
  it('a Tenant A claim cannot name a Tenant B person', async () => {
    await inRollback(async () => {
      const b = await newPerson(ORG_B);
      expect(await tryClaim(ORG_A, b, 'external_id', 'apollo', 'a-123')).toBe('23503');
    });
  });

  it('the person reference is composite and tenant-safe', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='identity_claims_person_tenant_fk'`);
    expect(rows[0].d).toMatch(/FOREIGN KEY \(person_id, organization_id\)/);
    expect(rows[0].d).toMatch(/REFERENCES unified_persons\(id, company_id\)/);
  });
});

describe('LI-5B — the legacy column is untouched by this phase', () => {
  it('external_keys still has only its GIN index — no uniqueness was added', async () => {
    const { rows } = await db.query(`
      SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname='public' AND tablename='unified_persons' AND indexdef LIKE '%external_keys%'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/USING gin/);
    expect(rows[0].indexdef).not.toMatch(/UNIQUE/);
  });

  it('a legacy-shaped external_keys row is still perfectly legal — nothing was migrated', async () => {
    await inRollback(async () => {
      const code = await attempt(
        `INSERT INTO public.unified_persons (company_id, external_keys)
         VALUES ($1, '{"linkedin_urns":["urn:li:person:x"]}'::jsonb)`, [ORG_A]);
      expect(code).toBe('ok');
    });
  });
});
