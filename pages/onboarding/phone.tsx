'use client';

/**
 * /onboarding/phone
 * Step 2 of free-credits signup — lands here after magic link click.
 * Verifies phone via Firebase SMS OTP, then calls /api/onboarding/complete
 * to create free_credit_profiles and grant 300 credits.
 */

import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type { ConfirmationResult } from 'firebase/auth';
import { supabase } from '../../utils/supabaseClient';
import { setupRecaptcha, sendPhoneOtp, clearRecaptcha } from '../../lib/firebase';

const INITIAL_CREDITS = 300;
const EARN_MORE = [
  { category: 'invite_friend',  label: 'Invite a friend',            credits: 200 },
  { category: 'feedback',       label: 'Share feedback',             credits: 100 },
  { category: 'setup',          label: 'Complete your profile',      credits: 100 },
  { category: 'connect_social', label: 'Connect a social account',   credits: 150 },
  { category: 'first_campaign', label: 'Create your first campaign', credits: 200 },
];

type Step = 'phone' | 'otp' | 'done' | 'error';

export default function PhoneVerificationPage() {
  const router = useRouter();
  const { goals = '', team = '', challenge = '' } = router.query as Record<string, string>;

  const [step, setStep]             = useState<Step>('phone');
  const [phone, setPhone]           = useState('');
  const [otp, setOtp]               = useState('');
  const [session, setSession]       = useState<any>(null);
  const [loading, setLoading]       = useState(false);
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);

  const [claimedActions, setClaimedActions] = useState<Record<string, boolean>>({});
  const [claimingAction, setClaimingAction] = useState<string | null>(null);

  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const recaptchaContainerRef = useRef<HTMLDivElement>(null);

  // ── Require Supabase session (must have clicked magic link) ────────────────
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

      // Call our API to finalise onboarding
      const resp = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          phoneNumber:      phone.trim(),
          firebaseUid:      fbUid,
          firebaseIdToken,
          intentGoals:      goals ? goals.split(',') : [],
          intentTeam:       team,
          intentChallenges: challenge ? challenge.split(',') : [],
        }),
      });

      const json = await resp.json();

      if (!resp.ok) {
        if (resp.status === 409) {
          setErrorMsg(json.error);
          setStep('error');
          return;
        }
        throw new Error(json.error ?? 'Failed to complete onboarding');
      }

      setStep('done');
    } catch (err: any) {
      setErrorMsg(err.message ?? 'OTP verification failed. Try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Earn-more credit claim ──────────────────────────────────────────────────
  async function claimAction(category: string) {
    if (!session || claimedActions[category]) return;
    setClaimingAction(category);
    try {
      const resp = await fetch('/api/credits/claim-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ category }),
      });
      if (resp.ok || resp.status === 409) {
        setClaimedActions(prev => ({ ...prev, [category]: true }));
      }
    } finally {
      setClaimingAction(null);
    }
  }

  const totalEarnable = EARN_MORE.reduce((s, a) => s + a.credits, 0);

  return (
    <>
      <Head>
        <title>Verify Phone | Omnivyra</title>
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
            {step !== 'done' && (
              <span className="text-xs text-[#6B7C93]">
                {step === 'phone' ? 'Step 2 of 2' : 'Almost there…'}
              </span>
            )}
          </div>
          {/* Progress bar */}
          <div className="h-0.5 w-full bg-gray-100">
            <div
              className="h-0.5 bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] transition-all duration-500"
              style={{ width: step === 'done' ? '100%' : step === 'otp' ? '80%' : '60%' }}
            />
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">

            {/* ── Phone entry ─────────────────────────────────────────── */}
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
              <div className="animate-fadeIn space-y-6">
                {/* Credit card */}
                <div
                  className="rounded-2xl p-8 text-center text-white"
                  style={{ background: 'linear-gradient(135deg, #0A1F44 0%, #0A66C2 100%)' }}
                >
                  <p className="text-xs font-semibold uppercase tracking-widest text-white/60">Credits claimed</p>
                  <p className="mt-1 text-6xl font-bold">{INITIAL_CREDITS}</p>
                  <p className="mt-1 text-sm font-medium text-[#3FA9F5]">free credits · expires in 14 days</p>
                  <p className="mt-3 text-sm text-white/70">
                    Enough to audit your website, generate content, and plan your first campaign.
                  </p>
                </div>

                {/* Earn more */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold uppercase tracking-widest text-[#6B7C93]">Earn more credits</p>
                    <p className="text-xs text-[#0A66C2] font-medium">Up to +{totalEarnable} available</p>
                  </div>
                  <div className="space-y-2">
                    {EARN_MORE.map(item => {
                      const claimed = !!claimedActions[item.category];
                      const claiming = claimingAction === item.category;
                      return (
                        <div
                          key={item.category}
                          className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition ${
                            claimed ? 'border-emerald-200 bg-emerald-50' : 'border-gray-100 bg-white'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${claimed ? 'text-emerald-700' : 'text-[#0B1F33]'}`}>
                              {item.label}
                            </p>
                          </div>
                          <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            claimed ? 'bg-emerald-100 text-emerald-700' : 'bg-[#EBF3FD] text-[#0A66C2]'
                          }`}>
                            {claimed ? '✓ Claimed' : `+${item.credits}`}
                          </span>
                          {!claimed && (
                            <button
                              onClick={() => claimAction(item.category)}
                              disabled={claiming}
                              className="flex-shrink-0 rounded-full border border-[#0A66C2]/30 px-3 py-1 text-xs font-medium text-[#0A66C2] hover:bg-[#EBF3FD] transition disabled:opacity-50"
                            >
                              {claiming ? '…' : 'Claim'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Continue to company setup */}
                <Link
                  href="/onboarding/company"
                  className="block w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-4 text-center text-base font-semibold text-white shadow-[0_4px_20px_rgba(10,102,194,0.4)] transition hover:opacity-95"
                >
                  Continue →
                </Link>
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
