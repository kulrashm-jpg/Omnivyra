/**
 * passwordPolicy.ts — THE canonical password policy (AUTH-001, Section 6).
 *
 * Before AUTH-001 the bounds diverged: the client enforced 8–20 characters
 * (create-account.tsx / set-password.tsx) while the server accepted 8–128
 * (api/auth/set-password.ts). A password set at 21+ characters via the server
 * path then failed every client form. This module is now the only place the
 * bounds are defined; client and server both import it.
 *
 * Policy: length-only (8–128), per NIST 800-63B — no composition rules.
 * The Supabase project minimum still applies underneath on the auth.signUp
 * path; 8 meets or exceeds it.
 *
 * Client-safe: no server dependencies.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Canonical user-facing copy for the length rule. */
export const PASSWORD_LENGTH_MESSAGE = `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`;

/**
 * Flat shape (no discriminated union) — this repo's tsconfig defeats
 * union narrowing in consumers (see the cast in create-account.tsx's
 * email validation); `reason` is '' when valid.
 */
export type PasswordValidation = { valid: boolean; reason: string };

/** Validate a candidate password against the canonical policy. */
export function validatePassword(password: string): PasswordValidation {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return { valid: false, reason: PASSWORD_LENGTH_MESSAGE };
  }
  return { valid: true, reason: '' };
}
