/**
 * Visual Messaging Plan — the canonical communication-to-design contract between
 * Story Blueprint and Template Selection. It is NOT a renderer, NOT a template,
 * NOT AI. It turns the upstream understanding (Intelligence + Strategy + Journey
 * + Message + the Blueprint's narrative roles) into an explicit, design-AGNOSTIC
 * plan that every visual asset (Image / Carousel / Infographic / future) consumes.
 *
 * It contains NO rendering coordinates, NO pixels, NO fonts, NO colors, NO
 * template ids — only communication intent + recommended (not binding) design
 * hints. Pure + deterministic: same inputs → byte-identical plan.
 */

import type { ContentIntelligence } from './contentIntelligence';
import type { CommunicationStrategyResult } from './communicationStrategy';
import type { AudienceJourneyResult } from './audienceJourney';
import type { MessageDocument } from './messageFoundation';
import type { TemplateAssetFamily } from './types';
import { STORY_BLUEPRINTS, type StoryBlueprintId } from './storyBlueprint';
import { packageIntelligence, packageToArchitectureBody, type ContentPackage } from './contentPackage';
import { classifyStrategy } from './communicationStrategy';
import { classifyAudienceJourney } from './audienceJourney';
import { extractMessageDocument } from './messageExtraction';

export type VisualHierarchy = 'Hero' | 'Primary' | 'Secondary' | 'Supporting' | 'MicroCopy' | 'Evidence' | 'CTA';
export type VisualIntent = 'Hero Image' | 'Illustration' | 'Icon' | 'Product Screenshot' | 'Diagram' | 'Comparison' | 'Process' | 'Data Visualization' | 'Quote Card' | 'Statistic Card' | 'Framework' | 'Checklist' | 'Timeline' | 'Decision Matrix' | 'Roadmap';
export type Density = 'Minimal' | 'Balanced' | 'Rich' | 'Dense' | 'Very Dense';
export type ImageTreatment = 'Lifestyle Photo' | 'Product Photo' | 'Abstract Illustration' | 'Flat Illustration' | '3D Illustration' | 'Screenshot' | 'UI Mockup' | 'Data Graphic' | 'Icon Set' | 'Minimal Shape' | 'Gradient Background' | 'No Image';
export type LayoutIntent = 'Hero' | 'Split' | 'Stack' | 'Comparison' | 'Timeline' | 'Grid' | 'Checklist' | 'Quote Focus' | 'Statistic Focus' | 'Framework' | 'Problem Solution' | 'Before After';
export type Emphasis = 'Headline' | 'Statistic' | 'Quote' | 'Benefit' | 'CTA' | 'Proof' | 'Urgency' | 'Authority' | 'Emotion' | 'Comparison' | 'Problem' | 'Solution';
export type Importance = 'HIGH' | 'MEDIUM' | 'LOW';

export interface VisualMessagingUnit {
  id: string;
  role: string;
  purpose: string;
  communicationObjective: string;
  headline: string;
  supportingText: string;
  supportingBullets: string[];
  quote: string;
  statistic: string;
  example: string;
  cta: string;
  priority: number;
  importance: Importance;
  recommendedVisual: VisualIntent;
  recommendedHierarchy: VisualHierarchy;
  recommendedLayoutWeight: number;        // 1..5 relative weight (not geometry)
  recommendedImageTreatment: ImageTreatment;
  recommendedEmphasis: Emphasis;
  recommendedIconStyle: string;
  recommendedEvidence: string[];
  recommendedAnimation: string;
  recommendedWhitespace: 'Low' | 'Medium' | 'High';
  density: Density;
  notes: string;
}

export interface VisualMessagingPlan {
  planId: string;
  assetFamily: TemplateAssetFamily;
  communicationGoal: string;
  storyBlueprint: StoryBlueprintId;
  overallMessage: string;
  overallVisualIntent: LayoutIntent;
  slides: VisualMessagingUnit[];
  sections: VisualMessagingUnit[];
  globalRules: {
    tone: string | null;
    ctaIntensity: string;
    audience: string;
    baselineDensity: Density;
    emphasisPriority: Emphasis[];
    primaryQuestions: string[];
  };
  metadata: Record<string, unknown>;
}

/* ── Role planner (role → communication + design intent) ───────────────── */

interface RolePlan {
  purpose: string; hierarchy: VisualHierarchy; visual: VisualIntent; layout: LayoutIntent;
  image: ImageTreatment; emphasis: Emphasis; icon: string; animation: string;
  whitespace: VisualMessagingUnit['recommendedWhitespace']; weight: number;
  /** Which message slot fills this unit. */
  slot: 'headline' | 'statistic' | 'quote' | 'cta' | 'bullets' | 'example' | 'text';
}

const DEFAULT_PLAN: RolePlan = { purpose: 'Communicate a supporting point', hierarchy: 'Supporting', visual: 'Illustration', layout: 'Stack', image: 'Flat Illustration', emphasis: 'Headline', icon: 'line', animation: 'fade', whitespace: 'Medium', weight: 3, slot: 'text' };

const ROLE_PLANS: Array<[RegExp, RolePlan]> = [
  [/hook|cover|bold claim|hero|setup|origin/, { purpose: 'Grab attention', hierarchy: 'Hero', visual: 'Hero Image', layout: 'Hero', image: 'Lifestyle Photo', emphasis: 'Emotion', icon: 'none', animation: 'reveal', whitespace: 'High', weight: 5, slot: 'headline' }],
  [/problem|pain|challenge|tension|common belief|myth/, { purpose: 'Name the problem', hierarchy: 'Primary', visual: 'Illustration', layout: 'Problem Solution', image: 'Flat Illustration', emphasis: 'Problem', icon: 'duotone', animation: 'fade', whitespace: 'Medium', weight: 4, slot: 'text' }],
  [/solution|approach|fix|fact|after/, { purpose: 'Present the solution', hierarchy: 'Primary', visual: 'Diagram', layout: 'Problem Solution', image: 'Abstract Illustration', emphasis: 'Solution', icon: 'duotone', animation: 'fade', whitespace: 'Medium', weight: 4, slot: 'text' }],
  [/stat|result|number|proof|evidence|metric|so what/, { purpose: 'Show the evidence', hierarchy: 'Evidence', visual: 'Statistic Card', layout: 'Statistic Focus', image: 'Data Graphic', emphasis: 'Statistic', icon: 'none', animation: 'count', whitespace: 'High', weight: 5, slot: 'statistic' }],
  [/quote|testimon|advoca|customer/, { purpose: 'Build trust with a voice', hierarchy: 'Evidence', visual: 'Quote Card', layout: 'Quote Focus', image: 'Minimal Shape', emphasis: 'Quote', icon: 'none', animation: 'fade', whitespace: 'High', weight: 4, slot: 'quote' }],
  [/benefit|takeaway|outcome|implication|key/, { purpose: 'Reinforce the benefit', hierarchy: 'Secondary', visual: 'Icon', layout: 'Stack', image: 'Icon Set', emphasis: 'Benefit', icon: 'line', animation: 'fade', whitespace: 'Medium', weight: 3, slot: 'bullets' }],
  [/framework|pillar|method|criteria/, { purpose: 'Present a structured model', hierarchy: 'Primary', visual: 'Framework', layout: 'Framework', image: 'Minimal Shape', emphasis: 'Authority', icon: 'duotone', animation: 'fade', whitespace: 'Medium', weight: 4, slot: 'bullets' }],
  [/step|stage|process|how to apply|how it works/, { purpose: 'Show the process', hierarchy: 'Secondary', visual: 'Process', layout: 'Grid', image: 'Flat Illustration', emphasis: 'Solution', icon: 'numbered', animation: 'sequence', whitespace: 'Medium', weight: 3, slot: 'bullets' }],
  [/compar|option|verdict|trade|versus/, { purpose: 'Compare the options', hierarchy: 'Primary', visual: 'Comparison', layout: 'Comparison', image: 'Minimal Shape', emphasis: 'Comparison', icon: 'duotone', animation: 'fade', whitespace: 'Medium', weight: 4, slot: 'text' }],
  [/milestone|timeline|today|now|next|later/, { purpose: 'Show progression over time', hierarchy: 'Secondary', visual: 'Timeline', layout: 'Timeline', image: 'Minimal Shape', emphasis: 'Authority', icon: 'line', animation: 'sequence', whitespace: 'Medium', weight: 3, slot: 'text' }],
  [/example|in action|execution|case/, { purpose: 'Make it concrete', hierarchy: 'Secondary', visual: 'Product Screenshot', layout: 'Split', image: 'Screenshot', emphasis: 'Proof', icon: 'line', animation: 'fade', whitespace: 'Low', weight: 3, slot: 'example' }],
  [/concept|explain|insight|context|overview/, { purpose: 'Explain the concept', hierarchy: 'Secondary', visual: 'Illustration', layout: 'Split', image: 'Flat Illustration', emphasis: 'Headline', icon: 'line', animation: 'fade', whitespace: 'Medium', weight: 3, slot: 'text' }],
  [/q\d|question|faq/, { purpose: 'Answer a question', hierarchy: 'Supporting', visual: 'Icon', layout: 'Stack', image: 'Icon Set', emphasis: 'Headline', icon: 'line', animation: 'fade', whitespace: 'Medium', weight: 2, slot: 'text' }],
  [/cta|call|where to|recap|moral|lessons/, { purpose: 'Drive the action', hierarchy: 'CTA', visual: 'Icon', layout: 'Stack', image: 'Minimal Shape', emphasis: 'CTA', icon: 'solid', animation: 'pulse', whitespace: 'High', weight: 4, slot: 'cta' }],
];

function planForRole(role: string): RolePlan {
  const lc = role.toLowerCase();
  const hit = ROLE_PLANS.find(([re]) => re.test(lc));
  return hit ? hit[1] : DEFAULT_PLAN;
}

/* ── Density planner ───────────────────────────────────────────────────── */

function wc(s: string): number { return s ? s.split(/\s+/).filter(Boolean).length : 0; }
function densityOf(u: { headline: string; supportingText: string; supportingBullets: string[]; statistic: string; quote: string; example: string }): Density {
  const words = wc(u.headline) + wc(u.supportingText) + u.supportingBullets.reduce((a, b) => a + wc(b), 0) + wc(u.statistic) + wc(u.quote) + wc(u.example);
  const elements = (u.headline ? 1 : 0) + (u.supportingText ? 1 : 0) + u.supportingBullets.length + (u.statistic ? 1 : 0) + (u.quote ? 1 : 0) + (u.example ? 1 : 0);
  const score = words + elements * 4;
  return score <= 8 ? 'Minimal' : score <= 20 ? 'Balanced' : score <= 40 ? 'Rich' : score <= 70 ? 'Dense' : 'Very Dense';
}

const importanceOf = (h: VisualHierarchy): Importance => (h === 'Hero' || h === 'Evidence' || h === 'CTA' ? 'HIGH' : h === 'Primary' || h === 'Secondary' ? 'MEDIUM' : 'LOW');

/* ── Plan builder ──────────────────────────────────────────────────────── */

export interface VisualPlanInput {
  intel: ContentIntelligence;
  strategy: CommunicationStrategyResult;
  journey: AudienceJourneyResult;
  message: MessageDocument;
  assetFamily: TemplateAssetFamily;
  blueprintId?: StoryBlueprintId;
  planId?: string;
}

function baselineDensity(knowledge: string): Density {
  return knowledge === 'Beginner' ? 'Balanced' : knowledge === 'Intermediate' ? 'Balanced' : knowledge === 'Advanced' ? 'Rich' : 'Dense';
}
function emphasisPriority(strategyId: string): Emphasis[] {
  if (strategyId === 'statistics-driven' || strategyId === 'research-summary' || strategyId === 'data-narrative') return ['Statistic', 'Proof', 'Authority'];
  if (strategyId === 'case-study' || strategyId === 'social-proof' || strategyId === 'testimonial') return ['Proof', 'Quote', 'Authority'];
  if (strategyId === 'problem-solution') return ['Problem', 'Solution', 'CTA'];
  if (strategyId === 'product-marketing' || strategyId === 'feature-launch') return ['Benefit', 'CTA', 'Solution'];
  if (strategyId === 'comparison' || strategyId === 'decision-guide') return ['Comparison', 'Proof', 'CTA'];
  return ['Headline', 'Benefit', 'CTA'];
}

/** Build the canonical Visual Messaging Plan (pure, deterministic). */
export function buildVisualMessagingPlan(input: VisualPlanInput): VisualMessagingPlan {
  const blueprintId = input.blueprintId
    ?? input.journey.selectedJourney.recommendedBlueprints[0]
    ?? input.strategy.selectedStrategy.recommendedBlueprints[0]
    ?? 'educational';
  const blueprint = STORY_BLUEPRINTS[blueprintId];
  const msg = input.message;

  // Stable content cursors so each evidence/quote slot pulls a distinct item.
  let statCursor = 0, quoteCursor = 0, supportCursor = 0;
  const benefits = msg.benefits.length ? msg.benefits : msg.supportingMessages;

  const units: VisualMessagingUnit[] = blueprint.narrativeFlow.map((role, i) => {
    const rp = planForRole(role);
    let headline = '', supportingText = '', statistic = '', quote = '', example = '', cta = '';
    const supportingBullets: string[] = [];

    if (i === 0) headline = msg.mainMessage || msg.title;
    switch (rp.slot) {
      case 'headline': headline = headline || msg.mainMessage || role; break;
      case 'statistic': statistic = msg.statistics[statCursor++] ?? ''; headline = headline || statistic || role; break;
      case 'quote': quote = msg.quotes[quoteCursor++] ?? ''; headline = headline || role; break;
      case 'cta': cta = msg.ctas[0] ?? 'Learn more'; headline = headline || cta; break;
      case 'bullets': supportingBullets.push(...benefits.slice(supportCursor, supportCursor + 3)); supportCursor += supportingBullets.length; headline = headline || role; break;
      case 'example': example = msg.examples[0] ?? msg.supportingEvidence[0] ?? ''; headline = headline || role; break;
      default: headline = headline || (msg.supportingMessages[supportCursor++] ?? role); break;
    }
    if (!supportingText && rp.slot !== 'bullets') supportingText = msg.supportingMessages[Math.min(supportCursor, Math.max(0, msg.supportingMessages.length - 1))] ?? '';

    const recommendedEvidence: string[] = [];
    if (rp.hierarchy === 'Evidence') recommendedEvidence.push(...input.journey.selectedJourney.requiredEvidence);

    const unitDensity = densityOf({ headline, supportingText, supportingBullets, statistic, quote, example });
    return {
      id: `unit-${i}`, role, purpose: rp.purpose,
      communicationObjective: `${rp.purpose} (${input.strategy.selectedStrategy.communicationGoal})`,
      headline, supportingText, supportingBullets, quote, statistic, example, cta,
      priority: rp.weight, importance: importanceOf(rp.hierarchy),
      recommendedVisual: rp.visual, recommendedHierarchy: rp.hierarchy, recommendedLayoutWeight: rp.weight,
      recommendedImageTreatment: input.assetFamily === 'infographic' ? 'Data Graphic' : rp.image,
      recommendedEmphasis: rp.emphasis, recommendedIconStyle: rp.icon, recommendedEvidence,
      recommendedAnimation: rp.animation, recommendedWhitespace: rp.whitespace, density: unitDensity,
      notes: `${role} → ${rp.hierarchy} · ${rp.layout}`,
    };
  });

  const overallVisualIntent: LayoutIntent = units.find((u) => u.recommendedHierarchy === 'Hero')
    ? (planForRole(blueprint.narrativeFlow.find((r) => /problem|solution/.test(r.toLowerCase())) ? 'problem' : 'hook').layout)
    : 'Stack';

  const slidesFamilies: TemplateAssetFamily[] = ['carousel', 'image'];
  return {
    planId: input.planId ?? `vmp-${blueprintId}-${input.assetFamily}`,
    assetFamily: input.assetFamily,
    communicationGoal: input.strategy.selectedStrategy.communicationGoal,
    storyBlueprint: blueprintId,
    overallMessage: msg.mainMessage || msg.title,
    overallVisualIntent,
    slides: slidesFamilies.includes(input.assetFamily) ? units : [],
    sections: input.assetFamily === 'infographic' ? units : [],
    globalRules: {
      tone: msg.tone,
      ctaIntensity: input.journey.selectedJourney.ctaIntensity,
      audience: input.journey.selectedJourney.buyerType,
      baselineDensity: baselineDensity(input.journey.selectedJourney.knowledgeLevel),
      emphasisPriority: emphasisPriority(input.strategy.selectedStrategy.id),
      primaryQuestions: input.journey.selectedJourney.primaryQuestions,
    },
    metadata: { strategy: input.strategy.selectedStrategy.id, journey: input.journey.selectedJourney.id, unitCount: units.length },
  };
}

/* ── Package bridge ────────────────────────────────────────────────────── */

/**
 * Package → Intelligence → Strategy → Journey → (Message) → Visual Messaging
 * Plan. Deterministic; re-runs identically whenever the package changes. Reuses
 * every upstream layer — no new extraction, no new AI.
 */
export function packageVisualMessagingPlan(pkg: ContentPackage, assetFamily: TemplateAssetFamily): VisualMessagingPlan {
  const intel = packageIntelligence(pkg);
  const strategy = classifyStrategy(intel);
  const journey = classifyAudienceJourney(strategy, intel);
  const message = extractMessageDocument({ content: packageToArchitectureBody(pkg), source: 'extraction', id: pkg.id });
  return buildVisualMessagingPlan({ intel, strategy, journey, message, assetFamily, planId: `vmp-${pkg.id}-${assetFamily}` });
}

/* ── Template consumption bridge ───────────────────────────────────────── */

/**
 * Bridge: expose the plan in the shape template population consumes (Image
 * overlay / Carousel slides / Infographic sections). It does NOT touch the
 * template engine — templates simply receive richer, explicit communication.
 */
export function planToTemplateFields(plan: VisualMessagingPlan): Record<string, unknown> {
  const units = plan.slides.length ? plan.slides : plan.sections;
  if (plan.assetFamily === 'carousel') {
    return { slides: units.map((u, i) => ({ slide_number: i + 1, title: u.headline, body: u.supportingText || u.supportingBullets.join(' · '), role: u.role, emphasis: u.recommendedEmphasis })) };
  }
  if (plan.assetFamily === 'infographic') {
    return { sections: units.map((u) => ({ label: u.headline, value: u.statistic, role: u.role })), headline: plan.overallMessage };
  }
  const hero = units.find((u) => u.recommendedHierarchy === 'Hero') ?? units[0];
  const ctaUnit = units.find((u) => u.recommendedHierarchy === 'CTA');
  return { headline: hero?.headline ?? plan.overallMessage, subheadline: hero?.supportingText ?? '', cta: ctaUnit?.cta ?? '', keyInsight: units.find((u) => u.statistic)?.statistic ?? '' };
}

/* ── Search / summary ──────────────────────────────────────────────────── */

const SEARCH_ALIASES: Array<[RegExp, (u: VisualMessagingUnit) => boolean]> = [
  [/\bstat|\bnumber|\bmetric/, (u) => !!u.statistic || u.recommendedVisual === 'Statistic Card'],
  [/\bcta\b|action/, (u) => u.recommendedHierarchy === 'CTA' || !!u.cta],
  [/\bevidence|\bproof/, (u) => u.recommendedHierarchy === 'Evidence' || u.recommendedEvidence.length > 0],
  [/\bhero/, (u) => u.recommendedHierarchy === 'Hero'],
  [/\bcompar/, (u) => u.recommendedVisual === 'Comparison'],
  [/\bquote|testimon/, (u) => !!u.quote || u.recommendedVisual === 'Quote Card'],
];

/** Deterministic search across plan units. */
export function searchVisualMessagingPlan(plan: VisualMessagingPlan, query: string): VisualMessagingUnit[] {
  const units = [...plan.slides, ...plan.sections];
  const q = query.toLowerCase().replace(/^find\s+(all\s+)?/, '').trim();
  for (const [re, pred] of SEARCH_ALIASES) if (re.test(q)) return units.filter(pred);
  return units.filter((u) => `${u.role} ${u.headline} ${u.supportingText} ${u.recommendedVisual}`.toLowerCase().includes(q));
}

export interface VisualMessagingPlanSummary {
  overallMessage: string; slidePurposes: string[]; headlineOrder: string[]; evidenceCount: number;
  ctaCount: number; hierarchy: VisualHierarchy[]; density: Density[]; visualIntent: VisualIntent[];
}
export function summarizeVisualMessagingPlan(plan: VisualMessagingPlan): VisualMessagingPlanSummary {
  const units = plan.slides.length ? plan.slides : plan.sections;
  return {
    overallMessage: plan.overallMessage,
    slidePurposes: units.map((u) => u.purpose),
    headlineOrder: units.map((u) => u.headline),
    evidenceCount: units.filter((u) => u.recommendedHierarchy === 'Evidence' || u.statistic || u.quote).length,
    ctaCount: units.filter((u) => u.recommendedHierarchy === 'CTA' || u.cta).length,
    hierarchy: units.map((u) => u.recommendedHierarchy),
    density: units.map((u) => u.density),
    visualIntent: units.map((u) => u.recommendedVisual),
  };
}
