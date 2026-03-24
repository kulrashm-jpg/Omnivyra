/**
 * getAuthToken — Firebase-only client-side auth token resolver.
 *
 * Returns the current Firebase ID token for API calls.
 * Supabase session is no longer used — Firebase is the sole identity provider.
 *
 * Returns null when unauthenticated; callers decide how to handle.
 */

import { getFirebaseAuth } from '../lib/firebase';
import { getIdToken } from 'firebase/auth';

export async function getAuthToken(): Promise<string | null> {
  try {
    const auth = getFirebaseAuth();
    const user = auth.currentUser;
    if (user) {
      // force=false: returns cached token if still valid; refreshes when < 5 min left
      return await getIdToken(user, false);
    }
  } catch {
    // Firebase not initialised or user not signed in
  }
  return null;
}
