/**
 * 05 (2026-11-13): "a lock key that two call sites compute independently is a lock that silently stops working when one
 * of them is edited". M1's bootstrap (20270217000013) and M2's revoke (20270217000052) must serialise on ONE key. This
 * pins: the key is DEFINED once (public.super_admin_membership_lock_key() in 013) and equals the TS constant; both
 * functions take pg_advisory_xact_lock(public.super_admin_membership_lock_key()) - never a literal of their own; and no
 * other migration defines the key function.
 */
import * as fs from 'fs';
import * as path from 'path';
import { SUPER_ADMIN_MEMBERSHIP_LOCK_KEY } from '../../security/superAdminMembershipLock';

const DIR = path.join(process.cwd(), 'supabase/migrations');
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');
const M1 = read('20270217000013_super_admin_bootstrap_atomic.sql');
const M2 = read('20270217000052_revoke_super_admin_last_admin_guard.sql');

/** Body of `CREATE OR REPLACE FUNCTION public.<name>(` up to its closing `$$;`. */
function body(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('$$', start) + 2) + 3);
}

const TAKES_SHARED_LOCK = /pg_advisory_xact_lock\(public\.super_admin_membership_lock_key\(\)\)/;

it('the key is defined once in 013 and equals the TS constant', () => {
  const def = body(M1, 'super_admin_membership_lock_key');
  const m = /SELECT\s+(\d+)::bigint/.exec(def);
  expect(m).not.toBeNull();
  expect(Number(m![1])).toBe(SUPER_ADMIN_MEMBERSHIP_LOCK_KEY);
});

it('bootstrap (013) and revoke (052) both take the lock THROUGH the key function', () => {
  expect(body(M1, 'bootstrap_first_super_admin')).toMatch(TAKES_SHARED_LOCK);
  expect(body(M2, 'revoke_super_admin')).toMatch(TAKES_SHARED_LOCK);
});

it('neither function spells the key as a literal', () => {
  const literal = String(SUPER_ADMIN_MEMBERSHIP_LOCK_KEY);
  expect(body(M1, 'bootstrap_first_super_admin')).not.toContain(literal);
  expect(body(M2, 'revoke_super_admin')).not.toContain(literal);
});

it('no other migration defines the key function (positive control: 013 does)', () => {
  const definers = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql'))
    .filter((f) => read(f).includes('FUNCTION public.super_admin_membership_lock_key('));
  expect(definers).toEqual(['20270217000013_super_admin_bootstrap_atomic.sql']);
});

it('the matcher WOULD catch a revoke that took its own key (mutation)', () => {
  const mutated = body(M2, 'revoke_super_admin').replace('public.super_admin_membership_lock_key()', '7302118001');
  expect(mutated).not.toMatch(TAKES_SHARED_LOCK);
});

// 05/e9 (BLOCKING): the "others" count is an ALLOWLIST on users.status - a suspended (or unknown-status) super-admin
// cannot authenticate and must not count, or the guard permits revoking the last USABLE admin.
const STATUS_ALLOWLIST = /coalesce\(u\.status, 'active'\) = 'active'/;
it('revoke_super_admin counts only ACTIVE-status, non-deleted users as other super-admins', () => {
  const b = body(M2, 'revoke_super_admin');
  expect(b).toMatch(STATUS_ALLOWLIST);
  expect(b).toMatch(/coalesce\(u\.is_deleted, false\) = false/);
});
it('the pin WOULD catch the old filter (mutation: status clause removed)', () => {
  const old = body(M2, 'revoke_super_admin').replace(/\n\s*AND coalesce\(u\.status, 'active'\) = 'active'/, '');
  expect(old).not.toMatch(STATUS_ALLOWLIST);
});
