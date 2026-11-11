/**
 * PI-LDB — the mapping profile tables, against the real DDL.
 *
 * ─── WHY THIS EXISTS ALONGSIDE THE UNIT SUITE ─────────────────────────────
 * `backend/tests/unit/leadMappingProfileStore.test.ts` tests the store's
 * ordering logic against a double that imitates these constraints. A double is
 * only ever as good as the constraints copied into it, and a copy that has
 * drifted from the schema is worse than no test — it reports green while the
 * real database behaves differently.
 *
 * So this file proves the other half: that the constraints the double imitates
 * are the constraints Postgres actually enforces. Together they mean something;
 * either alone does not.
 *
 * ─── EVERY REFUSAL IS OBSERVED, NOT ASSUMED ───────────────────────────────
 * `attempt()` returns the SQLSTATE a statement raised, so each test here names
 * the error it expects. A test that merely inserted valid rows would pass
 * against a table with no constraints at all.
 */

import {
  ORG_A,
  ORG_B,
  attempt,
  constraintDef,
  db,
  inRollback,
  seedTenants,
  uniqueIndexColumns,
} from './setup';

const FP_A = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);

const HEADERS = ['Full Name', 'Work Email', 'Designation'];

/** Inserts a profile and returns its id. Caller is inside `inRollback`. */
async function insertProfile(
  org: string,
  opts: {
    source?: string;
    fingerprint?: string;
    version?: number;
    status?: string;
    supersededAt?: string | null;
    headers?: string[];
    headerCount?: number;
  } = {},
): Promise<string> {
  const headers = opts.headers ?? HEADERS;
  const { rows } = await db.query(
    `INSERT INTO public.source_mapping_profiles
       (organization_id, source, schema_fingerprint, version, status, superseded_at, header_count, headers)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING id`,
    [
      org,
      opts.source ?? 'csv',
      opts.fingerprint ?? FP_A,
      opts.version ?? 1,
      opts.status ?? 'active',
      opts.supersededAt ?? null,
      opts.headerCount ?? headers.length,
      JSON.stringify(headers),
    ],
  );
  return rows[0].id;
}

const ENTRY_SQL = `
  INSERT INTO public.source_mapping_profile_entries
    (organization_id, profile_id, source_field, source_field_normalized,
     target_field, decision, mapping_method, transformation, score, evidence, approved_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`;

const entryParams = (
  org: string,
  profileId: string,
  over: Partial<{
    sourceField: string;
    normalized: string;
    target: string | null;
    decision: string;
    method: string;
    transformation: string | null;
    score: number | null;
    evidence: unknown;
    approvedAt: string | null;
  }> = {},
) => [
  org,
  profileId,
  over.sourceField ?? 'Designation',
  over.normalized ?? 'designation',
  over.target === undefined ? 'jobTitle' : over.target,
  over.decision ?? 'approved',
  over.method ?? 'tenant_confirmed',
  over.transformation === undefined ? 'trim' : over.transformation,
  over.score === undefined ? 0.9 : over.score,
  JSON.stringify(over.evidence ?? []),
  over.approvedAt === undefined ? '2026-11-03T00:00:00.000Z' : over.approvedAt,
];

/* ── structure ───────────────────────────────────────────────────────────── */

describe('PI-LDB-1 · the tables are shaped the way the store assumes', () => {
  it('creates both tables', async () => {
    const { rows } = await db.query(
      `SELECT to_regclass('public.source_mapping_profiles') p,
              to_regclass('public.source_mapping_profile_entries') e`,
    );
    expect(rows[0].p).not.toBeNull();
    expect(rows[0].e).not.toBeNull();
  });

  it('carries all six named unique indexes', async () => {
    // Named individually. A count would pass if the wrong index existed, and
    // each of these encodes a different rule the store depends on.
    expect(await uniqueIndexColumns('uq_source_mapping_profiles_active')).toEqual([
      'organization_id',
      'source',
      'schema_fingerprint',
    ]);
    expect(await uniqueIndexColumns('uq_source_mapping_profiles_version')).toEqual([
      'organization_id',
      'source',
      'schema_fingerprint',
      'version',
    ]);
    expect(await uniqueIndexColumns('uq_source_mapping_profiles_id_org')).toEqual([
      'id',
      'organization_id',
    ]);
    expect(await uniqueIndexColumns('uq_smpe_approved_per_field')).toEqual([
      'profile_id',
      'source_field_normalized',
    ]);
    expect(await uniqueIndexColumns('uq_smpe_ignored_per_field')).toEqual([
      'profile_id',
      'source_field_normalized',
    ]);
    expect(await uniqueIndexColumns('uq_smpe_rejected_per_target')).toEqual([
      'profile_id',
      'source_field_normalized',
      'target_field',
    ]);
  });

  it('makes the entry foreign key COMPOSITE, so a tenant cannot be crossed', async () => {
    const def = await constraintDef('smpe_profile_tenant_fk');
    expect(def).not.toBeNull();
    // Referencing `id` alone would let an entry point at another tenant's
    // profile while carrying its own organization_id.
    expect(def).toMatch(/FOREIGN KEY \(profile_id, organization_id\)/);
    expect(def).toMatch(/REFERENCES source_mapping_profiles\(id, organization_id\)/);
  });

  it('has row level security enabled on both tables', async () => {
    const { rows } = await db.query(
      `SELECT relname, relrowsecurity FROM pg_class
        WHERE relname IN ('source_mapping_profiles', 'source_mapping_profile_entries')`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r: { relrowsecurity: boolean }) => r.relrowsecurity)).toBe(true);
  });

  it('GOV-H: the actor columns carry NO foreign key into users at all', async () => {
    // Renumbered 20270211000000 (2026-11-11) dropped the users FKs on
    // created_by / approved_by: immutable actor attribution carries no FK
    // (an ON DELETE SET NULL FK rewrites history when a user is deleted).
    // Writer-validated instead (mappingProfileStore, active-member check).
    for (const name of ['source_mapping_profiles', 'source_mapping_profile_entries']) {
      const { rows } = await db.query(
        `SELECT pg_get_constraintdef(c.oid) d
           FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relname = $1 AND c.contype = 'f'
            AND pg_get_constraintdef(c.oid) LIKE '%users(id)%'`,
        [name],
      );
      expect(rows).toEqual([]);
    }
  });

  it('the SCOPE FK is load-bearing: without it, the tenant FK (MATCH SIMPLE) admits a platform entry on a profile that does not exist', async () => {
    // smpe_profile_tenant_fk (profile_id, organization_id) is MATCH SIMPLE, so
    // it is NOT checked when organization_id is NULL - every platform row.
    // smpe_profile_scope_fk (profile_id, scope) has two NOT NULL columns and is
    // always checked. This proves the hole is real, so the pair is not
    // mistaken for redundancy and the scope FK "simplified" away.
    await inRollback(async () => {
      await seedTenants();
      const ghost = '00000000-0000-4000-8000-00000000dead';   // no such profile
      const insert = `INSERT INTO public.source_mapping_profile_entries
          (scope, organization_id, profile_id, source_field, source_field_normalized, target_field, decision, mapping_method)
        VALUES ('platform', NULL, $1, 'x', 'x', 'jobTitle', 'approved', 'high_confidence_suggestion')`;
      // With both FKs: REJECTED (by the scope FK).
      expect(await attempt(insert, [ghost])).toBe('23503');
      // Drop ONLY the scope FK; the tenant FK stays.
      await db.query('ALTER TABLE public.source_mapping_profile_entries DROP CONSTRAINT smpe_profile_scope_fk');
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'smpe_profile_tenant_fk' AND contype = 'f'`);
      expect(rows[0].n).toBe(1);
      // THE HOLE: the same orphan entry is now ACCEPTED.
      expect(await attempt(insert, [ghost])).toBe('ok');
    });
    // The rollback restored the scope FK.
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'smpe_profile_scope_fk' AND contype = 'f'`);
    expect(rows[0].n).toBe(1);
  });

  it('scope: a platform profile has NO tenant and an entry cannot attach to the other scope', async () => {
    await inRollback(async () => {
      await seedTenants();
      const fp = 'b'.repeat(64);
      // platform profile with a tenant -> refused by the coherence CHECK
      expect(await attempt(
        `INSERT INTO public.source_mapping_profiles (scope, organization_id, source, schema_fingerprint, version, status, header_count, headers)
         VALUES ('platform', $1, 'apollo', $2, 1, 'active', 1, '["x"]'::jsonb)`, [ORG_A, fp])).toBe('23514');
      // a valid platform profile
      const { rows } = await db.query(
        `INSERT INTO public.source_mapping_profiles (scope, organization_id, source, schema_fingerprint, version, status, header_count, headers)
         VALUES ('platform', NULL, 'apollo', $1, 1, 'active', 1, '["x"]'::jsonb) RETURNING id`, [fp]);
      const pid = rows[0].id;
      // a second ACTIVE platform profile for the same shape -> refused (NULL org must not defeat uniqueness)
      expect(await attempt(
        `INSERT INTO public.source_mapping_profiles (scope, organization_id, source, schema_fingerprint, version, status, header_count, headers)
         VALUES ('platform', NULL, 'apollo', $1, 2, 'active', 1, '["x"]'::jsonb)`, [fp])).toBe('23505');
      // a TENANT entry pointing at the PLATFORM profile -> refused by the scope FK
      expect(await attempt(
        `INSERT INTO public.source_mapping_profile_entries (scope, organization_id, profile_id, source_field, source_field_normalized, target_field, decision, mapping_method)
         VALUES ('tenant', $1, $2, 'x', 'x', 'jobTitle', 'approved', 'high_confidence_suggestion')`, [ORG_A, pid])).toBe('23503');
      // NEGATIVE CONTROL: a platform entry on the platform profile is admitted
      expect(await attempt(
        `INSERT INTO public.source_mapping_profile_entries (scope, organization_id, profile_id, source_field, source_field_normalized, target_field, decision, mapping_method)
         VALUES ('platform', NULL, $1, 'x', 'x', 'jobTitle', 'approved', 'high_confidence_suggestion')`, [pid])).toBe('ok');
    });
  });
});

describe('PI-LDB-1 · step E: a Super Admin platform approval', () => {
  it("'platform_approved' is admitted on a platform entry WITH a timestamp, refused without one", async () => {
    await inRollback(async () => {
      await seedTenants();
      const fp = 'c'.repeat(64);
      const { rows } = await db.query(
        `INSERT INTO public.source_mapping_profiles (scope, organization_id, source, schema_fingerprint, version, status, header_count, headers)
         VALUES ('platform', NULL, 'apollo', $1, 1, 'active', 1, '["x"]'::jsonb) RETURNING id`, [fp]);
      const pid = rows[0].id;
      const sql = `INSERT INTO public.source_mapping_profile_entries (scope, organization_id, profile_id, source_field, source_field_normalized, target_field, decision, mapping_method, approved_at)
         VALUES ('platform', NULL, $1, $2, $2, 'jobTitle', 'approved', 'platform_approved', $3)`;
      expect(await attempt(sql, [pid, 'x', null])).toBe('23514');                      // a human decision must be dated
      expect(await attempt(sql, [pid, 'x', '2026-11-11T00:00:00Z'])).toBe('ok');
      // NEGATIVE CONTROL on the vocabulary: an unknown method is still refused.
      expect(await attempt(sql.replace("'platform_approved'", "'platform_guessed'"), [pid, 'y', '2026-11-11T00:00:00Z'])).toBe('23514');
    });
  });

  it('service_role holds NO DELETE on either table (why the store never deletes a staged row)', async () => {
    const { rows } = await db.query(
      `SELECT t, has_table_privilege('service_role', t, 'DELETE') AS d, has_table_privilege('service_role', t, 'INSERT') AS i
         FROM unnest(ARRAY['public.source_mapping_profiles', 'public.source_mapping_profile_entries']) AS t`);
    for (const r of rows) {
      expect(r.d).toBe(false);
      expect(r.i).toBe(true);   // control: the role does hold its intended privileges
    }
  });
});

/* ── one active profile per shape ────────────────────────────────────────── */

describe('PI-LDB-1 · exactly one active mapping per file shape', () => {
  it('refuses a second ACTIVE profile for the same shape', async () => {
    await inRollback(async () => {
      await seedTenants();
      await insertProfile(ORG_A, { version: 1 });
      // This is the constraint that makes "reuse the approved mapping" a
      // deterministic lookup instead of a choice between candidates.
      const code = await attempt(
        `INSERT INTO public.source_mapping_profiles
           (organization_id, source, schema_fingerprint, version, status, header_count, headers)
         VALUES ($1,'csv',$2,2,'active',3,$3::jsonb)`,
        [ORG_A, FP_A, JSON.stringify(HEADERS)],
      );
      expect(code).toBe('23505');
    });
  });

  it('allows a superseded version alongside the active one', async () => {
    await inRollback(async () => {
      await seedTenants();
      await insertProfile(ORG_A, { version: 1, status: 'superseded', supersededAt: 'now()' });
      // Versioning is the whole point: history must coexist with the present.
      const id = await insertProfile(ORG_A, { version: 2 });
      expect(id).toBeTruthy();
    });
  });

  it('lets two tenants hold an active profile for the SAME shape', async () => {
    await inRollback(async () => {
      await seedTenants();
      await insertProfile(ORG_A);
      // The index is keyed on the tenant first. Two companies importing the
      // same vendor export must not collide.
      const id = await insertProfile(ORG_B);
      expect(id).toBeTruthy();
    });
  });

  it('refuses a duplicate VERSION even when the duplicate is not active', async () => {
    await inRollback(async () => {
      await seedTenants();
      await insertProfile(ORG_A, { version: 1 });
      // Version numbering spans every status, which is why the store takes
      // `max(version)` across all rows rather than from the active one.
      const code = await attempt(
        `INSERT INTO public.source_mapping_profiles
           (organization_id, source, schema_fingerprint, version, status, superseded_at, header_count, headers)
         VALUES ($1,'csv',$2,1,'superseded',now(),3,$3::jsonb)`,
        [ORG_A, FP_A, JSON.stringify(HEADERS)],
      );
      expect(code).toBe('23505');
    });
  });

  it('treats a different fingerprint as a different shape', async () => {
    await inRollback(async () => {
      await seedTenants();
      await insertProfile(ORG_A, { fingerprint: FP_A });
      const id = await insertProfile(ORG_A, { fingerprint: FP_B });
      expect(id).toBeTruthy();
    });
  });
});

/* ── self-consistency of a profile row ──────────────────────────────────── */

describe('PI-LDB-1 · a profile row cannot contradict itself', () => {
  it('refuses an ACTIVE row that carries a supersession time', async () => {
    await inRollback(async () => {
      await seedTenants();
      const code = await attempt(
        `INSERT INTO public.source_mapping_profiles
           (organization_id, source, schema_fingerprint, version, status, superseded_at, header_count, headers)
         VALUES ($1,'csv',$2,1,'active',now(),3,$3::jsonb)`,
        [ORG_A, FP_A, JSON.stringify(HEADERS)],
      );
      expect(code).toBe('23514');
    });
  });

  it('refuses a SUPERSEDED row with no supersession time', async () => {
    await inRollback(async () => {
      await seedTenants();
      // Without this, the staged-write pattern could leave an audit record
      // that cannot say when it stopped being in force.
      const code = await attempt(
        `INSERT INTO public.source_mapping_profiles
           (organization_id, source, schema_fingerprint, version, status, header_count, headers)
         VALUES ($1,'csv',$2,1,'superseded',3,$3::jsonb)`,
        [ORG_A, FP_A, JSON.stringify(HEADERS)],
      );
      expect(code).toBe('23514');
    });
  });

  it('refuses a header_count that disagrees with the header list', async () => {
    await inRollback(async () => {
      await seedTenants();
      // The drift report is computed from `headers`; a count that disagrees
      // would make it announce columns that never appeared.
      const code = await attempt(
        `INSERT INTO public.source_mapping_profiles
           (organization_id, source, schema_fingerprint, version, status, header_count, headers)
         VALUES ($1,'csv',$2,1,'active',9,$3::jsonb)`,
        [ORG_A, FP_A, JSON.stringify(HEADERS)],
      );
      expect(code).toBe('23514');
    });
  });

  it('refuses headers that are not a json ARRAY', async () => {
    await inRollback(async () => {
      await seedTenants();
      const code = await attempt(
        `INSERT INTO public.source_mapping_profiles
           (organization_id, source, schema_fingerprint, version, status, header_count, headers)
         VALUES ($1,'csv',$2,1,'active',1,'{"a":1}'::jsonb)`,
        [ORG_A, FP_A],
      );
      expect(code).toBe('23514');
    });
  });

  it('refuses a malformed fingerprint and a blank source', async () => {
    await inRollback(async () => {
      await seedTenants();
      // The fingerprint shape is checked in the database too, so a caller that
      // passes a file name instead of a digest is refused rather than stored.
      expect(
        await attempt(
          `INSERT INTO public.source_mapping_profiles
             (organization_id, source, schema_fingerprint, version, status, header_count, headers)
           VALUES ($1,'csv','vendor-export.csv',1,'active',3,$2::jsonb)`,
          [ORG_A, JSON.stringify(HEADERS)],
        ),
      ).toBe('23514');
      expect(
        await attempt(
          `INSERT INTO public.source_mapping_profiles
             (organization_id, source, schema_fingerprint, version, status, header_count, headers)
           VALUES ($1,'   ',$2,1,'active',3,$3::jsonb)`,
          [ORG_A, FP_A, JSON.stringify(HEADERS)],
        ),
      ).toBe('23514');
    });
  });
});

/* ── decisions ──────────────────────────────────────────────────────────── */

describe('PI-LDB-1 · a decision is about a target, or it is an ignore', () => {
  it('refuses an IGNORED entry that names a target', async () => {
    await inRollback(async () => {
      await seedTenants();
      const profileId = await insertProfile(ORG_A);
      // Without this, an ignore carrying a target would read as an approval to
      // anything that only checks for a non-null target_field.
      const code = await attempt(ENTRY_SQL, entryParams(ORG_A, profileId, { decision: 'ignored' }));
      expect(code).toBe('23514');
    });
  });

  it('refuses an APPROVED entry with no target, and one with a blank target', async () => {
    await inRollback(async () => {
      await seedTenants();
      const profileId = await insertProfile(ORG_A);
      expect(await attempt(ENTRY_SQL, entryParams(ORG_A, profileId, { target: null }))).toBe(
        '23514',
      );
      expect(await attempt(ENTRY_SQL, entryParams(ORG_A, profileId, { target: '   ' }))).toBe(
        '23514',
      );
    });
  });

  it('accepts an ignore with a null target', async () => {
    await inRollback(async () => {
      await seedTenants();
      const profileId = await insertProfile(ORG_A);
      const code = await attempt(
        ENTRY_SQL,
        entryParams(ORG_A, profileId, { decision: 'ignored', target: null }),
      );
      expect(code).toBe('ok');
    });
  });

  it('refuses an unrecognised decision and an unrecognised method', async () => {
    await inRollback(async () => {
      await seedTenants();
      const profileId = await insertProfile(ORG_A);
      expect(await attempt(ENTRY_SQL, entryParams(ORG_A, profileId, { decision: 'maybe' }))).toBe(
        '23514',
      );
      expect(await attempt(ENTRY_SQL, entryParams(ORG_A, profileId, { method: 'vibes' }))).toBe(
        '23514',
      );
    });
  });

  it('refuses a score outside 0..1 and evidence that is not an array', async () => {
    await inRollback(async () => {
      await seedTenants();
      const profileId = await insertProfile(ORG_A);
      expect(await attempt(ENTRY_SQL, entryParams(ORG_A, profileId, { score: 1.5 }))).toBe('23514');
      expect(
        await attempt(ENTRY_SQL, entryParams(ORG_A, profileId, { evidence: { why: 'x' } })),
      ).toBe('23514');
    });
  });

  it('requires a timestamp on a HUMAN decision but not on a bulk-accepted one', async () => {
    await inRollback(async () => {
      await seedTenants();
      const profileId = await insertProfile(ORG_A);
      // A person's decision with no timestamp cannot be audited.
      expect(
        await attempt(
          ENTRY_SQL,
          entryParams(ORG_A, profileId, { method: 'tenant_confirmed', approvedAt: null }),
        ),
      ).toBe('23514');
      // The engine's own suggestion, accepted in bulk, may legitimately have
      // none — which is why the store writes one anyway.
      expect(
        await attempt(
          ENTRY_SQL,
          entryParams(ORG_A, profileId, { method: 'high_confidence_suggestion', approvedAt: null }),
        ),
      ).toBe('ok');
    });
  });
});

/* ── one answer per column ──────────────────────────────────────────────── */

describe('PI-LDB-1 · one approved destination per column', () => {
  it('refuses two APPROVED destinations for one column', async () => {
    await inRollback(async () => {
      await seedTenants();
      const profileId = await insertProfile(ORG_A);
      await db.query(ENTRY_SQL, entryParams(ORG_A, profileId, { target: 'jobTitle' }));
      const code = await attempt(
        ENTRY_SQL,
        entryParams(ORG_A, profileId, { target: 'department' }),
      );
      expect(code).toBe('23505');
    });
  });

  it('refuses two IGNORES of one column', async () => {
    await inRollback(async () => {
      await seedTenants();
      const profileId = await insertProfile(ORG_A);
      const ignore = { decision: 'ignored', target: null } as const;
      await db.query(ENTRY_SQL, entryParams(ORG_A, profileId, ignore));
      expect(await attempt(ENTRY_SQL, entryParams(ORG_A, profileId, ignore))).toBe('23505');
    });
  });

  it('refuses the SAME rejection twice', async () => {
    await inRollback(async () => {
      await seedTenants();
      const profileId = await insertProfile(ORG_A);
      const reject = { decision: 'rejected', target: 'department' } as const;
      await db.query(ENTRY_SQL, entryParams(ORG_A, profileId, reject));
      expect(await attempt(ENTRY_SQL, entryParams(ORG_A, profileId, reject))).toBe('23505');
    });
  });

  it('ALLOWS a column to reject several different targets', async () => {
    await inRollback(async () => {
      await seedTenants();
      const profileId = await insertProfile(ORG_A);
      // "Not job title, and not description" is a thing a tenant can say, which
      // is why rejections are unique per target rather than per field. If this
      // were refused, the refusal UI could not work.
      await db.query(
        ENTRY_SQL,
        entryParams(ORG_A, profileId, { decision: 'rejected', target: 'jobTitle' }),
      );
      const code = await attempt(
        ENTRY_SQL,
        entryParams(ORG_A, profileId, { decision: 'rejected', target: 'description' }),
      );
      expect(code).toBe('ok');
    });
  });

  it('does NOT itself refuse a column that is both approved and ignored', async () => {
    await inRollback(async () => {
      await seedTenants();
      const profileId = await insertProfile(ORG_A);
      await db.query(ENTRY_SQL, entryParams(ORG_A, profileId, { target: 'jobTitle' }));
      const code = await attempt(
        ENTRY_SQL,
        entryParams(ORG_A, profileId, { decision: 'ignored', target: null }),
      );
      // Deliberately asserting the GAP, not a guarantee. The two partial unique
      // indexes are independent, so Postgres accepts both rows and a reader
      // would pick arbitrarily. `assertEntries` in the store is the only thing
      // standing in the way — and a test that claimed the database covered this
      // would make that guard look redundant and invite its removal.
      expect(code).toBe('ok');
    });
  });
});

/* ── tenant isolation ───────────────────────────────────────────────────── */

describe('PI-LDB-1 · an entry cannot cross a tenant', () => {
  it('refuses an entry whose tenant disagrees with its profile', async () => {
    await inRollback(async () => {
      await seedTenants();
      const profileId = await insertProfile(ORG_A);
      // The composite key means getting the application filter wrong is caught
      // by the database rather than stored as another tenant's mapping.
      const code = await attempt(ENTRY_SQL, entryParams(ORG_B, profileId));
      expect(code).toBe('23503');
    });
  });

  it('cascades entries when a profile is removed', async () => {
    await inRollback(async () => {
      await seedTenants();
      const profileId = await insertProfile(ORG_A);
      await db.query(ENTRY_SQL, entryParams(ORG_A, profileId));
      await db.query('DELETE FROM public.source_mapping_profiles WHERE id = $1', [profileId]);
      const { rows } = await db.query(
        'SELECT count(*)::int n FROM public.source_mapping_profile_entries WHERE profile_id = $1',
        [profileId],
      );
      // The store's cleanup of a staged row relies on this: a failed approval
      // must not leave orphaned entries behind.
      expect(rows[0].n).toBe(0);
    });
  });
});

/* ── the rest of the PI-LDB migration set ───────────────────────────────── */

describe('PI-LDB-5 · the billed action can actually be priced', () => {
  it('has exactly one credit row and one ACTIVE pricing row', async () => {
    const { rows } = await db.query(
      `SELECT (SELECT count(*)::int FROM credit_cost_config WHERE action_type='lead_attribute_mapping') credit,
              (SELECT count(*)::int FROM action_pricing_config WHERE action_key='lead_attribute_mapping' AND is_active) pricing`,
    );
    // `fetchActionPricingRow` throws on zero, which is what makes AI mapping
    // dark rather than broken until this migration is applied.
    expect(rows[0].credit).toBe(1);
    expect(rows[0].pricing).toBe(1);
  });

  it('is priced from the model rate card, not the flat fallback', async () => {
    const { rows } = await db.query(
      `SELECT source_type FROM action_pricing_config
        WHERE action_key='lead_attribute_mapping' AND is_active`,
    );
    expect(rows).toHaveLength(1);
    // 'fixed' would apply cleanly and then bill every mapping call at the flat
    // credit_cost_config rate, ignoring tokens entirely. The NOT NULL on this
    // column caught the first version of the migration omitting it; only an
    // assertion catches it being present but wrong.
    expect(rows[0].source_type).toBe('llm');
  });

  it('sets a spend ceiling rather than leaving it open', async () => {
    const { rows } = await db.query(
      `SELECT ceiling_usd, cost_multiplier FROM action_pricing_config
        WHERE action_key='lead_attribute_mapping' AND is_active`,
    );
    expect(rows).toHaveLength(1);
    // A NULL ceiling leaves the confirm unbounded while `estimateMaxHoldCredits`
    // falls back to `minimum_charge_usd * 5` = 0, so the hold would sit at the
    // 1-credit floor while the actual charge was uncapped.
    expect(rows[0].ceiling_usd).not.toBeNull();
    expect(Number(rows[0].cost_multiplier)).toBeGreaterThan(0);
  });
});

describe('PI-LDB · the destinations the engine proposes exist as columns', () => {
  it('has prospect_accounts.description for the mapping to land in', async () => {
    const { rows } = await db.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='prospect_accounts' AND column_name='description'`,
    );
    // `description` was a dead destination until the adapter learned to carry
    // it. The column was never the missing part — this asserts it still is not.
    expect(rows).toHaveLength(1);
  });
});

/**
 * PI-LDB 2F / requirement 11 — the privilege assertions are no longer vacuous.
 *
 * THE PROBLEM THESE TESTS EXIST FOR. 20270211000000 ends with a DO block
 * asserting that `service_role` does NOT hold DELETE or TRUNCATE on the two
 * mapping tables. On a stock postgres image that assertion cannot fail:
 * `pg_default_acl` is empty, so the surplus the REVOKE exists to remove never
 * arrives. Prompt 2B's three-grantee REVOKE — which left `service_role`
 * holding ALL in production — passed this harness green.
 *
 * The bootstrap now reproduces Supabase's hosted default (ALTER DEFAULT
 * PRIVILEGES FOR ROLE postgres ... GRANT ALL ON TABLES TO service_role), so the
 * surplus is really present at replay time and the migration really removes it.
 *
 * Asserted as a WHOLE SET rather than privilege-by-privilege: a chain of
 * `IS NOT FALSE` checks cannot catch a privilege nobody thought to name, and
 * REFERENCES and TRIGGER are exactly what the migration never mentions.
 */
describe('PI-LDB 2F · hosted-like default privileges make the REVOKE meaningful', () => {
  const TABLES = ['source_mapping_profiles', 'source_mapping_profile_entries'];
  const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

  /** Every privilege the role actually holds, in a fixed order. */
  async function held(table: string, role = 'service_role'): Promise<string[]> {
    const { rows } = await db.query(
      `SELECT p FROM unnest($1::text[]) p
        WHERE has_table_privilege($2, ('public.' || quote_ident($3))::regclass, p)
        ORDER BY array_position($1::text[], p)`,
      [PRIVS, role, table],
    );
    return rows.map((r: { p: string }) => r.p);
  }

  it('the hosted default really is reproduced: a table created now ARRIVES with the surplus', async () => {
    await inRollback(async () => {
      // THE ANTI-VACUITY CONTROL. If this fails, the bootstrap line is missing
      // or ineffective and every other assertion in this describe is empty.
      // The probe name follows the `public.__` convention the governance suite
      // already anticipates, so it cannot be mistaken for a shipped table.
      await db.query('CREATE TABLE public.__ldb2f_privilege_probe (id int)');
      expect(await held('__ldb2f_privilege_probe')).toEqual(PRIVS);
    });
  });

  it('after the migration the two tables hold EXACTLY SELECT, INSERT, UPDATE', async () => {
    for (const t of TABLES) {
      expect(await held(t)).toEqual(['SELECT', 'INSERT', 'UPDATE']);
    }
  });

  it('and the client roles hold nothing at all on either table', async () => {
    for (const t of TABLES) {
      for (const r of ['anon', 'authenticated', 'authenticator']) {
        expect(await held(t, r)).toEqual([]);
      }
      // PUBLIC is not a role `has_table_privilege` can be asked about by name
      // in the same way, so it is read off the ACL directly. grantee 0 is
      // PUBLIC in aclexplode.
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
          WHERE c.oid = ('public.' || quote_ident($1))::regclass AND a.grantee = 0`,
        [t],
      );
      expect(rows[0].n).toBe(0);
    }
  });

  it('MUTANT: the old THREE-grantee REVOKE leaves the surplus — so the test above can fail', async () => {
    await inRollback(async () => {
      // The mutation, applied to a probe rather than to a shipped table so the
      // real tables are never left in the defective state even inside a
      // rolled-back transaction. This is the whole point of requirement 11:
      // reverting the correction must break something.
      await db.query('CREATE TABLE public.__ldb2f_mutant_probe (id int)');
      expect(await held('__ldb2f_mutant_probe')).toEqual(PRIVS);

      // Prompt 2B's original: PUBLIC, anon, authenticated — and NOT
      // authenticator or service_role.
      await db.query('REVOKE ALL ON TABLE public.__ldb2f_mutant_probe FROM PUBLIC, anon, authenticated');
      await db.query('GRANT SELECT, INSERT, UPDATE ON TABLE public.__ldb2f_mutant_probe TO service_role');

      // The surplus SURVIVES. DELETE and TRUNCATE are still held, which is
      // precisely the production exposure, and it is only visible because the
      // default ACL is now reproduced.
      expect(await held('__ldb2f_mutant_probe')).toEqual(PRIVS);

      // And the five-grantee form removes it, on the same probe, so the
      // difference is attributable to the grantee list and nothing else.
      await db.query(
        'REVOKE ALL ON TABLE public.__ldb2f_mutant_probe FROM PUBLIC, anon, authenticated, authenticator, service_role');
      await db.query('GRANT SELECT, INSERT, UPDATE ON TABLE public.__ldb2f_mutant_probe TO service_role');
      expect(await held('__ldb2f_mutant_probe')).toEqual(['SELECT', 'INSERT', 'UPDATE']);
    });
  });

  it('BEHAVIOUR, not just the catalog: as service_role, DELETE and TRUNCATE are refused', async () => {
    await inRollback(async () => {
      await seedTenants();
      // `SET LOCAL ROLE` is the privilege context PostgREST uses for a
      // service_role request, and it genuinely drops the owner rights: 14
      // real-schema suites rely on it and observe 42501 from it. A catalog
      // read and an actual refusal are different claims, and the migration
      // only ever made the first one.
      await db.query('SET LOCAL ROLE service_role');
      const del = await attempt('DELETE FROM public.source_mapping_profiles WHERE false');
      const trunc = await attempt('TRUNCATE public.source_mapping_profiles');
      await db.query('RESET ROLE');
      expect(del).toBe('42501');
      expect(trunc).toBe('42501');
    });
  });
});
