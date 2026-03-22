'use client';

/**
 * /onboarding/phone
 * Step 2 of free-credits signup — lands here after magic link click.
 * Collects company name, then verifies phone via Firebase SMS OTP,
 * then calls /api/onboarding/complete to create free_credit_profiles
 * and grant 300 credits.
 */

import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type { ConfirmationResult } from 'firebase/auth';
import { supabase } from '../../utils/supabaseClient';
import { setupRecaptcha, sendPhoneOtp, clearRecaptcha } from '../../lib/firebase';

type Step = 'company' | 'phone' | 'otp' | 'done' | 'error';

export default function PhoneVerificationPage() {
  const router = useRouter();
  const { goals: goalsParam = '', team: teamParam = '', challenge: challengeParam = '' } = router.query as Record<string, string>;

  // Intent params arrive as query params when coming from create-account directly,
  // or from sessionStorage when routed here via /auth/callback → /onboarding/verify-phone.
  const goals     = goalsParam     || (typeof window !== 'undefined' ? sessionStorage.getItem('intent_goals')     ?? '' : '');
  const team      = teamParam      || (typeof window !== 'undefined' ? sessionStorage.getItem('intent_team')      ?? '' : '');
  const challenge = challengeParam || (typeof window !== 'undefined' ? sessionStorage.getItem('intent_challenge') ?? '' : '');

  const [step, setStep]             = useState<Step>('company');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone]           = useState('');
  const [otp, setOtp]               = useState('');
  const [session, setSession]       = useState<any>(null);
  const [loading, setLoading]       = useState(false);
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);

  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const recaptchaContainerRef = useRef<HTMLDivElement>(null);

  // ── Require Supabase session ────────────────────────────────────────────────
  // The PKCE code exchange is handled upstream by /auth/callback before
  // routing here, so a session is always present by the time this page loads.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace('/create-account');
        return;
      }
      setSession(data.session);
    });

    return () => clearRecaptcha();
  }, [router]);

  // ── Step 0: Company name ────────────────────────────────────────────────────
  function handleCompanySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim()) { setErrorMsg('Enter your company name.'); return; }
    setErrorMsg(null);
    setStep('phone');
  }

  // ── Step 1: Send SMS ────────────────────────────────────────────────────────
  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) { setErrorMsg('Enter your phone number.'); return; }
    setLoading(true);
    setErrorMsg(null);

    try {
      setupRecaptcha('recaptcha-container');
      const result = await sendPhoneOtp(phone.trim());
      confirmationRef.current = result;
      setStep('otp');
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Failed to send OTP. Check the phone number and try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: Verify OTP ──────────────────────────────────────────────────────
  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!otp.trim() || otp.length < 6) { setErrorMsg('Enter the 6-digit code.'); return; }
    setLoading(true);
    setErrorMsg(null);

    try {
      const credential = await confirmationRef.current!.confirm(otp.trim());
      const fbUid = credential.user.uid;

      // Get the Firebase ID token to let the server verify phone auth server-side
      const firebaseIdToken = await credential.user.getIdToken();

      // Store firebase data temporarily so profile page can call the complete API
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('onboarding_phone',           phone.trim());
        sessionStorage.setItem('onboarding_firebase_uid',    fbUid);
        sessionStorage.setItem('onboarding_firebase_token',  firebaseIdToken);
        sessionStorage.setItem('onboarding_company_name',    companyName.trim());
      }

      // Redirect to profile capture page
      router.push('/onboarding/profile');
    } catch (err: any) {
      setErrorMsg(err.message ?? 'OTP verification failed. Try again.');
    } finally {
      setLoading(false);
    }
  }

  const progressWidth =
    step === 'company' ? '33%' :
    step === 'phone'   ? '66%' :
    step === 'otp'     ? '100%' :
    step === 'done'    ? '100%' : '33%';

  const stepLabel =
    step === 'company' ? 'Step 1 of 3' :
    step === 'phone'   ? 'Step 2 of 3' :
    step === 'otp'     ? 'Step 3 of 3' : '';

  return (
    <>
      <Head>
        <title>Set Up Account | Omnivyra</title>
      </Head>

      {/* Invisible reCAPTCHA anchor */}
      <div id="recaptcha-container" ref={recaptchaContainerRef} />

      <div className="min-h-screen bg-[#F5F9FF] flex flex-col">
        {/* Minimal header */}
        <header className="border-b border-gray-100 bg-white/95">
          <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-6">
            <Link href="/">
              <img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" />
            </Link>
            {step !== 'done' && step !== 'error' && (
              <span className="text-xs text-[#6B7C93]">{stepLabel}</span>
            )}
          </div>
          {/* Progress bar */}
          <div className="h-0.5 w-full bg-gray-100">
            <div
              className="h-0.5 bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] transition-all duration-500"
              style={{ width: progressWidth }}
            />
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">

            {/* ── Company name ─────────────────────────────────────────── */}
            {step === 'company' && (
              <div className="animate-fadeIn">
                <div className="mb-8 text-center">
                  <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] text-2xl shadow-lg">
                    🏢
                  </div>
                  <h1
                    className="text-2xl font-bold tracking-tight text-[#0B1F33]"
                    style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
                  >
                    What&rsquo;s your company name?
                  </h1>
                  <p className="mt-2 text-sm leading-relaxed text-[#6B7C93]">
                    This will be used to set up your workspace.
                  </p>
                </div>

                <form onSubmit={handleCompanySubmit} className="space-y-4">
                  <div>
                    <label htmlFor="company" className="block text-sm font-medium text-[#0B1F33] mb-1.5">
                      Company name
                    </label>
                    <input
                      id="company"
                      type="text"
                      autoFocus
                      autoComplete="organization"
                      placeholder="Acme Inc."
                      value={companyName}
                      onChange={e => setCompanyName(e.target.value)}
                      className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2]"
                    />
                  </div>

                  {errorMsg && (
                    <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{errorMsg}</p>
                  )}

                  <button
                    type="submit"
                    className="w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95"
                  >
                    Continue
                  </button>
                </form>
              </div>
            )}

            {/* ── Phone number ─────────────────────────────────────────── */}
            {step === 'phone' && (
              <div className="animate-fadeIn">
                <div className="mb-8 text-center">
                  <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] text-2xl shadow-lg">
                    📱
                  </div>
                  <h1
                    className="text-2xl font-bold tracking-tight text-[#0B1F33]"
                    style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
                  >
                    Verify your phone
                  </h1>
                  <p className="mt-2 text-sm leading-relaxed text-[#6B7C93]">
                    We use phone verification to protect your credits and prevent abuse.
                    One phone number = one free credit claim.
                  </p>
                </div>

                <form onSubmit={handleSendOtp} className="space-y-4">
                  <div>
                    <label htmlFor="phone" className="block text-sm font-medium text-[#0B1F33] mb-1.5">
                      Phone number (international format)
                    </label>
                    <input
                      id="phone"
                      type="tel"
                      autoComplete="tel"
                      autoFocus
                      placeholder="+44 7911 123456"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2]"
                    />
                    <p className="mt-1 text-xs text-[#6B7C93]">Include country code, e.g. +1 415 555 0100</p>
                  </div>

                  {errorMsg && (
                    <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{errorMsg}</p>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Sending SMS…' : 'Send verification code'}
                  </button>

                  <button
                    type="button"
                    onClick={() => { setStep('company'); setErrorMsg(null); }}
                    className="w-full text-sm text-[#6B7C93] hover:text-[#0A66C2] transition-colors"
                  >
                    ← Change company name
                  </button>
                </form>
              </div>
            )}

            {/* ── OTP entry ───────────────────────────────────────────── */}
            {step === 'otp' && (
              <div className="animate-fadeIn">
                <div className="mb-8 text-center">
                  <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EBF3FD] text-2xl">
                    🔐
                  </div>
                  <h1
                    className="text-2xl font-bold tracking-tight text-[#0B1F33]"
                    style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
                  >
                    Enter the code
                  </h1>
                  <p className="mt-2 text-sm text-[#6B7C93]">
                    We sent a 6-digit code to <strong className="text-[#0B1F33]">{phone}</strong>
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
                    onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                    className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3.5 text-center text-2xl font-mono tracking-[0.4em] text-[#0B1F33] outline-none transition focus:border-[#0A66C2]"
                  />

                  {errorMsg && (
                    <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{errorMsg}</p>
                  )}

                  <button
                    type="submit"
                    disabled={loading || otp.length < 6}
                    className="w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Verifying…' : 'Verify & claim credits'}
                  </button>

                  <button
                    type="button"
                    onClick={() => { setStep('phone'); setOtp(''); setErrorMsg(null); }}
                    className="w-full text-sm text-[#6B7C93] hover:text-[#0A66C2] transition-colors"
                  >
                    ← Use a different number
                  </button>
                </form>
              </div>
            )}

            {/* ── Done / Credits granted ──────────────────────────────── */}
            {step === 'done' && (
              <div className="animate-fadeIn space-y-6 text-center">
                <div
                  className="rounded-2xl p-8 text-white"
                  style={{ background: 'linear-gradient(135deg, #0A1F44 0%, #0A66C2 100%)' }}
                >
                  <p className="text-xs font-semibold uppercase tracking-widest text-white/60">Credits claimed</p>
                  <p className="mt-2 text-6xl font-bold">300</p>
                  <p className="mt-2 text-sm font-medium text-[#3FA9F5]">free credits · expires in 14 days</p>
                  <p className="mt-4 text-sm text-white/70">
                    Enough to audit your website, generate content, and plan campaigns.
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-[#6B7C93]">Redirecting to your dashboard…</p>
                  <div className="flex justify-center gap-1">
                    <div className="h-1 w-1 rounded-full bg-[#0A66C2] animate-pulse"></div>
                    <div className="h-1 w-1 rounded-full bg-[#0A66C2] animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                    <div className="h-1 w-1 rounded-full bg-[#0A66C2] animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Error state (e.g. phone already used) ───────────────── */}
            {step === 'error' && (
              <div className="animate-fadeIn text-center">
                <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-2xl">
                  ⚠️
                </div>
                <h2 className="text-xl font-bold text-[#0B1F33]">Couldn&rsquo;t claim credits</h2>
                <p className="mt-3 text-sm leading-relaxed text-[#6B7C93]">{errorMsg}</p>
                <Link
                  href="/dashboard"
                  className="mt-6 inline-block rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-8 py-3 text-sm font-semibold text-white transition hover:opacity-95"
                >
                  Continue to Dashboard
                </Link>
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
