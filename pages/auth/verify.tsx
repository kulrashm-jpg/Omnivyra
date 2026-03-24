'use client';

/**
 * /auth/verify
 *
 * Firebase Email Link verification handler.
 * Firebase redirects here after the user clicks the sign-in link in their email.
 *
 * States:
 *   detecting      — initial load; checking whether the URL is a valid sign-in link
 *   email-required — link is valid but no email found in localStorage
 *                    (cross-device open — user must re-enter their email)
 *   verifying      — completing Firebase signInWithEmailLink()
 *   syncing        — writing user to Supabase via syncUserToSupabase()
 *   done           — success; redirecting to next page
 *   error          — something went wrong; actionable message shown
 */

import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { signOut } from 'firebase/auth';
import { getFirebaseAuth } from '../../lib/firebase';
import {
  verifyEmailLink,
  syncUserToSupabase,
  EMAIL_FOR_SIGN_IN_KEY,
} from '../../lib/auth/emailLink';

// sessionStorage key for the email Firebase ID token.
// Downstream pages (profile.tsx, onboarding/complete.ts) read this to
// authenticate as the email-verified Firebase user.
export const EMAIL_FIREBASE_TOKEN_KEY = 'emailFirebaseToken';

type Stage =
  | 'detecting'
  | 'email-required'
  | 'verifying'
  | 'syncing'
  | 'done'
  | 'error';

interface ErrorState {
  title: string;
  message: string;
  /** If true, show a resend-link option */
  canResend: boolean;
}

function classifyFirebaseError(code: string): ErrorState {
  switch (code) {
    case 'auth/expired-action-code':
      return {
        title: 'Link expired',
        message:
          'Your sign-in link has expired. Links are valid for 1 hour — please request a new one.',
        canResend: true,
      };
    case 'auth/invalid-action-code':
      return {
        title: 'Link already used',
        message:
          'This sign-in link has already been used or is invalid. Please request a fresh link.',
        canResend: true,
      };
    case 'auth/user-disabled':
      return {
        title: 'Account disabled',
        message:
          'Your account has been disabled. Please contact support.',
        canResend: false,
      };
    default:
      return {
        title: 'Sign-in failed',
        message:
          'Something went wrong during sign-in. Please try again or request a new link.',
        canResend: true,
      };
  }
}

export default function VerifyPage() {
  const router = useRouter();

  const [stage, setStage]           = useState<Stage>('detecting');
  const [emailInput, setEmailInput]  = useState('');
  const [emailErr, setEmailErr]      = useState<string | null>(null);
  const [errorState, setErrorState]  = useState<ErrorState | null>(null);
  const [loading, setLoading]        = useState(false);

  // Prevent double-execution in React StrictMode / fast-refresh
  const attempted = useRef(false);

  // ── On mount: attempt silent verification ──────────────────────────────────
  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    void attemptVerify();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function attemptVerify(emailOverride?: string) {
    try {
      setStage(emailOverride ? 'verifying' : 'detecting');

      // ── 1. Verify email link ─────────────────────────────────────────────
      let result: Awaited<ReturnType<typeof verifyEmailLink>>;
      try {
        result = await verifyEmailLink(emailOverride);
      } catch (err: any) {
        if (err.message === 'INVALID_LINK') {
          setErrorState({
            title: 'Invalid link',
            message:
              'This link does not appear to be a valid sign-in link. Please return to the login page and try again.',
            canResend: false,
          });
          setStage('error');
          return;
        }
        if (err.message === 'EMAIL_REQUIRED') {
          setStage('email-required');
          return;
        }
        setErrorState(classifyFirebaseError(err.code ?? ''));
        setStage('error');
        return;
      }

      const { user, idToken, isNewUser } = result;

      // ── 2. Store email Firebase ID token for downstream use ──────────────
      // profile.tsx and onboarding/complete.ts read this to authenticate
      // without requiring a Supabase session.
      window.sessionStorage.setItem(EMAIL_FIREBASE_TOKEN_KEY, idToken);

      // ── 3. Sync to Supabase (blocking — user must be in DB before routing) ─
      setStage('syncing');
      try {
        await syncUserToSupabase({ uid: user.uid, email: user.email!, idToken });
      } catch (err: any) {
        console.error('[/auth/verify] Supabase sync error:', err);
        // ACCOUNT_DELETED: user was deleted — force sign out, show clear message
        if (err.message === 'ACCOUNT_DELETED') {
          await signOut(getFirebaseAuth());
          setErrorState({
            title: 'Account not found',
            message: 'Your account no longer exists. Please contact support.',
            canResend: false,
          });
          setStage('error');
          return;
        }
        // Email already registered to a different account (e.g. data conflict)
        if (err.message?.includes('already associated')) {
          setErrorState({
            title: 'Email already in use',
            message:
              'This email address is already registered to a different account. Please contact support if you believe this is an error.',
            canResend: false,
          });
          setStage('error');
          return;
        }
        setErrorState({
          title: 'Sync failed',
          message:
            'We couldn\'t save your account details. Please try signing in again.',
          canResend: true,
        });
        setStage('error');
        return;
      }

      // ── 4. Ask server for routing decision ────────────────────────────────
      let destination = isNewUser ? '/onboarding/phone' : '/dashboard';
      try {
        const routeRes = await fetch('/api/auth/post-login-route', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (routeRes.status === 401) {
          // Account deleted between sync and route check — force sign out.
          await signOut(getFirebaseAuth());
          setErrorState({
            title: 'Account not found',
            message: 'Your account no longer exists. Please contact support or create a new account.',
            canResend: false,
          });
          setStage('error');
          return;
        }
        if (routeRes.ok) {
          const { route } = await routeRes.json() as { route: string };
          if (route) destination = route;
        }
      } catch {
        // Non-fatal: fall back to default route
      }

      // ── 5. Navigate ───────────────────────────────────────────────────────
      setStage('done');
      setTimeout(() => router.replace(destination), 800);
    } catch (err: any) {
      setErrorState(classifyFirebaseError(err.code ?? ''));
      setStage('error');
    }
  }

  // ── Email-required form submission ─────────────────────────────────────────
  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = emailInput.trim().toLowerCase();
    if (!trimmed) {
      setEmailErr('Please enter your email address.');
      return;
    }
    setEmailErr(null);
    setLoading(true);
    window.localStorage.setItem(EMAIL_FOR_SIGN_IN_KEY, trimmed);
    await attemptVerify(trimmed);
    setLoading(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Signing you in… | Omnivyra</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF] flex flex-col">

        {/* Header */}
        <header className="border-b border-gray-100 bg-white/95 backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-lg items-center px-6">
            <Link href="/">
              <img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" />
            </Link>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">

            {/* ── Detecting / Verifying / Syncing ─────────────────────────── */}
            {(stage === 'detecting' || stage === 'verifying' || stage === 'syncing') && (
              <div className="animate-fadeIn flex flex-col items-center gap-5 text-center">
                <svg
                  className="h-10 w-10 animate-spin text-[#0A66C2]"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <div>
                  <p className="text-base font-semibold text-[#0B1F33]">
                    {stage === 'syncing' ? 'Setting up your account…' : 'Verifying your link…'}
                  </p>
                  <p className="mt-1 text-sm text-[#6B7C93]">This will only take a moment.</p>
                </div>
              </div>
            )}

            {/* ── Email required (cross-device) ────────────────────────────── */}
            {stage === 'email-required' && (
              <div className="animate-fadeIn">
                <div className="mb-8 text-center">
                  <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] shadow-lg">
                    <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                    </svg>
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-[#0B1F33]">
                    Confirm your email
                  </h1>
                  <p className="mt-2 text-sm leading-relaxed text-[#6B7C93]">
                    It looks like you opened this link on a different device or browser.
                    Enter the email address you used to request the sign-in link.
                  </p>
                </div>

                <form onSubmit={handleEmailSubmit} className="space-y-4">
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
                      value={emailInput}
                      onChange={e => { setEmailInput(e.target.value); setEmailErr(null); }}
                      placeholder="you@company.com"
                      className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2]"
                    />
                  </div>

                  {emailErr && (
                    <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                      <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                      </svg>
                      <p className="text-sm text-red-600">{emailErr}</p>
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
                        Verifying…
                      </span>
                    ) : 'Continue'}
                  </button>
                </form>
              </div>
            )}

            {/* ── Success ──────────────────────────────────────────────────── */}
            {stage === 'done' && (
              <div className="animate-fadeIn flex flex-col items-center gap-5 text-center">
                <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50">
                  <svg className="h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
                <div>
                  <p className="text-lg font-bold text-[#0B1F33]">Signed in successfully</p>
                  <p className="mt-1 text-sm text-[#6B7C93]">Taking you to your dashboard…</p>
                </div>
              </div>
            )}

            {/* ── Error ────────────────────────────────────────────────────── */}
            {stage === 'error' && errorState && (
              <div className="animate-fadeIn text-center">
                <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
                  <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-[#0B1F33]">
                  {errorState.title}
                </h2>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[#6B7C93]">
                  {errorState.message}
                </p>

                <div className="mt-8 space-y-3">
                  {errorState.canResend && (
                    <Link
                      href="/login"
                      className="block w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3.5 text-center text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95"
                    >
                      Request a new sign-in link
                    </Link>
                  )}
                  <Link
                    href="/login"
                    className="block w-full rounded-full border border-gray-200 px-6 py-3 text-center text-sm font-medium text-[#0B1F33] transition hover:border-[#0A66C2] hover:text-[#0A66C2]"
                  >
                    Back to sign in
                  </Link>
                </div>
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
