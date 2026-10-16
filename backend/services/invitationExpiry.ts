/**
 * Closure-015E — the one invitation-expiry predicate for the TypeScript
 * acceptance paths (team/accept-invite, auth/accept-invite, auth/set-password).
 *
 * Semantics are those of the authoritative activation RPC
 * `activate_invitation_membership` (supabase/migrations/20260420_lockdown_idempotency.sql:
 * `IF v_invitation.expires_at <= p_now THEN` → expired): an invitation is
 * expired AT its `expires_at` instant, not only after it. Two paths compared
 * with `<` and accepted the boundary instant.
 *
 * Fail closed: `invitations.expires_at` is NOT NULL with a default, so a
 * missing, empty or unparseable value is unexpected — it is treated as expired.
 * (`new Date(garbage) < now` is `false`, so the former checks ACCEPTED it.)
 */
export function isInvitationExpired(expiresAt: unknown, now: Date = new Date()): boolean {
  let t: number;
  if (expiresAt instanceof Date) t = expiresAt.getTime();
  else if (typeof expiresAt === 'string' && expiresAt.trim() !== '') t = Date.parse(expiresAt);
  else return true;
  if (!Number.isFinite(t)) return true;
  return t <= now.getTime();
}
