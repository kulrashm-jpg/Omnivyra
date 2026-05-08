/**
 * Digital Authority Snapshot Report — Dedicated Generation Page
 *
 * FREE for first use. No payment required.
 * Inline form to collect domain, business type, geography, and social links.
 * On submit, triggers the existing report generation API.
 */

import React, { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { CheckCircle2, Loader2, Zap } from 'lucide-react';
import { useCompanyContext } from '@/components/CompanyContext';
import { getAuthToken } from '@/utils/getAuthToken';
import StepTracker, { type StepDef } from '@/components/progress/StepTracker';

const SNAPSHOT_GEN_STAGES: StepDef[] = [
  { key: 'crawl',    label: 'Crawling your domain',      etaSeconds: 30 },
  { key: 'social',   label: 'Reading social signals',    etaSeconds: 30 },
  { key: 'score',    label: 'Scoring digital authority', etaSeconds: 45 },
  { key: 'insights', label: 'Drafting insights',         etaSeconds: 30 },
  { key: 'finalize', label: 'Finalizing report',         etaSeconds: 15 },
];

interface FormData {
  domain: string;
  businessType: string;
  targetGeography: string;
  socialLinks: string;
  companyName: string;
}

type Step = 'form' | 'submitting' | 'success';

const BUSINESS_TYPES = [
  'SaaS / Software',
  'E-commerce / Retail',
  'B2B Services',
  'B2C Services',
  'Agency / Consulting',
  'Healthcare',
  'Education',
  'Real Estate',
  'Finance / Fintech',
  'Other',
];

const GEO_OPTIONS = [
  'Global',
  'United States',
  'United Kingdom',
  'India',
  'Europe',
  'Southeast Asia',
  'Australia / NZ',
  'Middle East',
  'Other',
];

const STORAGE_KEY = 'omnivyra_snapshot_form';

function isValidDomain(value: string): boolean {
  const clean = value.replace(/^https?:\/\//, '').replace(/^www\./, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(clean);
}

function normalizeDomain(value: string | null | undefined): string {
  return (value || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').trim();
}

function toBusinessType(profile: Record<string, any> | null | undefined): string {
  const raw = String(
    profile?.report_settings?.default_inputs?.business_type ||
    profile?.category ||
    profile?.industry ||
    '',
  ).trim().toLowerCase();

  if (!raw) return '';
  if (raw.includes('saas') || raw.includes('software')) return 'SaaS / Software';
  if (raw.includes('ecommerce') || raw.includes('e-commerce') || raw.includes('retail')) return 'E-commerce / Retail';
  if (raw.includes('agency') || raw.includes('consult')) return 'Agency / Consulting';
  if (raw.includes('health')) return 'Healthcare';
  if (raw.includes('education')) return 'Education';
  if (raw.includes('real estate')) return 'Real Estate';
  if (raw.includes('fintech') || raw.includes('finance')) return 'Finance / Fintech';
  if (raw.includes('b2b')) return 'B2B Services';
  if (raw.includes('b2c')) return 'B2C Services';
  return 'Other';
}

function toGeography(profile: Record<string, any> | null | undefined): string {
  const raw = String(
    profile?.report_settings?.default_inputs?.geography ||
    profile?.geography ||
    (Array.isArray(profile?.geography_list) ? profile.geography_list[0] : '') ||
    '',
  ).trim();

  if (!raw) return '';
  const match = GEO_OPTIONS.find((option) => option.toLowerCase() === raw.toLowerCase());
  return match || 'Other';
}

function toSocialLinks(profile: Record<string, any> | null | undefined): string {
  const fromSettings = Array.isArray(profile?.report_settings?.default_inputs?.social_links)
    ? profile.report_settings.default_inputs.social_links
    : [];
  const fromProfiles = Array.isArray(profile?.social_profiles)
    ? profile.social_profiles.map((item: any) => item?.url).filter(Boolean)
    : [];
  const fromFields = [
    profile?.linkedin_url,
    profile?.facebook_url,
    profile?.instagram_url,
    profile?.x_url,
    profile?.youtube_url,
    profile?.tiktok_url,
    profile?.reddit_url,
    profile?.pinterest_url,
    profile?.whatsapp_url,
    profile?.blog_url,
  ].filter(Boolean);

  const all = [...fromSettings, ...fromProfiles, ...fromFields]
    .map((item) => String(item).trim())
    .filter(Boolean);

  return Array.from(new Set(all)).join('\n');
}

export default function DigitalAuthoritySnapshotPage() {
  const router = useRouter();
  const { selectedCompanyId, selectedCompanyName } = useCompanyContext();

  const [formData, setFormData] = useState<FormData>({
    domain: '',
    businessType: '',
    targetGeography: '',
    socialLinks: '',
    companyName: selectedCompanyName || '',
  });
  const [errors, setErrors] = useState<Partial<FormData>>({});
  const [step, setStep] = useState<Step>('form');
  const [apiError, setApiError] = useState<string | null>(null);
  const submittingStartedAt = useRef<number>(0);

  // Pre-fill company name when context loads
  useEffect(() => {
    if (selectedCompanyName) {
      setFormData((prev) => ({ ...prev, companyName: prev.companyName || selectedCompanyName }));
    }
  }, [selectedCompanyName]);

  // Restore persisted form data
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<FormData>;
        setFormData((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function loadCompanyProfile() {
      if (!selectedCompanyId) return;

      const token = await getAuthToken().catch(() => null);
      const res = await fetch(`/api/company-profile?companyId=${encodeURIComponent(selectedCompanyId)}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }).catch(() => null);

      if (!active || !res?.ok) return;

      const data = await res.json().catch(() => null) as { profile?: Record<string, any> } | null;
      const profile = data?.profile;
      if (!profile || !active) return;

      setFormData((prev) => {
        const next = {
          companyName: prev.companyName || profile?.report_settings?.default_inputs?.company_name || profile?.name || selectedCompanyName || '',
          domain: prev.domain || normalizeDomain(profile?.report_settings?.default_inputs?.website_domain || profile?.website_url),
          businessType: prev.businessType || toBusinessType(profile),
          targetGeography: prev.targetGeography || toGeography(profile),
          socialLinks: prev.socialLinks || toSocialLinks(profile),
        };

        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    }

    void loadCompanyProfile();
    return () => {
      active = false;
    };
  }, [selectedCompanyId, selectedCompanyName]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => {
      const next = { ...prev, [name]: value };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    if (errors[name as keyof FormData]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validate = (): boolean => {
    const errs: Partial<FormData> = {};
    if (!formData.domain.trim()) {
      errs.domain = 'Please enter your website domain';
    } else if (!isValidDomain(formData.domain)) {
      errs.domain = 'Enter a valid domain, e.g. example.com';
    }
    if (!formData.businessType) {
      errs.businessType = 'Please select your business type';
    }
    if (!formData.targetGeography) {
      errs.targetGeography = 'Please select your target geography';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setStep('submitting');
    submittingStartedAt.current = Date.now();
    setApiError(null);

    try {
      const token = await getAuthToken();
      const body = {
        domain: formData.domain.replace(/^https?:\/\//, '').replace(/^www\./, ''),
        companyId: selectedCompanyId,
        type: 'free',
        reportCategory: 'snapshot',
        isFreeReport: true,
        formData: {
          businessType: formData.businessType,
          targetGeography: formData.targetGeography,
          socialLinks: formData.socialLinks,
          companyName: formData.companyName,
        },
        generationContext: {
          source: 'manual-entry',
        },
      };

      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || `Server error ${res.status}`);
      }

      const data = await res.json().catch(() => ({})) as { reportId?: string };
      if (data.reportId) {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
        await router.push(`/reports/view/${data.reportId}?type=snapshot`);
        return;
      }

      // Clear persisted form on success
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      setStep('success');
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setStep('form');
    }
  };

  return (
    <>
      <Head>
        <title>Digital Authority Snapshot — Free Report | Omnivyra</title>
        <meta
          name="description"
          content="Generate your free Digital Authority Snapshot. See exactly what's holding your digital growth back — no payment, no credit card."
        />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 px-3 py-8 sm:px-4 lg:px-6">
        <div className="mx-auto max-w-4xl">
          <button
            onClick={() => router.push('/reports')}
            className="mb-8 inline-flex items-center gap-2 text-sm text-gray-600 transition-colors hover:text-gray-900"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back to Reports
          </button>

        {/* SUCCESS STATE */}
        {step === 'success' && (
          <div className="flex items-center justify-center min-h-[80vh] px-4">
            <div className="text-center max-w-lg">
              <div className="flex items-center justify-center w-24 h-24 bg-green-100 rounded-full mx-auto mb-6">
                <CheckCircle2 className="w-12 h-12 text-green-600" />
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-3">Report Queued!</h1>
              <p className="text-gray-600 mb-2">
                Your Digital Authority Snapshot is being generated. This takes 2–5 minutes.
              </p>
              <p className="text-sm text-gray-500 mb-8">
                We'll notify you when it's ready. You can also check the Reports section.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  onClick={() => router.push('/reports')}
                  className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
                >
                  Go to Reports
                </button>
                <button
                  onClick={() => router.push('/dashboard')}
                  className="px-6 py-3 bg-white hover:bg-gray-50 text-gray-700 font-semibold rounded-lg border border-gray-200 transition-colors"
                >
                  Go to Dashboard
                </button>
              </div>
            </div>
          </div>
        )}

        {/* FORM STATE */}
        {(step === 'form' || step === 'submitting') && (
          <>
            <div className="mb-8 rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-end">
                <div className="max-w-3xl">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Report System</p>
                  <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">Digital Authority Snapshot</h1>
                  <p className="mt-3 text-sm leading-relaxed text-gray-600 md:text-base">
                    Start with a focused baseline report that shows what is limiting your visibility, authority, and growth momentum.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 lg:w-[240px]">
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Report Type</p>
                    <p className="mt-1 text-base font-semibold text-gray-900">Free</p>
                  </div>
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Turnaround</p>
                    <p className="mt-1 text-base font-semibold text-gray-900">2-5 min</p>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Designed For</p>
                  <p className="mt-1 text-sm text-gray-700">Teams that need a credible first baseline before deeper performance or market analysis.</p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Decision Quality</p>
                  <p className="mt-1 text-sm text-gray-700">Shows the most important visibility, authority, and content gaps to act on first.</p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Output Standard</p>
                  <p className="mt-1 text-sm text-gray-700">Professional baseline report with usable takeaways, not just a teaser or scorecard.</p>
                </div>
              </div>
            </div>

            {/* What You'll Get — 3-column highlights */}
            <section className="pb-10">
              <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { icon: '🎯', title: 'Visibility vs Competitors', desc: 'See exactly where you rank and why' },
                  { icon: '📈', title: 'Content & Authority Gaps', desc: 'Discover what\'s missing from your strategy' },
                  { icon: '⚡', title: 'Quick Wins Roadmap', desc: '5–10 highest-impact changes to make today' },
                ].map((item) => (
                  <div key={item.title} className="bg-white rounded-xl border border-green-200 p-5 text-center">
                    <div className="text-3xl mb-2">{item.icon}</div>
                    <h3 className="font-bold text-gray-900 text-sm mb-1">{item.title}</h3>
                    <p className="text-xs text-gray-500">{item.desc}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Form Card */}
            <section className="pb-16">
              <div className="max-w-2xl mx-auto">
                <div className="bg-white rounded-2xl border-2 border-green-200 shadow-lg overflow-hidden">

                  {/* Form header */}
                  <div className="bg-gradient-to-r from-green-500 to-emerald-600 px-8 py-6 text-white">
                    <h2 className="text-xl font-bold mb-1">Generate Your Free Report</h2>
                    <p className="text-green-100 text-sm">
                      Fill in your details below — we'll handle the rest
                    </p>
                  </div>

                  <form onSubmit={handleSubmit} className="px-8 py-8 space-y-6" noValidate>

                    {/* Company Name */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                        Company Name <span className="text-gray-400 font-normal">(optional)</span>
                      </label>
                      <input
                        type="text"
                        name="companyName"
                        value={formData.companyName}
                        onChange={handleChange}
                        placeholder="Acme Corp"
                        className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition"
                      />
                    </div>

                    {/* Website Domain */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                        Website Domain <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        name="domain"
                        value={formData.domain}
                        onChange={handleChange}
                        placeholder="example.com"
                        autoComplete="off"
                        className={`w-full border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition ${
                          errors.domain
                            ? 'border-red-400 focus:ring-red-400 bg-red-50'
                            : 'border-gray-300 focus:ring-green-400'
                        }`}
                      />
                      {errors.domain && (
                        <p className="mt-1.5 text-xs text-red-600">{errors.domain}</p>
                      )}
                      <p className="mt-1 text-xs text-gray-400">
                        Enter without http:// — e.g. example.com or www.example.com
                      </p>
                    </div>

                    {/* Business Type */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                        Business Type <span className="text-red-500">*</span>
                      </label>
                      <select
                        name="businessType"
                        value={formData.businessType}
                        onChange={handleChange}
                        className={`w-full border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition ${
                          errors.businessType
                            ? 'border-red-400 focus:ring-red-400 bg-red-50'
                            : 'border-gray-300 focus:ring-green-400'
                        }`}
                      >
                        <option value="">Select your business type…</option>
                        {BUSINESS_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                      {errors.businessType && (
                        <p className="mt-1.5 text-xs text-red-600">{errors.businessType}</p>
                      )}
                    </div>

                    {/* Target Geography */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                        Target Geography <span className="text-red-500">*</span>
                      </label>
                      <select
                        name="targetGeography"
                        value={formData.targetGeography}
                        onChange={handleChange}
                        className={`w-full border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition ${
                          errors.targetGeography
                            ? 'border-red-400 focus:ring-red-400 bg-red-50'
                            : 'border-gray-300 focus:ring-green-400'
                        }`}
                      >
                        <option value="">Select your target region…</option>
                        {GEO_OPTIONS.map((g) => (
                          <option key={g} value={g}>{g}</option>
                        ))}
                      </select>
                      {errors.targetGeography && (
                        <p className="mt-1.5 text-xs text-red-600">{errors.targetGeography}</p>
                      )}
                    </div>

                    {/* Social Links */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                        Social Media Profiles <span className="text-gray-400 font-normal">(optional)</span>
                      </label>
                      <textarea
                        name="socialLinks"
                        value={formData.socialLinks}
                        onChange={handleChange}
                        rows={3}
                        placeholder={"linkedin.com/company/yourco\ntwitter.com/yourco\ninstagram.com/yourco"}
                        className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition resize-none"
                      />
                      <p className="mt-1 text-xs text-gray-400">
                        One URL per line — helps us include social authority in the analysis
                      </p>
                    </div>

                    {/* API Error */}
                    {apiError && (
                      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                        <p className="text-sm text-red-700">{apiError}</p>
                      </div>
                    )}

                    {/* Free badge reminder */}
                    <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-3">
                      <span className="text-2xl">✨</span>
                      <div>
                        <p className="text-sm font-bold text-green-800">Your first report is completely free</p>
                        <p className="text-xs text-green-700">No credits, no payment, no strings attached</p>
                      </div>
                    </div>

                    {/* Generation Progress */}
                    {step === 'submitting' && submittingStartedAt.current > 0 && (
                      <StepTracker
                        stages={SNAPSHOT_GEN_STAGES}
                        startedAt={submittingStartedAt.current}
                        status={apiError ? 'failed' : 'running'}
                        errorMessage={apiError ?? undefined}
                        accent="emerald"
                        title="Generating your snapshot"
                        subLabel={`Building report for ${formData.domain}`}
                        variant="card"
                      />
                    )}

                    {/* Submit */}
                    <button
                      type="submit"
                      disabled={step === 'submitting'}
                      className="w-full py-4 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:opacity-60 text-white font-bold text-base rounded-xl transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
                    >
                      {step === 'submitting' ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Generating Your Report…
                        </>
                      ) : (
                        <>
                          <Zap className="w-5 h-5" />
                          Generate My Free Report
                        </>
                      )}
                    </button>

                    <p className="text-center text-xs text-gray-400">
                      By submitting, you agree to our{' '}
                      <a href="/privacy" className="underline hover:text-gray-600">Privacy Policy</a>.
                      Your data is never shared with third parties.
                    </p>
                  </form>
                </div>

                {/* Trust signals */}
                <div className="mt-6 grid grid-cols-3 gap-3">
                  {[
                    { icon: '🔒', text: 'Secure & private' },
                    { icon: '⚡', text: 'Ready in 2–5 min' },
                    { icon: '💳', text: 'No credit card' },
                  ].map((item) => (
                    <div key={item.text} className="bg-white rounded-lg border border-gray-200 p-3 text-center">
                      <div className="text-xl mb-1">{item.icon}</div>
                      <p className="text-xs text-gray-600 font-medium">{item.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
        </div>
      </div>
    </>
  );
}
