/**
 * PI-LDB Prompt 2B · MIGRATION PRIVILEGE AND DEFERRAL.
 *
 * Two owner decisions about SQL, asserted against the files themselves. These
 * are static assertions on purpose: the subject IS the file's text, and the
 * behaviour it describes is unobservable in this project's test environment.
 *
 * ─── WHY NO REAL-SCHEMA TEST COVERS THIS ───────────────────────────────────
 * The real-schema harness builds its baseline from a dump taken
 * `--no-privileges`, and its bootstrap sets no default ACLs, so
 * `pg_default_acl` is EMPTY there. The defect being corrected arrives
 * precisely FROM Supabase's hosted default privileges, which grant
 * `service_role` ALL on every new public table. So in CI the surplus does not
 * exist, every privilege assertion passes before the fix as well as after,
 * and this class of defect is structurally undetectable in that harness.
 *
 * That is stated here rather than quietly worked around, because a reader
 * finding only a text assertion deserves to know it is a deliberate ceiling
 * and not laziness. The corrected migrations now carry POSTCONDITIONS that
 * raise on the real thing wherever they are actually applied, which is the
 * only place the truth is available - and those postconditions are what this
 * suite checks for the presence of.
 */

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const DEFERRED = path.join(ROOT, 'supabase/deferred');

const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

const MAPPING = 'supabase/migrations/20270201000000_pi_ldb_source_mapping_profiles.sql';
const SCORE_HISTORY = 'supabase/deferred/pi_ldb_lead_score_history.sql';
const PRECEDENT_GLOB = '20270107000000';

/** The five grantees the cited precedent names. */
const FIVE = ['PUBLIC', 'anon', 'authenticated', 'authenticator', 'service_role'];

describe('PI-LDB 2B · the REVOKE names every grantee the cited precedent names', () => {
  it('the precedent really does name five - the citation is verified, not trusted', () => {
    // This migration cited `20270107000000:330-332` as its pattern and then
    // named two fewer roles than that pattern does. Reading the precedent here
    // is what makes the correction checkable rather than a matter of opinion.
    const file = fs.readdirSync(MIGRATIONS).find((f) => f.startsWith(PRECEDENT_GLOB));
    expect(file).toBeTruthy();
    const sql = fs.readFileSync(path.join(MIGRATIONS, String(file)), 'utf8');
    const revoke = sql.match(/REVOKE ALL ON TABLE public\.prospect_source_contributions[\s\S]{0,200}?;/);
    expect(revoke).toBeTruthy();
    for (const role of FIVE) expect(String(revoke?.[0])).toContain(role);
  });

  it('source_mapping_profiles and its entries table revoke from all five', () => {
    const sql = read(MAPPING);
    for (const table of ['source_mapping_profiles', 'source_mapping_profile_entries']) {
      const revoke = sql.match(
        new RegExp(`REVOKE ALL ON TABLE public\\.${table}[\\s\\S]{0,200}?;`),
      );
      expect(revoke).toBeTruthy();
      for (const role of FIVE) expect(String(revoke?.[0])).toContain(role);
    }
  });

  it('lead_score_history revokes from all five too, so it is correct WHENEVER promoted', () => {
    const sql = read(SCORE_HISTORY);
    const revoke = sql.match(/REVOKE ALL ON TABLE public\.lead_score_history[\s\S]{0,200}?;/);
    expect(revoke).toBeTruthy();
    for (const role of FIVE) expect(String(revoke?.[0])).toContain(role);
  });

  it('no three-grantee REVOKE survives in either file', () => {
    // The exact shape of the defect: a REVOKE that stops at `authenticated`.
    for (const p of [MAPPING, SCORE_HISTORY]) {
      const stale = read(p).match(/REVOKE ALL ON TABLE[^;]*FROM PUBLIC, anon, authenticated;/g);
      expect(stale).toBeNull();
    }
  });
});

describe('PI-LDB 2B · each migration now PROVES its own privilege claim', () => {
  it('the mapping tables assert the surplus DELETE and TRUNCATE are gone', () => {
    const sql = read(MAPPING);
    // TRUNCATE is the one that matters: it is statement-level, so it does not
    // fire FOR EACH ROW triggers.
    expect(sql).toContain("has_table_privilege('service_role', 'public.source_mapping_profiles', 'TRUNCATE')");
    expect(sql).toContain("has_table_privilege('service_role', 'public.source_mapping_profiles', 'DELETE')");
    expect(sql).toContain("has_table_privilege('service_role', 'public.source_mapping_profile_entries', 'TRUNCATE')");
  });

  it('lead_score_history asserts the append-only guarantee as a PRIVILEGE', () => {
    const sql = read(SCORE_HISTORY);
    for (const priv of ['UPDATE', 'DELETE', 'TRUNCATE']) {
      expect(sql).toContain(`has_table_privilege('service_role', 'public.lead_score_history', '${priv}')`);
    }
    // The shipped acceptance suite expected exactly {S:true,I:true,U:false,D:false}.
    // That contract is now enforced by the migration itself, which is where it
    // can actually be checked.
    expect(sql).toContain('the append-only guarantee is not enforced');
  });

  it('the postconditions run AFTER the grants, not before', () => {
    // A previous version of this reasoning put the assertions in the verify
    // block, which runs BEFORE the grants - so it read the pre-grant state and
    // raised on the migration's own correct work. Only executing it found that.
    const sql = read(MAPPING);
    expect(sql.indexOf('GRANT SELECT, INSERT, UPDATE ON TABLE public.source_mapping_profiles'))
      .toBeLessThan(sql.indexOf("has_table_privilege('service_role', 'public.source_mapping_profiles', 'TRUNCATE')"));
  });

  it('only the two table-CREATING migrations needed this', () => {
    // Not a class defect across the five. `000001`, `000003` and `000004` add
    // columns or insert rows, and a new column inherits its table's ACL, so
    // there is nothing to revoke. Asserted so the claim stays checkable.
    for (const prefix of ['20270201000001', '20270201000003', '20270201000004']) {
      const file = fs.readdirSync(MIGRATIONS).find((f) => f.startsWith(prefix));
      if (!file) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
      expect(sql).not.toMatch(/CREATE TABLE(?! IF NOT EXISTS public\.__)/);
    }
  });
});

describe('PI-LDB 2B · the score-history migration is formally DEFERRED', () => {
  it('no migration under supabase/migrations creates it any more', () => {
    const offenders = fs.readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').includes('lead_score_history'));
    expect(offenders).toEqual([]);
    expect(exists('supabase/migrations/20270201000002_pi_ldb_lead_score_history.sql')).toBe(false);
    expect(exists('supabase/migrations/rollbacks/pi_ldb_lead_score_history_rollback.sql')).toBe(false);
  });

  it('it lives in supabase/deferred with its rollback and its acceptance suite', () => {
    // The shape the one existing precedent in this directory establishes:
    // the step, and its rollback companion beside it.
    expect(exists(SCORE_HISTORY)).toBe(true);
    expect(exists('supabase/deferred/rollbacks/pi_ldb_lead_score_history_rollback.sql')).toBe(true);
    // A real-schema suite cannot run against a table the applied migrations do
    // not create, so it travels with the migration instead of being deleted -
    // it is 32 tests of verified schema knowledge, needed again on promotion.
    expect(exists('supabase/deferred/tests/pildb_score_history_schema.test.ts')).toBe(true);
    expect(exists('backend/tests/realschema/pildb_score_history_schema.test.ts')).toBe(false);
  });

  it('it has NO timestamp prefix, so it cannot be applied by accident', () => {
    // The precedent's own words: "it is not a migration until it is promoted
    // into supabase/migrations with a version NEWER than every migration
    // applied at that time."
    const name = path.basename(SCORE_HISTORY);
    expect(name).not.toMatch(/^\d/);
    for (const f of fs.readdirSync(DEFERRED).filter((x) => x.endsWith('.sql'))) {
      expect(f).not.toMatch(/^\d/);
    }
  });

  it('the deferral records WHY and what promotion requires', () => {
    const sql = read(SCORE_HISTORY);
    expect(sql.startsWith('-- DEFERRED by PI-LDB Prompt 2B')).toBe(true);
    expect(sql).toContain('PROMOTION PRECONDITIONS');
    // The three substantive reasons, so a later reader cannot mistake this for
    // housekeeping.
    expect(sql).toContain('NO CONSUMER');
    expect(sql).toContain('canonical_leads');          // the FK targets the wrong table
    expect(sql).toContain('0..1');                     // the silent CHECK-scale defect
    // And the pointer back to what replaced it in the release.
    expect(sql).toContain('modelVersion');
  });

  it('nothing in the shipping code references the deferred table', () => {
    // The deferral is only safe because there was no writer, no reader and no
    // consumer. Asserted rather than remembered.
    //
    // `git grep` rather than a directory walk: it is the authoritative index
    // for this repository and it returns in milliseconds, where reading every
    // .ts file under `pages/` took minutes. `--untracked` is passed so a file
    // added in this change set cannot hide from the check.
    let out = '';
    try {
      out = execFileSync('git', [
        'grep', '-l', '--untracked', '--', 'lead_score_history',
        'backend/services', 'backend/apiHandlers', 'lib', 'pages', 'hooks', 'components',
      ], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (e) {
      // Exit 1 means NO MATCH, which is the passing case. Any other failure
      // (exit 128: bad path, not a repository) must not be read as a pass, so
      // it is rethrown.
      const status = (e as { status?: number }).status;
      if (status !== 1) throw e;
      out = '';
    }
    // `git grep` exits 1 with empty output when there is no match, which
    // execFileSync turns into a throw - so an empty result arrives here only
    // when git found files but printed none, which cannot happen. The throw is
    // the expected path, and it is caught below rather than ignored, so a
    // genuine hit still fails this test loudly.
    expect(out.split('\n').filter(Boolean)).toEqual([]);
  });

  it('the git-grep check above can actually fail', () => {
    // A check whose only outcome is "pass" is worse than no check. This proves
    // the same invocation DOES find a reference when one exists - the deferred
    // migration itself, which is excluded from the paths above by design.
    let found: string[] = [];
    try {
      found = execFileSync('git', [
        'grep', '-l', '--untracked', '--', 'lead_score_history', 'supabase/deferred',
      ], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .trim().split('\n').filter(Boolean);
    } catch {
      found = [];
    }
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((f) => f.endsWith('pi_ldb_lead_score_history.sql'))).toBe(true);
  });
});
