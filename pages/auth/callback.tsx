'use client';

/**
 * /auth/callback
 *
 * Handles Supabase magic-link PKCE code exchange.
 * The magic link redirects here with ?code=xxx.
 * We exchange it for a session then always forward to /onboarding/verify-phone.
 *
 * This page is the single, reliable entry point for email magic links.
 * It must never redirect directly to /dashboard — phone verification is required.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../utils/supabaseClient';

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');

    if (code) {
      // Explicitly exchange the PKCE code — more reliable than waiting for
      // onAuthStateChange which can miss the event on Fast Refresh or remount.
      supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
        if (error || !data.session) {
          router.replace('/login');
          return;
        }
        router.replace('/onboarding/verify-phone');
      });
    } else {
      // No code in URL — check if already signed in (e.g. navigated back)
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) {
          router.replace('/onboarding/verify-phone');
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
