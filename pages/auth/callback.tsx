import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '../../lib/supabaseBrowser';
import { apiFetch } from '../../lib/apiFetch';
import { clearBrowserAuthState } from '../../utils/authStorage';
import { assertCallbackIdentitySource } from '../../utils/authIntegrityGuards';

const AUTH_FLOW_SESSION_MARKER = 'auth_flow_session_established_v1';

async function clearServerAuthSession(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch { /* ignore */ }
}

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
      const params    = new URLSearchParams(window.location.search);
      const code      = params.get('code');
      // Prefetch-resistant magic-link path: the email links straight here with
      // ?token_hash=…&type=magiclink and the token is only consumed when this
      // JS runs verifyOtp — a mail scanner's plain GET can't burn it.
      const tokenHash = params.get('token_hash');
      const otpType   = params.get('type');
      const errorParam = params.get('error');
      const hash = window.location.hash;
      const hashParams = hash ? new URLSearchParams(hash.substring(1)) : null;
      const hashError = hashParams?.get('error');
      const hasHashToken = Boolean(hash && hash.includes('access_token'));

      if (errorParam || hashError) {
        await clearServerAuthSession();
        clearBrowserAuthState({ preservePkce: false });
        router.replace('/login?error=verification_invalid_or_expired');
        return;
      }

      if (!code && !hasHashToken && !tokenHash) {
        await clearServerAuthSession();
        clearBrowserAuthState({ preservePkce: false });
        router.replace('/login?error=verification_invalid_or_expired');
        return;
      }

      clearBrowserAuthState({ preservePkce: Boolean(code) });
      const supabase  = getSupabaseBrowser();
      let accessToken: string | null = null;
      let verifiedUserId: string | null = null;
      let establishedFromVerificationFlow = false;

      if (tokenHash) {
        setStatusMsg('Completing sign-in…');

        const { data, error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          // 'signup' + 'email' cover the prefetch-resistant email-confirmation
          // link (…/auth/callback?token_hash=…&type=signup): the token is only
          // consumed here when this JS runs verifyOtp, so a corporate mail
          // scanner's plain GET can't burn it. 'magiclink'/'recovery'/'invite'
          // remain for their respective flows.
          type: (otpType || 'magiclink') as 'magiclink' | 'email' | 'recovery' | 'invite' | 'signup',
        });

        const user = data.session?.user;
        if (error || !data.session || !user?.id || !user.email) {
          console.error('[auth/callback] verifyOtp failed', error?.message);
          await clearServerAuthSession();
          clearBrowserAuthState({ preservePkce: false });
          router.replace('/login?error=verification_invalid_or_expired');
          return;
        }

        accessToken = data.session.access_token;
        verifiedUserId = user.id;
        establishedFromVerificationFlow = true;
      } else if (code) {
        setStatusMsg('Completing sign-in…');

        const { data, error } = await supabase.auth.exchangeCodeForSession(code);

        const user = data.session?.user;
        if (error || !data.session || !user?.id || !user.email) {
          await clearServerAuthSession();
          clearBrowserAuthState({ preservePkce: false });
          router.replace('/login?error=verification_invalid_or_expired');
          return;
        }

        accessToken = data.session.access_token;
        verifiedUserId = user.id;
        establishedFromVerificationFlow = true;
      } else {
        // ── Implicit flow: hash fragment (#access_token=…) ──────────────────
        // The SDK processes hash tokens asynchronously, so getSession() may
        // return null if called before initialization completes.
        // Explicitly parse and set the session from the hash to avoid the race.
        if (hasHashToken) {
          const hp = new URLSearchParams(hash.substring(1));
          const at = hp.get('access_token');
          const rt = hp.get('refresh_token');
          if (at && rt) {
            // Clear the hash from the URL so it isn't reprocessed on refresh.
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
            const { data, error } = await supabase.auth.setSession({ access_token: at, refresh_token: rt });
            const user = data.session?.user;
            if (error || !data.session || !user?.id || !user.email) {
              await clearServerAuthSession();
              clearBrowserAuthState({ preservePkce: false });
              router.replace('/login?error=verification_invalid_or_expired');
              return;
            }
            accessToken = data.session.access_token;
            verifiedUserId = user.id;
            establishedFromVerificationFlow = true;
          }
        }

        // No usable hash tokens: fail closed instead of restoring persisted state.
        if (!accessToken) {
          await clearServerAuthSession();
          clearBrowserAuthState({ preservePkce: false });
          router.replace('/login?error=verification_invalid_or_expired');
          return;
        }
      }

      if (!accessToken || !establishedFromVerificationFlow) {
        await clearServerAuthSession();
        clearBrowserAuthState({ preservePkce: false });
        router.replace('/login?error=verification_invalid_or_expired');
        return;
      }
      assertCallbackIdentitySource({
        hasVerificationToken: Boolean(code || hasHashToken),
        accessToken,
        userId: verifiedUserId,
      });
      try {
        window.sessionStorage.setItem(AUTH_FLOW_SESSION_MARKER, '1');
      } catch { /* ignore */ }

      setStatusMsg('Syncing your account…');
      const mode = params.get('mode') ?? '';
      // apiFetch attaches Bearer via the canonical browser singleton, which
      // already holds the session we just established above with
      // verifyOtp / exchangeCodeForSession / setSession.
      const jsonHeaders = { 'Content-Type': 'application/json' };

      try {
        const syncRes = await apiFetch('/api/auth/sync-supabase-user', {
          method: 'POST',
          headers: jsonHeaders,
        });

        if (syncRes.status === 403) {
          await supabase.auth.signOut();
          await clearServerAuthSession();
          clearBrowserAuthState({ preservePkce: false });
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
        let syncJson: {
          domain_verification?: { token: string; final_domain: string };
          mfa_required?: true;
          factors?: ReadonlyArray<'totp' | 'webauthn'>;
        } = {};
        try {
          syncJson = await syncRes.clone().json().catch(() => ({}));
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

        // ── MFA-required branch ──────────────────────────────────────────
        // The server has issued a short-lived mfa_intent cookie. We must
        // NOT call verify-email or post-login-route here — neither
        // endpoint will work without an auth_session, and the session
        // cannot exist until the MFA challenge passes. Route the user
        // straight to the challenge page; on success, /auth/mfa will mint
        // the session and continue the flow itself.
        if (syncJson.mfa_required === true) {
          setStatusMsg('One more step — confirm with your authenticator.');
          const factorParam = (syncJson.factors ?? []).join(',');
          const next = factorParam
            ? `/auth/mfa?factors=${encodeURIComponent(factorParam)}`
            : '/auth/mfa';
          router.replace(next);
          return;
        }

        setStatusMsg('Verifying your account…');
        const verifyRes = await apiFetch('/api/auth/verify-email', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({ mode }),
        });

        if (verifyRes.status === 403) {
          await supabase.auth.signOut();
          await clearServerAuthSession();
          clearBrowserAuthState({ preservePkce: false });
          router.replace('/login?error=account_deleted');
          return;
        }

        if (verifyRes.status === 401) {
          await supabase.auth.signOut();
          await clearServerAuthSession();
          clearBrowserAuthState({ preservePkce: false });
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
          await clearServerAuthSession();
          clearBrowserAuthState({ preservePkce: false });
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
        const routeRes = await apiFetch('/api/auth/post-login-route', {
          method: 'GET',
          headers: jsonHeaders,
        });

        if (routeRes.status === 403) {
          await supabase.auth.signOut();
          await clearServerAuthSession();
          clearBrowserAuthState({ preservePkce: false });
          router.replace('/login?error=account_deleted');
          return;
        }

        if (routeRes.status === 401) {
          await supabase.auth.signOut();
          await clearServerAuthSession();
          clearBrowserAuthState({ preservePkce: false });
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

      await clearServerAuthSession();
      clearBrowserAuthState({ preservePkce: false });
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
