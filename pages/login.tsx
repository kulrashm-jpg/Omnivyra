'use client';

/**
 * /login
 *
 * Auth flow:
 * 1. User enters email.
 * 2. We check /api/auth/check-user — if not found, show "No account" message.
 * 3. If found: send Supabase magic link → redirect to /onboarding/verify-phone.
 * 4. User clicks link → /onboarding/verify-phone requires phone OTP to grant access.
 */

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../utils/supabaseClient';
import { validateEmailDomain } from '../lib/auth/domainValidation';

type Stage = 'email' | 'sent' | 'not-found';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]     = useState('');
  const [stage, setStage]     = useState<Stage>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Skip login if already authenticated
  const [checkingSession, setCheckingSession] = useState(true);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/dashboard');
      setCheckingSession(false);
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { setError('Please enter your email address.'); return; }

    // Validate domain (for public login flow)
    const domainCheck = validateEmailDomain(trimmed);
    if (!domainCheck.valid) {
      setError((domainCheck as { valid: false; reason: string }).reason);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // ── Step 1: check user exists ───────────────────────────────────────────
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

      // ── Step 2: send magic link → redirect through auth callback ──────────
      // /auth/callback handles the PKCE code exchange then forwards to verify-phone.
      // Never redirect straight to verify-phone — session won't be ready yet.
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error: authErr } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          emailRedirectTo: redirectTo,
          shouldCreateUser: false, // never create new users via login
        },
      });

      if (authErr) {
        setError(authErr.message);
        setLoading(false);
        return;
      }

      setStage('sent');
    } catch {
      setError('Something went wrong. Please try again.');
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
                    Enter your email — we'll send a secure sign-in link.<br />
                    You'll then verify your phone to access your account.
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
                    disabled={loading || checkingSession}
                    className="w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading || checkingSession ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        {checkingSession ? 'Checking session…' : 'Checking…'}
                      </span>
                    ) : 'Send sign-in link'}
                  </button>
                </form>

                {/* Security notice */}
                <div className="mt-6 rounded-2xl border border-[#0A66C2]/15 bg-[#EBF3FD] px-5 py-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0A66C2]/10">
                      <svg className="h-4 w-4 text-[#0A66C2]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-[#0A66C2]">Two-step verification</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-[#6B7C93]">
                        After clicking your email link, you'll verify your phone via SMS. Both steps are required to access your account.
                      </p>
                    </div>
                  </div>
                </div>

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
                  Click it to continue — you'll then verify your phone number to access your account.
                </p>

                {/* Steps reminder */}
                <div className="mx-auto mt-8 max-w-xs space-y-3">
                  {[
                    { step: '1', label: 'Click the link in your email', done: true },
                    { step: '2', label: 'Enter the SMS code sent to your phone', done: false },
                    { step: '3', label: 'Access your dashboard', done: false },
                  ].map((s) => (
                    <div key={s.step} className="flex items-center gap-3 text-left">
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        s.done ? 'bg-emerald-500 text-white' : 'bg-[#0A66C2]/10 text-[#0A66C2]'
                      }`}>
                        {s.done ? '✓' : s.step}
                      </div>
                      <span className="text-sm text-[#0B1F33]">{s.label}</span>
                    </div>
                  ))}
                </div>

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
                    href="/get-free-credits"
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
