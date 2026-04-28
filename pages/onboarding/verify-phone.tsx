'use client';

/**
 * /onboarding/verify-phone
 *
 * Phone OTP verification for returning users arriving via login magic link.
 * Does NOT grant credits — this is identity verification only.
 *
 * Flow:
 *  1. Require Supabase session (redirect → /login if absent)
 *  2. Fetch stored phone from /api/auth/get-stored-phone
 *     - null phone → redirect /onboarding/phone (incomplete account)
 *  3. Show masked phone, send Firebase OTP on button press
 *  4. User enters 6-digit code → confirm → redirect /dashboard
 */

import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '../../lib/supabaseBrowser';
import { getAuthToken } from '../../utils/getAuthToken';

type Step = 'loading' | 'send' | 'otp' | 'error';

export default function VerifyPhonePage() {
  const router = useRouter();

  const [step, setStep]               = useState<Step>('loading');
  const [phone, setPhone]             = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [otp, setOtp]                 = useState('');
  const [loading, setLoading]         = useState(false);
  const [errorMsg, setErrorMsg]       = useState<string | null>(null);

  const confirmationRef = useRef<any>(null);

  // ── 1. Require Supabase session, then fetch stored phone ─────────────────
  useEffect(() => {
    const init = async () => {
      const { data } = await getSupabaseBrowser().auth.getSession();
      if (!data.session) {
        router.replace('/login');
        return;
      }
      const token = await getAuthToken();
      if (!token) {
        router.replace('/login');
        return;
      }
      try {
        const res = await fetch('/api/auth/get-stored-phone', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json() as { phone: string | null; maskedPhone: string | null; error?: string };

        if (!res.ok || json.error) throw new Error(json.error ?? 'Could not load phone');

        if (!json.phone) {
          router.replace('/onboarding/phone');
          return;
        }

        setPhone(json.phone);
        setMaskedPhone(json.maskedPhone ?? json.phone);
        setStep('send');
      } catch (err: any) {
        setErrorMsg(err.message ?? 'Failed to load your account details.');
        setStep('error');
      }
    };

    void init();
  }, [router]);

  // ── 2. Send Supabase OTP ──────────────────────────────────────────────────
  async function handleSendOtp() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.auth.signInWithOtp({ phone });
      if (error) throw error;
      setStep('otp');
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Failed to send SMS. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── 3. Confirm OTP ────────────────────────────────────────────────────────
  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!otp.trim() || otp.length < 6) { setErrorMsg('Enter the 6-digit code.'); return; }
    setLoading(true);
    setErrorMsg(null);
    try {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.auth.verifyOtp({ phone, token: otp.trim(), type: 'sms' });
      if (error) throw error;
      router.replace('/dashboard');
    } catch (err: any) {
      setErrorMsg('Incorrect code. Please try again.');
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>Verify Phone | Omnivyra</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF] flex flex-col">

        {/* Header */}
        <header className="border-b border-gray-100 bg-white/95 backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-6">
            <Link href="/">
              <img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" />
            </Link>
            {step !== 'error' && (
              <span className="text-xs text-[#6B7C93]">Security check</span>
            )}
          </div>
          <div className="h-0.5 w-full bg-gray-100">
            <div
              className="h-0.5 bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] transition-all duration-500"
              style={{ width: step === 'otp' ? '85%' : step === 'send' ? '50%' : '20%' }}
            />
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">

            {/* ── Loading ──────────────────────────────────────────────── */}
            {step === 'loading' && (
              <div className="flex flex-col items-center gap-4 text-center animate-fadeIn">
                <svg className="h-8 w-8 animate-spin text-[#0A66C2]" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-sm text-[#6B7C93]">Loading your account…</p>
              </div>
            )}

            {/* ── Send OTP ─────────────────────────────────────────────── */}
            {step === 'send' && (
              <div className="animate-fadeIn">
                <div className="mb-8 text-center">
                  <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] text-2xl shadow-lg">
                    📱
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-[#0B1F33]">
                    One more step
                  </h1>
                  <p className="mt-2 text-sm leading-relaxed text-[#6B7C93]">
                    We'll send a verification code to the phone number registered on your account.
                  </p>
                </div>

                {/* Masked phone display */}
                <div className="mb-6 rounded-2xl border border-[#0A66C2]/15 bg-[#EBF3FD] px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0A66C2]/10">
                      <svg className="h-4 w-4 text-[#0A66C2]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3m-3 3h3m-3 3h3" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-[#0A66C2]">Registered phone</p>
                      <p className="mt-0.5 font-mono text-sm font-medium text-[#0B1F33]">{maskedPhone}</p>
                    </div>
                  </div>
                </div>

                {errorMsg && (
                  <div className="mb-4 flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                    <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                    </svg>
                    <p className="text-sm text-red-600">{errorMsg}</p>
                  </div>
                )}

                <button
                  onClick={handleSendOtp}
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
                  ) : 'Send verification code'}
                </button>

                {/* Security note */}
                <div className="mt-6 rounded-2xl border border-gray-100 bg-white px-5 py-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0A66C2]/10">
                      <svg className="h-4 w-4 text-[#0A66C2]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                      </svg>
                    </div>
                    <p className="text-xs leading-relaxed text-[#6B7C93]">
                      This step confirms it's really you. Your email link verified your identity — now we confirm your phone before granting access.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ── OTP entry ────────────────────────────────────────────── */}
            {step === 'otp' && (
              <div className="animate-fadeIn">
                <div className="mb-8 text-center">
                  <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EBF3FD] text-2xl">
                    🔐
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-[#0B1F33]">
                    Enter the code
                  </h1>
                  <p className="mt-2 text-sm text-[#6B7C93]">
                    We sent a 6-digit code to{' '}
                    <strong className="font-mono text-[#0B1F33]">{maskedPhone}</strong>
                  </p>
                </div>

                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    placeholder="123456"
                    value={otp}
                    onChange={e => { setOtp(e.target.value.replace(/\D/g, '')); setErrorMsg(null); }}
                    className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3.5 text-center text-2xl font-mono tracking-[0.4em] text-[#0B1F33] outline-none transition focus:border-[#0A66C2]"
                  />

                  {errorMsg && (
                    <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                      <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                      </svg>
                      <p className="text-sm text-red-600">{errorMsg}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || otp.length < 6}
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
                    ) : 'Verify & sign in'}
                  </button>

                  <button
                    type="button"
                    onClick={() => { setStep('send'); setOtp(''); setErrorMsg(null); }}
                    className="w-full text-sm text-[#6B7C93] hover:text-[#0A66C2] transition-colors"
                  >
                    ← Resend code
                  </button>
                </form>
              </div>
            )}

            {/* ── Error state ──────────────────────────────────────────── */}
            {step === 'error' && (
              <div className="animate-fadeIn text-center">
                <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-2xl">
                  ⚠️
                </div>
                <h2 className="text-xl font-bold text-[#0B1F33]">Something went wrong</h2>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[#6B7C93]">{errorMsg}</p>
                <div className="mt-8 space-y-3">
                  <Link
                    href="/login"
                    className="block w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3.5 text-center text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95"
                  >
                    Back to sign in
                  </Link>
                  <Link
                    href="/get-free-credits"
                    className="block w-full rounded-full border border-gray-200 px-6 py-3 text-center text-sm font-medium text-[#0B1F33] transition hover:border-[#0A66C2] hover:text-[#0A66C2]"
                  >
                    Create a new account
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
