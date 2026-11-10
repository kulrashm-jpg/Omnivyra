/**
 * GD-4 ordering postcondition (static): a function redefined by a later
 * security migration must stay last in replay order.
 *
 * `supabase db push`, CI real-schema and every fresh environment apply
 * migrations in filename order. Two functions are redefined by later
 * migrations that add security gates:
 *   - advance_execution_plan: the not_before floor (20270127000000);
 *   - claim_community_ai_browser_command: the human-approval gate
 *     (20270120000010), then the policy/evidence CAS (20270126000001).
 * If the earlier definers (20261228000002, 20261231000005) were ever renumbered
 * ABOVE those files - as a GD-4 band placed above 20270112000000 would do -
 * their older CREATE OR REPLACE bodies would silently win on replay and
 * remove the gates. This test fails if that happens; the real-schema
 * counterpart (realschema/migration_function_order_security) asserts the
 * replayed bodies themselves.
 */
import * as fs from 'fs';
import * as path from 'path';

const DIR = path.join(process.cwd(), 'supabase/migrations');

/** The protected functions, the migration that must define them last, and a marker unique to that body. */
const PROTECTED = [
  { fn: 'advance_execution_plan', last: '20270127000000_execution_step_not_before.sql', marker: 'not_before' },
  { fn: 'claim_community_ai_browser_command', last: '20270126000001_community_action_approval_claim.sql', marker: 'community_action_approval_evidence_code' },
] as const;

const defines = (sql: string, fn: string): boolean =>
  new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(public\\.)?${fn}\\s*\\(`, 'i').test(sql);

/** The body of the function's definition in `sql` (from its CREATE to the closing dollar quote). */
const bodyOf = (sql: string, fn: string): string => {
  const start = sql.search(new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(public\\.)?${fn}\\s*\\(`, 'i'));
  if (start < 0) return '';
  const rest = sql.slice(start);
  const open = /\$([a-z_]*)\$/i.exec(rest);
  if (!open) return '';
  const tag = open[0];
  const close = rest.indexOf(tag, open.index + tag.length);
  return close < 0 ? '' : rest.slice(open.index, close + tag.length);
};

const migrationFiles = (): string[] => fs.readdirSync(DIR).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();

/** Replay order = filename order. Returns the file whose definition wins for `fn`. */
const lastDefiner = (files: string[], read: (f: string) => string, fn: string): string | undefined =>
  files.filter((f) => defines(read(f), fn)).pop();

const read = (f: string): string => fs.readFileSync(path.join(DIR, f), 'utf8');

describe('migration replay order keeps the security redefinitions last', () => {
  const files = migrationFiles();

  it.each(PROTECTED)('$fn is defined last by $last', ({ fn, last }) => {
    expect(lastDefiner(files, read, fn)).toBe(last);
  });

  it.each(PROTECTED)('the winning $fn body carries its gate ($marker), and no earlier definer does', ({ fn, last, marker }) => {
    const definers = files.filter((f) => defines(read(f), fn));
    expect(definers.length).toBeGreaterThan(1);
    expect(bodyOf(read(last), fn)).toContain(marker);
    for (const f of definers.filter((d) => d !== last)) expect(bodyOf(read(f), fn)).not.toContain(marker);
  });

  it('negative control: an earlier definer renumbered above the gate would win, and the check sees it', () => {
    // Simulate a mis-placed band: move each protected function's earliest definer above every other file.
    for (const { fn, last } of PROTECTED) {
      const first = files.find((f) => defines(read(f), fn))!;
      const moved = `29991231000000_${first.slice(15)}`;
      const sim = [...files.filter((f) => f !== first), moved].sort();
      const simRead = (f: string): string => (f === moved ? read(first) : read(f));
      expect(lastDefiner(sim, simRead, fn)).toBe(moved);
      expect(lastDefiner(sim, simRead, fn)).not.toBe(last);
    }
  });
});
