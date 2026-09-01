/**
 * B1 — the social contact identity edge, against real PostgreSQL.
 *
 * The unit suite proves the resolver's logic against a double. This proves the
 * database behaviour that logic RESTS ON, because every branch of it is a bet
 * on a specific SQLSTATE:
 *
 *   - a repeated claim really raises `23505` and not something else, so
 *     "already claimed" is a benign outcome rather than a swallowed failure;
 *   - `ON CONFLICT` really answers `42P10` against the partial unique index,
 *     so INSERT-and-catch is the correct shape and not a workaround;
 *   - the composite FK really refuses a cross-tenant `unified_person_id` on
 *     `contacts`, so D-1 survives a bug in the application layer;
 *   - an unresolved contact may legally keep `unified_person_id` NULL, which is
 *     what makes "never invent a person for a bare handle" a storable position
 *     rather than a temporary one.
 *
 * The last is the load-bearing one. If the column were NOT NULL, refusing to
 * mint a person would be impossible and the honest unresolved state would have
 * no representation.
 */
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson } from './setup';

/** Exactly the claim shape backend/services/prospectIdentity/socialContactResolution writes. */
const CLAIM = `INSERT INTO public.identity_claims
  (organization_id, person_id, claim_type, platform, normalized_value, raw_value,
   source, source_reference, evidence, confidence, verification_state, observed_at, recorded_at)
  VALUES ($1,$2,'external_id',$3,$4,$5,'social_contact_ingestion',$6,$7::jsonb,1,'unverified',now(),now())`;

const claim = (
  org: string, person: string | null, platform: string, value: string,
  ref = 'contacts:x', evidence = '{}',
) => db.query(`${CLAIM} RETURNING id`, [org, person, platform, value, 'RAW', ref, evidence]);

const tryClaim = (
  org: string, person: string | null, platform: string, value: string,
  ref = 'contacts:x', evidence = '{}',
) => attempt(CLAIM, [org, person, platform, value, 'RAW', ref, evidence]);

/** A contact exactly as canonicalLeadSignalService creates one: identity-free. */
async function newContact(org: string, platformUserId: string, platform = 'linkedin'): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.contacts (organization_id, platform, platform_user_id, contact_key)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [org, platform, platformUserId, `${platform}:${platformUserId}`],
  );
  return rows[0].id;
}

const personOf = async (contactId: string): Promise<string | null> => (await db.query(
  `SELECT unified_person_id FROM public.contacts WHERE id=$1`, [contactId])).rows[0].unified_person_id;

beforeAll(seedTenants);

describe('B1 — the SQLSTATEs the resolver classifies on', () => {
  it('a repeated claim for one identity raises 23505 — the only benign duplicate', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      await claim(ORG_A, p, 'linkedin', 'abc123');
      expect(await tryClaim(ORG_A, p, 'linkedin', 'abc123')).toBe('23505');
    });
  });

  it('person_id is NOT part of the uniqueness key — an unresolved claim blocks a linked one', async () => {
    // This is why a second run over the 10 existing W3 rows converges on
    // `already_exists` instead of writing a second, contradictory claim.
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      await claim(ORG_A, null, 'linkedin', 'abc123');            // the W3 shape
      expect(await tryClaim(ORG_A, p, 'linkedin', 'abc123')).toBe('23505');
    });
  });

  it('ON CONFLICT still answers 42P10 — which is why the writer catches 23505 instead', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      await claim(ORG_A, p, 'linkedin', 'abc123');
      const code = await attempt(
        `${CLAIM} ON CONFLICT (organization_id, claim_type, platform, normalized_value) DO NOTHING`,
        [ORG_A, p, 'linkedin', 'abc123', 'RAW', 'contacts:x', '{}']);
      expect(code).toBe('42P10');
    });
  });

  it('a cross-tenant person on the claim raises 23503 — classified as tenant_fk_failure', async () => {
    await inRollback(async () => {
      const b = await newPerson(ORG_B);
      expect(await tryClaim(ORG_A, b, 'linkedin', 'abc123')).toBe('23503');
    });
  });

  it('an un-normalised value raises 23514, so a resolver that skipped normalization would be caught', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      expect(await tryClaim(ORG_A, p, 'linkedin', 'ABC123')).toBe('23514');
    });
  });

  it('external_id without a platform raises 23514 — the platform rule the writer must satisfy', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      const code = await attempt(
        `INSERT INTO public.identity_claims
          (organization_id, person_id, claim_type, platform, normalized_value,
           source, evidence, verification_state, observed_at, recorded_at)
         VALUES ($1,$2,'external_id',NULL,'abc123','social_contact_ingestion','{}'::jsonb,'unverified',now(),now())`,
        [ORG_A, p]);
      expect(code).toBe('23514');
    });
  });
});

describe('B1 — the contacts identity edge', () => {
  it('a contact is created with unified_person_id NULL, exactly as ingestion leaves it', async () => {
    await inRollback(async () => {
      const c = await newContact(ORG_A, 'abc123');
      expect(await personOf(c)).toBeNull();
    });
  });

  it('an UNRESOLVED contact may legally keep unified_person_id NULL forever', async () => {
    // The whole "never invent a person for a bare handle" position depends on
    // this column being nullable. If it were NOT NULL, the honest unresolved
    // state would be unstorable and minting a person would be forced.
    await inRollback(async () => {
      const c = await newContact(ORG_A, 'abc123');
      await claim(ORG_A, null, 'linkedin', 'abc123', `contacts:${c}`,
        JSON.stringify({ resolutionOutcome: 'unresolved', linked: false }));
      expect(await attempt(
        `UPDATE public.contacts SET updated_at=now() WHERE id=$1`, [c])).toBe('ok');
      expect(await personOf(c)).toBeNull();

      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.unified_persons WHERE company_id=$1`, [ORG_A]);
      expect(Number(rows[0].n)).toBe(0);   // no person was conjured
    });
  });

  it('a same-tenant person is accepted as the contact identity', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      const c = await newContact(ORG_A, 'abc123');
      expect(await attempt(
        `UPDATE public.contacts SET unified_person_id=$1 WHERE id=$2 AND organization_id=$3`,
        [p, c, ORG_A])).toBe('ok');
    });
  });

  it('a CROSS-TENANT unified_person_id on contacts is REFUSED by the composite FK', async () => {
    // D-1 is not an application rule. A person in another tenant cannot become
    // this tenant's contact identity even if every guard above were bypassed.
    await inRollback(async () => {
      const b = await newPerson(ORG_B);
      const c = await newContact(ORG_A, 'abc123');
      expect(await attempt(
        `UPDATE public.contacts SET unified_person_id=$1 WHERE id=$2`, [b, c])).toBe('23503');
      expect(await personOf(c)).toBeNull();
    });
  });

  it('the tenant-safe FK is composite, not a bare person reference', async () => {
    const { rows } = await db.query(`
      SELECT pg_get_constraintdef(con.oid) d
        FROM pg_constraint con JOIN pg_class s ON s.oid = con.conrelid
       WHERE con.contype='f' AND s.relname='contacts'
         AND pg_get_constraintdef(con.oid) LIKE '%unified_person_id%'`);
    expect(rows.length).toBeGreaterThan(0);
    const def: string = rows.map((r: { d: string }) => r.d).join(' | ');
    expect(def).toContain('organization_id');
    expect(def).toContain('unified_persons');
  });

  it('the same platform identity in two tenants is two contacts and two claims', async () => {
    await inRollback(async () => {
      await newContact(ORG_A, 'abc123');
      await newContact(ORG_B, 'abc123');
      await claim(ORG_A, null, 'linkedin', 'abc123');
      await claim(ORG_B, null, 'linkedin', 'abc123');
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.identity_claims
          WHERE source='social_contact_ingestion' AND normalized_value='abc123' AND revoked_at IS NULL`);
      expect(Number(rows[0].n)).toBe(2);
    });
  });
});

describe('B1 — parking an ambiguous identity', () => {
  it('one open pair per unordered pair; the repeat is a benign 23505', async () => {
    await inRollback(async () => {
      const a = await newPerson(ORG_A);
      const b = await newPerson(ORG_A);
      const park = (x: string, y: string) => attempt(
        `INSERT INTO public.person_duplicate_candidates
          (organization_id, person_id, candidate_person_id, classification, matched_on)
         VALUES ($1,$2,$3,'probable','external_key')`, [ORG_A, x, y]);

      expect(await park(a, b)).toBe('ok');
      // ROLLBACK TO SAVEPOINT undid the first insert, so re-park then repeat.
      await db.query(
        `INSERT INTO public.person_duplicate_candidates
          (organization_id, person_id, candidate_person_id, classification, matched_on)
         VALUES ($1,$2,$3,'probable','external_key')`, [ORG_A, a, b]);
      expect(await park(a, b)).toBe('23505');
      expect(await park(b, a)).toBe('23505');   // the pair is unordered
    });
  });

  it('external_key is an accepted deterministic signal', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='person_dup_matched_on_valid'`);
    expect(rows[0].d).toContain('external_key');
  });

  it('a cross-tenant candidate pair is refused', async () => {
    await inRollback(async () => {
      const a = await newPerson(ORG_A);
      const b = await newPerson(ORG_B);
      expect(await attempt(
        `INSERT INTO public.person_duplicate_candidates
          (organization_id, person_id, candidate_person_id, classification, matched_on)
         VALUES ($1,$2,$3,'probable','external_key')`, [ORG_A, a, b])).toBe('23503');
    });
  });
});
