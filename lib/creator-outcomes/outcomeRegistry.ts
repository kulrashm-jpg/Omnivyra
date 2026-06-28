/**
 * Canonical Outcome Registry (CREATOR-044, STEP 1).
 *
 * THE single source of truth for the outcome-first Creator experience. Each
 * outcome groups creator templates by BUSINESS OUTCOME (what the user wants to
 * achieve) instead of implementation/format. Every one of the 61 system
 * templates maps to exactly one outcome (enforced by coverage tests).
 *
 * This layer is pure data — it does NOT touch the runtime. `templateIds` are the
 * canonical membership; the mapper (outcomeTemplateMapper) feeds them into the
 * EXISTING recommendation engine to resolve a concrete template_id.
 */

import type { TemplateAssetFamily } from '../creator-templates/types';

export type FunnelStage = 'awareness' | 'consideration' | 'decision' | 'retention';
export type OutcomeCategory =
  | 'launch-promote' | 'educate-explain' | 'build-authority'
  | 'prove-trust' | 'company-culture' | 'plan-structure';

export interface CreatorOutcome {
  id: string;
  label: string;
  category: OutcomeCategory;
  objective: string;            // free-text → recommender.objective
  funnelStage: FunnelStage;
  description: string;
  supportedFamilies: TemplateAssetFamily[];               // derived from templateIds
  industries: string[];
  audiences: string[];
  tags: string[];
  templateIds: Partial<Record<TemplateAssetFamily, string[]>>;     // canonical membership
  defaultTemplateIds: Partial<Record<TemplateAssetFamily, string>>; // deterministic fallback per family
  /** Optional pinned showcase ids; curated showcases live in creatorShowcaseRepository. */
  showcaseIds?: string[];
}

type OutcomeSeed = Omit<CreatorOutcome, 'supportedFamilies' | 'defaultTemplateIds'>;

/** Derive supportedFamilies + per-family default (first listed) from templateIds — single source. */
function defineOutcome(seed: OutcomeSeed): CreatorOutcome {
  const families = Object.keys(seed.templateIds) as TemplateAssetFamily[];
  const defaults: Partial<Record<TemplateAssetFamily, string>> = {};
  for (const f of families) { const ids = seed.templateIds[f]; if (ids && ids.length) defaults[f] = ids[0]; }
  return { ...seed, supportedFamilies: families, defaultTemplateIds: defaults };
}

const ALL_IND = ['marketing', 'sales', 'finance', 'healthcare', 'education', 'technology'];
const AUD = { prospects: 'prospects', customers: 'customers', execs: 'executives', practitioners: 'practitioners', candidates: 'candidates' };

export const CREATOR_OUTCOMES: CreatorOutcome[] = [
  // ── A · Launch & Promote (decision) ──────────────────────────────────────
  defineOutcome({
    id: 'launch-product', label: 'Launch a New Product', category: 'launch-promote', funnelStage: 'decision',
    objective: 'launch a new product', description: 'Introduce a new product or feature and drive first action.',
    industries: ALL_IND, audiences: [AUD.prospects, AUD.customers], tags: ['launch', 'product', 'announcement', 'release'],
    templateIds: { image: ['sys-image-product-highlight', 'sys-image-feature-highlight', 'sys-banner-product-launch'] },
  }),
  defineOutcome({
    id: 'promote-offer', label: 'Promote an Offer or Sale', category: 'launch-promote', funnelStage: 'decision',
    objective: 'promote an offer or sale', description: 'Drive conversions with a time-bound offer, discount, or promotion.',
    industries: ['marketing', 'sales', 'education', 'technology'], audiences: [AUD.prospects, AUD.customers], tags: ['promotion', 'sale', 'offer', 'discount'],
    templateIds: { image: ['sys-image-promotion', 'sys-banner-sale'] },
  }),
  defineOutcome({
    id: 'promote-event', label: 'Promote an Event', category: 'launch-promote', funnelStage: 'decision',
    objective: 'promote an event or webinar', description: 'Fill seats for a webinar, event, or live session.',
    industries: ALL_IND, audiences: [AUD.prospects, AUD.practitioners], tags: ['event', 'webinar', 'register', 'rsvp'],
    templateIds: { image: ['sys-image-event', 'sys-banner-event', 'sys-banner-webinar'] },
  }),
  defineOutcome({
    id: 'generate-leads', label: 'Generate Leads', category: 'launch-promote', funnelStage: 'decision',
    objective: 'generate leads', description: 'Capture interest with a clear value proposition and call to action.',
    industries: ALL_IND, audiences: [AUD.prospects], tags: ['leads', 'cta', 'signup', 'funnel', 'newsletter'],
    templateIds: { image: ['sys-image-headline-sub-cta', 'sys-banner-cta', 'sys-banner-newsletter'], carousel: ['sys-carousel-marketing-funnel'], infographic: ['sys-infographic-funnel'] },
  }),
  defineOutcome({
    id: 'announce-news', label: 'Announce News', category: 'launch-promote', funnelStage: 'awareness',
    objective: 'announce news or an update', description: 'Share an announcement, milestone, or company news with reach.',
    industries: ALL_IND, audiences: [AUD.customers, AUD.prospects], tags: ['announcement', 'news', 'update'],
    templateIds: { image: ['sys-image-announcement', 'sys-image-hero-announcement'] },
  }),

  // ── B · Educate & Explain (consideration) ────────────────────────────────
  defineOutcome({
    id: 'educate-audience', label: 'Educate Your Audience', category: 'educate-explain', funnelStage: 'consideration',
    objective: 'educate the audience on a concept', description: 'Teach a concept clearly with a guided, skimmable arc.',
    industries: ALL_IND, audiences: [AUD.practitioners, AUD.prospects], tags: ['educational', 'teach', 'explainer', 'concept'],
    templateIds: { carousel: ['sys-carousel-educational-5'] },
  }),
  defineOutcome({
    id: 'explain-process', label: 'Explain a Process or How-To', category: 'educate-explain', funnelStage: 'consideration',
    objective: 'explain a process or how-to', description: 'Walk through steps, a process, or a decision flow.',
    industries: ALL_IND, audiences: [AUD.practitioners], tags: ['process', 'how-to', 'steps', 'workflow', 'guide'],
    templateIds: { carousel: ['sys-carousel-step-by-step', 'sys-carousel-process', 'sys-carousel-product-walkthrough'], infographic: ['sys-infographic-process', 'sys-infographic-decision-tree', 'sys-infographic-lifecycle', 'sys-infographic-cycle', 'sys-infographic-workflow'] },
  }),
  defineOutcome({
    id: 'compare-options', label: 'Compare Options', category: 'educate-explain', funnelStage: 'consideration',
    objective: 'compare options or products', description: 'Help buyers choose with a clear side-by-side comparison.',
    industries: ['marketing', 'sales', 'finance', 'technology'], audiences: [AUD.prospects, AUD.execs], tags: ['comparison', 'versus', 'vs', 'matrix'],
    templateIds: { image: ['sys-image-comparison'], carousel: ['sys-carousel-comparison'], infographic: ['sys-infographic-comparison', 'sys-infographic-matrix', 'sys-infographic-swot', 'sys-infographic-feature-comparison'] },
  }),
  defineOutcome({
    id: 'tips-and-mistakes', label: 'Share Tips & Common Mistakes', category: 'educate-explain', funnelStage: 'consideration',
    objective: 'share tips and common mistakes', description: 'Deliver quick, practical value with tips, checklists, or pitfalls to avoid.',
    industries: ALL_IND, audiences: [AUD.practitioners], tags: ['tips', 'mistakes', 'checklist', 'listicle', 'advice'],
    templateIds: { image: ['sys-image-tip-card', 'sys-image-checklist'], carousel: ['sys-carousel-tips', 'sys-carousel-mistakes', 'sys-carousel-checklist-10', 'sys-carousel-listicle'] },
  }),
  defineOutcome({
    id: 'answer-faqs', label: 'Answer Common Questions', category: 'educate-explain', funnelStage: 'consideration',
    objective: 'answer frequently asked questions', description: 'Address the questions prospects ask most, in a clear Q&A.',
    industries: ALL_IND, audiences: [AUD.prospects, AUD.customers], tags: ['faq', 'questions', 'answers'],
    templateIds: { carousel: ['sys-carousel-faq'] },
  }),
  defineOutcome({
    id: 'present-framework', label: 'Present a Framework or Model', category: 'educate-explain', funnelStage: 'consideration',
    objective: 'present a framework or model', description: 'Make your thinking memorable with a named framework, model, or hierarchy.',
    industries: ['marketing', 'sales', 'finance', 'technology', 'education'], audiences: [AUD.execs, AUD.practitioners], tags: ['framework', 'model', 'hierarchy', 'pyramid'],
    templateIds: { carousel: ['sys-carousel-framework'], infographic: ['sys-infographic-framework', 'sys-infographic-hierarchy', 'sys-infographic-pyramid', 'sys-infographic-product-architecture', 'sys-infographic-business-model', 'sys-infographic-org-structure'] },
  }),

  // ── C · Build Authority (awareness) ──────────────────────────────────────
  defineOutcome({
    id: 'industry-insight', label: 'Share an Industry Insight', category: 'build-authority', funnelStage: 'awareness',
    objective: 'share an industry insight or point of view', description: 'Build authority with a sharp point of view or expert quote.',
    industries: ALL_IND, audiences: [AUD.execs, AUD.practitioners], tags: ['insight', 'thought-leadership', 'pov', 'quote'],
    templateIds: { image: ['sys-image-thought-leadership', 'sys-image-quote-author'], carousel: ['sys-carousel-thought-leadership'] },
  }),
  defineOutcome({
    id: 'bust-a-myth', label: 'Bust a Myth', category: 'build-authority', funnelStage: 'awareness',
    objective: 'correct a common misconception', description: 'Challenge a common misconception with a clear myth-vs-fact.',
    industries: ALL_IND, audiences: [AUD.prospects, AUD.practitioners], tags: ['myth', 'fact', 'misconception', 'truth'],
    templateIds: { image: ['sys-image-myth-fact'] },
  }),
  defineOutcome({
    id: 'highlight-statistic', label: 'Highlight a Statistic', category: 'build-authority', funnelStage: 'awareness',
    objective: 'highlight a key statistic or data point', description: 'Lead with a striking number to earn attention and trust.',
    industries: ALL_IND, audiences: [AUD.execs, AUD.prospects], tags: ['statistic', 'data', 'number', 'metric'],
    templateIds: { image: ['sys-image-statistic'], infographic: ['sys-infographic-statistics', 'sys-infographic-kpi-dashboard'] },
  }),
  defineOutcome({
    id: 'brand-awareness', label: 'Build Brand Awareness', category: 'build-authority', funnelStage: 'awareness',
    objective: 'build brand awareness', description: 'Reinforce your brand identity with a polished, on-brand statement.',
    industries: ALL_IND, audiences: [AUD.prospects, AUD.customers], tags: ['brand', 'identity', 'awareness', 'style'],
    templateIds: { image: ['sys-image-minimal-brand-card', 'sys-image-logo-only', 'sys-image-premium-luxury', 'sys-image-corporate', 'sys-image-modern-tech', 'sys-image-creative', 'sys-image-clean-editorial', 'sys-image-bold-marketing', 'sys-image-headline', 'sys-banner-website-hero'] },
  }),

  // ── D · Prove Trust & Results (decision / retention) ─────────────────────
  defineOutcome({
    id: 'increase-trust', label: 'Increase Trust', category: 'prove-trust', funnelStage: 'decision',
    objective: 'increase trust with social proof', description: 'Earn confidence with a customer testimonial or proof point.',
    industries: ALL_IND, audiences: [AUD.prospects, AUD.execs], tags: ['testimonial', 'trust', 'social-proof', 'review'],
    templateIds: { image: ['sys-image-testimonial'] },
  }),
  defineOutcome({
    id: 'customer-success', label: 'Tell a Customer Success Story', category: 'prove-trust', funnelStage: 'decision',
    objective: 'tell a customer success story', description: 'Show real results with a challenge → approach → outcome story.',
    industries: ALL_IND, audiences: [AUD.prospects, AUD.execs], tags: ['case-study', 'success', 'story', 'results'],
    templateIds: { carousel: ['sys-carousel-case-study', 'sys-carousel-storytelling-7', 'sys-carousel-customer-journey'], infographic: ['sys-infographic-customer-journey'] },
  }),
  defineOutcome({
    id: 'show-transformation', label: 'Show a Transformation', category: 'prove-trust', funnelStage: 'consideration',
    objective: 'show a before-and-after transformation', description: 'Make impact tangible with a before / after contrast.',
    industries: ALL_IND, audiences: [AUD.prospects, AUD.customers], tags: ['before-after', 'transformation', 'results', 'change'],
    templateIds: { image: ['sys-image-before-after'], carousel: ['sys-carousel-before-after', 'sys-carousel-problem-solution', 'sys-carousel-transformation'] },
  }),
  defineOutcome({
    id: 'celebrate-milestone', label: 'Celebrate a Milestone', category: 'prove-trust', funnelStage: 'awareness',
    objective: 'celebrate a milestone or thank customers', description: 'Mark a milestone or thank your community.',
    industries: ALL_IND, audiences: [AUD.customers], tags: ['milestone', 'celebrate', 'thank-you', 'anniversary'],
    templateIds: { image: ['sys-image-milestone', 'sys-image-thank-you'] },
  }),

  // ── E · Company & Culture (awareness) ────────────────────────────────────
  defineOutcome({
    id: 'hiring', label: 'Hire & Recruit', category: 'company-culture', funnelStage: 'awareness',
    objective: 'attract candidates and recruit', description: 'Attract talent with a clear, branded hiring announcement.',
    industries: ALL_IND, audiences: [AUD.candidates], tags: ['hiring', 'recruit', 'jobs', 'careers'],
    templateIds: { image: ['sys-banner-hiring'] },
  }),
  defineOutcome({
    id: 'behind-the-scenes', label: 'Show Behind the Scenes', category: 'company-culture', funnelStage: 'awareness',
    objective: 'humanize the brand with behind-the-scenes', description: 'Humanize your brand with a behind-the-scenes moment.',
    industries: ALL_IND, audiences: [AUD.customers, AUD.candidates], tags: ['culture', 'behind-the-scenes', 'team', 'human'],
    templateIds: { image: ['sys-image-behind-the-scenes'] },
  }),
  defineOutcome({
    id: 'company-update', label: 'Share a Company Update', category: 'company-culture', funnelStage: 'awareness',
    objective: 'share a company update', description: 'Keep your audience informed with a clean company update.',
    industries: ALL_IND, audiences: [AUD.customers, AUD.execs], tags: ['update', 'company', 'news'],
    templateIds: { image: ['sys-image-company-update'] },
  }),

  // ── F · Plan & Structure (consideration) ─────────────────────────────────
  defineOutcome({
    id: 'timeline-roadmap', label: 'Show a Timeline or Roadmap', category: 'plan-structure', funnelStage: 'consideration',
    objective: 'show a timeline or roadmap', description: 'Visualize a plan, history, or roadmap over time.',
    industries: ALL_IND, audiences: [AUD.execs, AUD.practitioners], tags: ['timeline', 'roadmap', 'plan', 'history'],
    templateIds: { carousel: ['sys-carousel-timeline'], infographic: ['sys-infographic-timeline', 'sys-infographic-roadmap'] },
  }),
];

export const OUTCOME_BY_ID: Record<string, CreatorOutcome> = Object.fromEntries(CREATOR_OUTCOMES.map((o) => [o.id, o]));

export function getOutcome(id: string | null | undefined): CreatorOutcome | null {
  return id ? OUTCOME_BY_ID[id] ?? null : null;
}
export function listOutcomes(): CreatorOutcome[] { return CREATOR_OUTCOMES; }

const CATEGORY_ORDER: OutcomeCategory[] = ['launch-promote', 'educate-explain', 'build-authority', 'prove-trust', 'company-culture', 'plan-structure'];
export const CATEGORY_LABELS: Record<OutcomeCategory, string> = {
  'launch-promote': 'Launch & Promote', 'educate-explain': 'Educate & Explain', 'build-authority': 'Build Authority',
  'prove-trust': 'Prove Trust & Results', 'company-culture': 'Company & Culture', 'plan-structure': 'Plan & Structure',
};
export function listOutcomesByCategory(): { category: OutcomeCategory; label: string; outcomes: CreatorOutcome[] }[] {
  return CATEGORY_ORDER.map((category) => ({ category, label: CATEGORY_LABELS[category], outcomes: CREATOR_OUTCOMES.filter((o) => o.category === category) }));
}

/** STEP 7 flag — OFF: current template browser · ON: outcome-first experience. */
export function creatorOutcomeFirstEnabled(): boolean {
  return typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_CREATOR_OUTCOME_FIRST === '1';
}
