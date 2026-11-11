/**
 * check-migration-quality.js idempotencyViolations — the CREATE INDEX rule.
 * Regression (virality-e1, 2026-11-11): an optional CONCURRENTLY group before the negative lookahead
 * backtracked to empty, so `CREATE INDEX CONCURRENTLY IF NOT EXISTS` was wrongly flagged.
 * Each case names its input (#27).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { idempotencyViolations } = require('../../../scripts/check-migration-quality.js');

const indexRule = (sql: string) =>
  idempotencyViolations(sql).filter((v: { rule: string }) => v.rule === 'CREATE INDEX must use IF NOT EXISTS');

describe('migration gate: CREATE INDEX must use IF NOT EXISTS', () => {
  it.each([
    'CREATE INDEX IF NOT EXISTS i ON t (a);',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS i ON t (a);',
    'CREATE UNIQUE INDEX IF NOT EXISTS i ON t (a);',
    'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS i ON t (a);',
    'create index concurrently if not exists i on t (a);',
  ])('PASS: %s', (sql) => {
    expect(indexRule(sql)).toEqual([]);
  });

  it.each([
    'CREATE INDEX i ON t (a);',
    'CREATE INDEX CONCURRENTLY i ON t (a);',
    'CREATE UNIQUE INDEX i ON t (a);',
    'CREATE UNIQUE INDEX CONCURRENTLY i ON t (a);',
  ])('FAIL input: %s is flagged', (sql) => {
    expect(indexRule(sql)).toHaveLength(1);
  });

  it('a CREATE INDEX inside a line comment is ignored', () => {
    expect(indexRule('-- CREATE INDEX i ON t (a);')).toEqual([]);
  });
});
