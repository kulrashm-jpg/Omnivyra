/**
 * Lead Actions & CRM Readiness — DETERMINISTIC action layer (NO AI / NO LLM).
 *
 * Turns a BuyingIntentProfile (+ the canonical view + existing behaviour) into a
 * LeadActionPlan: prioritised actions from a fixed catalog (selected by rules, not
 * generation), channel readiness, deterministic qualification (Unknown stays Unknown),
 * a follow-up strategy, and a CRM export package. Pure + reusable by the workspace,
 * CRM, and future email/calling/automation modules. Every action is evidence-backed;
 * nothing is inferred beyond the evidence. `now` is injectable for deterministic dates.
 */

import type { CanonicalLeadView } from './types';
import type { BuyingIntentProfile, DecisionStage } from './buyingIntent';
import type { WebsiteBehaviourProjection } from './profileEnrichment';
import { CANONICAL_LEAD_SOURCE_LABELS } from './sourceTaxonomy';

export type ActionPriority = 'critical' | 'high' | 'medium' | 'low';
export type ActionCategory = 'immediate' | 'short_term' | 'long_term' | 'monitoring';

export interface LeadAction {
  id: string;
  label: string;
  category: ActionCategory;
  priority: ActionPriority;
  reason: string;
  evidence: string[];
  expectedOutcome: string;
  confidence: number; // 0–100
  dependencies: string[];
}

export type ReadinessChannel = 'email' | 'call' | 'crm' | 'automation' | 'nurture';
export type ReadinessStatus = 'ready' | 'partial' | 'not_ready';
export interface ReadinessItem {
  channel: ReadinessChannel;
  status: ReadinessStatus;
  missingInformation: string[];
  blockers: string[];
  confidence: number;
}

export interface QualificationField { value: string; known: boolean; evidence: string[] }
export interface Qualification {
  bant: { budget: QualificationField; authority: QualificationField; need: QualificationField; timeline: QualificationField };
  meddic: { metrics: QualificationField; economicBuyer: QualificationField; decisionCriteria: QualificationField; decisionProcess: QualificationField; identifyPain: QualificationField; champion: QualificationField };
  omnivyra: { intentScore: number; decisionStage: DecisionStage; topInterest: string | null; engagementLevel: 'high' | 'medium' | 'low'; source: string };
}

export interface FollowUpStrategy {
  cadence: string;
  nextTouch: { date: string; channel: 'call' | 'email'; action: string };
  escalationRules: string[];
  expiry: { date: string; reason: string };
}

export interface CrmPackage {
  leadSummary: string;
  companySummary: string | null;
  buyingIntent: { score: number; stage: DecisionStage; confidence: number };
  interestProfile: string[];
  decisionStage: DecisionStage;
  conversationGuidance: BuyingIntentProfile['recommendations'];
  recommendedActions: string[];
  nextFollowUpDate: string;
  recommendedOwner: string | null;
  qualificationChecklist: Array<{ label: string; status: 'known' | 'unknown'; value: string }>;
  metadata: Record<string, unknown>;
}

export interface LeadActionPlan {
  actions: LeadAction[];
  readiness: ReadinessItem[];
  crmPackage: CrmPackage;
  qualification: Qualification;
  followUp: FollowUpStrategy;
  evidence: string[];
  confidence: number;
  provenance: string[];
}

export interface LeadActionInputs {
  view: CanonicalLeadView;
  buyingIntent: BuyingIntentProfile;
  behaviour?: WebsiteBehaviourProjection;
  now?: number;
}

/* ── helpers ─────────────────────────────────────────────────────────────────── */

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));
const UNKNOWN = (): QualificationField => ({ value: 'Unknown', known: false, evidence: [] });
const known = (value: string, evidence: string[]): QualificationField => ({ value, known: true, evidence });

function leadMeta(view: CanonicalLeadView): Record<string, unknown> {
  return obj(obj(view.attribution.sourceMetadata).metadata);
}
function addDays(now: number, days: number): string {
  return new Date(now + days * 86_400_000).toISOString().slice(0, 10);
}

const PRIORITY_ORDER: Record<ActionPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const CATEGORY_ORDER: Record<ActionCategory, number> = { immediate: 0, short_term: 1, long_term: 2, monitoring: 3 };

const ENTERPRISE_SIZES = new Set(['501–1000', '1000+']);
const SENIOR_TITLE = /\b(ceo|cto|cfo|coo|founder|owner|president|vp|vice president|director|head|chief)\b/i;

/* ── Action catalog (the ONLY action vocabulary) ─────────────────────────────── */

interface CatalogEntry { label: string; category: ActionCategory; priority: ActionPriority; expectedOutcome: string }
const CATALOG = {
  call_24h: { label: 'Call within 24 hours', category: 'immediate', priority: 'critical', expectedOutcome: 'Live conversation while intent is hot' },
  send_demo: { label: 'Send product demo', category: 'immediate', priority: 'high', expectedOutcome: 'Show product fit for their use case' },
  schedule_consultation: { label: 'Schedule a consultation', category: 'immediate', priority: 'high', expectedOutcome: 'Booked meeting with the lead' },
  escalate_enterprise: { label: 'Escalate to enterprise sales', category: 'immediate', priority: 'high', expectedOutcome: 'Route to an enterprise AE' },
  share_pricing: { label: 'Share pricing', category: 'short_term', priority: 'high', expectedOutcome: 'Advance the budget conversation' },
  share_case_study: { label: 'Share a case study', category: 'short_term', priority: 'medium', expectedOutcome: 'Build proof and trust' },
  share_implementation_guide: { label: 'Share implementation guide', category: 'short_term', priority: 'medium', expectedOutcome: 'Reduce onboarding/effort concern' },
  request_requirements: { label: 'Request requirements', category: 'short_term', priority: 'medium', expectedOutcome: 'Clarify scope and needs' },
  qualify_budget: { label: 'Qualify budget', category: 'short_term', priority: 'medium', expectedOutcome: 'Confirm budget fit (BANT)' },
  qualify_authority: { label: 'Qualify authority', category: 'short_term', priority: 'medium', expectedOutcome: 'Identify the decision-maker (BANT)' },
  qualify_timeline: { label: 'Qualify timeline', category: 'short_term', priority: 'medium', expectedOutcome: 'Confirm the purchase timeline (BANT)' },
  follow_up: { label: 'Follow up', category: 'long_term', priority: 'low', expectedOutcome: 'Stay top-of-mind' },
  nurture: { label: 'Add to nurture track', category: 'long_term', priority: 'low', expectedOutcome: 'Educate until sales-ready' },
  monitor_engagement: { label: 'Monitor engagement', category: 'monitoring', priority: 'low', expectedOutcome: 'Detect renewed intent' },
  enrich_identity: { label: 'Enrich identity', category: 'monitoring', priority: 'low', expectedOutcome: 'Make the lead reachable / qualifiable' },
} satisfies Record<string, CatalogEntry>;

type ActionId = keyof typeof CATALOG;

/* ── Action selection (deterministic rules) ──────────────────────────────────── */

function buildActions(view: CanonicalLeadView, intent: BuyingIntentProfile, now: number): LeadAction[] {
  const types = new Set(intent.evidence.map((e) => e.type));
  const meta = leadMeta(view);
  const hasPhone = !!view.identity.phone;
  const hasEmail = !!view.identity.email;
  const hasContact = hasPhone || hasEmail;
  const enterprise = ENTERPRISE_SIZES.has(str(meta.company_size) ?? '');
  const stage = intent.decisionStage;
  const evidenceLabels = intent.scoreBreakdown.map((b) => b.label);
  const picked = new Map<ActionId, LeadAction>();

  const add = (id: ActionId, reason: string, evidence: string[], confidence: number, dependencies: string[] = []) => {
    const c = CATALOG[id];
    const next: LeadAction = { id, label: c.label, category: c.category, priority: c.priority, reason, evidence, expectedOutcome: c.expectedOutcome, confidence: clamp(confidence), dependencies };
    const prev = picked.get(id);
    if (!prev || PRIORITY_ORDER[next.priority] < PRIORITY_ORDER[prev.priority]) picked.set(id, next);
  };

  // Stage-driven core actions.
  if (stage === 'decision') {
    if (hasPhone) add('call_24h', 'Decision-stage lead with a phone number on file.', [intent.decisionStageRationale, 'Phone present'], intent.confidence, []);
    add('schedule_consultation', 'Decision-stage intent — secure a meeting now.', [intent.decisionStageRationale], intent.confidence, hasContact ? [] : ['enrich_identity']);
    if (!types.has('demo_intent')) add('send_demo', 'High intent without an explicit demo request.', [intent.decisionStageRationale], 80);
  } else if (stage === 'shortlisting') {
    add('share_case_study', 'Shortlisting stage — proof accelerates the decision.', [intent.decisionStageRationale], 75);
    if (!types.has('pricing_view')) add('share_pricing', 'Shortlisting without a pricing view yet.', [intent.decisionStageRationale], 75);
    add('schedule_consultation', 'Shortlisting — propose a decision call.', [intent.decisionStageRationale], 70, hasContact ? [] : ['enrich_identity']);
  } else if (stage === 'evaluation') {
    add('share_implementation_guide', 'Evaluation stage — address onboarding/effort.', [intent.decisionStageRationale], 65);
    add('request_requirements', 'Evaluation stage — clarify scope to tailor the pitch.', [intent.decisionStageRationale], 65);
  } else if (stage === 'interest') {
    add('share_case_study', 'Interest stage — build trust with relevant proof.', [intent.decisionStageRationale], 55);
    add('follow_up', 'Interest stage — keep momentum with a timed follow-up.', [intent.decisionStageRationale], 55);
  } else if (stage === 'awareness') {
    add('nurture', 'Awareness stage — educate before pitching.', [intent.decisionStageRationale], 50);
    add('follow_up', 'Awareness stage — schedule a low-pressure follow-up.', [intent.decisionStageRationale], 50);
  } else if (stage === 'customer') {
    add('monitor_engagement', 'Existing customer — watch for expansion signals.', [intent.decisionStageRationale], 60);
    add('follow_up', 'Existing customer — periodic value check-in.', [intent.decisionStageRationale], 55);
  }

  // Evidence-driven actions.
  if (types.has('pricing_view') && !types.has('demo_intent')) add('send_demo', 'Viewed pricing but has not requested a demo.', ['Viewed pricing'], 78);
  if (types.has('case_study_view')) add('share_case_study', 'Already engaged with a case study — send a closely matched one.', ['Viewed a case study'], 65);
  if (enterprise) add('escalate_enterprise', `Enterprise-sized company (${str(meta.company_size)}).`, [`Company size ${str(meta.company_size)}`], 80);

  // Qualification-gap actions (only when the field is genuinely missing).
  const q = buildQualification(view, intent);
  if (!q.bant.budget.known) add('qualify_budget', 'Budget is unknown — qualify before forecasting.', ['Budget: Unknown'], 60);
  if (!q.bant.authority.known) add('qualify_authority', 'Decision authority is unclear.', ['Authority: Unknown'], 60);
  if (!q.bant.timeline.known) add('qualify_timeline', 'Purchase timeline is unknown.', ['Timeline: Unknown'], 60);

  // Reachability.
  if (!hasContact) add('enrich_identity', 'No email or phone on file — cannot reach the lead.', ['No contact identity'], 70);

  // Always monitor.
  add('monitor_engagement', 'Continuously watch for new intent signals.', evidenceLabels.slice(0, 2), 50);

  return [...picked.values()].sort((a, b) =>
    (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) ||
    (CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]) ||
    a.id.localeCompare(b.id),
  );
}

/* ── Readiness ───────────────────────────────────────────────────────────────── */

function buildReadiness(view: CanonicalLeadView, intent: BuyingIntentProfile): ReadinessItem[] {
  const meta = leadMeta(view);
  const hasEmail = !!view.identity.email;
  const hasPhone = !!view.identity.phone;
  const hasName = !!(str(meta.name) || view.unifiedPersonId);
  const hasCompany = !!str(meta.company_name);
  const consentGranted = (str(obj(view.attribution.sourceMetadata).consent_state) ?? str(meta.consent_state) ?? '') === 'granted';
  const conf = intent.confidence;

  const email: ReadinessItem = { channel: 'email', status: hasEmail ? 'ready' : 'not_ready', missingInformation: hasEmail ? [] : ['email'], blockers: hasEmail ? [] : ['No email address'], confidence: hasEmail ? clamp(conf) : clamp(conf - 20) };
  const call: ReadinessItem = { channel: 'call', status: hasPhone ? 'ready' : 'not_ready', missingInformation: hasPhone ? [] : ['phone'], blockers: hasPhone ? [] : ['No phone number'], confidence: hasPhone ? clamp(conf) : clamp(conf - 20) };

  const crmMissing = [!hasEmail && !hasPhone ? 'contact (email/phone)' : null, !hasName ? 'name' : null, !hasCompany ? 'company' : null].filter((x): x is string => !!x);
  const crm: ReadinessItem = { channel: 'crm', status: crmMissing.length === 0 ? 'ready' : crmMissing.length <= 1 ? 'partial' : 'not_ready', missingInformation: crmMissing, blockers: [], confidence: clamp(conf) };

  const automation: ReadinessItem = { channel: 'automation', status: hasEmail && consentGranted ? 'ready' : 'not_ready', missingInformation: [!hasEmail ? 'email' : null, !consentGranted ? 'marketing consent' : null].filter((x): x is string => !!x), blockers: consentGranted ? [] : ['No marketing consent on record'], confidence: clamp(conf) };
  const nurture: ReadinessItem = { channel: 'nurture', status: hasEmail ? 'ready' : 'not_ready', missingInformation: hasEmail ? [] : ['email'], blockers: [], confidence: clamp(conf) };

  return [email, call, crm, automation, nurture];
}

/* ── Qualification (Unknown stays Unknown) ───────────────────────────────────── */

function buildQualification(view: CanonicalLeadView, intent: BuyingIntentProfile): Qualification {
  const meta = leadMeta(view);
  const types = new Set(intent.evidence.map((e) => e.type));
  const title = str(meta.job_title);
  const topInterest = intent.interestProfile[0]?.interest ?? null;
  const engagementLevel: 'high' | 'medium' | 'low' = intent.score >= 60 ? 'high' : intent.score >= 30 ? 'medium' : 'low';

  // BANT — only evidence-backed fields become known.
  const budget = types.has('pricing_view') ? known('Evaluating (viewed pricing)', ['Viewed pricing']) : UNKNOWN();
  const authority = title
    ? (SENIOR_TITLE.test(title) ? known(`Decision-maker (${title})`, [`Job title: ${title}`]) : known(`Influencer (${title})`, [`Job title: ${title}`]))
    : UNKNOWN();
  const need = topInterest ? known(topInterest, intent.interestProfile[0].signals.slice(0, 2)) : UNKNOWN();
  const timeline = (types.has('demo_intent') || types.has('contact_intent'))
    ? known('Active (requested demo/contact)', ['Requested demo/sales contact'])
    : UNKNOWN();

  // MEDDIC — only the fields the evidence supports; everything else Unknown.
  const meddic = {
    metrics: UNKNOWN(),
    economicBuyer: authority.known && /Decision-maker/.test(authority.value) ? known(authority.value, authority.evidence) : UNKNOWN(),
    decisionCriteria: intent.interestProfile.length > 0 ? known(intent.interestProfile.slice(0, 3).map((i) => i.interest).join(', '), ['Derived from interest profile']) : UNKNOWN(),
    decisionProcess: UNKNOWN(),
    identifyPain: topInterest ? known(topInterest, ['Top interest']) : UNKNOWN(),
    champion: UNKNOWN(),
  };

  return {
    bant: { budget, authority, need, timeline },
    meddic,
    omnivyra: { intentScore: intent.score, decisionStage: intent.decisionStage, topInterest, engagementLevel, source: view.source },
  };
}

/* ── Follow-up strategy ──────────────────────────────────────────────────────── */

const STAGE_CADENCE: Record<DecisionStage, { cadence: string; touchDays: number; expiryDays: number }> = {
  decision: { cadence: 'Daily until contacted', touchDays: 1, expiryDays: 14 },
  shortlisting: { cadence: 'Every 2 days', touchDays: 2, expiryDays: 21 },
  evaluation: { cadence: 'Weekly', touchDays: 7, expiryDays: 45 },
  interest: { cadence: 'Every 2 weeks', touchDays: 14, expiryDays: 60 },
  awareness: { cadence: 'Monthly', touchDays: 30, expiryDays: 90 },
  customer: { cadence: 'Quarterly check-in', touchDays: 90, expiryDays: 365 },
};

function buildFollowUp(view: CanonicalLeadView, intent: BuyingIntentProfile, topAction: LeadAction | undefined, now: number): FollowUpStrategy {
  const c = STAGE_CADENCE[intent.decisionStage];
  const channel: 'call' | 'email' = view.identity.phone ? 'call' : 'email';
  const meta = leadMeta(view);
  const enterprise = ENTERPRISE_SIZES.has(str(meta.company_size) ?? '');
  const escalationRules = [
    `If no response after ${c.touchDays * 3} day(s), escalate to ${enterprise ? 'enterprise sales' : 'the sales lead'}.`,
    intent.score >= 70 ? 'High intent: escalate immediately if not contacted within 24 hours.' : `Re-evaluate stage if engagement changes (current score ${intent.score}).`,
  ];
  return {
    cadence: c.cadence,
    nextTouch: { date: addDays(now, c.touchDays), channel, action: topAction?.label ?? 'Follow up' },
    escalationRules,
    expiry: { date: addDays(now, c.expiryDays), reason: `${intent.decisionStage}-stage leads expire after ${c.expiryDays} days without engagement.` },
  };
}

/* ── CRM package ─────────────────────────────────────────────────────────────── */

function buildCrmPackage(view: CanonicalLeadView, intent: BuyingIntentProfile, actions: LeadAction[], qualification: Qualification, followUp: FollowUpStrategy): CrmPackage {
  const meta = leadMeta(view);
  const company = str(meta.company_name);
  const size = str(meta.company_size);
  const industry = str(meta.industry);
  const owner = str(meta.owner_user_id);
  const enterprise = ENTERPRISE_SIZES.has(size ?? '');
  const sourceLabel = CANONICAL_LEAD_SOURCE_LABELS[view.source] ?? view.source;

  const checklist: CrmPackage['qualificationChecklist'] = [
    { label: 'Budget', status: qualification.bant.budget.known ? 'known' : 'unknown', value: qualification.bant.budget.value },
    { label: 'Authority', status: qualification.bant.authority.known ? 'known' : 'unknown', value: qualification.bant.authority.value },
    { label: 'Need', status: qualification.bant.need.known ? 'known' : 'unknown', value: qualification.bant.need.value },
    { label: 'Timeline', status: qualification.bant.timeline.known ? 'known' : 'unknown', value: qualification.bant.timeline.value },
  ];

  return {
    leadSummary: intent.recommendations.recommendedOpening,
    companySummary: company ? [company, size ? `${size} employees` : null, industry].filter(Boolean).join(' · ') : null,
    buyingIntent: { score: intent.score, stage: intent.decisionStage, confidence: intent.confidence },
    interestProfile: intent.interestProfile.slice(0, 5).map((i) => i.interest),
    decisionStage: intent.decisionStage,
    conversationGuidance: intent.recommendations,
    recommendedActions: actions.slice(0, 5).map((a) => a.label),
    nextFollowUpDate: followUp.nextTouch.date,
    recommendedOwner: owner ? `User ${owner}` : (enterprise ? 'Enterprise sales' : null),
    qualificationChecklist: checklist,
    metadata: { source: view.source, sourceLabel, unifiedPersonId: view.unifiedPersonId, sourceRef: view.sourceRef, confidence: intent.confidence },
  };
}

/* ── Public builder ──────────────────────────────────────────────────────────── */

export function buildLeadActionPlan(inputs: LeadActionInputs): LeadActionPlan {
  const { view, buyingIntent } = inputs;
  const now = inputs.now ?? Date.now();
  const actions = buildActions(view, buyingIntent, now);
  const readiness = buildReadiness(view, buyingIntent);
  const qualification = buildQualification(view, buyingIntent);
  const followUp = buildFollowUp(view, buyingIntent, actions[0], now);
  const crmPackage = buildCrmPackage(view, buyingIntent, actions, qualification, followUp);
  const evidence = [...new Set(actions.flatMap((a) => a.evidence))];

  return {
    actions,
    readiness,
    crmPackage,
    qualification,
    followUp,
    evidence,
    confidence: buyingIntent.confidence,
    provenance: buyingIntent.provenance,
  };
}
