'use client';

/**
 * /create-account
 * Step 1 of the free-credits signup flow.
 * Collects email → sends Supabase magic link → redirects to /onboarding/phone
 * with intent data as query params so phone verification can complete the profile.
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../utils/supabaseClient';

export default function CreateAccountPage() {
  const router = useRouter();
  const { goals = '', team = '', challenge = '' } = router.query as Record<string, string>;

  const [email, setEmail]     = useState('');
  const [sent, setSent]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Already logged in → skip ahead to phone step
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace(`/onboarding/phone?goals=${goals}&team=${team}&challenge=${challenge}`);
      }
    });
  }, [router, goals, team, challenge]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { setError('Please enter your email.'); return; }
    setLoading(true);
    setError(null);

    // Build the redirect URL so after clicking the magic link the user lands on phone verification
    const redirectTo = `${window.location.origin}/onboarding/phone?goals=${encodeURIComponent(goals)}&team=${encodeURIComponent(team)}&challenge=${encodeURIComponent(challenge)}`;

    const { error: authErr } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
    });

    setLoading(false);
    if (authErr) { setError(authErr.message); return; }
    setSent(true);
  }

  return (
    <>
      <Head>
        <title>Create Account | Omnivyra</title>
        <meta name="description" content="Create your free Omnivyra account and claim your starting credits." />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF] flex flex-col">
        {/* Minimal header */}
        <header className="border-b border-gray-100 bg-white/95">
          <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-6">
            <Link href="/">
              <img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" />
            </Link>
            <Link href="/login" className="text-sm text-[#6B7C93] hover:text-[#0A66C2] transition-colors">
              Log in
            </Link>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">

            {!sent ? (
              <>
                {/* Header */}
                <div className="mb-8 text-center">
                  <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] text-2xl shadow-lg">
                    🎁
                  </div>
                  <h1
                    className="text-2xl font-bold tracking-tight text-[#0B1F33]"
                    style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
                  >
                    Create your account
                  </h1>
                  <p className="mt-2 text-sm leading-relaxed text-[#6B7C93]">
                    We&rsquo;ll email you a secure sign-in link — no password needed.
                    Then we&rsquo;ll verify your phone to protect your free credits.
                  </p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-[#0B1F33] mb-1.5">
                      Work email
                    </label>
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      autoFocus
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2] focus:ring-0"
                    />
                  </div>

                  {error && (
                    <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Sending…' : 'Send sign-in link'}
                  </button>
                </form>

                {/* Credit reminder */}
                <div className="mt-6 rounded-2xl border border-[#0A66C2]/20 bg-[#EBF3FD] px-5 py-4">
                  <p className="text-xs font-semibold text-[#0A66C2] mb-1">🎁 Your 300 free credits are waiting</p>
                  <p className="text-xs leading-relaxed text-[#6B7C93]">
                    After email confirmation you&rsquo;ll verify your phone number — this keeps credits secure and prevents abuse.
                  </p>
                </div>

                <p className="mt-6 text-center text-xs text-[#6B7C93]">
                  Already have an account?{' '}
                  <Link href="/login" className="text-[#0A66C2] hover:underline">Log in</Link>
                </p>
                <p className="mt-2 text-center text-xs text-[#6B7C93]/60">
                  By continuing you agree to our{' '}
                  <Link href="/terms" className="hover:underline">Terms</Link> and{' '}
                  <Link href="/privacy" className="hover:underline">Privacy Policy</Link>.
                </p>
              </>
            ) : (
              /* Sent state */
              <div className="text-center">
                <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-3xl">
                  📬
                </div>
                <h2
                  className="text-2xl font-bold tracking-tight text-[#0B1F33]"
                  style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
                >
                  Check your inbox
                </h2>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[#6B7C93]">
                  We sent a sign-in link to <strong className="text-[#0B1F33]">{email}</strong>.
                  Click it to continue — you&rsquo;ll then verify your phone number and claim your credits.
                </p>
                <p className="mt-6 text-xs text-[#6B7C93]">
                  Didn&rsquo;t receive it?{' '}
                  <button
                    onClick={() => setSent(false)}
                    className="text-[#0A66C2] hover:underline"
                  >
                    Try again
                  </button>
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
