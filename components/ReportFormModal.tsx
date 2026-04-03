import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { X } from 'lucide-react';
import { getAuthToken } from '../utils/getAuthToken';
import { useCompanyContext } from '@/components/CompanyContext';

interface ReportFormModalProps {
  isOpen: boolean;
  reportType: 'snapshot' | 'performance' | 'market' | null;
  isFreeReport: boolean;
  reportCategory?: 'snapshot' | 'performance' | 'growth';
  generationContext?: Record<string, unknown>;
  onClose: () => void;
  onSubmitSuccess: () => void;
}

interface FormData {
  domain: string;
  businessType: string;
  targetGeography: string;
  socialLinks: string;
}

const REPORT_LABELS = {
  snapshot: {
    title: 'Generate Your Free Digital Authority Snapshot',
    creditsLabel: 'Free report',
  },
  performance: {
    title: 'Generate Performance Intelligence Report',
    creditsLabel: '40–80 Credits',
  },
  market: {
    title: 'Generate Market & Growth Intelligence Report',
    creditsLabel: '80–150 Credits',
  },
};

const STORAGE_KEY = 'omniware_report_form';

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
  if (raw.includes('saas') || raw.includes('software')) return 'saas';
  if (raw.includes('ecommerce') || raw.includes('e-commerce') || raw.includes('retail')) return 'ecommerce';
  if (raw.includes('agency') || raw.includes('consult')) return 'agency';
  if (raw.includes('local')) return 'local';
  return 'other';
}

function toGeography(profile: Record<string, any> | null | undefined): string {
  return String(
    profile?.report_settings?.default_inputs?.geography ||
    profile?.geography ||
    (Array.isArray(profile?.geography_list) ? profile.geography_list[0] : '') ||
    '',
  ).trim();
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
    profile?.blog_url,
  ].filter(Boolean);

  const all = [...fromSettings, ...fromProfiles, ...fromFields]
    .map((item) => String(item).trim())
    .filter(Boolean);

  return Array.from(new Set(all)).join('\n');
}

export default function ReportFormModal({
  isOpen,
  reportType,
  isFreeReport,
  reportCategory,
  generationContext,
  onClose,
  onSubmitSuccess,
}: ReportFormModalProps) {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();

  const [formData, setFormData] = useState<FormData>({
    domain: '',
    businessType: '',
    targetGeography: '',
    socialLinks: '',
  });

  const [errors, setErrors] = useState<Partial<FormData>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentStep, setPaymentStep] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [showPreviewInsight, setShowPreviewInsight] = useState(false);
  const [submittedDomain, setSubmittedDomain] = useState<string>('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const resolvedReportCategory: 'snapshot' | 'performance' | 'growth' =
    reportCategory ??
    (reportType === 'performance' ? 'performance' : reportType === 'market' ? 'growth' : 'snapshot');

  const PREVIEW_INSIGHTS = [
    'Your content coverage appears below industry average',
    "You're missing opportunities in organic search",
    'Your competitors are outranking you in key markets',
    'Your website has untapped growth potential',
    'Your digital authority score needs attention',
  ];

  // Load persisted data on mount
  useEffect(() => {
    if (isOpen) {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          setFormData(JSON.parse(saved));
        } catch (e) {
          console.error('Failed to load saved form data');
        }
      }
    }
  }, [isOpen]);

  useEffect(() => {
    let active = true;

    async function loadCompanyProfile() {
      if (!isOpen || !selectedCompanyId) return;

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

      setFormData((prev) => ({
        domain: prev.domain || normalizeDomain(profile?.report_settings?.default_inputs?.website_domain || profile?.website_url),
        businessType: prev.businessType || toBusinessType(profile),
        targetGeography: prev.targetGeography || toGeography(profile),
        socialLinks: prev.socialLinks || toSocialLinks(profile),
      }));
    }

    void loadCompanyProfile();
    return () => {
      active = false;
    };
  }, [isOpen, selectedCompanyId]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setSubmitError(null);
    // Clear error for this field
    if (errors[name as keyof FormData]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<FormData> = {};

    if (!formData.domain.trim()) {
      newErrors.domain = 'Please enter a domain';
    } else if (!isValidDomain(formData.domain)) {
      newErrors.domain = 'Please enter a valid domain (e.g., yoursite.com)';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const isValidDomain = (domain: string): boolean => {
    const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    const simpleDomain = domain.replace(/^(https?:\/\/)?(www\.)?/, '');
    return domainRegex.test(simpleDomain);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    // Save form data
    localStorage.setItem(STORAGE_KEY, JSON.stringify(formData));
    
    // Store last submitted domain for "edit data" entry point
    localStorage.setItem('omniware_last_domain', formData.domain);
    
    // Track submitted domain for personalization
    setSubmittedDomain(formData.domain);

    setIsSubmitting(true);
    setSubmitError(null);

    // If FREE report, submit immediately
    if (isFreeReport) {
      try {
        const token = await getAuthToken();
        const res = await fetch('/api/reports/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            domain: formData.domain,
            type: 'free',
            reportCategory: resolvedReportCategory,
            formData,
            generationContext: generationContext || null,
          }),
        });
        const data = await res.json();
        if (res.ok && data.reportId) {
          handleClose();
          onSubmitSuccess();
          router.push(`/reports/view/${data.reportId}?type=snapshot`);
          return;
        }
        setSubmitError(data.error || 'Failed to generate report');
        setIsSubmitting(false);
        return;
      } catch {
        setSubmitError('Failed to generate report');
        setIsSubmitting(false);
        return;
      }
    } else {
      // For PAID, show payment confirmation step
      setPaymentStep(true);
      setIsSubmitting(false);
    }
  };

  const handleConfirmPayment = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const token = await getAuthToken();
      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          domain: formData.domain,
          type: 'premium',
          reportCategory: resolvedReportCategory,
          formData,
          generationContext: generationContext || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.reportId) {
        const viewType = reportType === 'performance' ? 'performance' : reportType === 'market' ? 'growth' : 'snapshot';
        handleClose();
        onSubmitSuccess();
        router.push(`/reports/view/${data.reportId}?type=${viewType}`);
        return;
      }
      setSubmitError(data.error || 'Failed to generate report');
      setIsSubmitting(false);
      return;
    } catch {
      setSubmitError('Failed to generate report');
      setIsSubmitting(false);
      return;
    }
  };
  
  // Helper to get submitted domain display
  const getSubmittedDomain = (): string => {
    return submittedDomain || formData.domain;
  };

  const handleBackToForm = () => {
    setPaymentStep(false);
  };

  const handleClose = () => {
    setFormData({
      domain: '',
      businessType: '',
      targetGeography: '',
      socialLinks: '',
    });
    setErrors({});
    setIsSubmitting(false);
    setPaymentStep(false);
    setSubmitSuccess(false);
    setShowPreviewInsight(false);
    setSubmittedDomain('');
    setSubmitError(null);
    onClose();
  };

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen || !reportType) return null;

  const reportLabel = REPORT_LABELS[reportType];
  const isLoading = isSubmitting;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity duration-300"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto transition-all duration-300"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-start justify-between">
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-gray-900">{reportLabel.title}</h2>
            </div>
            <button
              onClick={handleClose}
              className="ml-4 text-gray-500 hover:text-gray-700 transition-colors"
              aria-label="Close modal"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Expectation Strip */}
            <div
              className={`rounded-lg p-4 text-sm font-medium ${
                isFreeReport
                  ? 'bg-green-50 border border-green-200 text-green-800'
                  : 'bg-blue-50 border border-blue-200 text-blue-800'
              }`}
            >
              <span className="mr-2">✔</span>
              {isFreeReport
                ? 'Free report • Takes 2–3 minutes • No payment required'
                : 'Paid report • Credits will be deducted on submission'}
            </div>

            {/* Form or Payment Step */}
            {!paymentStep ? (
              // FORM STEP
              <form onSubmit={handleSubmit} className="space-y-5">
                {submitError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {submitError}
                  </div>
                )}
                {/* Domain Field */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Domain <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="domain"
                    value={formData.domain}
                    onChange={handleInputChange}
                    placeholder="yourwebsite.com"
                    disabled={isLoading}
                    className={`w-full px-4 py-3 rounded-lg border transition-colors ${
                      errors.domain
                        ? 'border-red-500 bg-red-50'
                        : 'border-gray-300 bg-white hover:border-gray-400 focus:border-green-500'
                    } focus:outline-none focus:ring-2 focus:ring-green-100 disabled:bg-gray-100 disabled:cursor-not-allowed`}
                  />
                  {errors.domain && (
                    <p className="mt-2 text-sm text-red-600">{errors.domain}</p>
                  )}
                  {!errors.domain && (
                    <p className="mt-2 text-xs text-gray-500">Enter without https:// (e.g., yourwebsite.com)</p>
                  )}
                </div>

                {/* Business Type */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Business Type
                  </label>
                  <select
                    name="businessType"
                    value={formData.businessType}
                    onChange={handleInputChange}
                    disabled={isLoading}
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100 disabled:bg-gray-100 disabled:cursor-not-allowed transition-colors"
                  >
                    <option value="">Select your business type...</option>
                    <option value="saas">SaaS</option>
                    <option value="ecommerce">E-commerce</option>
                    <option value="agency">Agency</option>
                    <option value="local">Local Business</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                {/* Target Geography */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Target Geography (optional)
                  </label>
                  <input
                    type="text"
                    name="targetGeography"
                    value={formData.targetGeography}
                    onChange={handleInputChange}
                    placeholder="India, US, Global"
                    disabled={isLoading}
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100 disabled:bg-gray-100 disabled:cursor-not-allowed transition-colors"
                  />
                </div>

                {/* Social Links */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Social Links (optional)
                  </label>
                  <textarea
                    name="socialLinks"
                    value={formData.socialLinks}
                    onChange={handleInputChange}
                    placeholder="LinkedIn, Twitter, Instagram URLs (one per line)"
                    disabled={isLoading}
                    rows={3}
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white hover:border-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100 disabled:bg-gray-100 disabled:cursor-not-allowed transition-colors resize-none"
                  />
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className={`w-full py-3 px-4 rounded-lg font-bold text-white transition-all ${
                    isFreeReport
                      ? 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:from-gray-400 disabled:to-gray-500'
                      : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-gray-400 disabled:to-gray-500'
                  } disabled:cursor-not-allowed`}
                >
                  {isLoading ? (
                    <>
                      {isFreeReport ? 'Analyzing your digital presence…' : 'Preparing your report…'}
                    </>
                  ) : isFreeReport ? (
                    'Generate Free Report'
                  ) : (
                    'Proceed to Payment'
                  )}
                </button>

                {/* Trust Signal */}
                <p className="text-center text-xs text-gray-500 mt-3">
                  Your data is secure and will not be shared.
                </p>
              </form>
            ) : (
              // PAYMENT CONFIRMATION STEP
              <div className="space-y-6">
                <div className="bg-gray-50 rounded-lg p-6 space-y-4">
                  <h3 className="text-lg font-bold text-gray-900">Confirm Your Report</h3>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between py-3 border-b border-gray-200">
                      <span className="text-gray-700">Report:</span>
                      <span className="font-semibold text-gray-900">{reportLabel.title.replace('Generate ', '')}</span>
                    </div>
                    <div className="flex items-center justify-between py-3">
                      <span className="text-gray-700">Credits to deduct:</span>
                      <span className="font-semibold text-gray-900">{reportLabel.creditsLabel}</span>
                    </div>
                  </div>

                  <p className="text-sm text-gray-600 italic">
                    Credits will be deducted once your report is generated.
                  </p>
                </div>

                <div className="space-y-3">
                  {submitError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {submitError}
                    </div>
                  )}
                  <p className="text-center text-xs text-gray-600 mb-3">
                    No charges will be made without your confirmation.
                  </p>
                  <button
                    onClick={handleConfirmPayment}
                    disabled={isLoading}
                    className="w-full py-3 px-4 rounded-lg font-bold text-white bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed transition-all"
                  >
                    {isLoading ? 'Processing...' : 'Confirm & Generate Report'}
                  </button>
                  <button
                    onClick={handleBackToForm}
                    disabled={isLoading}
                    className="w-full py-3 px-4 rounded-lg font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:cursor-not-allowed transition-colors"
                  >
                    Back to Form
                  </button>
                  <p className="text-center text-xs text-gray-500 mt-3">
                    Your data is secure and will not be shared.
                  </p>
                </div>
              </div>
            )}

            {/* Preview Insight State */}
            {showPreviewInsight && (
              <div className="fixed inset-0 flex items-center justify-center z-[60]">
                <div className="bg-white rounded-2xl p-8 shadow-2xl text-center max-w-md">
                  <div className="text-4xl mb-4">💡</div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2">Report for {getSubmittedDomain()}</h3>
                  <p className="text-sm text-gray-500 mb-4">Initial Insight</p>
                  <p className="text-gray-600 leading-relaxed">
                    Based on initial analysis, {PREVIEW_INSIGHTS[Math.floor(Math.random() * PREVIEW_INSIGHTS.length)]}
                  </p>
                  <p className="text-sm text-gray-500 mt-6 italic">
                    View your full report in the dashboard
                  </p>
                </div>
              </div>
            )}

            {/* Success State */}
            {submitSuccess && !showPreviewInsight && (
              <div className="fixed inset-0 flex items-center justify-center z-[60]">
                <div className="bg-white rounded-2xl p-8 shadow-2xl text-center max-w-md">
                  <div className="text-5xl mb-4">✓</div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Success!</h3>
                  <p className="text-gray-600">Your report request has been submitted. You'll be able to view it from your dashboard shortly.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
