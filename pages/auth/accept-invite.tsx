'use client';

/**
 * /auth/accept-invite?token=xxx
 *
 * Landing page for team invitation links.
 * Flow:
 *   1. Extract token from query string
 *   2. POST /api/auth/accept-invite → get { email }
 *   3. Call signInWithOtp(email) → user clicks magic link → /auth/callback
 */

import { useEffect, useState, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '../../lib/supabaseBrowser';

type Stage = 'validating' | 'sending' | 'sent' | 'error';

export default function AcceptInvitePage() {
  const router = useRouter();
  const [stage, setStage]   = useState<Stage>('validating');
  const [email, setEmail]   = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const attempted = useRef(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    if (attempted.current) return;
    if (!router.isReady) return;
    attempted.current = true;

    const token = router.query.token as string;
    if (!token) {
      setErrorMsg('No invitation token provided.');
      setStage('error');
      return;
    }

    handleAcceptInvite(token);
  }, [router.isReady, router.query.token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAcceptInvite(token: string) {
    setStage('validating');

    // Step 1: Validate token with backend
    let inviteEmail: string;
    try {
      const res = await fetch('/api/auth/accept-invite', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error ?? 'Invalid invitation.');
        setStage('error');
        return;
      }
      inviteEmail = json.email;
    } catch {
      setErrorMsg('Network error. Please try again.');
      setStage('error');
      return;
    }

    setEmail(inviteEmail);
    setStage('sending');

    // Step 2: Send magic link to the invited email
    const { error: otpErr } = await getSupabaseBrowser().auth.signInWithOtp({
      email: inviteEmail,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });

    if (otpErr) {
      setErrorMsg(otpErr.message);
      setStage('error');
      return;
    }

    setStage('sent');
  }

  return (
    <>
      <Head>
        <title>Accept Invitation | Omnivyra</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF] flex flex-col">
        <header className="border-b border-gray-100 bg-white/95 backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-lg items-center px-6">
            <Link href="/"><img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" /></Link>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">

            {/* Validating */}
            {stage === 'validating' && (
              <div className="animate-fadeIn flex flex-col items-center gap-5 text-center">
                <svg className="h-10 w-10 animate-spin text-[#0A66C2]" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-base font-semibold text-[#0B1F33]">Validating your invitation…</p>
              </div>
            )}

            {/* Sending OTP */}
            {stage === 'sending' && (
              <div className="animate-fadeIn flex flex-col items-center gap-5 text-center">
                <svg className="h-10 w-10 animate-spin text-[#0A66C2]" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-base font-semibold text-[#0B1F33]">Sending sign-in link…</p>
              </div>
            )}

            {/* Sent */}
            {stage === 'sent' && (
              <div className="animate-fadeIn text-center">
                <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-3xl">📬</div>
                <h2 className="text-2xl font-bold text-[#0B1F33]">Check your inbox</h2>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[#6B7C93]">
                  We sent a sign-in link to <strong className="text-[#0B1F33]">{email}</strong>.
                  Click it to join your team.
                </p>
                <p className="mt-4 text-xs text-[#6B7C93]">
                  After signing in, you&apos;ll be asked to set a password and complete your profile.
                </p>
              </div>
            )}

            {/* Error */}
            {stage === 'error' && (
              <div className="animate-fadeIn text-center">
                <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
                  <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-[#0B1F33]">Invitation invalid</h2>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[#6B7C93]">{errorMsg}</p>
                <div className="mt-8 flex flex-col items-center gap-3">
                  <Link href="/create-account"
                    className="rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95">
                    Create a new account
                  </Link>
                  <Link href="/login" className="text-sm text-[#6B7C93] hover:text-[#0A66C2]">
                    Or sign in
                  </Link>
                </div>
              </div>
            )}

          </div>
        </main>
      </div>

      <style jsx>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .animate-fadeIn { animation: fadeIn 0.22s ease both; }
      `}</style>
    </>
  );
}
