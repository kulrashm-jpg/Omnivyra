/**
 * The advisory-lock key that serialises every writer deciding on the platform's super-admin COUNT (M1 bootstrap,
 * M2 revoke). The database defines it ONCE - public.super_admin_membership_lock_key() (20270217000013) - and both RPCs
 * call that function rather than spelling the number. This constant exists so the key is visible and greppable from
 * the application; backend/tests/unit/superAdminMembershipLock.test.ts pins it to the SQL definition and asserts both
 * migrations take the lock through the function (05: two constants that merely happen to match are the failure mode).
 */
export const SUPER_ADMIN_MEMBERSHIP_LOCK_KEY = 7302118001;
