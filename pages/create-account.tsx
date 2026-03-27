'use client';

/**
 * /create-account
 *
 * Single signup method: work email → magic link → /auth/set-password → onboarding.
 * User sets a password during signup. Future logins: email + password OR magic link.
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '../lib/supabaseBrowser';
import { validateEmailDomain } from '../lib/auth/domainValidation';

export default function CreateAccountPage() {
  const router = useRouter();
  const { email: emailParam = '' } = router.query as Record<string, string>;

  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [sent, setSent]       = useState(false);

  useEffect(() => {
    if (emailParam) setEmail(emailParam);
  }, [emailParam]);

  // Store referral code from ?ref= so onboarding can pick it up
  useEffect(() => {
    const ref = router.query.ref as string | undefined;
    if (ref) {
      try { localStorage.setItem('ref_code', ref); } catch { /* ignore */ }
    }
  }, [router.query.ref]);

  useEffect(() => {
    getSupabaseBrowser().auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/dashboard');
    });
  }, [router]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  function validateEmail(val: string): boolean {
    const check = validateEmailDomain(val);
    if (!check.valid) {
      setError((check as { valid: false; reason: string }).reason);
      return false;
    }
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!validateEmail(trimmed)) return;
    setLoading(true);
    setError(null);

    // Check if account already exists
    try {
      const res  = await fetch('/api/auth/signup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.code === 'ACCOUNT_EXISTS') {
          router.replace(`/login?email=${encodeURIComponent(trimmed)}&reason=account_exists`);
          return;
        }
        setError(json.error ?? 'Signup failed');
        setLoading(false);
        return;
      }
    } catch {
      setError('Network error. Please try again.');
      setLoading(false);
      return;
    }

    // Send magic link → /auth/callback → /auth/set-password
    const { error: otpErr } = await getSupabaseBrowser().auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });

    setLoading(false);
    if (otpErr) { setError(otpErr.message); return; }
    setSent(true);
  }

  // ── Sent confirmation ─────────────────────────────────────────────────────
  if (sent) {
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
                We sent an account creation link to <strong className="text-[#0B1F33]">{email}</strong>.
                Click it to set your password, then sign in to get started.
              </p>
              <button onClick={() => { setSent(false); setError(null); }}
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

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Create Account | Omnivyra</title>
        <meta name="description" content="Create your free Omnivyra account." />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF] flex flex-col">
        <header className="border-b border-gray-100 bg-white/95">
          <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-6">
            <Link href="/"><img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" /></Link>
            <Link href="/login" className="text-sm text-[#6B7C93] hover:text-[#0A66C2] transition-colors">Log in</Link>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">

            <div className="mb-8 text-center">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] text-2xl shadow-lg">🎁</div>
              <h1 className="text-2xl font-bold tracking-tight text-[#0B1F33]">Create your account</h1>
              <p className="mt-2 text-sm text-[#6B7C93]">Start with 300 free credits — no card required.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-[#0B1F33] mb-1.5">Work email</label>
                <input
                  id="email" type="email" autoComplete="email" autoFocus required
                  value={email} onChange={e => { setEmail(e.target.value); setError(null); }}
                  placeholder="you@company.com"
                  className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2]"
                />
              </div>

              {error && <ErrorBox message={error} />}

              <button type="submit" disabled={loading}
                className="w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? <Spinner label="Sending…" /> : 'Send link to create account'}
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-[#6B7C93]">
              Already have an account?{' '}
              <Link href="/login" className="font-semibold text-[#0A66C2] hover:underline">Log in</Link>
            </p>
            <p className="mt-2 text-center text-xs text-[#6B7C93]/60">
              By continuing you agree to our{' '}
              <Link href="/terms" className="hover:underline">Terms</Link> and{' '}
              <Link href="/privacy" className="hover:underline">Privacy Policy</Link>.
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

function Spinner({ label }: { label: string }) {
  return (
    <span className="flex items-center justify-center gap-2">
      <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {label}
    </span>
  );
}
