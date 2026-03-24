/**
 * RequestAccessForm
 *
 * Shown to users whose email domain triggers `pending_review`
 * (public provider, forwarding domain, etc.).
 * Submits to POST /api/access/request.
 */

import { useState } from 'react';
import { getAuthToken } from '@/utils/getAuthToken';
import { Building2, Briefcase, FileText, Globe, CheckCircle, Clock } from 'lucide-react';

interface Props {
  email: string;
  domain: string;
  domainReason: string; // e.g. 'public_provider' | 'forwarding_domain'
  onSubmitted?: () => void;
}

const REASON_LABELS: Record<string, string> = {
  public_provider:   'a public email provider',
  forwarding_domain: 'a domain forwarder',
  no_mx:             'a domain without mail records',
};

export default function RequestAccessForm({ email, domain, domainReason, onSubmitted }: Props) {
  const [companyName, setCompanyName] = useState('');
  const [jobTitle, setJobTitle]       = useState('');
  const [useCase, setUseCase]         = useState('');
  const [websiteUrl, setWebsiteUrl]   = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [submitted, setSubmitted]     = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim() || !useCase.trim()) return;
    setLoading(true);
    setError(null);

    const token = await getAuthToken();
    if (!token) { setError('Session expired. Please sign in again.'); setLoading(false); return; }

    const res = await fetch('/api/access/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ companyName, jobTitle, useCase, websiteUrl: websiteUrl || undefined }),
    });

    const json = await res.json();
    setLoading(false);

    if (!res.ok) {
      // 409 = already submitted
      if (res.status === 409) { setSubmitted(true); return; }
      setError(json.error ?? 'Something went wrong. Please try again.');
      return;
    }

    setSubmitted(true);
    onSubmitted?.();
  }

  if (submitted) {
    return (
      <div className="text-center py-8 px-6">
        <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
          <Clock className="h-7 w-7 text-blue-500" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Request submitted</h3>
        <p className="text-sm text-gray-500 max-w-xs mx-auto">
          We&apos;ll review your request and send a decision to <strong>{email}</strong> within 1–2 business days.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-medium text-amber-700">Manual review required</span>
        </div>
        <p className="text-sm text-gray-500">
          <strong>{domain}</strong> is {REASON_LABELS[domainReason] ?? 'flagged for review'}.
          Tell us about your company and we&apos;ll approve access within 1–2 business days.
        </p>
      </div>

      <form onSubmit={e => void handleSubmit(e)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            <Building2 className="inline h-3.5 w-3.5 mr-1" />
            Company name <span className="text-red-500">*</span>
          </label>
          <input
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            required
            placeholder="Acme Corp"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            <Briefcase className="inline h-3.5 w-3.5 mr-1" />
            Job title
          </label>
          <input
            value={jobTitle}
            onChange={e => setJobTitle(e.target.value)}
            placeholder="Marketing Manager"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            <Globe className="inline h-3.5 w-3.5 mr-1" />
            Company website
          </label>
          <input
            type="url"
            value={websiteUrl}
            onChange={e => setWebsiteUrl(e.target.value)}
            placeholder="https://acmecorp.com"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            <FileText className="inline h-3.5 w-3.5 mr-1" />
            How will you use Virality? <span className="text-red-500">*</span>
          </label>
          <textarea
            value={useCase}
            onChange={e => setUseCase(e.target.value)}
            required
            rows={3}
            placeholder="e.g. We manage social media for 5 e-commerce brands and want to automate campaign creation…"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || !companyName.trim() || !useCase.trim()}
          className="w-full py-2.5 px-4 bg-[#0A66C2] text-white rounded-lg text-sm font-medium hover:bg-[#0856a8] disabled:opacity-50 transition-colors"
        >
          {loading ? 'Submitting…' : 'Request access'}
        </button>
      </form>
    </div>
  );
}
