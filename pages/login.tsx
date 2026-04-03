'use client';

/**
 * /login
 *
 * Two sign-in methods:
 *   1. Email + password  (for users who set a password during sign-up)
 *   2. Magic link        (passwordless — sends OTP, straight to dashboard/onboarding)
 *
 * Forgot password → sends reset link → /auth/set-password → back here.
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '../lib/supabaseBrowser';

type Mode = 'password' | 'forgot' | 'magic-link';

export default function LoginPage() {
  const router = useRouter();
  const { reason, error: errorParam, verified, email: emailParam } = router.query as Record<string, string>;

  const [checking, setChecking] = useState(true); // true while session check is in-flight
  const [mode, setMode]         = useState<Mode>('password');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState<string | null>(null); // 'password' | 'magic' | 'forgot'
  const [error, setError]       = useState<string | null>(
    errorParam === 'account_deleted' ? 'This account has been removed.' :
    errorParam === 'auth_failed'     ? 'Sign-in failed. Please try again.' :
    null,
  );
  const [resetSent,    setResetSent]    = useState(false);
  const [magicSent,    setMagicSent]    = useState(false);
  const [noAccount,    setNoAccount]    = useState(false);

  useEffect(() => {
    if (emailParam && !email) setEmail(emailParam);
  }, [emailParam]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // getSession() reads from localStorage — no network request, resolves immediately.
    // Keep checking=true until we know the user is NOT logged in so the login form
    // is never briefly visible before a redirect fires.
    getSupabaseBrowser().auth.getSession().then(({ data }) => {
      if (data.session) {
        const pinned = localStorage.getItem('pin_home') === 'true';
        router.replace(pinned ? '/home' : '/command-center');
      } else {
        setChecking(false);
      }
    });
  }, [router]);

  // Render nothing while the session check is in-flight
  if (checking) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  // ── Method 1: email + password ──────────────────────────────────────────
  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading('password');
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.code === 'NO_PASSWORD'
          ? 'No password set. Use "Send me a magic link" below to sign in.'
          : json.error ?? 'Sign-in failed.');
        setLoading(null);
        return;
      }
    } catch {
      setError('Network error. Please try again.');
      setLoading(null);
      return;
    }

    const { data, error: signInErr } = await getSupabaseBrowser().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (signInErr) {
      setError(
        signInErr.message.toLowerCase().includes('invalid login')
          ? 'Incorrect email or password.'
          : signInErr.message,
      );
      setLoading(null);
      return;
    }

    if (data.session) router.replace('/auth/callback');
    setLoading(null);
  }

  // ── Method 2: magic link ────────────────────────────────────────────────
  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { setError('Enter your email address.'); return; }
    setLoading('magic');
    setError(null);

    // Verify account exists before sending OTP — prevents magic links going to unknown emails
    try {
      const check = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const checkJson = await check.json();
      if (!check.ok) {
        setLoading(null);
        if (checkJson.code === 'INVALID_CREDENTIALS') {
          setNoAccount(true);
        } else {
          setError(checkJson.error ?? 'Unable to send link. Please try again.');
        }
        return;
      }
    } catch {
      setLoading(null);
      setError('Network error. Please try again.');
      return;
    }

    const { error: otpErr } = await getSupabaseBrowser().auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo:  `${origin}/auth/callback?mode=passwordless`,
        shouldCreateUser: false, // login only — don't create new accounts
      },
    });

    setLoading(null);
    if (otpErr) { setError(otpErr.message); return; }
    setMagicSent(true);
  }

  // ── Forgot password ──────────────────────────────────────────────────────
  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { setError('Enter your work email.'); return; }
    setLoading('forgot');
    setError(null);

    const { error: resetErr } = await getSupabaseBrowser().auth.resetPasswordForEmail(trimmed, {
      redirectTo: `${origin}/auth/set-password`,
    });

    setLoading(null);
    if (resetErr) { setError(resetErr.message); return; }
    setResetSent(true);
  }

  // ── Magic link sent confirmation ─────────────────────────────────────────
  if (magicSent) {
    return (
      <>
        <Head><title>Check your inbox | Omnivyra</title></Head>
        <div className="min-h-screen bg-[#F5F9FF] flex flex-col">
          <header className="border-b border-gray-100 bg-white/95">
            <div className="mx-auto flex h-14 max-w-lg items-center px-6">
              <Link href="/"><img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" /></Link>
            </div>
          </header>
          <main className="flex flex-1 items-center justify-center px-6 py-12">
            <div className="w-full max-w-md text-center animate-fadeIn">
              <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-3xl">📬</div>
              <h2 className="text-2xl font-bold text-[#0B1F33]">Check your inbox</h2>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[#6B7C93]">
                We sent a magic link to <strong className="text-[#0B1F33]">{email}</strong>.
                Click it to sign in — no password needed.
              </p>
              <button onClick={() => { setMagicSent(false); setError(null); }}
                className="mt-6 text-sm text-[#0A66C2] hover:underline">
                Try a different email
              </button>
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

  return (
    <>
      <Head>
        <title>Log in | Omnivyra</title>
        <meta name="description" content="Log in to Omnivyra." />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF] flex flex-col">
        <header className="border-b border-gray-100 bg-white/95 backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-6">
            <Link href="/"><img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" /></Link>
            <Link href="/create-account" className="text-sm text-[#6B7C93] hover:text-[#0A66C2] transition-colors">
              No account? Create one →
            </Link>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">

            {/* ── Banners ── */}
            {reason === 'account_exists' && (
              <div className="mb-6 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                <svg className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
                <p className="text-sm text-blue-800">You already have an account. Sign in below.</p>
              </div>
            )}
            {verified === '1' && (
              <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <svg className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
                <p className="text-sm text-emerald-800">Password set! Sign in to continue.</p>
              </div>
            )}
            {reason === 'expired' && (
              <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                <p className="text-sm text-amber-800">Your session has expired. Please sign in again.</p>
              </div>
            )}

            {/* ── Header ── */}
            <div className="mb-8 text-center">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] shadow-lg">
                <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-[#0B1F33]">
                {mode === 'forgot' ? 'Reset your password' : 'Welcome back'}
              </h1>
              <p className="mt-2 text-sm text-[#6B7C93]">
                {mode === 'forgot'
                  ? 'Enter your work email and we\'ll send you a reset link.'
                  : 'Sign in to your Omnivyra account.'}
              </p>
            </div>

            {/* ── Password sign-in ── */}
            {mode === 'password' && (
              <>
                {/* Shared email */}
                <div className="mb-4">
                  <label htmlFor="email" className="block text-sm font-medium text-[#0B1F33] mb-1.5">Work email</label>
                  <input id="email" type="email" autoComplete="email" autoFocus required
                    value={email} onChange={e => { setEmail(e.target.value); setError(null); setNoAccount(false); }}
                    placeholder="you@company.com"
                    className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2]" />
                </div>

                {/* Password form */}
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label htmlFor="password" className="text-sm font-medium text-[#0B1F33]">Password</label>
                      <button type="button" onClick={() => { setMode('forgot'); setError(null); setResetSent(false); }}
                        className="text-xs text-[#0A66C2] hover:underline">
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <input id="password" type={showPw ? 'text' : 'password'} autoComplete="current-password" required
                        value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password"
                        className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 pr-10 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2]" />
                      <button type="button" onClick={() => setShowPw(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7C93] hover:text-[#0A66C2]">
                        {showPw ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                  </div>
                  {error && <ErrorBox message={error} />}
                  <button type="submit" disabled={!!loading}
                    className="w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed">
                    {loading === 'password' ? <Spinner label="Signing in…" /> : 'Sign in'}
                  </button>
                </form>

                {/* Divider */}
                <div className="my-4 flex items-center gap-3">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-xs text-[#6B7C93]">or</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>

                {/* Magic link login */}
                <form onSubmit={handleMagicLink}>
                  <button type="submit" disabled={!!loading}
                    className="w-full rounded-full border-2 border-[#0A66C2] bg-white px-6 py-3.5 text-sm font-semibold text-[#0A66C2] transition hover:bg-[#EBF3FD] disabled:opacity-50 disabled:cursor-not-allowed">
                    {loading === 'magic' ? <Spinner label="Sending…" color="blue" /> : 'Send me a magic link'}
                  </button>
                </form>
                {noAccount && (
                  <div className="mt-3 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <span className="mt-0.5 text-amber-500">⚠</span>
                    <p className="text-sm text-amber-800">
                      No account found.{' '}
                      <Link href="/create-account" className="font-semibold underline">
                        Create a free account →
                      </Link>
                    </p>
                  </div>
                )}
                <p className="mt-2 text-center text-xs text-[#6B7C93]">
                  No password? Sign in with a one-time link sent to your email.
                </p>
              </>
            )}

            {/* ── Forgot password ── */}
            {mode === 'forgot' && (
              resetSent ? (
                <div className="text-center animate-fadeIn">
                  <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-3xl">📬</div>
                  <h2 className="text-2xl font-bold text-[#0B1F33]">Check your inbox</h2>
                  <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[#6B7C93]">
                    We sent a password reset link to <strong className="text-[#0B1F33]">{email}</strong>.
                  </p>
                  <button onClick={() => { setMode('password'); setResetSent(false); setError(null); }}
                    className="mt-6 text-sm text-[#0A66C2] hover:underline">
                    Back to sign in
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4 animate-fadeIn">
                  <div>
                    <label htmlFor="email-forgot" className="block text-sm font-medium text-[#0B1F33] mb-1.5">Work email</label>
                    <input id="email-forgot" type="email" autoComplete="email" autoFocus required
                      value={email} onChange={e => { setEmail(e.target.value); setError(null); }}
                      placeholder="you@company.com"
                      className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2]" />
                  </div>
                  {error && <ErrorBox message={error} />}
                  <button type="submit" disabled={!!loading}
                    className="w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed">
                    {loading === 'forgot' ? 'Sending…' : 'Send reset link'}
                  </button>
                  <button type="button" onClick={() => { setMode('password'); setError(null); }}
                    className="w-full text-center text-xs text-[#6B7C93] hover:text-[#0A66C2]">
                    Back to sign in
                  </button>
                </form>
              )
            )}

            <p className="mt-6 text-center text-xs text-[#6B7C93]">
              Don&apos;t have an account?{' '}
              <Link href="/create-account" className="font-semibold text-[#0A66C2] hover:underline">
                Create one free
              </Link>
            </p>

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

function ErrorBox({ message }: { message: string }) {
  return <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{message}</p>;
}
function Spinner({ label, color = 'white' }: { label: string; color?: string }) {
  return (
    <span className="flex items-center justify-center gap-2">
      <svg className={`h-4 w-4 animate-spin text-${color}`} viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {label}
    </span>
  );
}
function EyeIcon() {
  return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>;
}
function EyeOffIcon() {
  return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>;
}
