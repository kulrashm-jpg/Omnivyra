import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '../../lib/supabaseBrowser';

export default function AuthCallback() {
  const router = useRouter();
  const [statusMsg, setStatusMsg] = useState('Signing you in…');
  // Guard against React strict-mode (and HMR-triggered) double-fire of
  // the useEffect below. Without this, exchangeCodeForSession runs twice
  // — the second call fails with "code already used" and the catch
  // block redirects to /login?error=auth_failed. Tracking the call in
  // a ref (instead of state) ensures the second invocation sees the
  // flag synchronously even before the first invocation finishes.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

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

      setStatusMsg('Syncing your account…');
      const mode = params.get('mode') ?? '';
      const authHeaders = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      };

      try {
        const syncRes = await fetch('/api/auth/sync-supabase-user', {
          method: 'POST',
          headers: authHeaders,
        });

        if (syncRes.status === 403) {
          await supabase.auth.signOut();
          router.replace('/login?error=account_deleted');
          return;
        }

        if (!syncRes.ok) {
          throw new Error('sync_failed');
        }

        // Capture the one-time domain verification token (if present) into
        // sessionStorage so /onboarding/domain-verification can display it.
        // The DB stores HMAC(token); this is the only window to surface the
        // raw value to the client.
        try {
          const syncJson = await syncRes.clone().json().catch(() => ({})) as {
            domain_verification?: { token: string; final_domain: string };
          };
          if (syncJson.domain_verification?.token) {
            window.sessionStorage.setItem(
              'domain_verification_token_v1',
              JSON.stringify({
                token:        syncJson.domain_verification.token,
                final_domain: syncJson.domain_verification.final_domain,
              }),
            );
          }
        } catch {
          /* non-fatal — verification UI will degrade gracefully */
        }

        setStatusMsg('Verifying your account…');
        const verifyRes = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ mode }),
        });

        if (verifyRes.status === 403) {
          await supabase.auth.signOut();
          router.replace('/login?error=account_deleted');
          return;
        }

        if (verifyRes.status === 401) {
          await supabase.auth.signOut();
          router.replace('/login?error=invalid_session');
          return;
        }

        if (!verifyRes.ok) {
          throw new Error('verify_failed');
        }

        const verifyJson = await verifyRes.json().catch(() => ({})) as {
          route?: string;
          requiresLogin?: boolean;
          email?: string | null;
        };
        const verifyRoute = verifyJson.route;

        // First-time email verification on a password signup: sign the user
        // back out and bounce them to /login with a "verified" banner instead
        // of silently dropping them into onboarding. Matches user expectation
        // that clicking a verification link confirms the email and prompts a
        // proper sign-in.
        if (verifyJson.requiresLogin) {
          setStatusMsg('Email verified! Redirecting to sign in…');
          await supabase.auth.signOut();
          const emailParam = verifyJson.email
            ? `&email=${encodeURIComponent(verifyJson.email)}`
            : '';
          router.replace(`/login?verified=signup${emailParam}`);
          return;
        }

        if (verifyRoute && verifyRoute !== '/dashboard') {
          setStatusMsg('Redirecting…');
          router.replace(verifyRoute);
          return;
        }

        setStatusMsg('Loading your workspace…');
        const routeRes = await fetch('/api/auth/post-login-route', {
          method: 'GET',
          headers: authHeaders,
        });

        if (routeRes.status === 403) {
          await supabase.auth.signOut();
          router.replace('/login?error=account_deleted');
          return;
        }

        if (routeRes.status === 401) {
          await supabase.auth.signOut();
          router.replace('/login?error=invalid_session');
          return;
        }

        if (!routeRes.ok) {
          throw new Error('route_failed');
        }

        const { route } = await routeRes.json() as { route: string };
        const dest = route ?? '/command-center';
        const pinned = localStorage.getItem('pin_home') === 'true';
        setStatusMsg('Redirecting…');
        router.replace(dest === '/command-center' && pinned ? '/home' : dest);
        return;
      } catch (e) {
        console.error('[auth/callback] auth bootstrap error:', e);
      }

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
