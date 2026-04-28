'use client';

/**
 * /auth/verify
 *
 * Universal landing page for Supabase auth links (magic-link, invite, recovery).
 * Supabase can deliver tokens in two ways depending on project PKCE settings:
 *
 *   PKCE flow  — query param: ?code=xxx  → forward to /auth/callback?code=xxx
 *   Implicit   — hash fragment: #access_token=xxx&type=magiclink
 *                → forward to /auth/callback preserving the hash so the
 *                  SDK can consume it there
 *
 * If neither is present the link is expired/invalid → /login with error.
 */

import { useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

export default function VerifyPage() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;

    const { code } = router.query as Record<string, string>;

    // ── PKCE flow: code in query string ──────────────────────────────────────
    if (code) {
      router.replace(`/auth/callback?code=${encodeURIComponent(code)}`);
      return;
    }

    // ── Implicit flow: tokens in hash fragment ────────────────────────────────
    // window.location.hash is not available server-side; guard with typeof.
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (hash && hash.includes('access_token')) {
      // Forward to /auth/callback keeping the hash so the Supabase SDK can
      // exchange it there instead of silently consuming it here.
      window.location.replace('/auth/callback' + hash);
      return;
    }

    // ── Nothing usable — expired or invalid link ──────────────────────────────
    router.replace('/login?error=link_expired');
  }, [router.isReady]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Head>
        <title>Redirecting… | Omnivyra</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="min-h-screen bg-[#F5F9FF] flex items-center justify-center">
        <svg className="h-10 w-10 animate-spin text-[#0A66C2]" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    </>
  );
}
