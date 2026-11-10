/**
 * G-11 — 20270127000004 under the ASSUMED hosted default: service_role holds ALL on a new public
 * table (not measured against hosted).
 *
 * The governed local build gives service_role nothing on a new table, so 0004's privilege block
 * (REVOKE from PUBLIC/anon/authenticated, GRANT SELECT, INSERT, UPDATE to service_role) passed its
 * own postcondition here. Hosted Supabase is ASSUMED to give service_role default privileges,
 * DELETE among them; the postcondition forbids DELETE, so 0004 would RAISE at apply time, and no
 * later migration could repair it because 0004 aborts first. The fix is one statement in 0004:
 * REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ... FROM service_role. MAINTAIN (PG17+,
 * which GRANT ALL includes; production is PG 17.6) is revoked by owner ruling, matching PI's
 * security track, although the postcondition does not check it.
 *
 * This suite simulates the assumed default with `GRANT ALL ... TO service_role`, then runs 0004's
 * own privilege statements and postcondition DO block, read from the migration FILE (never
 * retyped). Counterfactual 1 strips the fix statement and proves the block then raises with the
 * postcondition's message, so the suite reproduces the production failure, not just the pass.
 * Counterfactual 2 drops only MAINTAIN from the fix and proves MAINTAIN then stays granted, so the
 * MAINTAIN assertion discriminates.
 *
 * Real: the table, its RLS, guard trigger and redaction function as built in the template. Runs
 * as the harness's connection role (the superuser that applies migrations); every test is inside
 * inRollback(), so the template's grants are unchanged afterwards.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { db, inRollback } from './setup';

const FILE = join(__dirname, '../../../supabase/migrations/20270127000004_contact_enrolment_closures.sql');
const TABLE = 'public.contact_enrolment_closures';
const RAISE_MESSAGE = 'G-11 postcondition: a client role can read closures, or a closure can be deleted';
const ASSUMED = 'ASSUMED hosted default: service_role holds ALL on a new public table (not measured against hosted)';

const src = readFileSync(FILE, 'utf8');

/** Every REVOKE/GRANT whose object is the closures TABLE (not its guard function). */
const privilegeStatements = (src.match(
  /^(?:REVOKE|GRANT)\b[^;]*?\bON\s+(?:TABLE\s+)?public\.contact_enrolment_closures\s+(?:FROM|TO)\b[^;]*;/gim,
) ?? []).map((s) => s.trim());

const FIX = /^REVOKE\s+DELETE,\s*TRUNCATE,\s*REFERENCES,\s*TRIGGER,\s*MAINTAIN\s+ON\s+public\.contact_enrolment_closures\s+FROM\s+service_role;$/i;
const fixStatements = privilegeStatements.filter((s) => FIX.test(s));

const doBlocks = src.match(/^DO \$\$\r?\n[\s\S]*?\r?\n\$\$;/gm) ?? [];
const postconditions = doBlocks.filter((b) =>
  /has_table_privilege\(\s*'service_role'\s*,\s*'public\.contact_enrolment_closures'\s*,\s*'DELETE'\s*\)/.test(b));
const postcondition = postconditions[0] ?? '';

const NAMED = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] as const;

async function serviceRolePrivileges(): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const p of NAMED) {
    const r = await db.query(`SELECT has_table_privilege('service_role', $1, $2) AS ok`, [TABLE, p]);
    out[p] = r.rows[0].ok as boolean;
  }
  return out;
}

/** The ACL entries granted directly to service_role, by name. */
async function serviceRoleAcl(): Promise<string[]> {
  const r = await db.query(
    `SELECT a.privilege_type AS p
       FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid = $1::regclass AND a.grantee = 'service_role'::regrole
      ORDER BY 1`, [TABLE]);
  return r.rows.map((x) => x.p as string);
}

/** Run SQL under a savepoint; return null on success or the error message (savepoint restored). */
async function run(sql: string): Promise<string | null> {
  await db.query('SAVEPOINT g');
  try {
    await db.query(sql);
    await db.query('RELEASE SAVEPOINT g');
    return null;
  } catch (err: any) {
    await db.query('ROLLBACK TO SAVEPOINT g');
    return String(err.message ?? err);
  }
}

/** MAINTAIN exists from PostgreSQL 17; on an older server has_table_privilege would reject the name. */
async function isPg17(): Promise<boolean> {
  return Number((await db.query(`SELECT current_setting('server_version_num') AS v`)).rows[0].v) >= 170000;
}
async function serviceRoleHasMaintain(): Promise<boolean> {
  const r = await db.query(`SELECT has_table_privilege('service_role', $1, 'MAINTAIN') AS ok`, [TABLE]);
  return r.rows[0].ok as boolean;
}

async function simulateHostedDefault(): Promise<void> {
  await db.query(`GRANT ALL ON ${TABLE} TO service_role`);
  // The simulation must actually produce the hostile starting state, or nothing below proves anything.
  expect((await serviceRolePrivileges()).DELETE).toBe(true);
  if (await isPg17()) expect(await serviceRoleHasMaintain()).toBe(true);
}

describe(`G-11 0004 privilege block — ${ASSUMED}`, () => {
  it('extraction: exactly 4 table privilege statements (one is the fix) and exactly one postcondition DO block with the DELETE check', () => {
    expect(privilegeStatements).toEqual([
      'REVOKE ALL ON public.contact_enrolment_closures FROM PUBLIC;',
      'REVOKE ALL ON public.contact_enrolment_closures FROM anon, authenticated;',
      'GRANT SELECT, INSERT, UPDATE ON public.contact_enrolment_closures TO service_role;',
      'REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.contact_enrolment_closures FROM service_role;',
    ]);
    expect(fixStatements).toHaveLength(1);
    expect(postconditions).toHaveLength(1);
    expect(postcondition).toContain(RAISE_MESSAGE);
  });

  it(`(a)+(b) with the fix, under the ${ASSUMED}, the block applies, the postcondition does not raise, and service_role ends with exactly SELECT, INSERT, UPDATE`, async () => {
    expect(postcondition).not.toBe('');
    await inRollback(async () => {
      await simulateHostedDefault();
      expect(await run(privilegeStatements.join('\n'))).toBeNull();
      expect(await run(postcondition)).toBeNull();
      expect(await serviceRolePrivileges()).toEqual({
        SELECT: true, INSERT: true, UPDATE: true,
        DELETE: false, TRUNCATE: false, REFERENCES: false, TRIGGER: false,
      });
      expect(await serviceRoleAcl()).toEqual(['INSERT', 'SELECT', 'UPDATE']);
    });
  });

  it(`(c) COUNTERFACTUAL 1: without the fix statement, under the ${ASSUMED}, the postcondition RAISES`, async () => {
    const withoutFix = privilegeStatements.filter((s) => !FIX.test(s));
    expect(withoutFix).toHaveLength(privilegeStatements.length - 1);
    expect(withoutFix).toHaveLength(3);
    await inRollback(async () => {
      await simulateHostedDefault();
      expect(await run(withoutFix.join('\n'))).toBeNull();
      expect((await serviceRolePrivileges()).DELETE).toBe(true);
      expect(await run(postcondition)).toBe(RAISE_MESSAGE);
    });
  });

  it(`MAINTAIN (PostgreSQL 17+) is revoked by the fix, under the ${ASSUMED}`, async () => {
    await inRollback(async () => {
      await simulateHostedDefault();
      expect(await run(privilegeStatements.join('\n'))).toBeNull();
      expect((await serviceRoleAcl()).includes('MAINTAIN')).toBe(false);
      if (await isPg17()) expect(await serviceRoleHasMaintain()).toBe(false);
    });
  });

  it(`COUNTERFACTUAL 2: the fix line WITHOUT MAINTAIN leaves MAINTAIN granted (PG17+), under the ${ASSUMED}`, async () => {
    const [fix] = fixStatements;
    const fixWithoutMaintain = fix.replace(/,\s*MAINTAIN\b/i, '');
    expect(fixWithoutMaintain).not.toBe(fix);
    expect(fixWithoutMaintain).toBe('REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.contact_enrolment_closures FROM service_role;');
    const block = privilegeStatements.map((s) => (s === fix ? fixWithoutMaintain : s));
    const pg17 = await isPg17();
    await inRollback(async () => {
      await simulateHostedDefault();
      expect(await run(block.join('\n'))).toBeNull();
      // The postcondition does not check MAINTAIN, so it passes; only the MAINTAIN assertion catches this.
      expect(await run(postcondition)).toBeNull();
      expect((await serviceRoleAcl()).includes('MAINTAIN')).toBe(pg17);
      if (pg17) expect(await serviceRoleHasMaintain()).toBe(true);
    });
  });

  it('the template itself (local governed build, no simulation) already matches the fixed end state', async () => {
    expect(await serviceRolePrivileges()).toEqual({
      SELECT: true, INSERT: true, UPDATE: true,
      DELETE: false, TRUNCATE: false, REFERENCES: false, TRIGGER: false,
    });
    expect(await serviceRoleAcl()).toEqual(['INSERT', 'SELECT', 'UPDATE']);
  });
});
