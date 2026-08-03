import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { safeFetchJson, type SafeFetchJsonError } from '@/lib/utils/safeFetchJson';
import { trackWebsiteEvent } from '@/lib/websiteAnalytics';
import { captureAttribution } from '@/lib/website/attributionCapture';
import { recordJourneyEvent } from '@/lib/website/journeyIntelligence';
import {
  COMPANY_SIZES,
  INDUSTRIES,
  PRIMARY_INTERESTS,
  LEAD_CAPTURE_INTENTS,
  type ConfirmationConfig,
  type LeadIntent,
} from '@/lib/website/leadCaptureConfig';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormState {
  firstName: string; lastName: string; email: string; phone: string; company: string;
  jobTitle: string; companySize: string; industry: string; country: string;
  primaryInterest: string; message: string; consent: boolean;
}

const emptyState = (defaultInterest: string): FormState => ({
  firstName: '', lastName: '', email: '', phone: '', company: '',
  jobTitle: '', companySize: '', industry: '', country: '',
  primaryInterest: defaultInterest, message: '', consent: false,
});

function validate(s: FormState): Record<string, string> {
  const e: Record<string, string> = {};
  if (!s.firstName.trim()) e.firstName = 'First name is required';
  if (!s.lastName.trim()) e.lastName = 'Last name is required';
  if (!s.email.trim()) e.email = 'Work email is required';
  else if (!EMAIL_RE.test(s.email.trim())) e.email = 'Enter a valid email address';
  if (!s.consent) e.consent = 'Please accept to continue';
  return e;
}

const field = 'w-full rounded-xl border border-[#C9DDF3] bg-white px-4 py-3 text-sm text-[#0B1F33] placeholder-[#90A4BC] focus:border-[#0A66C2] focus:outline-none focus:ring-2 focus:ring-[#0A66C2]/20';
const label = 'block text-xs font-semibold uppercase tracking-wide text-[#5D6F83]';

export default function LeadCaptureForm({ intent }: { intent: LeadIntent }) {
  const cfg = LEAD_CAPTURE_INTENTS[intent];
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => emptyState(cfg.defaultInterest));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<ConfirmationConfig | null>(null);
  const [honeypot, setHoneypot] = useState('');

  // INT-001 Phase 1 — journey behaviour events (append-only, storage-side):
  // form_start on the first interaction, form_abandon when the visitor leaves
  // a dirty un-submitted form, form_submit on success. Refs so listeners see
  // current values without re-binding.
  const journeyRef = React.useRef({ started: false, submitted: false });

  const set = (k: keyof FormState, v: string | boolean) => {
    if (!journeyRef.current.started) {
      journeyRef.current.started = true;
      recordJourneyEvent('form_start', { intent });
    }
    setState((s) => ({ ...s, [k]: v }));
  };
  const fieldErr = useMemo(() => errors, [errors]);

  useEffect(() => {
    const onBeforeUnload = () => {
      if (journeyRef.current.started && !journeyRef.current.submitted) {
        recordJourneyEvent('form_abandon', { intent });
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [intent]);

  // Reset when the intent changes (shared component across all four entry points).
  useEffect(() => { setState(emptyState(cfg.defaultInterest)); setErrors({}); setDone(null); setSubmitError(null); journeyRef.current = { started: false, submitted: false }; }, [intent, cfg.defaultInterest]);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setSubmitError(null);
    const v = validate(state);
    setErrors(v);
    if (Object.keys(v).length > 0) return;

    setSubmitting(true);
    const attribution = captureAttribution();
    const payload = {
      intent,
      firstName: state.firstName, lastName: state.lastName, email: state.email, phone: state.phone,
      company: state.company, jobTitle: state.jobTitle, companySize: state.companySize, industry: state.industry,
      country: state.country, primaryInterest: state.primaryInterest, message: state.message, consent: state.consent,
      company_website: honeypot, // honeypot — real users leave this empty
      ...attribution,
    };
    const res = await safeFetchJson<{ status: string; confirmation: ConfirmationConfig; fields?: Record<string, string> }>(
      '/api/website/lead-capture',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
    );
    setSubmitting(false);

    if (!res.ok) {
      const err = res as SafeFetchJsonError;
      const fieldErrors = (err.data as { fields?: Record<string, string> } | null)?.fields;
      if (fieldErrors) { setErrors(fieldErrors); return; }
      setSubmitError(err.message || 'Something went wrong. Please try again.');
      return;
    }

    journeyRef.current.submitted = true;
    recordJourneyEvent('form_submit', { intent });
    trackWebsiteEvent('lead_created', { lead_source: 'lead_capture', lead_surface: cfg.route, intent });
    const confirmation = res.data.confirmation ?? cfg.confirmation;
    if (confirmation.mode === 'redirect' && confirmation.redirectUrl) { window.location.href = confirmation.redirectUrl; return; }
    if (confirmation.mode === 'page' && confirmation.successPath) { router.push(confirmation.successPath); return; }
    setDone(confirmation);
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-[#BFE3C9] bg-[#F1FBF4] p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#1E9E5A] text-2xl text-white">✓</div>
        <h3 className="text-lg font-bold text-[#0B1F33]">Thank you</h3>
        <p className="mt-2 text-sm text-[#3C5066]">{done.message}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {submitError && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{submitError}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="firstName">First name *</label>
          <input id="firstName" className={field} value={state.firstName} onChange={(e) => set('firstName', e.target.value)} />
          {fieldErr.firstName && <p className="mt-1 text-xs text-red-600">{fieldErr.firstName}</p>}
        </div>
        <div>
          <label className={label} htmlFor="lastName">Last name *</label>
          <input id="lastName" className={field} value={state.lastName} onChange={(e) => set('lastName', e.target.value)} />
          {fieldErr.lastName && <p className="mt-1 text-xs text-red-600">{fieldErr.lastName}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="email">Work email *</label>
          <input id="email" type="email" className={field} value={state.email} onChange={(e) => set('email', e.target.value)} />
          {fieldErr.email && <p className="mt-1 text-xs text-red-600">{fieldErr.email}</p>}
        </div>
        <div>
          <label className={label} htmlFor="phone">Phone</label>
          <input id="phone" className={field} value={state.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="company">Company</label>
          <input id="company" className={field} value={state.company} onChange={(e) => set('company', e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="jobTitle">Job title</label>
          <input id="jobTitle" className={field} value={state.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor="companySize">Company size</label>
          <select id="companySize" className={field} value={state.companySize} onChange={(e) => set('companySize', e.target.value)}>
            <option value="">Select…</option>
            {COMPANY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="industry">Industry</label>
          <select id="industry" className={field} value={state.industry} onChange={(e) => set('industry', e.target.value)}>
            <option value="">Select…</option>
            {INDUSTRIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="country">Country</label>
          <input id="country" className={field} value={state.country} onChange={(e) => set('country', e.target.value)} />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="primaryInterest">Primary interest</label>
        <select id="primaryInterest" className={field} value={state.primaryInterest} onChange={(e) => set('primaryInterest', e.target.value)}>
          {PRIMARY_INTERESTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div>
        <label className={label} htmlFor="message">Message</label>
        <textarea id="message" rows={4} className={field} value={state.message} onChange={(e) => set('message', e.target.value)} />
      </div>

      {/* Honeypot — hidden from humans; bots fill it and get silently dropped server-side. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="company_website">Company website</label>
        <input id="company_website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
      </div>

      <label className="flex items-start gap-2 text-sm text-[#3C5066]">
        <input type="checkbox" className="mt-1" checked={state.consent} onChange={(e) => set('consent', e.target.checked)} />
        <span>I agree to be contacted by OmniVyra and accept the privacy policy. *</span>
      </label>
      {fieldErr.consent && <p className="-mt-2 text-xs text-red-600">{fieldErr.consent}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex min-h-[52px] w-full items-center justify-center rounded-xl bg-[#0A66C2] px-6 py-3 text-base font-semibold text-white shadow-[0_14px_34px_rgba(10,102,194,0.28)] transition hover:bg-[#0857A8] disabled:opacity-60"
      >
        {submitting ? 'Submitting…' : cfg.submitLabel}
      </button>
    </form>
  );
}
