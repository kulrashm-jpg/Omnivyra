/**
 * W6 — real-schema regression cover for the DG-001 SERP-results migration.
 *
 * The defect this pins: the first draft of
 * supabase/migrations/20261025000000_serp_result_feature_types.sql DROPPED
 * `analytics_serp_results_unique (snapshot_id, position, domain, url)` and
 * replaced it with a six-column identity index. The only writer of the table is
 *
 *   externalCompetitiveIntelligenceService.ingestSerpSnapshot
 *     .upsert(rows, { onConflict: 'snapshot_id,position,domain,url' })
 *
 * and PostgreSQL infers an ON CONFLICT arbiter only from a unique index whose key
 * columns are EXACTLY the conflict target. Without the four-column constraint,
 * every SERP ingest raises 42P10 — the same class as W0.1 / W0.2 / W3, all of
 * which reached production because a mock cannot fail the way PostgreSQL fails.
 *
 * This suite runs after the harness has replayed that migration onto the
 * production schema baseline, so it observes the post-migration schema. It
 * executes the writer's real statement rather than inspecting text.
 */
import { db, inRollback, attempt } from './setup';

const TABLE = 'public.analytics_serp_results';
const COMPANY = '00000000-0000-4000-8000-0000000000d1';

/** The writer's conflict target, exactly as PostgREST receives it. */
const WRITER_CONFLICT_TARGET = ['snapshot_id', 'position', 'domain', 'url'];

async function newSnapshot(fingerprint: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.analytics_serp_snapshots (company_id, query, captured_at, fingerprint, provider)
     VALUES ($1, 'w6 dg001', now(), $2, 'serpapi') RETURNING id`,
    [COMPANY, fingerprint],
  );
  return rows[0].id as string;
}

/**
 * The statement PostgREST issues for
 *   .upsert(rows, { onConflict: 'snapshot_id,position,domain,url' })
 * — an INSERT whose conflict target is those four columns, updating in place.
 */
const WRITER_UPSERT = `
  INSERT INTO public.analytics_serp_results
    (snapshot_id, company_id, query, captured_at, position, url, domain, title, result_type)
  VALUES ($1, $2, 'w6 dg001', now(), $3, $4, $5, $6, $7)
  ON CONFLICT (snapshot_id, position, domain, url)
  DO UPDATE SET title = EXCLUDED.title, result_type = EXCLUDED.result_type
  RETURNING id`;

describe('DG-001 — the writer’s ON CONFLICT target keeps an arbiter', () => {
  it('has a NON-PARTIAL unique structure whose key is exactly (snapshot_id, position, domain, url)', async () => {
    // Key columns of every unique index on the table, in index order, excluding
    // partial indexes: a partial index cannot be inferred by ON CONFLICT (W0.1).
    // `relname` rather than `regclass::text`, whose output depends on search_path.
    const { rows } = await db.query(
      `SELECT ic.relname AS name,
              array_agg(a.attname::text) AS cols
         FROM pg_index i
         JOIN pg_class ic ON ic.oid = i.indexrelid
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = $1::regclass
          AND i.indisunique
          AND i.indpred IS NULL
        GROUP BY ic.relname`,
      [TABLE],
    );
    const target = [...WRITER_CONFLICT_TARGET].sort().join(',');
    const arbiters = rows.filter((r) => [...(r.cols as string[])].sort().join(',') === target);
    expect(arbiters.map((r) => r.name)).toContain('analytics_serp_results_unique');
  });

  it('accepts the writer’s real upsert — the statement that would raise 42P10', async () => {
    await inRollback(async () => {
      const snapshot = await newSnapshot('w6-dg001-writer');
      const args = [snapshot, COMPANY, 1, 'https://a.test/x', 'a.test', 'First', 'organic'];

      // Executed, not inspected. With the arbiter gone this throws 42P10.
      expect(await attempt(WRITER_UPSERT, args)).toBe('ok');

      const first = await db.query(WRITER_UPSERT, args);
      // Re-ingesting the same result resolves as an update: still one row.
      const second = await db.query(WRITER_UPSERT, [...args.slice(0, 5), 'Renamed', 'organic']);
      expect(second.rows[0].id).toBe(first.rows[0].id);

      const { rows } = await db.query(
        `SELECT count(*)::int AS n, max(title) AS title FROM ${TABLE} WHERE snapshot_id = $1`,
        [snapshot],
      );
      expect(rows[0]).toEqual({ n: 1, title: 'Renamed' });
    });
  });

  it('keeps every value the pre-DG-001 writer and readers rely on valid', async () => {
    await inRollback(async () => {
      const snapshot = await newSnapshot('w6-dg001-legacy');
      // The four original result types, with the non-null rank/url/domain the
      // current writer always supplies.
      for (const [pos, type] of [[1, 'organic'], [2, 'featured_snippet'], [3, 'paid'], [4, 'other']] as const) {
        expect(await attempt(WRITER_UPSERT, [snapshot, COMPANY, pos, `https://a.test/${pos}`, 'a.test', null, type]))
          .toBe('ok');
      }
    });
  });
});

describe('DG-001 — the expansion is present, and does not collide with the writer', () => {
  it('adds the identity index with NULLS NOT DISTINCT', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'analytics_serp_results_identity'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/CREATE UNIQUE INDEX/);
    expect(rows[0].indexdef).toMatch(/NULLS NOT DISTINCT/);
  });

  it('can hold a feature that has no rank and no link', async () => {
    await inRollback(async () => {
      const snapshot = await newSnapshot('w6-dg001-feature');
      const insertFeature = `
        INSERT INTO ${TABLE} (snapshot_id, company_id, query, captured_at, position, url, domain, title, result_type)
        VALUES ($1, $2, 'w6 dg001', now(), NULL, NULL, NULL, $3, 'people_also_ask')`;
      expect(await attempt(insertFeature, [snapshot, COMPANY, 'What is it?'])).toBe('ok');

      await db.query(insertFeature, [snapshot, COMPANY, 'What is it?']);
      // NULLS NOT DISTINCT: the same unranked, unlinked feature is a duplicate,
      // not a second observation. Without it this would silently insert twice.
      expect(await attempt(insertFeature, [snapshot, COMPANY, 'What is it?'])).toBe('23505');
    });
  });

  it('a rank of zero is still rejected — NULL is "no rank", never 0', async () => {
    await inRollback(async () => {
      const snapshot = await newSnapshot('w6-dg001-zero');
      expect(await attempt(WRITER_UPSERT, [snapshot, COMPANY, 0, 'https://a.test/z', 'a.test', null, 'organic']))
        .toBe('23514');
    });
  });
});
