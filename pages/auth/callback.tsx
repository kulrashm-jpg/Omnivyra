'use client';

/**
 * /auth/callback
 *
 * Handles Supabase magic-link PKCE code exchange.
 * After exchanging the code for a session, asks the server where to route the user:
 *
 *   existing user               → /dashboard  (email auth is sufficient)
 *   new user / no phone         → /onboarding/phone
 *   new user completing flow    → /onboarding/verify-phone
 *   company admin (suspicious)  → /onboarding/verify-phone
 *   has phone but no company    → /onboarding/company
 */

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../utils/supabaseClient';

async function resolveRoute(accessToken: string): Promise<string> {
  try {
    const res = await fetch('/api/auth/post-login-route', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const { route } = await res.json() as { route: string };
      return route ?? '/dashboard';
    }
  } catch { /* fall through */ }
  // On any error, fall back to dashboard (session is valid, let the page guard handle it)
  return '/dashboard';
}

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');

    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(async ({ data, error }) => {
        if (error || !data.session) {
          router.replace('/login');
          return;
        }
        const route = await resolveRoute(data.session.access_token);
        router.replace(route);
      });
    } else {
      supabase.auth.getSession().then(async ({ data }) => {
        if (data.session) {
          const route = await resolveRoute(data.session.access_token);
          router.replace(route);
        } else {
          router.replace('/login');
        }
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-[#F5F9FF] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <svg className="h-8 w-8 animate-spin text-[#0A66C2]" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm text-[#6B7C93]">Verifying your link…</p>
      </div>
    </div>
  );
}
