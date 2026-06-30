/**
 * Canonical lead-capture configuration (pure; shared by the public website client
 * and the server endpoint). One config drives all four entry points and their
 * confirmation behaviour — nothing about success/redirect/inline is hardcoded in
 * the form or the endpoint; it is read from here.
 */

export type LeadIntent = 'request_demo' | 'contact_sales' | 'book_consultation' | 'talk_to_expert' | 'free_audit';

export type ConfirmationMode = 'inline' | 'redirect' | 'page';

export interface ConfirmationConfig {
  mode: ConfirmationMode;
  message: string;
  /** for mode='page' — internal success route. */
  successPath?: string;
  /** for mode='redirect' — absolute or relative URL. */
  redirectUrl?: string;
}

export interface LeadCaptureIntentConfig {
  intent: LeadIntent;
  /** CTA label used across the marketing site. */
  cta: string;
  route: string;
  heading: string;
  subheading: string;
  submitLabel: string;
  defaultInterest: string;
  confirmation: ConfirmationConfig;
}

export const LEAD_INTENTS: readonly LeadIntent[] = ['request_demo', 'contact_sales', 'book_consultation', 'talk_to_expert', 'free_audit'] as const;

/** Entry points shown as marketing CTAs (the free-audit intent is a funnel migration, not a CTA). */
export const SALES_INTENTS: readonly LeadIntent[] = ['request_demo', 'contact_sales', 'book_consultation', 'talk_to_expert'] as const;

export const LEAD_CAPTURE_INTENTS: Record<LeadIntent, LeadCaptureIntentConfig> = {
  request_demo: {
    intent: 'request_demo',
    cta: 'Request a Demo',
    route: '/request-demo',
    heading: 'See OmniVyra in action',
    subheading: 'Tell us a little about your team and we’ll tailor a walkthrough to your goals.',
    submitLabel: 'Request my demo',
    defaultInterest: 'Product demo',
    confirmation: { mode: 'page', message: 'Your demo request is in — our team will reach out shortly.', successPath: '/thank-you?intent=request_demo' },
  },
  contact_sales: {
    intent: 'contact_sales',
    cta: 'Contact Sales',
    route: '/contact-sales',
    heading: 'Talk to our sales team',
    subheading: 'Share your needs and we’ll get back to you with pricing and next steps.',
    submitLabel: 'Contact sales',
    defaultInterest: 'Pricing & plans',
    confirmation: { mode: 'inline', message: 'Thanks — a sales specialist will be in touch within one business day.' },
  },
  book_consultation: {
    intent: 'book_consultation',
    cta: 'Book a Consultation',
    route: '/book-consultation',
    heading: 'Book a strategy consultation',
    subheading: 'Get a working session with a growth specialist tailored to your market.',
    submitLabel: 'Book my consultation',
    defaultInterest: 'Strategy consultation',
    confirmation: { mode: 'page', message: 'Your consultation request is received — check your inbox for scheduling.', successPath: '/thank-you?intent=book_consultation' },
  },
  talk_to_expert: {
    intent: 'talk_to_expert',
    cta: 'Talk to an Expert',
    route: '/talk-to-expert',
    heading: 'Talk to an OmniVyra expert',
    subheading: 'Have a question? Connect with someone who knows the platform inside out.',
    submitLabel: 'Talk to an expert',
    defaultInterest: 'General enquiry',
    confirmation: { mode: 'inline', message: 'Thanks for reaching out — an expert will follow up shortly.' },
  },
  // Funnel migration target (not a marketing CTA) — the free website audit now feeds
  // the canonical pipeline. Name is optional for this intent (the audit captures email).
  free_audit: {
    intent: 'free_audit',
    cta: 'Get a Free Audit',
    route: '/free-audit/start',
    heading: 'Free website audit',
    subheading: 'Get an AI-powered audit of your site’s structure, messaging, and conversion signals.',
    submitLabel: 'Get my report',
    defaultInterest: 'Website audit',
    confirmation: { mode: 'redirect', message: 'Your audit is ready.', redirectUrl: '/free-audit/report' },
  },
};

/** Intents that capture only email + consent (lighter funnels), not the full sales form. */
export const LITE_INTENTS: readonly LeadIntent[] = ['free_audit'] as const;

export function isLeadIntent(value: unknown): value is LeadIntent {
  return typeof value === 'string' && (LEAD_INTENTS as readonly string[]).includes(value);
}

export const COMPANY_SIZES = ['1–10', '11–50', '51–200', '201–500', '501–1000', '1000+'] as const;

export const INDUSTRIES = [
  'SaaS / Technology', 'E-commerce / Retail', 'Financial Services', 'Healthcare', 'Education',
  'Media / Publishing', 'Marketing / Agency', 'Manufacturing', 'Real Estate', 'Professional Services', 'Other',
] as const;

export const PRIMARY_INTERESTS = [
  'Product demo', 'Pricing & plans', 'Strategy consultation', 'Lead intelligence', 'Content & campaigns',
  'Integrations', 'Partnership', 'General enquiry',
] as const;

/** The hidden attribution field names the form carries and the server re-derives. */
export const ATTRIBUTION_FIELDS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'referrer', 'first_referrer', 'landing_page', 'current_page',
  'session_id', 'anonymous_id', 'journey_id', 'campaign_id', 'content_id',
  'asset_id', 'cta_id', 'form_id', 'website_id',
] as const;
