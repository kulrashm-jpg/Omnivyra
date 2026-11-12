/**
 * Conservative email-address policy for the points where an address FIRST enters the system (e1, 2026-11-12;
 * e9 ruling - defence in depth).
 *
 * Why: an address is chosen by the user and only CONFIRMED by verification - verification proves control of a
 * mailbox, never that the string is safe. A quoted local part may legally contain commas, dots and spaces, which
 * once let an address be parsed as PostgREST filter syntax (the onboarding .or() account takeover, fixed). We do not
 * rely on the auth provider's own validation, which this repo can neither see nor control.
 *
 * Accepted - and nothing else:
 *   local part   1-64 chars of  A-Z a-z 0-9 . _ + -   (no leading/trailing dot, no "..")
 *   domain       2+ labels of  A-Z a-z 0-9 -  (each 1-63 chars, not starting/ending with "-"),
 *                the last (TLD) alphabetic and 2+ chars
 *   whole        at most 254 chars, exactly one "@"
 * Rejected by construction: quotes, commas, spaces, control characters, "%", "(", ")", "<", ">", ";", ":",
 * backslash, IP-literal domains and any non-ASCII.
 */
const LOCAL = /^[A-Za-z0-9_+-]+(?:\.[A-Za-z0-9_+-]+)*$/;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const TLD = /^[A-Za-z]{2,63}$/;

export const EMAIL_ADDRESS_POLICY_MESSAGE =
  'Please use a standard email address (letters, digits and . _ + - before the @).';

export function isAcceptableEmailAddress(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const email = raw.trim();
  if (email.length === 0 || email.length > 254) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || !LOCAL.test(local)) return false;
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return false;
  return TLD.test(labels[labels.length - 1]);
}
