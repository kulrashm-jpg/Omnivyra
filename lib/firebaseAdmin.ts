/**
 * Firebase Admin SDK singleton.
 *
 * Usage (server-side only):
 *   import { getFirebaseAdmin } from '../lib/firebaseAdmin';
 *   const admin = getFirebaseAdmin();
 *   const decoded = await admin.auth().verifyIdToken(idToken);
 *
 * Required environment variables (never expose to the client):
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY   (the PEM key; replace literal \n with newlines)
 */

import * as admin from 'firebase-admin';
import { wrapFirebaseVerify } from './instrumentation/firebaseInstrumentation';

let app: admin.app.App | null = null;

export function getFirebaseAdmin(): admin.app.App {
  if (app) return app;

  // Re-use an already-initialised app (hot-reload / Lambda warm start)
  if (admin.apps.length > 0) {
    app = admin.apps[0]!;
    return app;
  }

  const projectId     = process.env.FIREBASE_PROJECT_ID;
  const clientEmail   = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKeyRaw) {
    throw new Error(
      'Firebase Admin SDK is not configured. ' +
      'Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY ' +
      'in your environment.',
    );
  }

  // Environment variables stored in .env files escape newlines as \n literals;
  // the PEM format requires real newline characters.
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

  app = admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });

  return app;
}

/**
 * Verifies a Firebase ID token server-side.
 * Returns the decoded token payload on success; throws on any failure.
 *
 * @param idToken  Raw Firebase ID token from the client
 * @param checkRevoked  Also check token-revocation status (default: false for
 *                      performance; set true for high-security endpoints)
 */
async function _verifyFirebaseIdToken(
  idToken: string,
  checkRevoked = false,
): Promise<admin.auth.DecodedIdToken> {
  const auth = getFirebaseAdmin().auth();
  return auth.verifyIdToken(idToken, checkRevoked);
}

/**
 * Verifies a Firebase ID token server-side.
 * Returns the decoded token payload on success; throws on any failure.
 *
 * @param idToken  Raw Firebase ID token from the client
 * @param checkRevoked  Also check token-revocation status (default: false for
 *                      performance; set true for high-security endpoints)
 */
export const verifyFirebaseIdToken = wrapFirebaseVerify(_verifyFirebaseIdToken);
