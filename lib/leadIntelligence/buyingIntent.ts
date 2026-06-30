/**
 * Buying Intent Intelligence — DETERMINISTIC decision-support (NO AI / NO LLM).
 *
 * Turns the lead's existing signals (canonical view + tracking events + touchpoints
 * + sessions, all hydrated by the repository) into an explainable BuyingIntentProfile:
 * weighted evidence → 0–100 score with a full breakdown, ranked interests, a decision
 * stage, a provenance-preserving decision journey, and traceable conversation guidance.
 *
 * Pure + reusable: the Lead Intelligence workspace, future email/calling, CRM and
 * automations all consume the SAME object. Every point of score is attributable to a
 * named evidence item; every recommendation traces to evidence. Reuses the existing
 * enrichment projections — no duplicated telemetry or logic.
 */

import type { CanonicalLeadView } from './types';
import type { TimelineEvent } from './timeline';
import { CANONICAL_LEAD_SOURCE_LABELS } from './sourceTaxonomy';
import { websiteBehaviourProjection } from './profileEnrichment';
import { sourceDetailProjection } from './profileEnrichment';

export type EvidenceLevel = 'very_high' | 'high' | 'medium' | 'low' | 'ignored';

export interface EvidenceItem {
  id: string;
  source: string;       // canonical source / subsystem (provenance)
  type: string;         // deterministic evidence type key
  label: string;        // human-readable
  level: EvidenceLevel;
  points: number;       // contribution to the score (0 when ignored)
  occurredAt: string | null;
}

export interface ScoreBreakdownItem { label: string; points: number; level: EvidenceLevel; source: string }

export type Interest =
  | 'Campaign Planning' | 'Marketing Analytics' | 'ROI' | 'SEO' | 'Automation'
  | 'Content Marketing' | 'Social Media' | 'Lead Generation' | 'CRM' | 'Integrations'
  | 'Website Intelligence' | 'Community Intelligence';

export interface InterestScore { interest: Interest; score: number; signals: string[] }

export type DecisionStage = 'awareness' | 'interest' | 'evaluation' | 'shortlisting' | 'decision' | 'customer';

export interface DecisionJourneyStep { label: string; detail: string | null; occurredAt: string | null; provenance: string }

export interface BuyingIntentRecommendations {
  recommendedOpening: string;
  recommendedNextAction: string;
  likelyInterests: string[];
  likelyConcerns: string[];
  contentToMention: string[];
  campaignToMention: string | null;
}

export interface BuyingIntentProfile {
  score: number;                       // 0–100
  scoreBreakdown: ScoreBreakdownItem[]; // every contributing point, explained
  evidence: EvidenceItem[];
  interestProfile: InterestScore[];     // ranked desc
  decisionStage: DecisionStage;
  decisionStageRationale: string;
  decisionJourney: DecisionJourneyStep[];
  recommendations: BuyingIntentRecommendations;
  concerns: string[];
  confidence: number;                   // 0–100 (evidence breadth)
  provenance: string[];                 // distinct sources used
}

export interface BuyingIntentInputs {
  view: CanonicalLeadView;
  events?: Array<Record<string, unknown>>;
  touchpoints?: Array<Record<string, unknown>>;
  sessions?: Array<Record<string, unknown>>;
  timeline?: TimelineEvent[];
}

/* ── Deterministic weight table (the ONLY source of points) ──────────────────── */

const WEIGHTS: Record<string, { level: EvidenceLevel; points: number; label: string }> = {
  demo_intent: { level: 'very_high', points: 25, label: 'Requested a demo / sales contact' },
  contact_intent: { level: 'very_high', points: 22, label: 'Reached out to sales' },
  pricing_view: { level: 'very_high', points: 20, label: 'Viewed pricing' },
  high_intent_score: { level: 'very_high', points: 20, label: 'High scored intent signal' },
  crm_qualified: { level: 'very_high', points: 20, label: 'Qualified in CRM' },
  lead_captured: { level: 'high', points: 15, label: 'Submitted a lead form' },
  case_study_view: { level: 'high', points: 15, label: 'Viewed a case study' },
  calculator_use: { level: 'high', points: 14, label: 'Used an ROI/calculator tool' },
  assessment_use: { level: 'high', points: 14, label: 'Completed an assessment/audit' },
  marketpulse_signal: { level: 'high', points: 14, label: 'Company-level MarketPulse signal' },
  return_visit: { level: 'high', points: 12, label: 'Returned to the site' },
  video_view: { level: 'medium', points: 10, label: 'Watched a video/webinar' },
  download: { level: 'medium', points: 10, label: 'Downloaded an asset' },
  medium_intent_score: { level: 'medium', points: 10, label: 'Medium scored intent signal' },
  community_signal: { level: 'medium', points: 10, label: 'Community/listening signal' },
  engagement_signal: { level: 'medium', points: 10, label: 'Direct engagement signal' },
  features_view: { level: 'medium', points: 8, label: 'Viewed product/features' },
  blog_read: { level: 'medium', points: 8, label: 'Read blog content' },
  cta_click: { level: 'medium', points: 8, label: 'Clicked a CTA' },
  multi_session: { level: 'medium', points: 8, label: 'Multiple sessions' },
  asset_view: { level: 'low', points: 5, label: 'Viewed an asset' },
  deep_scroll: { level: 'low', points: 5, label: 'Deep page engagement (scroll)' },
  time_engaged: { level: 'low', points: 5, label: 'Sustained time on site' },
  campaign_touch: { level: 'low', points: 5, label: 'Arrived via a campaign' },
};

const PAGE_RULES: Array<{ match: RegExp; type: string }> = [
  { match: /request-demo|book-consultation|\/demo|book-a-demo/i, type: 'demo_intent' },
  { match: /contact-sales|talk-to-expert|\/contact|\/sales/i, type: 'contact_intent' },
  { match: /pricing|\/plans/i, type: 'pricing_view' },
  { match: /case-stud|customer-stor|success-stor/i, type: 'case_study_view' },
  { match: /calculator|\broi\b/i, type: 'calculator_use' },
  { match: /assessment|\/audit|free-audit|quiz/i, type: 'assessment_use' },
  { match: /video|webinar|\/watch/i, type: 'video_view' },
  { match: /\/features|\/product|\/solutions/i, type: 'features_view' },
  { match: /\/blog/i, type: 'blog_read' },
];

/** Sources that represent a submitted/known lead (vs a passive signal). */
const CAPTURE_SOURCES = new Set(['website', 'blog', 'manual', 'webhook', 'referral', 'partner', 'api', 'import', 'crm', 'other']);

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const numv = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));

function intentOf(view: CanonicalLeadView): number {
  return view.scores.intent ?? view.scores.total ?? 0;
}

/* ── Interest derivation (deterministic keyword map) ─────────────────────────── */

const INTEREST_KEYWORDS: Record<Interest, RegExp[]> = {
  'Campaign Planning': [/campaign/i, /planner/i],
  'Marketing Analytics': [/analytic/i, /\breport/i, /dashboard/i, /metric/i],
  ROI: [/\broi\b/i, /return on invest/i, /\brevenue\b/i, /conversion rate/i],
  SEO: [/\bseo\b/i, /search engine/i, /ranking/i],
  Automation: [/automation/i, /workflow/i, /automate/i],
  'Content Marketing': [/content/i, /\bblog/i, /article/i, /newsletter/i],
  'Social Media': [/social/i, /linkedin/i, /twitter|x\.com/i, /instagram/i, /carousel/i],
  'Lead Generation': [/\blead/i, /capture/i, /\bdemo\b/i, /\bform\b/i, /pipeline of leads/i],
  CRM: [/\bcrm\b/i, /pipeline/i, /\bdeal/i, /contact management/i],
  Integrations: [/integration/i, /connect/i, /\bapi\b/i, /webhook/i],
  'Website Intelligence': [/website/i, /\baudit/i, /conversion/i, /landing page/i],
  'Community Intelligence': [/community/i, /listening/i, /opportunit/i, /reddit|forum/i],
};

const INTERESTS = Object.keys(INTEREST_KEYWORDS) as Interest[];

const CONTENT_FOR_INTEREST: Record<Interest, string> = {
  'Campaign Planning': 'Campaign planning walkthrough',
  'Marketing Analytics': 'Analytics dashboard overview',
  ROI: 'ROI / revenue impact case study',
  SEO: 'SEO performance guide',
  Automation: 'Automation playbook',
  'Content Marketing': 'Content engine demo',
  'Social Media': 'Social carousel templates',
  'Lead Generation': 'Lead capture + intelligence demo',
  CRM: 'CRM integration overview',
  Integrations: 'Integrations catalog',
  'Website Intelligence': 'Website intelligence report',
  'Community Intelligence': 'Community listening demo',
};

/* ── Evidence engine ─────────────────────────────────────────────────────────── */

function urlsFrom(inputs: BuyingIntentInputs): string[] {
  const urls: string[] = [];
  for (const e of inputs.events ?? []) { const u = str(e.page_url) ?? str(e.url); if (u) urls.push(u); }
  for (const t of inputs.touchpoints ?? []) { const u = str(t.page_url); if (u) urls.push(u); }
  const sm = (inputs.view.attribution.sourceMetadata ?? {}) as Record<string, unknown>;
  const meta = (sm.metadata && typeof sm.metadata === 'object' ? sm.metadata : {}) as Record<string, unknown>;
  const web = (meta.web_attribution && typeof meta.web_attribution === 'object' ? meta.web_attribution : {}) as Record<string, unknown>;
  for (const k of ['landing_page', 'current_page', 'first_referrer', 'referrer']) {
    const u = str(web[k]); if (u) urls.push(u);
  }
  return urls;
}

function buildEvidence(inputs: BuyingIntentInputs): EvidenceItem[] {
  const { view } = inputs;
  const behaviour = websiteBehaviourProjection({ events: inputs.events, touchpoints: inputs.touchpoints, sessionCount: (inputs.sessions ?? []).length });
  const out: EvidenceItem[] = [];
  const seenTypes = new Set<string>();
  const at = view.occurredAt;

  const add = (type: string, source: string, occurredAt: string | null, detail?: string) => {
    const w = WEIGHTS[type];
    if (!w || seenTypes.has(type)) return; // one evidence item per deterministic type
    seenTypes.add(type);
    out.push({ id: `${type}:${source}`, source, type, label: detail ? `${w.label} (${detail})` : w.label, level: w.level, points: w.points, occurredAt });
  };

  // Lead conversion itself — only for direct-capture sources (a form/website/CRM lead).
  // Signal-only sources (community/engagement/marketpulse/social) are NOT form submits,
  // so they can legitimately sit at the awareness stage on weak signal alone.
  if (CAPTURE_SOURCES.has(view.source)) add('lead_captured', view.source, at);

  // Key page intent from URLs (events / touchpoints / attribution) — deterministic rules.
  const urls = urlsFrom(inputs);
  for (const rule of PAGE_RULES) {
    if (urls.some((u) => rule.match.test(u))) add(rule.type, 'tracking', at);
  }

  // Behaviour-derived evidence (existing tracking; no new telemetry).
  if (behaviour.ctaClicks > 0) add('cta_click', 'tracking', at, `${behaviour.ctaClicks}`);
  if (behaviour.downloads > 0) add('download', 'tracking', at, `${behaviour.downloads}`);
  if (behaviour.assetsViewed > 0) add('asset_view', 'tracking', at, `${behaviour.assetsViewed}`);
  if (behaviour.blogPagesViewed > 0) add('blog_read', 'tracking', at, `${behaviour.blogPagesViewed} pages`);
  if (behaviour.scrollDepth >= 75) add('deep_scroll', 'tracking', at, `${behaviour.scrollDepth}%`);
  if (behaviour.timeOnSiteSeconds >= 120) add('time_engaged', 'tracking', at, `${behaviour.timeOnSiteSeconds}s`);
  if (behaviour.returnVisits >= 1) add('return_visit', 'tracking', at, `${behaviour.returnVisits}`);
  if ((inputs.sessions ?? []).length > 2) add('multi_session', 'tracking', at, `${(inputs.sessions ?? []).length}`);

  // Score-derived evidence.
  const intent = intentOf(view);
  if (intent >= 0.7) add('high_intent_score', view.source, at, `${Math.round(intent * 100)}%`);
  else if (intent >= 0.4) add('medium_intent_score', view.source, at, `${Math.round(intent * 100)}%`);

  // Source-derived evidence.
  if (view.source === 'community') add('community_signal', 'community', at);
  if (view.source === 'engagement') add('engagement_signal', 'engagement', at);
  if (view.source === 'marketpulse') add('marketpulse_signal', 'marketpulse', at);
  if (view.source === 'crm' && (view.status ?? '').toLowerCase() === 'qualified') add('crm_qualified', 'crm', at);

  // Campaign-derived evidence.
  if (view.campaign || view.utm.campaign || view.utm.source) add('campaign_touch', 'campaign', at);

  return out;
}

/* ── Score ───────────────────────────────────────────────────────────────────── */

function scoreFromEvidence(evidence: EvidenceItem[]): { score: number; breakdown: ScoreBreakdownItem[] } {
  const breakdown = evidence
    .filter((e) => e.level !== 'ignored' && e.points > 0)
    .map((e) => ({ label: e.label, points: e.points, level: e.level, source: e.source }))
    .sort((a, b) => b.points - a.points);
  const raw = breakdown.reduce((acc, b) => acc + b.points, 0);
  return { score: clamp(Math.round(raw)), breakdown };
}

/* ── Interests ───────────────────────────────────────────────────────────────── */

function buildInterestProfile(inputs: BuyingIntentInputs, evidence: EvidenceItem[]): InterestScore[] {
  const { view } = inputs;
  const sm = (view.attribution.sourceMetadata ?? {}) as Record<string, unknown>;
  const meta = (sm.metadata && typeof sm.metadata === 'object' ? sm.metadata : {}) as Record<string, unknown>;
  const haystack: string[] = [
    ...urlsFrom(inputs),
    view.campaign ?? '', view.content ?? '', view.utm.campaign ?? '', view.utm.source ?? '',
    str(meta.primary_interest) ?? '', str(meta.intent) ?? '', view.sourceLabel,
    str(sm.opportunity_type) ?? '', str(sm.signal_category) ?? '',
  ].filter(Boolean);

  const acc = new Map<Interest, { score: number; signals: Set<string> }>();
  for (const interest of INTERESTS) {
    for (const re of INTEREST_KEYWORDS[interest]) {
      for (const h of haystack) {
        if (re.test(h)) {
          const cur = acc.get(interest) ?? { score: 0, signals: new Set<string>() };
          cur.score += 10;
          cur.signals.add(h.length > 60 ? `${h.slice(0, 57)}…` : h);
          acc.set(interest, cur);
        }
      }
    }
  }
  // Lead-Generation is always at least weakly implied for any captured lead.
  if (!acc.has('Lead Generation')) acc.set('Lead Generation', { score: 5, signals: new Set([view.sourceLabel]) });

  return [...acc.entries()]
    .map(([interest, v]) => ({ interest, score: v.score, signals: [...v.signals] }))
    .sort((a, b) => b.score - a.score || a.interest.localeCompare(b.interest));
}

/* ── Decision stage ──────────────────────────────────────────────────────────── */

function classifyStage(view: CanonicalLeadView, score: number, types: Set<string>): { stage: DecisionStage; rationale: string } {
  const status = (view.status ?? '').toLowerCase();
  if (['won', 'customer', 'paid', 'closed_won', 'converted'].includes(status)) return { stage: 'customer', rationale: `Lead status is "${status}".` };
  const hasDemo = types.has('demo_intent') || types.has('contact_intent');
  const hasPricing = types.has('pricing_view');
  const hasCase = types.has('case_study_view');
  const hasReturn = types.has('return_visit') || types.has('multi_session');
  const contentTypes = ['blog_read', 'features_view', 'video_view', 'download', 'asset_view', 'calculator_use', 'assessment_use'].filter((t) => types.has(t)).length;

  if (score >= 75 || hasDemo) return { stage: 'decision', rationale: hasDemo ? 'Requested demo/sales contact.' : `Score ${score} ≥ 75.` };
  if (score >= 55 || (hasPricing && hasCase)) return { stage: 'shortlisting', rationale: hasPricing && hasCase ? 'Viewed pricing + a case study.' : `Score ${score} ≥ 55.` };
  if (score >= 35 || (hasReturn && contentTypes >= 2)) return { stage: 'evaluation', rationale: hasReturn ? 'Repeat visits across multiple content.' : `Score ${score} ≥ 35.` };
  if (score >= 15 || contentTypes >= 1) return { stage: 'interest', rationale: contentTypes >= 1 ? 'Engaged with content.' : `Score ${score} ≥ 15.` };
  return { stage: 'awareness', rationale: 'Minimal engagement so far.' };
}

/* ── Decision journey (provenance-preserving) ────────────────────────────────── */

function buildDecisionJourney(inputs: BuyingIntentInputs, types: Set<string>): DecisionJourneyStep[] {
  const { view } = inputs;
  const sd = sourceDetailProjection(view);
  const steps: DecisionJourneyStep[] = [];
  const seen = new Set<string>();
  const push = (label: string, detail: string | null, occurredAt: string | null, provenance: string) => {
    if (seen.has(label)) return; seen.add(label);
    steps.push({ label, detail, occurredAt, provenance });
  };
  // Attribution breadcrumb (channel → campaign → content).
  sd.path.forEach((seg, i) => push(seg, i === 0 ? 'Source' : 'Attribution', null, 'attribution'));
  // Key intent pages in a deterministic, decision-ordered sequence.
  const order: Array<{ type: string; label: string }> = [
    { type: 'blog_read', label: 'Blog' }, { type: 'features_view', label: 'Features' },
    { type: 'video_view', label: 'Video' }, { type: 'case_study_view', label: 'Case study' },
    { type: 'calculator_use', label: 'Calculator' }, { type: 'assessment_use', label: 'Assessment' },
    { type: 'pricing_view', label: 'Pricing' }, { type: 'contact_intent', label: 'Contact' },
    { type: 'demo_intent', label: 'Demo' },
  ];
  for (const o of order) if (types.has(o.type)) push(o.label, 'Page intent', view.occurredAt, 'tracking');
  // Conversion.
  push('Converted', 'Lead captured', view.occurredAt, view.source);
  return steps;
}

/* ── Recommendations (deterministic, evidence-traceable) ─────────────────────── */

const NEXT_ACTION_BY_STAGE: Record<DecisionStage, string> = {
  awareness: 'Share a relevant resource to build context — no hard pitch yet.',
  interest: 'Send a tailored piece of content matching their top interest, then propose a quick call.',
  evaluation: 'Offer a guided demo focused on their top interests and address evaluation criteria.',
  shortlisting: 'Send a case study + pricing summary and propose a decision call.',
  decision: 'Reach out now — schedule the demo/meeting and remove final blockers.',
  customer: 'Nurture for expansion — surface adjacent value, not a new sale.',
};

function buildRecommendations(
  view: CanonicalLeadView,
  stage: DecisionStage,
  interests: InterestScore[],
  types: Set<string>,
  campaignName: string | null,
): BuyingIntentRecommendations {
  const top = interests.slice(0, 3);
  const topNames = top.map((i) => i.interest);
  const sourceLabel = CANONICAL_LEAD_SOURCE_LABELS[view.source] ?? view.source;
  const primary = topNames[0] ?? 'their goals';

  const concerns: string[] = [];
  if (!types.has('pricing_view')) concerns.push('Pricing & budget fit (hasn’t viewed pricing yet)');
  if (stage === 'evaluation' || stage === 'shortlisting') concerns.push('Integration & onboarding effort');
  if (!(view.identity.email || view.identity.phone)) concerns.push('Reachability / decision authority unclear');
  if (types.has('case_study_view')) concerns.push('Proof / comparable results');
  if (concerns.length === 0) concerns.push('Time-to-value');

  return {
    recommendedOpening: `Open on ${primary} — they arrived via ${sourceLabel} and are at the ${stage} stage.`,
    recommendedNextAction: NEXT_ACTION_BY_STAGE[stage],
    likelyInterests: topNames,
    likelyConcerns: concerns,
    contentToMention: top.map((i) => CONTENT_FOR_INTEREST[i.interest]),
    campaignToMention: campaignName,
  };
}

/* ── Public builder ──────────────────────────────────────────────────────────── */

export function buildBuyingIntentProfile(inputs: BuyingIntentInputs): BuyingIntentProfile {
  const { view } = inputs;
  const evidence = buildEvidence(inputs);
  const types = new Set(evidence.map((e) => e.type));
  const { score, breakdown } = scoreFromEvidence(evidence);
  const interestProfile = buildInterestProfile(inputs, evidence);
  const { stage, rationale } = classifyStage(view, score, types);
  const decisionJourney = buildDecisionJourney(inputs, types);
  const campaignName = view.campaign ?? view.utm.campaign ?? null;
  const recommendations = buildRecommendations(view, stage, interestProfile, types, campaignName);

  const provenance = [...new Set(evidence.map((e) => e.source))].sort();
  const distinctSources = provenance.length;
  const confidence = clamp(distinctSources * 15 + Math.min(evidence.length, 8) * 5);

  return {
    score,
    scoreBreakdown: breakdown,
    evidence,
    interestProfile,
    decisionStage: stage,
    decisionStageRationale: rationale,
    decisionJourney,
    recommendations,
    concerns: recommendations.likelyConcerns,
    confidence,
    provenance,
  };
}
