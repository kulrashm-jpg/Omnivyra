'use client';

import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';

const GOALS = ['Generate leads', 'Drive sales', 'Build awareness', 'Book demos', 'Other'];
const TRAFFIC_SOURCES = ['Organic search', 'Paid ads', 'Social media', 'Email', 'Referral', 'Direct'];
const PRICE_RANGES = ['Free', 'Under $50', '$50–$200', '$200–$500', '$500+'];

export default function FreeAuditStart() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [url, setUrl] = useState('');
  const [primaryGoal, setPrimaryGoal] = useState('');
  const [productType, setProductType] = useState('');
  const [priceRange, setPriceRange] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [trafficSource, setTrafficSource] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    const q = router.query.url;
    if (typeof q === 'string') setUrl(q);
  }, [router.query.url]);

  const handleStep1Submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) setStep(2);
  };

  const handleStep2Submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (primaryGoal && productType) setStep(3);
  };

  const handleStep3Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setIsAnalyzing(true);
    // Simulate analysis delay
    await new Promise((r) => setTimeout(r, 2500));
    router.push({
      pathname: '/free-audit/report',
      query: { url: url || undefined },
    });
  };

  return (
    <>
      <Head>
        <title>Free Website Audit | Omnivyra</title>
        <meta name="description" content="Run a free AI-powered website audit." />
      </Head>
      <div className="min-h-screen bg-[#F5F9FF]">
        <div className="mx-auto max-w-xl px-4 py-12 sm:px-6 sm:py-16">
          {isAnalyzing ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-sm">
              <div className="mx-auto mb-6 h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-[#0B5ED7]" />
              <h2 className="text-xl font-semibold text-gray-900">Analyzing Website...</h2>
              <p className="mt-2 text-gray-600">This usually takes less than 60 seconds.</p>
              <p className="mt-4 text-sm text-gray-500">We&apos;re evaluating your site structure, messaging, and conversion signals.</p>
            </div>
          ) : (
            <>
              <div className="mb-8 text-center">
                <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Free Website Audit</h1>
                <p className="mt-2 text-gray-600">
                  Step {step} of 3
                </p>
                <div className="mt-4 flex justify-center gap-1">
                  {[1, 2, 3].map((s) => (
                    <div
                      key={s}
                      className={`h-1.5 flex-1 max-w-20 rounded-full ${
                        s <= step ? 'bg-[#0B5ED7]' : 'bg-gray-200'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Step 1: URL */}
              {step === 1 && (
                <form onSubmit={handleStep1Submit} className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
                  <label htmlFor="url" className="block font-medium text-gray-900">
                    Website URL
                  </label>
                  <input
                    id="url"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://yourwebsite.com"
                    required
                    className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-[#0B5ED7] focus:outline-none focus:ring-2 focus:ring-[#0B5ED7]/20"
                  />
                  <button
                    type="submit"
                    className="landing-btn-primary mt-6 w-full rounded-xl py-3.5 font-semibold"
                  >
                    Continue
                  </button>
                </form>
              )}

              {/* Step 2: Business context */}
              {step === 2 && (
                <form onSubmit={handleStep2Submit} className="space-y-6">
                  <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
                    <label className="block font-medium text-gray-900">Primary business goal</label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {GOALS.map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => setPrimaryGoal(g)}
                          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                            primaryGoal === g
                              ? 'bg-[#0B5ED7] text-white'
                              : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
                    <label htmlFor="product" className="block font-medium text-gray-900">
                      Product/service type
                    </label>
                    <input
                      id="product"
                      type="text"
                      value={productType}
                      onChange={(e) => setProductType(e.target.value)}
                      placeholder="e.g. SaaS, consulting, e-commerce"
                      className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-[#0B5ED7] focus:outline-none focus:ring-2 focus:ring-[#0B5ED7]/20"
                    />
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
                    <label className="block font-medium text-gray-900">Price range</label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {PRICE_RANGES.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPriceRange(p)}
                          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                            priceRange === p
                              ? 'bg-[#0B5ED7] text-white'
                              : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
                    <label htmlFor="audience" className="block font-medium text-gray-900">
                      Target audience
                    </label>
                    <input
                      id="audience"
                      type="text"
                      value={targetAudience}
                      onChange={(e) => setTargetAudience(e.target.value)}
                      placeholder="e.g. B2B marketers, SMB owners"
                      className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-[#0B5ED7] focus:outline-none focus:ring-2 focus:ring-[#0B5ED7]/20"
                    />
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
                    <label className="block font-medium text-gray-900">Main traffic source</label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {TRAFFIC_SOURCES.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTrafficSource(t)}
                          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                            trafficSource === t
                              ? 'bg-[#0B5ED7] text-white'
                              : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="rounded-xl border border-gray-200 px-6 py-3 font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      className="landing-btn-primary flex-1 rounded-xl py-3.5 font-semibold"
                    >
                      Continue
                    </button>
                  </div>
                </form>
              )}

              {/* Step 3: Email + optional phone */}
              {step === 3 && (
                <form onSubmit={handleStep3Submit} className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
                  <label htmlFor="email" className="block font-medium text-gray-900">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                    className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-[#0B5ED7] focus:outline-none focus:ring-2 focus:ring-[#0B5ED7]/20"
                  />
                  <label htmlFor="phone" className="mt-6 block font-medium text-gray-900">
                    Phone <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-[#0B5ED7] focus:outline-none focus:ring-2 focus:ring-[#0B5ED7]/20"
                  />
                  <div className="mt-6 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="rounded-xl border border-gray-200 px-6 py-3 font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      className="landing-btn-primary flex-1 rounded-xl py-3.5 font-semibold"
                    >
                      Get My Report
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          <p className="mt-8 text-center text-sm text-gray-500">
            <Link href="/" className="text-[#0B5ED7] hover:underline">
              Back to Omnivyra
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}
