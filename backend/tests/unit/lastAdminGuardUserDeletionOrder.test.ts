/**
 * 20270217000012 (last-admin guard) - 05's ORDERING DEPENDENCY.
 * Super-admin user deletion runs as separate PostgREST calls: Step B deletes the
 * Supabase Auth account (irreversible), Step C soft-deletes the users row, Step D
 * deactivates the user's memberships. The guard's commit-time check EXEMPTS a
 * removed admin whose user is already deleted - so a sole admin can be deleted
 * ONLY because Step C committed before Step D. If Step D ever ran before Step C,
 * it would raise LAST_COMPANY_ADMIN after the auth account is already gone (a
 * half-deleted user). This pins B < C < D in the handler's source.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(path.resolve(__dirname, '../../apiHandlers/superAdmin/usersMutations.ts'), 'utf8');

function at(re: RegExp, label: string): number {
  const m = re.exec(SRC);
  expect({ label, found: !!m }).toEqual({ label, found: true });
  return m!.index;
}

it('Step B (auth delete) < Step C (users soft-delete) < Step D (memberships inactive)', () => {
  const b = at(/supabase\.auth\.admin\.deleteUser\(/, 'Step B auth delete');
  const c = at(/\.update\(\{\s*is_deleted:\s*true,\s*deleted_at:\s*now\s*\}\)/, 'Step C users soft-delete');
  const d = at(/\.update\(\{\s*status:\s*'inactive',\s*deactivated_at:\s*now,\s*updated_at:\s*now\s*\}\)/, 'Step D memberships inactive');
  expect(b).toBeLessThan(c);
  expect(c).toBeLessThan(d); // LOAD-BEARING for the last-admin guard's user-deleted exemption
});

it('Step D writes user_company_roles (so the guard sees the deletion at all)', () => {
  const d = SRC.search(/\.update\(\{\s*status:\s*'inactive',\s*deactivated_at:\s*now,\s*updated_at:\s*now\s*\}\)/);
  const before = SRC.slice(Math.max(0, d - 400), d);
  expect(before).toMatch(/from\('user_company_roles'\)/);
});

// 05: an ordering of three literals cannot see a NEW membership write added above
// Step C. The invariant as a PROHIBITION: between Route 2's Step A and the Step C
// users soft-delete there is NO write (update / delete / upsert / insert) to
// user_company_roles. Reads (the membership lookup) are allowed.
it('PROHIBITION: no user_company_roles WRITE between Route 2 Step A and Step C', () => {
  const a = SRC.indexOf('// Step A: look up the user row to get the auth identity');
  const c = SRC.search(/\.update\(\{\s*is_deleted:\s*true,\s*deleted_at:\s*now\s*\}\)/);
  expect(a).toBeGreaterThan(-1);
  expect(c).toBeGreaterThan(a);
  const slice = SRC.slice(a, c);
  const writes: string[] = [];
  const re = /from\('user_company_roles'\)([\s\S]*?);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice))) {
    if (/\.(update|delete|upsert|insert)\(/.test(m[1])) writes.push(m[0].slice(0, 120));
  }
  expect(writes).toEqual([]);
});

it('control: the prohibition scanner DOES flag a membership write placed in such a slice', () => {
  const sample = "from('user_company_roles')\n  .update({ status: 'inactive' })\n  .eq('user_id', u);";
  const re = /from\('user_company_roles'\)([\s\S]*?);/g;
  const m = re.exec(sample);
  expect(m && /\.(update|delete|upsert|insert)\(/.test(m[1])).toBe(true);
});

