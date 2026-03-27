'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '../../lib/supabaseBrowser';

export default function AuthCallback() {
  const router = useRouter();
  const [statusMsg, setStatusMsg] = useState('Signing you in…');

  useEffect(() => {
    async function handleCallback() {
      const supabase  = getSupabaseBrowser();
      const params    = new URLSearchParams(window.location.search);
      const code      = params.get('code');
      const errorParam = params.get('error');
      const errorDesc  = params.get('error_description');

      if (errorParam) {
        router.replace(`/login?error=${encodeURIComponent(errorDesc ?? errorParam)}`);
        return;
      }

      let accessToken: string | null = null;

      if (code) {
        setStatusMsg('Completing sign-in…');

        const { data, error } = await supabase.auth.exchangeCodeForSession(code);

        if (error || !data.session) {
          router.replace('/login?error=auth_failed');
          return;
        }

        accessToken = data.session.access_token;
      } else {
        // ── Implicit flow: hash fragment (#access_token=…) ──────────────────
        // The SDK processes hash tokens asynchronously, so getSession() may
        // return null if called before initialization completes.
        // Explicitly parse and set the session from the hash to avoid the race.
        const hash = window.location.hash;
        if (hash && hash.includes('access_token')) {
          const hp = new URLSearchParams(hash.substring(1));
          const at = hp.get('access_token');
          const rt = hp.get('refresh_token');
          if (at && rt) {
            // Clear the hash from the URL so it isn't reprocessed on refresh.
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
            const { data, error } = await supabase.auth.setSession({ access_token: at, refresh_token: rt });
            if (error || !data.session) {
              router.replace('/login?error=auth_failed');
              return;
            }
            accessToken = data.session.access_token;
          }
        }

        // No hash tokens — fall back to an existing session (e.g. page refresh).
        if (!accessToken) {
          const { data } = await supabase.auth.getSession();
          accessToken = data.session?.access_token ?? null;
        }
      }

      if (!accessToken) {
        router.replace('/login');
        return;
      }

      // Verify email & get routing decision from backend
      setStatusMsg('Setting up your account…');
      const mode = params.get('mode') ?? '';
      try {
        const verifyRes = await fetch('/api/auth/verify-email', {
          method:  'POST',
          headers: {
            Authorization:  `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ mode }),
        });

        if (verifyRes.status === 401) {
          await supabase.auth.signOut();
          router.replace('/login?error=account_deleted');
          return;
        }

        if (verifyRes.ok) {
          const { route } = await verifyRes.json() as { route: string };
          const dest   = route ?? '/dashboard';
          const pinned = localStorage.getItem('pin_home') === '1';
          setStatusMsg('Redirecting…');
          router.replace(dest === '/dashboard' && pinned ? '/home' : dest);
          return;
        }
      } catch (e) {
        console.error('[auth/callback] verify-email error:', e);
      }

      // verify-email failed — redirect to login
      router.replace('/login?error=auth_failed');
    }

    handleCallback();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-[#F5F9FF] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <svg className="h-8 w-8 animate-spin text-[#0A66C2]" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm text-[#6B7C93]">{statusMsg}</p>
      </div>
    </div>
  );
}
