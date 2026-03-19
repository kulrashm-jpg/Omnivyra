'use client';

/**
 * /onboarding/company
 *
 * Final onboarding step — collects company website + details
 * after both email and phone auth are complete.
 *
 * Flow:
 *  1. Check Supabase session (redirect → /login if absent)
 *  2. If user already has a company → redirect /dashboard
 *  3. Step A: enter company website URL
 *  4. Step B: confirm/edit auto-filled details (name, industry, size)
 *  5. POST /api/onboarding/setup-company → redirect /dashboard
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../../utils/supabaseClient';

type Step = 'loading' | 'website' | 'details' | 'saving';

const INDUSTRIES = [
  'Technology & Software',
  'Marketing & Advertising',
  'E-commerce & Retail',
  'Finance & Banking',
  'Healthcare',
  'Education',
  'Media & Entertainment',
  'Professional Services',
  'Real Estate',
  'Food & Beverage',
  'Manufacturing',
  'Other',
];

const TEAM_SIZES = [
  { value: 'solo', label: 'Just me' },
  { value: '2-10', label: '2 – 10 people' },
  { value: '11-50', label: '11 – 50 people' },
  { value: '51-200', label: '51 – 200 people' },
  { value: '201+', label: '201+ people' },
];

function guessCompanyName(url: string): string {
  try {
    const hostname = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
    const domain = hostname.replace(/^www\./, '').split('.')[0];
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  } catch {
    return '';
  }
}

function normaliseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
}

export default function CompanySetupPage() {
  const router = useRouter();

  const [step, setStep]             = useState<Step>('loading');
  const [session, setSession]       = useState<any>(null);
  const [websiteInput, setWebsite]  = useState('');
  const [companyName, setCompanyName] = useState('');
  const [industry, setIndustry]     = useState('');
  const [teamSize, setTeamSize]     = useState('');
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);

  // ── Check session + existing company ─────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.replace('/login'); return; }
      setSession(data.session);

      // Check if already has an active company
      const { data: role } = await supabase
        .from('user_company_roles')
        .select('company_id')
        .eq('user_id', data.session.user.id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      if (role?.company_id) {
        router.replace('/dashboard');
        return;
      }

      setStep('website');
    });
  }, [router]);

  // ── Step A: website submitted ─────────────────────────────────────────────
  function handleWebsiteNext(e: React.FormEvent) {
    e.preventDefault();
    const url = normaliseUrl(websiteInput);
    if (!url) { setErrorMsg('Please enter your company website.'); return; }
    setErrorMsg(null);
    const guessed = guessCompanyName(url);
    setCompanyName(guessed);
    setWebsite(url);
    setStep('details');
  }

  // ── Step B: details submitted ─────────────────────────────────────────────
  async function handleDetailsSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim()) { setErrorMsg('Please enter your company name.'); return; }
    setErrorMsg(null);
    setStep('saving');

    try {
      const res = await fetch('/api/onboarding/setup-company', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          companyName: companyName.trim(),
          website:     websiteInput,
          industry,
          companySize: teamSize,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to create company');

      router.replace('/dashboard');
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Something went wrong. Please try again.');
      setStep('details');
    }
  }

  return (
    <>
      <Head>
        <title>Set up your company | Omnivyra</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF] flex flex-col">

        {/* Header */}
        <header className="border-b border-gray-100 bg-white/95 backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-6">
            <Link href="/">
              <img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" />
            </Link>
            {(step === 'website' || step === 'details') && (
              <span className="text-xs text-[#6B7C93]">
                {step === 'website' ? 'Last step' : 'Almost done'}
              </span>
            )}
          </div>
          <div className="h-0.5 w-full bg-gray-100">
            <div
              className="h-0.5 bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] transition-all duration-500"
              style={{ width: step === 'saving' ? '100%' : step === 'details' ? '80%' : step === 'website' ? '50%' : '20%' }}
            />
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">

            {/* ── Loading / redirecting ────────────────────────────────── */}
            {step === 'loading' && (
              <div className="flex flex-col items-center gap-4 text-center animate-fadeIn">
                <svg className="h-8 w-8 animate-spin text-[#0A66C2]" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-sm text-[#6B7C93]">Setting things up…</p>
              </div>
            )}

            {/* ── Step A: website URL ──────────────────────────────────── */}
            {step === 'website' && (
              <div className="animate-fadeIn">
                <div className="mb-8 text-center">
                  <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] shadow-lg">
                    <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
                    </svg>
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-[#0B1F33]">
                    Tell us about your company
                  </h1>
                  <p className="mt-2 text-sm leading-relaxed text-[#6B7C93]">
                    Enter your website and we'll pre-fill your company details — you can edit anything before saving.
                  </p>
                </div>

                <form onSubmit={handleWebsiteNext} className="space-y-4">
                  <div>
                    <label htmlFor="website" className="block text-sm font-medium text-[#0B1F33] mb-1.5">
                      Company website
                    </label>
                    <div className="relative">
                      <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center">
                        <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                        </svg>
                      </div>
                      <input
                        id="website"
                        type="text"
                        autoFocus
                        placeholder="yourcompany.com"
                        value={websiteInput}
                        onChange={e => { setWebsite(e.target.value); setErrorMsg(null); }}
                        className="w-full rounded-xl border-2 border-gray-200 bg-white py-3 pl-10 pr-4 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2]"
                      />
                    </div>
                    <p className="mt-1 text-xs text-[#6B7C93]">No https:// needed — just the domain</p>
                  </div>

                  {errorMsg && (
                    <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{errorMsg}</p>
                  )}

                  <button
                    type="submit"
                    className="w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95"
                  >
                    Continue →
                  </button>

                  <button
                    type="button"
                    onClick={() => { setWebsite(''); setStep('details'); setErrorMsg(null); }}
                    className="w-full text-sm text-[#6B7C93] hover:text-[#0A66C2] transition-colors"
                  >
                    Skip — I'll fill in details manually
                  </button>
                </form>
              </div>
            )}

            {/* ── Step B: details form ─────────────────────────────────── */}
            {(step === 'details' || step === 'saving') && (
              <div className="animate-fadeIn">
                <div className="mb-8 text-center">
                  <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EBF3FD] text-2xl">
                    🏢
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-[#0B1F33]">
                    Confirm your details
                  </h1>
                  <p className="mt-2 text-sm leading-relaxed text-[#6B7C93]">
                    {websiteInput
                      ? `We've pre-filled what we can from ${websiteInput} — update anything that's off.`
                      : 'Fill in your company details to personalise your experience.'}
                  </p>
                </div>

                <form onSubmit={handleDetailsSubmit} className="space-y-4">

                  {/* Company name */}
                  <div>
                    <label htmlFor="companyName" className="block text-sm font-medium text-[#0B1F33] mb-1.5">
                      Company name <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="companyName"
                      type="text"
                      autoFocus
                      required
                      placeholder="Acme Inc."
                      value={companyName}
                      onChange={e => { setCompanyName(e.target.value); setErrorMsg(null); }}
                      className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-[#0B1F33] placeholder-gray-400 outline-none transition focus:border-[#0A66C2]"
                    />
                  </div>

                  {/* Website (editable) */}
                  {websiteInput && (
                    <div>
                      <label htmlFor="websiteEdit" className="block text-sm font-medium text-[#0B1F33] mb-1.5">
                        Website
                      </label>
                      <input
                        id="websiteEdit"
                        type="text"
                        value={websiteInput}
                        onChange={e => setWebsite(e.target.value)}
                        className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-[#0B1F33] outline-none transition focus:border-[#0A66C2]"
                      />
                    </div>
                  )}

                  {/* Industry */}
                  <div>
                    <label htmlFor="industry" className="block text-sm font-medium text-[#0B1F33] mb-1.5">
                      Industry
                    </label>
                    <select
                      id="industry"
                      value={industry}
                      onChange={e => setIndustry(e.target.value)}
                      className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm text-[#0B1F33] outline-none transition focus:border-[#0A66C2] appearance-none"
                    >
                      <option value="">Select your industry…</option>
                      {INDUSTRIES.map(ind => (
                        <option key={ind} value={ind}>{ind}</option>
                      ))}
                    </select>
                  </div>

                  {/* Team size */}
                  <div>
                    <label className="block text-sm font-medium text-[#0B1F33] mb-2">
                      Team size
                    </label>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {TEAM_SIZES.map(s => (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => setTeamSize(s.value)}
                          className={`rounded-xl border-2 px-2 py-2.5 text-center text-xs font-medium transition ${
                            teamSize === s.value
                              ? 'border-[#0A66C2] bg-[#EBF3FD] text-[#0A66C2]'
                              : 'border-gray-200 bg-white text-[#6B7C93] hover:border-[#0A66C2]/40'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

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
                    disabled={step === 'saving'}
                    className="w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {step === 'saving' ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Setting up your workspace…
                      </span>
                    ) : 'Go to my dashboard →'}
                  </button>

                  {!websiteInput && (
                    <button
                      type="button"
                      onClick={() => { setStep('website'); setErrorMsg(null); }}
                      className="w-full text-sm text-[#6B7C93] hover:text-[#0A66C2] transition-colors"
                    >
                      ← Back
                    </button>
                  )}
                </form>

                {/* What we use this for */}
                <div className="mt-6 rounded-2xl border border-[#0A66C2]/15 bg-[#EBF3FD] px-5 py-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0A66C2]/10">
                      <svg className="h-4 w-4 text-[#0A66C2]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
                      </svg>
                    </div>
                    <p className="text-xs leading-relaxed text-[#6B7C93]">
                      We use these details to personalise your campaigns, content suggestions, and marketing strategy — you can update them any time from your profile settings.
                    </p>
                  </div>
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
