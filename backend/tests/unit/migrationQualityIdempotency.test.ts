/**
 * check-migration-quality.js idempotencyViolations: the three IF NOT EXISTS rules.
 * Regressions (2026-11-11):
 *  - virality-e1: `(CONCURRENTLY\s+)?` before the negative lookahead backtracked to empty, so
 *    `CREATE INDEX CONCURRENTLY IF NOT EXISTS` was flagged.
 *  - virality-05: `INDEX\s+` outside the lookahead gave back a space, so a double space before
 *    IF NOT EXISTS was flagged (this one predates e1's report; same class in CREATE TABLE / ADD COLUMN).
 * Irregular whitespace is the input class that separates a correct pattern from a backtracking one,
 * so it is tested explicitly. Each case names its input (#27).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { idempotencyViolations } = require('../../../scripts/check-migration-quality.js');

const rule = (sql: string, name: string) =>
  idempotencyViolations(sql).filter((v: { rule: string }) => v.rule === name);
const INDEX = 'CREATE INDEX must use IF NOT EXISTS';
const TABLE = 'CREATE TABLE must use IF NOT EXISTS';
const COLUMN = 'ADD COLUMN must use IF NOT EXISTS';

describe('migration gate: CREATE INDEX must use IF NOT EXISTS', () => {
  it.each([
    'CREATE INDEX IF NOT EXISTS i ON t (a);',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS i ON t (a);',
    'CREATE UNIQUE INDEX IF NOT EXISTS i ON t (a);',
    'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS i ON t (a);',
    'create index concurrently if not exists i on t (a);',
    // irregular whitespace (virality-05)
    'CREATE INDEX  IF NOT EXISTS i ON t (a);',
    'CREATE INDEX  CONCURRENTLY  IF NOT EXISTS i ON t (a);',
    'CREATE INDEX\tCONCURRENTLY\tIF NOT EXISTS i ON t (a);',
    'CREATE INDEX IF  NOT  EXISTS i ON t (a);',
    'CREATE  UNIQUE   INDEX   CONCURRENTLY   IF  NOT  EXISTS i ON t (a);',
  ])('PASS: %j', (sql) => {
    expect(rule(sql, INDEX)).toEqual([]);
  });

  it.each([
    'CREATE INDEX i ON t (a);',
    'CREATE INDEX CONCURRENTLY i ON t (a);',
    'CREATE UNIQUE INDEX i ON t (a);',
    'CREATE UNIQUE INDEX CONCURRENTLY i ON t (a);',
    'CREATE INDEX  CONCURRENTLY  i ON t (a);',
    'CREATE INDEX  ifnotexists ON t (a);',
    'CREATE INDEX CONCURRENTLY',
  ])('FLAGGED: %j', (sql) => {
    expect(rule(sql, INDEX)).toHaveLength(1);
  });

  it('a CREATE INDEX inside a line comment is ignored', () => {
    expect(rule('-- CREATE INDEX i ON t (a);', INDEX)).toEqual([]);
  });

  it.each([
    // real line, 20261210000004_activate_invitation_membership.sql:60 — a pattern, not DDL
    "  IF v_def NOT ILIKE 'CREATE UNIQUE INDEX%(user_id, company_id)%' THEN",
    'CREATE INDEXES_ARE_NOT_DDL',
  ])('NOT DDL (keyword not followed by whitespace): %j', (sql) => {
    expect(rule(sql, INDEX)).toEqual([]);
  });
});

describe('migration gate: CREATE TABLE / ADD COLUMN must use IF NOT EXISTS (same class)', () => {
  it.each([
    ['CREATE TABLE IF NOT EXISTS t (a int);', TABLE],
    ['CREATE TABLE  IF NOT EXISTS t (a int);', TABLE],
    ['CREATE TABLE\tIF  NOT  EXISTS t (a int);', TABLE],
    ['ALTER TABLE t ADD COLUMN IF NOT EXISTS a int;', COLUMN],
    ['ALTER TABLE t ADD COLUMN  IF NOT EXISTS a int;', COLUMN],
    ['ALTER TABLE t ADD  COLUMN\tIF  NOT  EXISTS a int;', COLUMN],
  ])('PASS: %j', (sql, name) => {
    expect(rule(sql, name)).toEqual([]);
  });

  it.each([
    ['CREATE TABLE t (a int);', TABLE],
    ['CREATE TABLE  t (a int);', TABLE],
    ['ALTER TABLE t ADD COLUMN a int;', COLUMN],
    ['ALTER TABLE t ADD COLUMN  a int;', COLUMN],
  ])('FLAGGED: %j', (sql, name) => {
    expect(rule(sql, name)).toHaveLength(1);
  });
});
