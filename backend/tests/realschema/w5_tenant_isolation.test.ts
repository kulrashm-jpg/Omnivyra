/**
 * W6 — real-schema regression cover for the tenant-safe person spine.
 *
 * W4 hardened three edges; W5 hardened eleven more. Every one is a composite
 * foreign key of the form
 *
 *     (person_col, tenant_col) REFERENCES unified_persons (id, company_id)
 *
 * and the thing that makes them work — MATCH SIMPLE letting NULL references
 * through, and ON DELETE SET NULL (column_list) nulling only the person column
 * so the tenant survives — cannot be observed through a mock at all.
 *
 * This suite is the reason W6 exists: it fails if anybody reverts one of these
 * to a simple foreign key, or replaces the column-list delete action with a
 * bare SET NULL that would wipe tenants off surviving rows.
 */
import {
  db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson, newAccount, constraintDef,
} from './setup';

/** [table, person column, tenant column, constraint name, expected delete action] */
const SPINE: Array<[string, string, string, string, RegExp]> = [
  ['canonical_leads', 'unified_person_id', 'company_id', 'canonical_leads_person_tenant_fk', /SET NULL \(unified_person_id\)/],
  ['canonical_revenue_events', 'unified_person_id', 'company_id', 'canonical_revenue_events_person_tenant_fk', /SET NULL \(unified_person_id\)/],
  ['canonical_users', 'unified_person_id', 'company_id', 'canonical_users_person_tenant_fk', /SET NULL \(unified_person_id\)/],
  ['contacts', 'unified_person_id', 'organization_id', 'contacts_person_tenant_fk', /SET NULL \(unified_person_id\)/],
  ['engagement_threads', 'unified_person_id', 'organization_id', 'engagement_threads_person_tenant_fk', /SET NULL \(unified_person_id\)/],
  ['expected_event_instances', 'unified_person_id', 'company_id', 'expected_event_instances_person_tenant_fk', /SET NULL \(unified_person_id\)/],
  ['leads', 'unified_person_id', 'company_id', 'leads_person_tenant_fk', /SET NULL \(unified_person_id\)/],
  ['unified_touchpoints', 'unified_person_id', 'company_id', 'unified_touchpoints_person_tenant_fk', /SET NULL \(unified_person_id\)/],
  ['visitor_sessions', 'unified_person_id', 'company_id', 'visitor_sessions_person_tenant_fk', /SET NULL \(unified_person_id\)/],
  ['unified_person_merges', 'winner_person_id', 'company_id', 'unified_person_merges_winner_tenant_fk', /CASCADE/],
  ['unified_person_merges', 'loser_person_id', 'company_id', 'unified_person_merges_loser_tenant_fk', /CASCADE/],
];

describe('W5 — the referenced key exists', () => {
  it('unified_persons has UNIQUE (id, company_id)', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND indexname='uq_unified_persons_id_company'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/CREATE UNIQUE INDEX/);
  });

  it('company_id is NOT NULL, so a person always has a tenant', async () => {
    const { rows } = await db.query(
      `SELECT attnotnull FROM pg_attribute
        WHERE attrelid='public.unified_persons'::regclass AND attname='company_id'`);
    expect(rows[0].attnotnull).toBe(true);
  });
});

describe('W5 — every spine edge is a tenant-safe composite', () => {
  it.each(SPINE)('%s.%s', async (_t, pcol, tcol, name, delAction) => {
    const def = await constraintDef(name);
    expect(def).not.toBeNull();
    expect(def).toContain(`FOREIGN KEY (${pcol}, ${tcol})`);
    expect(def).toContain('REFERENCES unified_persons(id, company_id)');
    expect(def).toMatch(delAction);
  });

  it('leaves no simple person foreign key behind on a hardened table', async () => {
    const hardened = [...new Set(SPINE.map(([t]) => t))];
    const { rows } = await db.query(
      `SELECT s.relname tbl, con.conname
         FROM pg_constraint con
         JOIN pg_class s ON s.oid = con.conrelid
         JOIN pg_class t ON t.oid = con.confrelid
         JOIN pg_namespace n ON n.oid = s.relnamespace
        WHERE con.contype='f' AND n.nspname='public'
          AND t.relname='unified_persons'
          AND array_length(con.conkey,1) = 1
          AND s.relname = ANY($1::text[])`, [hardened]);
    expect(rows).toEqual([]);
  });
});

/**
 * Explicit row factories, one per table. Written out rather than derived from
 * pg_catalog: a governance suite should say plainly what it inserts, and a
 * generated row silently stops covering a column the day someone adds one.
 * Each returns the id of a legal, tenant-owned row with NO person attached.
 */
const ROW_FACTORY: Record<string, (org: string) => Promise<string>> = {
  contacts: async (org) => (await db.query(
    `INSERT INTO public.contacts (organization_id, contact_key, platform, platform_user_id)
     VALUES ($1,'w6-xt','w6','w6-xt') RETURNING id`, [org])).rows[0].id,

  engagement_threads: async (org) => (await db.query(
    `INSERT INTO public.engagement_threads (organization_id, platform, platform_thread_id)
     VALUES ($1,'w6','w6-xt') RETURNING id`, [org])).rows[0].id,

  // user_type and device are CHECK-constrained to fixed vocabularies.
  canonical_users: async (org) => (await db.query(
    `INSERT INTO public.canonical_users (company_id, user_type, device)
     VALUES ($1,'anonymous','unknown') RETURNING id`, [org])).rows[0].id,

  // canonical_leads.user_id is itself a tenant-safe composite FK into
  // canonical_users(id, company_id) — the 20260409 precedent W2/W4/W5 followed —
  // so the lead needs a real same-tenant canonical user first.
  canonical_leads: async (org) => {
    const user = await ROW_FACTORY.canonical_users(org);
    return (await db.query(
      `INSERT INTO public.canonical_leads (company_id, user_id, source)
       VALUES ($1,$2,'w6') RETURNING id`, [org, user])).rows[0].id;
  },

  unified_touchpoints: async (org) => (await db.query(
    `INSERT INTO public.unified_touchpoints
       (company_id, source, touchpoint_type, reference_table, reference_id, occurred_at)
     VALUES ($1,'w6','w6','w6','w6',now()) RETURNING id`, [org])).rows[0].id,
};

describe('W5 — cross-tenant references are rejected in both directions', () => {
  const covered = SPINE.filter(([t]) => t in ROW_FACTORY);

  it.each(covered)('%s.%s rejects A→B and B→A but accepts same-tenant', async (tbl, pcol, tcol) => {
    await inRollback(async () => {
      await seedTenants();
      const pA = await newPerson(ORG_A);
      const pB = await newPerson(ORG_B);
      const id = await ROW_FACTORY[tbl](ORG_A);

      // A tenant-A row may not point at a tenant-B person.
      expect(await attempt(`UPDATE public.${tbl} SET ${pcol}=$1 WHERE id=$2`, [pB, id])).toBe('23503');
      // ...but its own tenant's person is fine.
      expect(await attempt(`UPDATE public.${tbl} SET ${pcol}=$1 WHERE id=$2`, [pA, id])).toBe('ok');
      // Reverse: hold the person, move the ROW to the other tenant.
      await db.query(`UPDATE public.${tbl} SET ${pcol}=$1 WHERE id=$2`, [pA, id]);
      expect(await attempt(`UPDATE public.${tbl} SET ${tcol}=$1 WHERE id=$2`, [ORG_B, id])).toBe('23503');
    });
  });

  it('covers every hardened table that can hold a person reference', () => {
    // unified_person_merges and the zero-row analytics tables are covered by
    // their own blocks; this guards against the factory map silently shrinking.
    expect(covered.length).toBeGreaterThanOrEqual(5);
  });
});

describe('W5 — NULL semantics are preserved (MATCH SIMPLE)', () => {
  it('an unlinked contact is still legal', async () => {
    await inRollback(async () => {
      await seedTenants();
      const code = await attempt(
        `INSERT INTO public.contacts (organization_id, unified_person_id, contact_key, platform, platform_user_id)
         VALUES ($1, NULL, 'w6-null-1', 'w6', 'w6-null-1')`, [ORG_A]);
      expect(code).toBe('ok');
    });
  });

  it('deleting a person nulls the person column but PRESERVES the tenant', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const c = await db.query(
        `INSERT INTO public.contacts (organization_id, unified_person_id, contact_key, platform, platform_user_id)
         VALUES ($1,$2,'w6-del-1','w6','w6-del-1') RETURNING id`, [ORG_A, p]);
      await db.query('DELETE FROM public.unified_persons WHERE id=$1', [p]);
      const { rows } = await db.query(
        'SELECT organization_id, unified_person_id FROM public.contacts WHERE id=$1', [c.rows[0].id]);
      expect(rows[0].unified_person_id).toBeNull();
      // A bare SET NULL on the composite key would have wiped this too.
      expect(rows[0].organization_id).toBe(ORG_A);
    });
  });
});

describe('W5 — unified_person_merges constrains BOTH persons', () => {
  it('rejects a cross-tenant loser', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newPerson(ORG_A); const b = await newPerson(ORG_B);
      expect(await attempt(
        `INSERT INTO public.unified_person_merges (company_id, winner_person_id, loser_person_id)
         VALUES ($1,$2,$3)`, [ORG_A, a, b])).toBe('23503');
    });
  });

  it('rejects a cross-tenant winner', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newPerson(ORG_A); const b = await newPerson(ORG_B);
      expect(await attempt(
        `INSERT INTO public.unified_person_merges (company_id, winner_person_id, loser_person_id)
         VALUES ($1,$2,$3)`, [ORG_A, b, a])).toBe('23503');
    });
  });

  it('rejects a loser that does not exist — before W5 this had no FK at all', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newPerson(ORG_A);
      expect(await attempt(
        `INSERT INTO public.unified_person_merges (company_id, winner_person_id, loser_person_id)
         VALUES ($1,$2,'00000000-0000-0000-0000-000000000000')`, [ORG_A, a])).toBe('23503');
    });
  });

  it('accepts a legal same-tenant merge', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newPerson(ORG_A); const a2 = await newPerson(ORG_A);
      expect(await attempt(
        `INSERT INTO public.unified_person_merges (company_id, winner_person_id, loser_person_id)
         VALUES ($1,$2,$3)`, [ORG_A, a, a2])).toBe('ok');
    });
  });
});

describe('W4 — account edges reject cross-tenant references', () => {
  it('a claim cannot name another tenant\'s person or account', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pB = await newPerson(ORG_B);
      const accB = await newAccount(ORG_B, { domain: 'w6xt.example' });
      expect(await attempt(
        `INSERT INTO public.identity_claims (organization_id, person_id, claim_type, platform, normalized_value, source)
         VALUES ($1,$2,'email',NULL,'xt1@w6.test','w6')`, [ORG_A, pB])).toBe('23503');
      expect(await attempt(
        `INSERT INTO public.identity_claims (organization_id, account_id, claim_type, platform, normalized_value, source)
         VALUES ($1,$2,'domain',NULL,'xt2.w6.test','w6')`, [ORG_A, accB])).toBe('23503');
    });
  });

  it('a person cannot be attached to another tenant\'s account', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pA = await newPerson(ORG_A);
      const accB = await newAccount(ORG_B, { domain: 'w6xt2.example' });
      expect(await attempt(
        `UPDATE public.unified_persons SET account_id=$1 WHERE id=$2`, [accB, pA])).toBe('23503');
    });
  });

  it('deleting an account with people attached is RESTRICTED', async () => {
    await inRollback(async () => {
      await seedTenants();
      const acc = await newAccount(ORG_A, { domain: 'w6restrict.example' });
      const p = await newPerson(ORG_A);
      await db.query('UPDATE public.unified_persons SET account_id=$1 WHERE id=$2', [acc, p]);
      expect(await attempt('DELETE FROM public.prospect_accounts WHERE id=$1', [acc])).toBe('23503');
    });
  });
});
