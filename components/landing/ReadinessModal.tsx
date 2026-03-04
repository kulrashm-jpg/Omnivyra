'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useCompanyContext } from '../CompanyContext';
import { Loader2, CheckCircle, X } from 'lucide-react';

const INDUSTRIES = [
  'Technology',
  'E-commerce',
  'SaaS',
  'Healthcare',
  'Finance',
  'Education',
  'Media',
  'Retail',
  'Other',
];

const PROGRESS_MESSAGES = [
  'Scanning Website Structure',
  'Mapping CTA Hierarchy',
  'Evaluating Messaging Strength',
  'Analyzing Conversion Flow',
];

type ReadinessModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function ReadinessModal({ open, onClose }: ReadinessModalProps) {
  const { isAuthenticated } = useCompanyContext();
  const [companyName, setCompanyName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [industry, setIndustry] = useState('');
  const [monthlyTraffic, setMonthlyTraffic] = useState('');
  const [campaignBudget, setCampaignBudget] = useState('');
  const [loading, setLoading] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [score, setScore] = useState<number | null>(null);
  const [showEmailCapture, setShowEmailCapture] = useState(false);
  const [leadEmail, setLeadEmail] = useState('');
  const [leadSubmitted, setLeadSubmitted] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);
  const attachedRef = useRef(false);

  const runDummyAnalysis = () => {
    setLoading(true);
    setScore(null);
    setShowEmailCapture(false);
    setLeadSubmitted(false);
    setLeadError(null);
    const interval = setInterval(() => {
      setProgressIndex((i) => (i + 1) % PROGRESS_MESSAGES.length);
    }, 600);
    setTimeout(() => {
      clearInterval(interval);
      const newScore = 55 + Math.floor(Math.random() * 30);
      setScore(newScore);
      setLoading(false);
      if (!isAuthenticated) setShowEmailCapture(true);
    }, 2500);
  };

  const handleStartAnalysis = (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim() || !websiteUrl.trim() || !industry) return;
    runDummyAnalysis();
  };

  const handleLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadEmail.trim() || score === null) return;
    setLeadError(null);
    try {
      const res = await fetch('/api/readiness-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName.trim(),
          websiteUrl: websiteUrl.trim(),
          email: leadEmail.trim(),
          score,
          industry: industry || undefined,
          monthlyTraffic: monthlyTraffic || undefined,
          campaignBudget: campaignBudget || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to save');
      }
      setLeadSubmitted(true);
    } catch (err) {
      setLeadError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  useEffect(() => {
    if (!isAuthenticated || score === null || loading || attachedRef.current) return;
    attachedRef.current = true;
    fetch('/api/readiness-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: companyName.trim(),
        websiteUrl: websiteUrl.trim(),
        score,
        industry: industry || undefined,
        monthlyTraffic: monthlyTraffic || undefined,
        campaignBudget: campaignBudget || undefined,
      }),
      credentials: 'include',
    }).catch(() => {});
  }, [isAuthenticated, score, loading, companyName, websiteUrl, industry, monthlyTraffic, campaignBudget]);

  const resetAndClose = () => {
    attachedRef.current = false;
    setScore(null);
    setShowEmailCapture(false);
    setLeadSubmitted(false);
    setLeadEmail('');
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={resetAndClose}
        aria-hidden="true"
      />
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-xl">
        <button
          type="button"
          onClick={resetAndClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="p-6 sm:p-8">
          <h2 className="pr-10 text-2xl font-bold text-gray-900 sm:text-3xl">
            Campaign Readiness Check
          </h2>
          <p className="mt-2 text-gray-600">
            Get an instant AI-powered readiness score. No signup required to try.
          </p>

          {score === null ? (
            <form onSubmit={handleStartAnalysis} className="mt-8 space-y-4">
              <div>
                <label htmlFor="modal-companyName" className="block text-sm font-medium text-gray-700">Company name *</label>
                <input
                  id="modal-companyName"
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-2.5 focus:border-[#0B5ED7] focus:ring-1 focus:ring-[#0B5ED7]"
                  placeholder="Acme Inc"
                />
              </div>
              <div>
                <label htmlFor="modal-websiteUrl" className="block text-sm font-medium text-gray-700">Website URL *</label>
                <input
                  id="modal-websiteUrl"
                  type="url"
                  required
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-2.5 focus:border-[#0B5ED7] focus:ring-1 focus:ring-[#0B5ED7]"
                  placeholder="https://example.com"
                />
              </div>
              <div>
                <label htmlFor="modal-industry" className="block text-sm font-medium text-gray-700">Industry *</label>
                <select
                  id="modal-industry"
                  required
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-2.5 focus:border-[#0B5ED7] focus:ring-1 focus:ring-[#0B5ED7]"
                >
                  <option value="">Select industry</option>
                  {INDUSTRIES.map((i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="modal-monthlyTraffic" className="block text-sm font-medium text-gray-700">Monthly traffic (optional)</label>
                <input
                  id="modal-monthlyTraffic"
                  type="text"
                  value={monthlyTraffic}
                  onChange={(e) => setMonthlyTraffic(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-2.5 focus:border-[#0B5ED7] focus:ring-1 focus:ring-[#0B5ED7]"
                  placeholder="e.g. 10K visits"
                />
              </div>
              <div>
                <label htmlFor="modal-campaignBudget" className="block text-sm font-medium text-gray-700">Campaign budget (optional)</label>
                <input
                  id="modal-campaignBudget"
                  type="text"
                  value={campaignBudget}
                  onChange={(e) => setCampaignBudget(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-2.5 focus:border-[#0B5ED7] focus:ring-1 focus:ring-[#0B5ED7]"
                  placeholder="e.g. ₹50,000"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="mt-6 w-full rounded-omnivyra landing-btn-primary py-3.5 font-semibold disabled:opacity-70"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    {PROGRESS_MESSAGES[progressIndex]}
                  </span>
                ) : (
                  'Start AI Analysis'
                )}
              </button>
            </form>
          ) : (
            <div className="mt-8">
              <div className="flex flex-col items-center">
                <div className="relative flex h-32 w-32 items-center justify-center">
                  <svg className="h-32 w-32 -rotate-90" viewBox="0 0 36 36">
                    <path className="text-gray-200" stroke="currentColor" strokeWidth="2" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    <path className="text-[#0B5ED7]" stroke="currentColor" strokeWidth="2" strokeDasharray={`${score}, 100`} strokeLinecap="round" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                  </svg>
                  <span className="absolute text-2xl font-bold text-gray-900">{score}</span>
                </div>
                <p className="mt-4 text-lg font-semibold text-gray-700">Readiness Score</p>
                <div className="mt-6 w-full space-y-2 rounded-xl bg-[#F5F9FF] p-4 text-sm">
                  <div className="flex justify-between"><span className="text-gray-600">Structure</span><span className="font-medium">72%</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">Messaging</span><span className="font-medium">68%</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">Conversion path</span><span className="font-medium">61%</span></div>
                </div>
                {!isAuthenticated && (
                  <>
                    {!leadSubmitted ? (
                      <form onSubmit={handleLeadSubmit} className="mt-8 w-full">
                        <label htmlFor="modal-leadEmail" className="block text-sm font-medium text-gray-700">Email to save this result</label>
                        <div className="mt-2 flex gap-2">
                          <input
                            id="modal-leadEmail"
                            type="email"
                            required
                            value={leadEmail}
                            onChange={(e) => setLeadEmail(e.target.value)}
                            className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 focus:border-[#0B5ED7] focus:ring-1 focus:ring-[#0B5ED7]"
                            placeholder="you@company.com"
                          />
                          <button type="submit" className="rounded-omnivyra landing-btn-primary px-4 py-2.5 font-semibold">Save</button>
                        </div>
                        {leadError && <p className="mt-2 text-sm text-red-600">{leadError}</p>}
                      </form>
                    ) : (
                      <div className="mt-8 flex items-center gap-2 text-green-700">
                        <CheckCircle className="h-5 w-5" />
                        <span>Result saved. We’ll be in touch.</span>
                      </div>
                    )}
                  </>
                )}
                {isAuthenticated && <p className="mt-6 text-sm text-gray-600">Result attached to your account.</p>}
                <button
                  type="button"
                  onClick={() => { attachedRef.current = false; setScore(null); setShowEmailCapture(false); setLeadSubmitted(false); setLeadEmail(''); }}
                  className="mt-6 rounded-omnivyra border border-[#0B5ED7] px-4 py-2 text-sm font-semibold text-[#0B5ED7] hover:bg-[#0B5ED7]/5"
                >
                  Run another check
                </button>
                <button type="button" onClick={resetAndClose} className="mt-3 text-sm text-gray-500 hover:text-gray-700">
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
