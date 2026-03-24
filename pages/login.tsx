'use client';

/**
 * /login
 *
 * Auth flow:
 * 1. User enters email.
 * 2. We check /api/auth/check-user — if not found, show "No account" message.
 * 3. If found: send Firebase Email Link → user clicks → /auth/verify handles it.
 */

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { validateEmailDomain } from '../lib/auth/domainValidation';
import { sendEmailLink, getCurrentFirebaseUser } from '../lib/auth/emailLink';

type Stage = 'email' | 'sent' | 'not-found';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]     = useState('');
  const [stage, setStage]     = useState<Stage>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Skip login if already authenticated (Firebase only)
  const [checkingSession, setCheckingSession] = useState(true);
  useEffect(() => {
    getCurrentFirebaseUser()
      .then((fbUser) => {
        if (fbUser) { router.replace('/dashboard'); return; }
        setCheckingSession(false);
      })
      .catch(() => setCheckingSession(false));
  }, [router]);

  // Prevent flicker while session is being resolved
  if (checkingSession) return <div className="min-h-screen bg-[#F5F9FF]" />;

  const { reason } = router.query;
  const showExpiredBanner = reason === 'expired';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { setError('Please enter your email address.'); return; }

    // Validate domain
    const domainCheck = validateEmailDomain(trimmed);
    if (!domainCheck.valid) {
      setError((domainCheck as { valid: false; reason: string }).reason);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // ── Step 1: check user exists ─────────────────────────────────────────
      const checkRes = await fetch('/api/auth/check-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const { exists } = await checkRes.json() as { exists: boolean };

      if (!exists) {
        setStage('not-found');
        setLoading(false);
        return;
      }

      // ── Step 2: send Firebase Email Link ─────────────────────────────────
      await sendEmailLink(trimmed);
      setStage('sent');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>Log in | Omnivyra</title>
        <meta name="description" content="Log in to Omnivyra — marketing clarity, control, and direction." />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF] flex flex-col">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="border-b border-gray-100 bg-white/95 backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-6">
            <Link href="/">
              <img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" />
            </Link>
            <Link
              href="/get-free-credits"
              className="text-sm text-[#6B7C93] hover:text-[#0A66C2] transition-colors"
            >
              No account? Start free →
            </Link>
          </div>
        </header>

        {/* ── Main ───────────────────────────────────────────────────────── */}
        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">

            {/* ── Expired-link banner ───────────────────────────────────── */}
            {showExpiredBanner && stage === 'email' && (
              <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                <p className="text-sm text-amber-800">
                  Your sign-in link has expired or was opened in a different browser.
                  Please request a new one below.
                </p>
              </div>
            )}

            {/* ── Stage: email entry ─────────────────────────────────────── */}
            {stage === 'email' && (
              <div className="animate-fadeIn">
                <div className="mb-8 text-center">
                  <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] shadow-lg">
                    <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                    </svg>
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-[#0B1F33]">
                    Welcome back
                  </h1>
                  <p className="mt-2 text-sm leading-relaxed text-[#6B7C93]">
                    Enter your email — we'll send a secure sign-in link.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-[#0B1F33] mb-1.5">
                      Email address
                    </label>
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      autoFocus
                      required
                      value={email}
                      onChange={e => { setEmail(e.target.value); setError(null); }}
                      placeholder="you@company.com"
                      className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2]"
                    />
                  </div>

                  {error && (
                    <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                      <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                      </svg>
                      <p className="text-sm text-red-600">{error}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Sending…
                      </span>
                    ) : 'Send sign-in link'}
                  </button>
                </form>

                <p className="mt-6 text-center text-xs text-[#6B7C93]">
                  Don't have an account?{' '}
                  <Link href="/get-free-credits" className="font-semibold text-[#0A66C2] hover:underline">
                    Get free credits
                  </Link>
                </p>
              </div>
            )}

            {/* ── Stage: email sent ─────────────────────────────────────── */}
            {stage === 'sent' && (
              <div className="animate-fadeIn text-center">
                <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-3xl">
                  📬
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-[#0B1F33]">
                  Check your inbox
                </h2>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[#6B7C93]">
                  We sent a sign-in link to{' '}
                  <strong className="text-[#0B1F33]">{email}</strong>.
                  Click it from the same browser to sign in.
                </p>

                <p className="mt-8 text-xs text-[#6B7C93]">
                  Wrong email?{' '}
                  <button
                    onClick={() => { setStage('email'); setError(null); }}
                    className="text-[#0A66C2] hover:underline"
                  >
                    Try a different one
                  </button>
                </p>
              </div>
            )}

            {/* ── Stage: no account found ───────────────────────────────── */}
            {stage === 'not-found' && (
              <div className="animate-fadeIn text-center">
                <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-3xl">
                  🔍
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-[#0B1F33]">
                  No account found
                </h2>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[#6B7C93]">
                  We couldn't find an account for{' '}
                  <strong className="text-[#0B1F33]">{email}</strong>.
                  You'll need to create an account first.
                </p>

                <div className="mt-8 space-y-3">
                  <Link
                    href={`/create-account?email=${encodeURIComponent(email)}`}
                    className="block w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3.5 text-center text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95"
                  >
                    Create account — it's free
                  </Link>
                  <button
                    onClick={() => { setStage('email'); setError(null); }}
                    className="w-full rounded-full border border-gray-200 px-6 py-3 text-sm font-medium text-[#0B1F33] transition hover:border-[#0A66C2] hover:text-[#0A66C2]"
                  >
                    Try a different email
                  </button>
                </div>

                <p className="mt-6 text-xs text-[#6B7C93]">
                  Start with 300 free credits — no card required.
                </p>
              </div>
            )}

          </div>
        </main>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.25s ease both; }
      `}</style>
    </>
  );
}
