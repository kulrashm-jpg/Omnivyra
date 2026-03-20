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
    // supabase.auth.getSession() will trigger the code exchange automatically
    // when detectSessionInUrl is true (the default). We just wait for it.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        // Always go to phone verification — never skip to dashboard
        router.replace('/onboarding/verify-phone');
      } else if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) {
        router.replace('/login');
      }
    });

    // Also handle the case where the session is already established
    // (e.g. implicit flow resolves before onAuthStateChange fires)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace('/onboarding/verify-phone');
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

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
