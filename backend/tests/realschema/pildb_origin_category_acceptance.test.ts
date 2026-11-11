/**
 * PI-LDB 2F / D2+D3 — the durable origin classification, against real PostgreSQL.
 *
 * A green run here concerns a disposable database built from the committed
 * baseline plus replayed migrations. It is NOT evidence about the production
 * database and must not be reported as production verification.
 *
 * WHY THIS SUITE EXISTS RATHER THAN A UNIT TEST. The D3 invariant is a property
 * of the TABLE, not of a writer: migration 20270211000005 installs a
 * BEFORE INSERT OR UPDATE trigger, because the canonical write is a full-row
 * `resolution=merge-duplicates` upsert that assigns every key in its body and
 * this store has four write paths. Nothing but a real database can show that
 * the invariant holds for a writer that has never heard of it, which is the
 * whole reason it was put there. The companion unit coverage
 * (`piLdbOriginCategoryWriteContract.test.ts`) proves the other half: which
 * values the repository is willing to send.
 *
 * Covered:
 *   - the controlled vocabulary is enforced, and 'unknown' is NOT in it;
 *   - an observation without a classification is refused;
 *   - a cold read-back returns exactly what was written;
 *   - repeated ingestion of the SAME classification preserves the FIRST
 *     acceptance time (D3's central rule);
 *   - a write carrying NO classification cannot erase a stored one;
 *   - an explicit supersession moves classification and observation TOGETHER;
 *   - a classification may be stored with no acceptance time;
 *   - tenant isolation: one tenant's write cannot reach another's row.
 */
import {
  ORG_A,
  ORG_B,
  constraintDef,
  db,
  effect,
  inRollback,
  seedTenants,
} from './setup';

const TABLE = 'public.lead_intelligence';

/** Acceptance times, far enough apart that a silent overwrite is unmissable. */
const FIRST = '2026-11-07T09:00:00.000Z';
const SECOND = '2026-11-07T17:30:00.000Z';

/** Insert a lead carrying an origin classification. */
const seed = (org: string, key: string, category: string | null, observed: string | null) => effect(
  `INSERT INTO ${TABLE} (company_id, dedupe_key, source, origin_category, origin_observed_at)
   VALUES ($1, $2, 'crm', $3, $4)`,
  [org, key, category, observed],
);

/** What the row actually holds now. */
async function stored(org: string, key: string): Promise<{ category: string | null; observed: string | null }> {
  const { rows } = await db.query(
    `SELECT origin_category,
            to_char(origin_observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed
       FROM ${TABLE} WHERE company_id = $1 AND dedupe_key = $2`,
    [org, key],
  );
  if (rows.length !== 1) throw new Error(`expected exactly one row, found ${rows.length}`);
  return { category: rows[0].origin_category ?? null, observed: rows[0].observed ?? null };
}

describe('PI-LDB 2F · the vocabulary is the provenance contract', () => {
  it('accepts every member of SOURCE_CATEGORIES', async () => {
    await inRollback(async () => {
      await seedTenants();
      const all = [
        'marketpulse', 'social_listening', 'community', 'engagement',
        'inbound_form', 'inbound_webhook', 'manual', 'crm', 'csv',
        'pi_discovery', 'pi_enrichment', 'website',
      ];
      for (const [i, c] of all.entries()) {
        expect(await seed(ORG_A, `dk-vocab-${i}`, c, FIRST)).toBe('ok');
      }
      const { rows } = await db.query(
        `SELECT count(DISTINCT origin_category)::int c FROM ${TABLE} WHERE company_id = $1`, [ORG_A],
      );
      expect(rows[0].c).toBe(all.length);
    });
  });

  it("refuses a category outside it — including 'unknown'", async () => {
    await inRollback(async () => {
      await seedTenants();
      // 'unknown' is the display-only fallback `stats.ts` substitutes for a NULL
      // category. If it were ever admitted here, a display value would become
      // stored data and NULL would stop being the single expression of absence.
      for (const bad of ['unknown', 'form', 'apollo', 'CRM', '']) {
        expect(await seed(ORG_A, `dk-bad-${bad}`, bad, FIRST)).toBe('23514');
      }
    });
  });

  it('the check is the one the migration names, and it permits NULL', async () => {
    const def = await constraintDef('lead_intelligence_origin_category_valid');
    expect(def).toContain('origin_category IS NULL');
    expect(def).toContain('inbound_form');
    expect(def).not.toContain("'unknown'");
  });

  it('NORMALISES an observation with nothing observed, rather than refusing it', async () => {
    await inRollback(async () => {
      await seedTenants();
      // An acceptance time for a classification that does not exist is not a
      // fact about anything, so it does not survive. The trigger drops it on
      // INSERT instead of raising, which is why this is `ok` and not 23514:
      // a BEFORE trigger runs before constraints, so by the time the CHECK is
      // evaluated the row is already a valid pair. Keeping the writer from
      // having to care is the point.
      expect(await seed(ORG_A, 'dk-orphan-observation', null, FIRST)).toBe('ok');
      expect(await stored(ORG_A, 'dk-orphan-observation')).toEqual({ category: null, observed: null });
    });
  });

  it('and the CHECK is a REAL backstop: with the trigger disabled, the same row is refused', async () => {
    await inRollback(async () => {
      await seedTenants();
      // Written because the test above proves the constraint can never fire
      // while the trigger exists — and a constraint that cannot fail is
      // indistinguishable from a comment. Disabling the trigger for the
      // length of this transaction is the only way to ask the CHECK a
      // question it can actually answer.
      await db.query(`ALTER TABLE ${TABLE} DISABLE TRIGGER trg_lead_intelligence_origin_evidence`);
      expect(await seed(ORG_A, 'dk-orphan-nobackstop', null, FIRST)).toBe('23514');
      await db.query(`ALTER TABLE ${TABLE} ENABLE TRIGGER trg_lead_intelligence_origin_evidence`);
      // Re-enabled inside the transaction as well as rolled back with it, so
      // a later assertion in this same test could not run against a table
      // whose invariant is switched off.
      expect(await seed(ORG_A, 'dk-orphan-again', null, FIRST)).toBe('ok');
    });
  });
});

describe('PI-LDB 2F · durable write and cold read-back', () => {
  it('returns exactly what was written', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await seed(ORG_A, 'dk-roundtrip', 'inbound_form', FIRST)).toBe('ok');
      // Read in a separate statement, from the table, not from the writer's
      // own return value: the claim is about what is DURABLE.
      expect(await stored(ORG_A, 'dk-roundtrip')).toEqual({ category: 'inbound_form', observed: FIRST });
    });
  });

  it('stores a classification with NO acceptance time (D3 keeps NULL rather than fabricating one)', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await seed(ORG_A, 'dk-no-observation', 'csv', null)).toBe('ok');
      expect(await stored(ORG_A, 'dk-no-observation')).toEqual({ category: 'csv', observed: null });
    });
  });

  it('an INSERT with no classification normalises the observation away', async () => {
    await inRollback(async () => {
      await seedTenants();
      await effect(
        `INSERT INTO ${TABLE} (company_id, dedupe_key, source) VALUES ($1, 'dk-bare', 'crm')`,
        [ORG_A],
      );
      expect(await stored(ORG_A, 'dk-bare')).toEqual({ category: null, observed: null });
    });
  });
});

describe('PI-LDB 2F · D3, enforced by the table and not by the writer', () => {
  it('REPEATED ingestion of the same classification keeps the FIRST acceptance time', async () => {
    await inRollback(async () => {
      await seedTenants();
      await seed(ORG_A, 'dk-resync', 'crm', FIRST);

      // A re-sync, written by a caller that knows nothing about D3 and supplies
      // its own "now" — which is exactly what the full-row upsert does.
      expect(await effect(
        `UPDATE ${TABLE} SET origin_category = 'crm', origin_observed_at = $3
           WHERE company_id = $1 AND dedupe_key = $2`,
        [ORG_A, 'dk-resync', SECOND],
      )).toBe('ok');

      // The classification did not change, so this was not a new acceptance.
      // Without the trigger the column would have become "last seen", which is
      // one of the four meanings D3 forbids it from having.
      expect(await stored(ORG_A, 'dk-resync')).toEqual({ category: 'crm', observed: FIRST });
    });
  });

  it('a write carrying NO classification cannot ERASE a stored one', async () => {
    await inRollback(async () => {
      await seedTenants();
      await seed(ORG_A, 'dk-silent', 'inbound_form', FIRST);

      // An adapter-hinted write reaches the column as NULL. That is "I have
      // nothing to say about origin", not "there is no origin" — and D2 allows
      // a change only when superseding evidence is accepted and recorded.
      expect(await effect(
        `UPDATE ${TABLE} SET origin_category = NULL, origin_observed_at = NULL
           WHERE company_id = $1 AND dedupe_key = $2`,
        [ORG_A, 'dk-silent'],
      )).toBe('ok');

      expect(await stored(ORG_A, 'dk-silent')).toEqual({ category: 'inbound_form', observed: FIRST });
    });
  });

  it('an explicit SUPERSESSION moves the classification and the observation together', async () => {
    await inRollback(async () => {
      await seedTenants();
      await seed(ORG_A, 'dk-supersede', 'website', FIRST);

      expect(await effect(
        `UPDATE ${TABLE} SET origin_category = 'inbound_form', origin_observed_at = $3
           WHERE company_id = $1 AND dedupe_key = $2`,
        [ORG_A, 'dk-supersede', SECOND],
      )).toBe('ok');

      // Both, in one statement. Neither field can lag the other, because the
      // trigger decides them together on the same NEW row.
      expect(await stored(ORG_A, 'dk-supersede')).toEqual({ category: 'inbound_form', observed: SECOND });
    });
  });

  it('a supersession that supplies no new time stores the classification with none', async () => {
    await inRollback(async () => {
      await seedTenants();
      await seed(ORG_A, 'dk-supersede-blind', 'website', FIRST);
      await effect(
        `UPDATE ${TABLE} SET origin_category = 'crm', origin_observed_at = NULL
           WHERE company_id = $1 AND dedupe_key = $2`,
        [ORG_A, 'dk-supersede-blind'],
      );
      // NOT the old time: that one established the OLD classification, and
      // carrying it forward would date this evidence to when different evidence
      // arrived. D3 would rather hold NULL than a wrong time.
      expect(await stored(ORG_A, 'dk-supersede-blind')).toEqual({ category: 'crm', observed: null });
    });
  });

  it('the trigger is installed on the table, by the name the migration asserts', async () => {
    const { rows } = await db.query(
      `SELECT tgname FROM pg_trigger
        WHERE tgrelid = 'public.lead_intelligence'::regclass AND NOT tgisinternal`,
    );
    expect(rows.map((r: { tgname: string }) => r.tgname)).toContain('trg_lead_intelligence_origin_evidence');
  });
});

describe('PI-LDB 2F · tenant isolation', () => {
  it("one tenant's update cannot reach another tenant's classification", async () => {
    await inRollback(async () => {
      await seedTenants();
      await seed(ORG_A, 'dk-shared-key', 'inbound_form', FIRST);
      await seed(ORG_B, 'dk-shared-key', 'crm', SECOND);

      // The same dedupe_key in two tenants is legal — the unique constraint is
      // (company_id, dedupe_key) — so a writer that forgets the tenant filter
      // is the realistic mistake. Scoped by company_id, it touches one row.
      await effect(
        `UPDATE ${TABLE} SET origin_category = 'csv', origin_observed_at = $3
           WHERE company_id = $1 AND dedupe_key = $2`,
        [ORG_B, 'dk-shared-key', SECOND],
      );

      expect(await stored(ORG_A, 'dk-shared-key')).toEqual({ category: 'inbound_form', observed: FIRST });
      expect(await stored(ORG_B, 'dk-shared-key')).toEqual({ category: 'csv', observed: SECOND });
    });
  });
});
