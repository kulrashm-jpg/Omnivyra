'use client';

/**
 * /auth/set-password
 *
 * Unified Set / Reset Password page.
 *
 * Reached via /auth/callback?next=/auth/set-password in two cases:
 *   1. New sign-up  — user clicked the sign-up magic link
 *   2. Password reset — user clicked the "reset password" link
 *
 * In both cases /auth/callback has already exchanged the code and
 * established a session. This page just reads that session and lets
 * the user choose a password.
 */

import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '../../lib/supabaseBrowser';

type Stage = 'loading' | 'form' | 'success' | 'error';

export default function SetPasswordPage() {
  const router = useRouter();

  const [stage, setStage]         = useState<Stage>('loading');
  const [userEmail, setUserEmail] = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const supabase = getSupabaseBrowser();
    const params   = new URLSearchParams(window.location.search);
    const code     = params.get('code');

    async function init() {
      // ── 1. Check for hash-fragment tokens (implicit flow: #access_token=…) ──
      const hash = window.location.hash;
      if (hash && hash.includes('access_token')) {
        const hp = new URLSearchParams(hash.substring(1));
        const at = hp.get('access_token');
        const rt = hp.get('refresh_token');
        if (at && rt) {
          const { data, error } = await supabase.auth.setSession({ access_token: at, refresh_token: rt });
          if (!error && data.session) {
            window.history.replaceState(null, '', window.location.pathname);
            setUserEmail(data.session.user.email ?? '');
            setStage('form');
            return;
          }
        }
      }

      // ── 2. PKCE code exchange (legacy/fallback) ──
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error && data.session) {
          setUserEmail(data.session.user.email ?? '');
          setStage('form');
          return;
        }
      }

      // ── 3. Existing session (e.g. came via /auth/callback) ──
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setUserEmail(data.session.user.email ?? '');
        setStage('form');
        return;
      }

      setError('Link expired or already used. Please request a new one.');
      setStage('error');
    }

    init();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8 || password.length > 20) { setError('Password must be 8–20 characters.'); return; }
    if (password !== confirm)  { setError('Passwords do not match.'); return; }

    setLoading(true);
    setError(null);

    const { error: updateErr } = await getSupabaseBrowser().auth.updateUser({ password });
    if (updateErr) { setError(updateErr.message); setLoading(false); return; }

    // Notify backend so it marks has_password, handles invitation acceptance, etc.
    try {
      const { data } = await getSupabaseBrowser().auth.getSession();
      if (data.session?.access_token) {
        await fetch('/api/auth/set-password', {
          method:  'POST',
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        });
      }
    } catch { /* ignore — password is set in Supabase regardless */ }

    // Sign out so the user must log in with their new password.
    // This confirms the password works and routes them correctly via /auth/callback.
    await getSupabaseBrowser().auth.signOut();
    setStage('success');
    setTimeout(() => router.replace('/login?verified=1'), 1200);
  }

  return (
    <>
      <Head>
        <title>Set / Reset Password | Omnivyra</title>
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

            {/* Loading */}
            {stage === 'loading' && (
              <div className="animate-fadeIn flex flex-col items-center gap-5 text-center">
                <svg className="h-10 w-10 animate-spin text-[#0A66C2]" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-base font-semibold text-[#0B1F33]">Verifying…</p>
              </div>
            )}

            {/* Password form */}
            {stage === 'form' && (
              <div className="animate-fadeIn">
                <div className="mb-8 text-center">
                  <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] shadow-lg">
                    <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                    </svg>
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-[#0B1F33]">Set / Reset Password</h1>
                  <p className="mt-1 text-sm text-[#6B7C93]">{userEmail}</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="password" className="block text-sm font-medium text-[#0B1F33] mb-1.5">
                      New password <span className="text-[#6B7C93] font-normal">(8–20 characters)</span>
                    </label>
                    <div className="relative">
                      <input
                        id="password" type={showPw ? 'text' : 'password'}
                        autoComplete="new-password" autoFocus required minLength={8} maxLength={20}
                        value={password} onChange={e => { setPassword(e.target.value); setError(null); }}
                        placeholder="Choose a strong password"
                        className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 pr-10 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2]"
                      />
                      <button type="button" onClick={() => setShowPw(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7C93] hover:text-[#0A66C2]">
                        {showPw ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="confirm" className="block text-sm font-medium text-[#0B1F33] mb-1.5">Confirm password</label>
                    <input
                      id="confirm" type={showPw ? 'text' : 'password'}
                      autoComplete="new-password" required
                      value={confirm} onChange={e => { setConfirm(e.target.value); setError(null); }}
                      placeholder="Repeat your password"
                      className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2]"
                    />
                  </div>

                  {error && <ErrorBox message={error} />}

                  <button type="submit" disabled={loading}
                    className="w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed">
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Saving…
                      </span>
                    ) : 'Set password & continue'}
                  </button>
                </form>
              </div>
            )}

            {/* Success */}
            {stage === 'success' && (
              <div className="animate-fadeIn flex flex-col items-center gap-5 text-center">
                <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50">
                  <svg className="h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
                <div>
                  <p className="text-lg font-bold text-[#0B1F33]">Password set!</p>
                  <p className="mt-1 text-sm text-[#6B7C93]">Taking you to sign in…</p>
                </div>
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
                <h2 className="text-2xl font-bold tracking-tight text-[#0B1F33]">Link expired</h2>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[#6B7C93]">{error}</p>
                <div className="mt-8 flex flex-col items-center gap-3">
                  <Link href="/create-account"
                    className="rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95">
                    New sign-up link
                  </Link>
                  <Link href="/login"
                    className="text-sm text-[#6B7C93] hover:text-[#0A66C2]">
                    Reset password instead
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

function ErrorBox({ message }: { message: string }) {
  return <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{message}</p>;
}
function EyeIcon() {
  return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>;
}
function EyeOffIcon() {
  return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>;
}
