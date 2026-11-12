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
