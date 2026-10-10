/**
 * THE APPLICATION STATUS VOCABULARY MUST EQUAL THE DATABASE CHECK CONSTRAINT.
 *
 * ─── WHY THIS SUITE EXISTS ─────────────────────────────────────────────────
 *
 * `report_recommendation_history.status` is constrained by a CHECK in SQL and by
 * a union in TypeScript. Nothing pinned the two together, and the consequence
 * was not hypothetical: adding a member to the union alone compiles, passes every
 * in-memory test, and is then REJECTED BY POSTGRES on the first real write.
 *
 * That failure is not graceful. `SupabaseHistoryStore.writeSnapshot` writes the
 * bundle as serial awaited inserts and throws on the first error, with
 * `report_recommendation_history` fourth of five tables, and its retries are not
 * idempotent -- `id` is the primary key and (company_id, observed_at) is UNIQUE.
 * A vocabulary mismatch therefore leaves a partially written snapshot that no
 * retry can repair, for every tenant, until the migration lands.
 *
 * An in-memory store cannot catch this: it never evaluates the constraint. So
 * this suite reads the SQL TEXT, which is the source of truth for what the
 * database will accept, and compares it with the union. A real-schema suite
 * proves the constraint behaves as written; this proves the two DECLARATIONS
 * agree, with no database required.
 *
 * ─── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 * It does not connect to a database, and it does not assert anything about
 * production: the committed SQL is what CI restores and replays, and production
 * conformance is an operator check.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { RecommendationHistoryRecord } from '../../services/intelligence/historicalPersistence';

const ROOT = join(__dirname, '..', '..', '..');
const BASELINE = join(ROOT, 'supabase', '_schema', 'baseline.sql');
const MIGRATION = join(
  ROOT, 'supabase', 'migrations',
  '20261201000000_recommendation_lifecycle_no_longer_surfaced.sql',
);

/**
 * The union, enumerated as VALUES rather than reflected from the type.
 *
 * TypeScript unions do not exist at runtime, so a literal list is unavoidable.
 * It is made safe by the `satisfies`-style assignment below: every entry must be
 * assignable to the union, so a member RENAMED or REMOVED in the type breaks the
 * typecheck here. The remaining risk -- a member ADDED to the type and not added
 * to this list -- is closed by the exhaustiveness guard at the end of the file.
 */
const TS_STATUSES: readonly RecommendationHistoryRecord['status'][] = [
  'first_seen',
  'persistent',
  'resolved',
  'regressed',
  'no_longer_surfaced',
];

/**
 * Strip SQL line comments, LINE-WISE.
 *
 * Required, not cosmetic: this migration documents its own rollback inside a
 * `--` comment, and that example necessarily lists the PRE-migration four
 * values. Parsing the raw text matched the comment instead of the executable
 * statement and reported four values for a five-value constraint — the first
 * run of this suite caught exactly that.
 *
 * Done line-wise rather than with a regex over the whole file, because a regex
 * that strips to end-of-line across a document also eats `--` sequences that are
 * inside string literals.
 */
function stripLineComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

/** Pull the quoted values out of a `CHECK (... IN (...))` or `= ANY (ARRAY[...])` clause. */
function parseCheckValues(rawSql: string, anchor: string): string[] {
  const sql = stripLineComments(rawSql);
  const at = sql.indexOf(anchor);
  if (at < 0) throw new Error(`anchor not found in executable SQL: ${anchor}`);
  const window = sql.slice(at, at + 1200);
  const check = window.slice(window.indexOf('CHECK'));
  const end = check.indexOf('\n');
  const clause = end > 0 ? check.slice(0, end) : check;
  const quoted = clause.match(/'([a-z_]+)'/g) ?? [];
  return quoted.map((q) => q.replace(/'/g, ''));
}

describe('the TypeScript status union equals the SQL CHECK constraint', () => {
  it('the NEW migration permits exactly the union', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const values = parseCheckValues(sql, 'ADD CONSTRAINT report_recommendation_history_status_check');
    // Non-vacuity: the parse found a real list, not an empty match.
    expect(values.length).toBeGreaterThan(0);
    expect([...values].sort()).toEqual([...TS_STATUSES].sort());
  });

  it('the migration PRESERVES the four pre-existing values', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const values = parseCheckValues(sql, 'ADD CONSTRAINT report_recommendation_history_status_check');
    for (const legacy of ['first_seen', 'persistent', 'resolved', 'regressed']) {
      expect(values).toContain(legacy);
    }
  });

  it('the migration is transactional and additive — it drops and re-adds, never rewrites rows', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS report_recommendation_history_status_check');
    // No statement may touch stored rows. This is the guard against a
    // "while we are here" backfill being added later.
    expect(sql).not.toMatch(/\bUPDATE\s+report_recommendation_history\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\s+report_recommendation_history\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\s+report_recommendation_history\b/i);
  });

  it('the APPLIED migration 20260601000000 is not edited — it still declares the original four', () => {
    // Editing an applied migration risks a ledger desync, so the original must
    // keep its original CHECK; the new value arrives only via the new migration.
    const applied = readFileSync(
      join(ROOT, 'supabase', 'migrations', '20260601000000_canonical_intelligence_platform.sql'),
      'utf8',
    );
    const values = parseCheckValues(applied, 'CREATE TABLE IF NOT EXISTS report_recommendation_history');
    expect([...values].sort()).toEqual(['first_seen', 'persistent', 'regressed', 'resolved']);
    expect(values).not.toContain('no_longer_surfaced');
  });

  it('the committed schema baseline still reflects the PRE-migration state', () => {
    // `baseline.sql` is a dump of the live schema and is regenerated by an
    // operator with production read access, which this slice does not do. Until
    // then it legitimately lags, and this test records that expectation rather
    // than pretending the baseline is already updated.
    const baseline = readFileSync(BASELINE, 'utf8');
    const values = parseCheckValues(baseline, 'CONSTRAINT report_recommendation_history_status_check');
    expect([...values].sort()).toEqual(['first_seen', 'persistent', 'regressed', 'resolved']);
  });
});

describe('the union list in this test cannot silently fall behind the type', () => {
  it('every declared status is covered exhaustively', () => {
    // A member added to the union but not to TS_STATUSES makes this switch
    // non-exhaustive, and the `never` assignment fails the typecheck.
    const describeStatus = (status: RecommendationHistoryRecord['status']): string => {
      switch (status) {
        case 'first_seen': return 'first_seen';
        case 'persistent': return 'persistent';
        case 'resolved': return 'resolved';
        case 'regressed': return 'regressed';
        case 'no_longer_surfaced': return 'no_longer_surfaced';
        default: {
          const unreachable: never = status;
          return unreachable;
        }
      }
    };
    for (const status of TS_STATUSES) expect(describeStatus(status)).toBe(status);
    expect(TS_STATUSES).toHaveLength(5);
  });
});
