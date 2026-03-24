/**
 * Firebase Email Link (passwordless) authentication helpers.
 *
 * Flow:
 *  1. sendEmailLink(email)     — request a sign-in link; persist email to localStorage
 *  2. verifyEmailLink(email?)  — called on /auth/verify; exchange the link for a Firebase session
 *  3. syncUserToSupabase(...)  — persist the Firebase user identity to the Supabase `users` table
 *
 * Supabase is used only as a database — no Supabase Auth is involved here.
 */

import {
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  getAdditionalUserInfo,
  getIdToken,
  onAuthStateChanged,
  type ActionCodeSettings,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth } from '../firebase';

// localStorage key used to persist email across the magic-link redirect.
// Firebase requires the same email that initiated the link to complete sign-in.
export const EMAIL_FOR_SIGN_IN_KEY = 'emailForSignIn';

const getActionCodeSettings = (): ActionCodeSettings => ({
  // Uses current origin so localhost works in dev and production domain works in prod.
  // The origin must be in Firebase Console → Authentication → Settings → Authorized domains.
  url: `${typeof window !== 'undefined' ? window.location.origin : 'https://app.omnivyra.com'}/auth/verify`,
  handleCodeInApp: true,
});

// ── sendEmailLink ─────────────────────────────────────────────────────────────

/**
 * Sends a Firebase Email Link sign-in email.
 * Saves the email to localStorage so verifyEmailLink() can retrieve it after
 * the user clicks the link and is redirected back to /auth/verify.
 *
 * Throws if Firebase rejects the request (invalid email, quota exceeded, etc.).
 */
export async function sendEmailLink(email: string): Promise<void> {
  const auth = getFirebaseAuth();
  await sendSignInLinkToEmail(auth, email, getActionCodeSettings());
  window.localStorage.setItem(EMAIL_FOR_SIGN_IN_KEY, email);
}

// ── verifyEmailLink ───────────────────────────────────────────────────────────

export interface EmailLinkVerifyResult {
  /** Authenticated Firebase user */
  user: User;
  /** Fresh Firebase ID token — pass this to your backend / syncUserToSupabase */
  idToken: string;
  /** true on first sign-in for this email address */
  isNewUser: boolean;
}

/**
 * Completes Firebase Email Link sign-in.
 * Must be called on the /auth/verify page (where Firebase redirects after link click).
 *
 * Throws typed errors:
 *   'INVALID_LINK'   — the current URL is not a valid Firebase sign-in link
 *   'EMAIL_REQUIRED' — no stored email and no emailOverride provided
 *                      (cross-device open — prompt user to re-enter their email)
 *   Firebase errors  — 'auth/expired-action-code', 'auth/invalid-action-code', etc.
 *
 * @param emailOverride  Provide only when re-prompting the user for their email
 *                       (i.e. localStorage was empty — common when the link is opened
 *                       on a different device than where it was requested).
 */
export async function verifyEmailLink(
  emailOverride?: string,
): Promise<EmailLinkVerifyResult> {
  const auth = getFirebaseAuth();
  const url = window.location.href;

  if (!isSignInWithEmailLink(auth, url)) {
    throw new Error('INVALID_LINK');
  }

  const email =
    emailOverride ??
    window.localStorage.getItem(EMAIL_FOR_SIGN_IN_KEY) ??
    undefined;

  if (!email) {
    throw new Error('EMAIL_REQUIRED');
  }

  const credential = await signInWithEmailLink(auth, email, url);

  // Clear stored email — it's no longer needed
  window.localStorage.removeItem(EMAIL_FOR_SIGN_IN_KEY);

  const idToken = await getIdToken(credential.user);
  const additionalInfo = getAdditionalUserInfo(credential);

  return {
    user: credential.user,
    idToken,
    isNewUser: additionalInfo?.isNewUser ?? false,
  };
}

// ── syncUserToSupabase ────────────────────────────────────────────────────────

/**
 * Persists the authenticated Firebase user to the Supabase `users` table.
 * Delegates to /api/auth/sync-firebase-user which verifies the Firebase ID
 * token server-side before writing — the service-role key never touches the client.
 *
 * Throws with a descriptive message on any failure.
 */
export async function syncUserToSupabase(params: {
  uid: string;
  email: string;
  idToken: string;
}): Promise<void> {
  const res = await fetch('/api/auth/sync-firebase-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as Record<string, string>)?.error ??
        `Sync failed with HTTP ${res.status}`,
    );
  }
}

// ── getCurrentFirebaseUser ────────────────────────────────────────────────────

/**
 * Returns the current Firebase user (or null) by waiting for the auth state
 * to resolve. Useful for session checks on page load.
 */
export function getCurrentFirebaseUser(): Promise<User | null> {
  return new Promise((resolve) => {
    const auth = getFirebaseAuth();
    // onAuthStateChanged fires once with the initial state, then we unsubscribe
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}
