/**
 * Firebase client — phone authentication only.
 *
 * Required environment variables (add to .env.local):
 *   NEXT_PUBLIC_FIREBASE_API_KEY
 *   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID
 *   NEXT_PUBLIC_FIREBASE_APP_ID
 *
 * Setup steps:
 *   1. Create a Firebase project at console.firebase.google.com
 *   2. Enable "Phone" under Authentication → Sign-in method
 *   3. Add your domain to the authorised domains list
 *   4. Copy the config values to .env.local
 */

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type Auth,
  type ConfirmationResult,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey:      process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain:  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId:   process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  appId:       process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

// Singleton — avoid re-initialising on hot reload
function getFirebaseApp(): FirebaseApp {
  if (getApps().length > 0) return getApp();
  return initializeApp(firebaseConfig);
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

// ── Phone auth helpers ────────────────────────────────────────────────────────

let recaptchaVerifier: RecaptchaVerifier | null = null;

/**
 * Creates (or reuses) an invisible reCAPTCHA verifier anchored to `containerId`.
 * Call this once before `sendPhoneOtp`.
 */
export function setupRecaptcha(containerId: string): RecaptchaVerifier {
  const auth = getFirebaseAuth();
  if (recaptchaVerifier) {
    try { recaptchaVerifier.clear(); } catch { /* ignore */ }
  }
  recaptchaVerifier = new RecaptchaVerifier(auth, containerId, { size: 'invisible' });
  return recaptchaVerifier;
}

/**
 * Sends an SMS OTP to `phoneNumber` (E.164 format, e.g. "+447911123456").
 * Returns a ConfirmationResult — call `.confirm(otp)` to verify.
 */
export async function sendPhoneOtp(phoneNumber: string): Promise<ConfirmationResult> {
  const auth = getFirebaseAuth();
  if (!recaptchaVerifier) throw new Error('Call setupRecaptcha() first.');
  return signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifier);
}

/**
 * Cleans up the reCAPTCHA verifier (call on component unmount).
 */
export function clearRecaptcha(): void {
  if (recaptchaVerifier) {
    try { recaptchaVerifier.clear(); } catch { /* ignore */ }
    recaptchaVerifier = null;
  }
}
