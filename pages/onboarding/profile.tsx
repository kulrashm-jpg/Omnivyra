'use client';

/**
 * /onboarding/profile
 *
 * First onboarding step after Supabase auth.
 * Collects name / job title / industry, then calls /api/onboarding/complete
 * which creates the company, grants 300 free credits, and sets up roles.
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '../../lib/supabaseBrowser';

const INDUSTRIES = [
  'Technology', 'Marketing & Advertising', 'E-commerce & Retail',
  'Media & Entertainment', 'Finance & Banking', 'Healthcare',
  'Education', 'Real Estate', 'Travel & Hospitality', 'Other',
];

type Step = 'form' | 'done' | 'error';

export default function ProfilePage() {
  const router = useRouter();

  const [step, setStep]         = useState<Step>('form');
  const [fullName, setFullName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [industry, setIndustry] = useState('');
  const [loading, setLoading]   = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Require Supabase session
  useEffect(() => {
    getSupabaseBrowser().auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace('/create-account');
        return;
      }
      setAccessToken(data.session.access_token);
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) { setErrorMsg('Please enter your full name.'); return; }
    if (!accessToken) { setErrorMsg('Session expired. Please sign in again.'); return; }

    setLoading(true);
    setErrorMsg(null);

    try {
      const resp = await fetch('/api/onboarding/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          name:     fullName.trim(),
          jobTitle: jobTitle.trim(),
          industry: industry.trim(),
        }),
      });

      const json = await resp.json();

      if (!resp.ok) {
        if (resp.status === 409) { setErrorMsg(json.error); setStep('error'); return; }
        throw new Error(json.error ?? 'Failed to save profile');
      }

      // Clear intent data
      ['intent_goals', 'intent_team', 'intent_challenge']
        .forEach(k => sessionStorage.removeItem(k));

      setStep('done');
      const dest = json.route ?? '/onboarding/company';
      setTimeout(() => router.push(dest), 1200);
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Head><title>Complete Profile | Omnivyra</title></Head>

      <div className="min-h-screen bg-[#F5F9FF] flex flex-col">
        <header className="border-b border-gray-100 bg-white/95">
          <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-6">
            <Link href="/"><img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" /></Link>
            {step === 'form' && <span className="text-xs text-[#6B7C93]">Step 1 of 2</span>}
          </div>
          <div className="h-0.5 w-full bg-gray-100">
            <div className="h-0.5 bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] transition-all duration-500"
              style={{ width: step === 'done' ? '50%' : '25%' }} />
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">

            {step === 'form' && (
              <div className="animate-fadeIn">
                <div className="mb-8 text-center">
                  <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] text-2xl shadow-lg">👤</div>
                  <h1 className="text-2xl font-bold tracking-tight text-[#0B1F33]"
                    style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}>
                    Complete your profile
                  </h1>
                  <p className="mt-2 text-sm leading-relaxed text-[#6B7C93]">
                    Help us personalise your experience and claim your 300 free credits.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="fullName" className="block text-sm font-medium text-[#0B1F33] mb-1.5">
                      Full name <span className="text-red-500">*</span>
                    </label>
                    <input id="fullName" type="text" autoFocus autoComplete="name"
                      placeholder="Jane Smith" value={fullName}
                      onChange={e => setFullName(e.target.value)}
                      className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2]" />
                  </div>

                  <div>
                    <label htmlFor="jobTitle" className="block text-sm font-medium text-[#0B1F33] mb-1.5">
                      Job title <span className="text-[#6B7C93] font-normal">(optional)</span>
                    </label>
                    <input id="jobTitle" type="text" autoComplete="organization-title"
                      placeholder="Head of Marketing" value={jobTitle}
                      onChange={e => setJobTitle(e.target.value)}
                      className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2]" />
                  </div>

                  <div>
                    <label htmlFor="industry" className="block text-sm font-medium text-[#0B1F33] mb-1.5">
                      Industry <span className="text-[#6B7C93] font-normal">(optional)</span>
                    </label>
                    <select id="industry" value={industry} onChange={e => setIndustry(e.target.value)}
                      className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-[#0B1F33] outline-none transition focus:border-[#0A66C2]">
                      <option value="">Select your industry</option>
                      {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </div>

                  {errorMsg && (
                    <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{errorMsg}</p>
                  )}

                  <button type="submit" disabled={loading || !accessToken}
                    className="w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed">
                    {loading ? 'Setting up your account…' : 'Claim 300 free credits →'}
                  </button>
                </form>
              </div>
            )}

            {step === 'done' && (
              <div className="animate-fadeIn space-y-6 text-center">
                <div className="rounded-2xl p-8 text-white"
                  style={{ background: 'linear-gradient(135deg, #0A1F44 0%, #0A66C2 100%)' }}>
                  <p className="text-xs font-semibold uppercase tracking-widest text-white/60">Credits claimed</p>
                  <p className="mt-2 text-6xl font-bold">300</p>
                  <p className="mt-2 text-sm font-medium text-[#3FA9F5]">free credits · expires in 14 days</p>
                  <p className="mt-4 text-sm text-white/70">Welcome, {fullName.split(' ')[0]}!</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-[#6B7C93]">Setting up your workspace…</p>
                  <div className="flex justify-center gap-1">
                    {[0, 0.2, 0.4].map((d, i) => (
                      <div key={i} className="h-1 w-1 rounded-full bg-[#0A66C2] animate-pulse" style={{ animationDelay: `${d}s` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {step === 'error' && (
              <div className="animate-fadeIn text-center">
                <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-2xl">⚠️</div>
                <h2 className="text-xl font-bold text-[#0B1F33]">Couldn&rsquo;t claim credits</h2>
                <p className="mt-3 text-sm leading-relaxed text-[#6B7C93]">{errorMsg}</p>
                <Link href="/dashboard"
                  className="mt-6 inline-block rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-8 py-3 text-sm font-semibold text-white transition hover:opacity-95">
                  Continue to Dashboard
                </Link>
              </div>
            )}

          </div>
        </main>
      </div>

      <style jsx>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .animate-fadeIn { animation: fadeIn 0.25s ease both; }
      `}</style>
    </>
  );
}
