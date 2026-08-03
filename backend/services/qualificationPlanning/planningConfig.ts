/**
 * INT-001 Phase 3 — deterministic tuning constants. One place to review every
 * weight, threshold, and playbook. Pure data — no logic, no I/O.
 */

import type { QualificationDimensionKey, QualificationBand, OutreachChannel } from './types';

/** Dimension weights — MUST sum to exactly 1. */
export const DIMENSION_WEIGHTS: Record<QualificationDimensionKey, number> = {
  intent: 0.3,
  urgency: 0.2,
  companyFit: 0.2,
  persona: 0.15,
  behavioralFit: 0.15,
};

/** Qualification bands over the 0..100 total score. */
export const BAND_THRESHOLDS: Array<{ band: QualificationBand; min: number }> = [
  { band: 'hot', min: 75 },
  { band: 'warm', min: 50 },
  { band: 'cool', min: 25 },
  { band: 'cold', min: 0 },
];

/** Persona → base commercial value score (0..100) for the persona dimension. */
export const PERSONA_VALUE_SCORES: Record<string, number> = {
  Founder: 90,
  CEO: 90,
  CTO: 85,
  Procurement: 75,
  Marketing: 70,
  Sales: 65,
  Developer: 60,
  Agency: 60,
  Consultant: 55,
  Partner: 55,
  Investor: 35,
  Recruiter: 15,
  Student: 10,
  Unknown: 40,
};

/** Free mailbox providers — a company domain scores higher than these. */
export const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
  'live.com', 'aol.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'mail.com', 'zoho.com', 'yandex.com',
]);

/** Academic email markers (student/researcher). */
export const STUDENT_EMAIL_MARKERS = ['.edu', '.ac.'];

/** Company sizes considered inside the default ICP. */
export const ICP_COMPANY_SIZES = new Set(['11–50', '51–200', '201–500', '501–1000', '1000+']);

/** Industries considered strong default-ICP matches. */
export const ICP_INDUSTRIES = new Set([
  'SaaS / Technology',
  'E-commerce / Retail',
  'Marketing / Agency',
  'Media / Publishing',
  'Professional Services',
]);

/** URL fragments → page signal classification used by urgency/behaviour. */
export const PAGE_SIGNAL_PATTERNS: Array<{ signal: string; patterns: string[] }> = [
  { signal: 'pricing', patterns: ['/pricing', 'plans'] },
  { signal: 'demo', patterns: ['/request-demo', '/demo', '/book-consultation'] },
  { signal: 'enterprise', patterns: ['/enterprise'] },
  { signal: 'comparison', patterns: ['/compare', '/vs-', '-vs-', '/alternatives'] },
  { signal: 'security', patterns: ['/security', '/compliance', '/trust', '/gdpr', '/soc2'] },
  { signal: 'documentation', patterns: ['/docs', '/documentation', '/api', '/developers', '/guides'] },
  { signal: 'case_study', patterns: ['/case-stud', '/customers', '/customer-success', '/stories'] },
  { signal: 'partners', patterns: ['/partners', '/partner-program', '/affiliates'] },
];

/** Recency thresholds (hours from `now` to the newest activity). */
export const RECENCY_HOURS = { immediate: 1, sameDay: 24, sameWeek: 168 } as const;

/** Deterministic channel tiebreak ordering (applied after confidence). */
export const CHANNEL_TIEBREAK_ORDER: OutreachChannel[] = [
  'linkedin', 'email', 'phone', 'whatsapp', 'sms', 'github', 'discord', 'slack', 'community',
];

/** Persona playbooks for the autonomous outreach planner. */
export const PERSONA_PLAYBOOKS: Record<string, Array<{ step: string; channel: string; detail: string }>> = {
  Founder: [
    { step: 'LinkedIn connect', channel: 'linkedin', detail: 'Short founder-to-founder note referencing their journey signals.' },
    { step: 'Personal email', channel: 'email', detail: 'One-paragraph value note; no deck, no calendar link yet.' },
    { step: 'Case study', channel: 'content', detail: 'Share the closest-industry customer story.' },
    { step: 'Meeting', channel: 'email', detail: 'Propose a 20-minute working session.' },
  ],
  CEO: [
    { step: 'LinkedIn connect', channel: 'linkedin', detail: 'Executive-level note referencing company fit.' },
    { step: 'Personal email', channel: 'email', detail: 'Outcome-first summary with one proof point.' },
    { step: 'Case study', channel: 'content', detail: 'Board-ready customer story.' },
    { step: 'Meeting', channel: 'email', detail: 'Propose an executive briefing.' },
  ],
  CTO: [
    { step: 'Technical brief', channel: 'email', detail: 'Architecture overview + integration surface.' },
    { step: 'API guide', channel: 'content', detail: 'Link the API documentation matching their doc visits.' },
    { step: 'Security documentation', channel: 'content', detail: 'Share the security/compliance pack.' },
    { step: 'Technical demo', channel: 'email', detail: 'Offer a hands-on technical session.' },
  ],
  Marketing: [
    { step: 'Whitepaper', channel: 'content', detail: 'Send the campaign-intelligence whitepaper.' },
    { step: 'Newsletter', channel: 'email', detail: 'Enroll in the marketing-intelligence newsletter.' },
    { step: 'Demo', channel: 'email', detail: 'Invite to a use-case-focused product demo.' },
  ],
  Sales: [
    { step: 'ROI one-pager', channel: 'content', detail: 'Share the pipeline-impact one-pager.' },
    { step: 'Email follow-up', channel: 'email', detail: 'Reference the pages they evaluated.' },
    { step: 'Demo', channel: 'email', detail: 'Offer a team demo with their manager invited.' },
  ],
  Developer: [
    { step: 'Technical docs', channel: 'content', detail: 'Link the developer documentation.' },
    { step: 'API guide', channel: 'content', detail: 'Share the quick-start API guide.' },
    { step: 'Community', channel: 'community', detail: 'Invite into the developer community/Discord.' },
    { step: 'Demo', channel: 'email', detail: 'Offer a technical walkthrough once activated.' },
  ],
  Agency: [
    { step: 'Partner deck', channel: 'content', detail: 'Send the agency partner deck.' },
    { step: 'Referral program', channel: 'email', detail: 'Introduce the referral/reseller program.' },
    { step: 'Meeting', channel: 'email', detail: 'Propose a partnership call.' },
  ],
  Procurement: [
    { step: 'Security documentation', channel: 'content', detail: 'Share compliance + DPA pack proactively.' },
    { step: 'Pricing summary', channel: 'email', detail: 'Provide transparent pricing/terms summary.' },
    { step: 'Meeting', channel: 'email', detail: 'Offer a procurement Q&A session.' },
  ],
  Partner: [
    { step: 'Partner deck', channel: 'content', detail: 'Send the partner program overview.' },
    { step: 'Meeting', channel: 'email', detail: 'Schedule a partnership exploration call.' },
  ],
  Consultant: [
    { step: 'Solution brief', channel: 'content', detail: 'Share the consultant enablement brief.' },
    { step: 'Email follow-up', channel: 'email', detail: 'Offer client-facing collateral.' },
    { step: 'Meeting', channel: 'email', detail: 'Propose a scoping conversation.' },
  ],
  Default: [
    { step: 'Email follow-up', channel: 'email', detail: 'Acknowledge the enquiry and reference their interest.' },
    { step: 'Relevant content', channel: 'content', detail: 'Share the closest matching resource.' },
    { step: 'Demo', channel: 'email', detail: 'Offer a product walkthrough.' },
  ],
};
