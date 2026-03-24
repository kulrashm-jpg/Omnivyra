'use client';

/**
 * /auth/callback
 *
 * Legacy Supabase PKCE callback — no longer used.
 * Firebase email link authentication uses /auth/verify instead.
 *
 * Redirects to /auth/verify in case anyone has bookmarked this URL,
 * or falls through to /dashboard if already authenticated.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { getFirebaseAuth } from '../../lib/firebase';
import { getAuthToken } from '../../utils/getAuthToken';
import { signOut } from 'firebase/auth';

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    const fbUser = getFirebaseAuth().currentUser;
    if (fbUser) {
      // Already authenticated — resolve route and redirect
      getAuthToken().then(async (token) => {
        if (!token) { router.replace('/login'); return; }
        try {
          const res = await fetch('/api/auth/post-login-route', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.status === 401) {
            // Ghost session: Firebase token valid but DB user deleted.
            await signOut(getFirebaseAuth());
            router.replace('/login');
            return;
          }
          if (res.ok) {
            const { route } = await res.json() as { route: string };
            router.replace(route ?? '/dashboard');
            return;
          }
        } catch { /* fall through */ }
        router.replace('/login');
      });
    } else {
      // No Firebase user — this could be a Firebase email link redirect.
      // Forward to /auth/verify which handles Firebase email links.
      router.replace(`/auth/verify${window.location.search}`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-[#F5F9FF] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <svg className="h-8 w-8 animate-spin text-[#0A66C2]" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm text-[#6B7C93]">Redirecting…</p>
      </div>
    </div>
  );
}
