/**
 * Asset Assembly — the single canonical handoff from strategy to design. It is
 * the ONLY place every planning layer (Message, Communication, Journey,
 * Architecture, Story Blueprint, Visual Messaging, Conversion) is combined into
 * ONE `AssetAssembly`. Templates consume exactly this object — they no longer
 * read multiple upstream planners. Pure deterministic MERGE (no inference, no
 * AI, no rendering): every field has exactly one authoritative owner. Same
 * inputs → byte-identical assembly. Contains NO pixels / fonts / colors /
 * coordinates / template ids.
 */

import type { MessageDocument } from './messageFoundation';
import type { CommunicationStrategyResult } from './communicationStrategy';
import type { AudienceJourneyResult } from './audienceJourney';
import { STORY_BLUEPRINTS } from './storyBlueprint';
import { buildVisualMessagingPlan, type VisualMessagingPlan, type VisualMessagingUnit, type VisualHierarchy, type VisualIntent, type Density, type ImageTreatment, type LayoutIntent, type Emphasis } from './visualMessagingPlan';
import { buildConversionStrategy, type ConversionStrategy } from './conversionStrategy';
import { packageIntelligence, packageToArchitectureBody, type ContentPackage } from './contentPackage';
import { classifyStrategy } from './communicationStrategy';
import { classifyAudienceJourney } from './audienceJourney';
import { extractMessageDocument } from './messageExtraction';
import type { ContentIntelligence } from './contentIntelligence';
import type { TemplateAssetFamily } from './types';

export type Importance = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AssetAssemblyUnit {
  id: string;
  role: string;
  headline: string;
  body: string;
  bullets: string[];
  quote: string;
  statistic: string;
  example: string;
  cta: string;
  purpose: string;
  communicationObjective: string;
  conversionObjective: string;
  trustRequirement: string;
  visualIntent: VisualIntent;
  layoutIntent: LayoutIntent;
  imageRecommendation: ImageTreatment;
  hierarchy: VisualHierarchy;
  density: Density;
  emphasis: Emphasis;
  priority: number;
  notes: string;
}

export interface AssetAssembly {
  assemblyId: string;
  assetFamily: TemplateAssetFamily;
  message: { mainMessage: string; summary: string; audience: string | null; objective: string | null; tone: string | null };
  communication: { strategy: string; communicationGoal: string; intent: string };
  journey: { id: string; awarenessStage: string; decisionStage: string; trustLevel: string; ctaIntensity: string; audience: string };
  architecture: { contentSequence: string[]; recommendedOrder: string[] };
  storyBlueprint: { id: string; narrativeFlow: string[] };
  visualMessaging: { overallVisualIntent: LayoutIntent; unitCount: number };
  conversion: { goal: string; trustRequirement: string; ctaIntensity: string; ctaPlacement: string; ctaStyle: string; objections: string[]; requiredAssets: string[]; channels: string[] };
  slides: AssetAssemblyUnit[];
  sections: AssetAssemblyUnit[];
  assets: AssetAssemblyUnit[];
  globalRules: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

/* ── Merge (one authoritative owner per field) ─────────────────────────── */

export interface AssemblyInput {
  message: MessageDocument;
  strategy: CommunicationStrategyResult;
  journey: AudienceJourneyResult;
  plan: VisualMessagingPlan;
  conversion: ConversionStrategy;
  assetFamily: TemplateAssetFamily;
}

function toUnit(u: VisualMessagingUnit, conv: ConversionStrategy, plan: VisualMessagingPlan): AssetAssemblyUnit {
  const isCta = u.recommendedHierarchy === 'CTA' || !!u.cta;
  const isEvidence = u.recommendedHierarchy === 'Evidence';
  const ctaStep = conv.conversionSequence.find((c) => /cta|action|follow/i.test(c.stage));
  return {
    id: u.id, role: u.role,
    // OWNER: Visual Messaging Plan — headline/body/bullets/quote/statistic/example.
    headline: u.headline, body: u.supportingText, bullets: u.supportingBullets, quote: u.quote, statistic: u.statistic, example: u.example,
    // OWNER: Conversion Strategy — cta + conversion objective + trust.
    cta: isCta ? (u.cta || (ctaStep ? ctaStep.recommendedMessage : '') || 'Learn more') : u.cta,
    purpose: u.purpose, communicationObjective: u.communicationObjective,
    conversionObjective: isCta ? conv.primaryConversion : isEvidence ? 'Build trust' : 'Advance the message',
    trustRequirement: isEvidence || isCta ? conv.trustRequirement : 'None',
    // OWNER: Visual Messaging Plan — every visual/layout/density/emphasis hint.
    visualIntent: u.recommendedVisual, layoutIntent: plan.overallVisualIntent, imageRecommendation: u.recommendedImageTreatment,
    hierarchy: u.recommendedHierarchy, density: u.density, emphasis: u.recommendedEmphasis, priority: u.priority, notes: u.notes,
  };
}

/** Deterministic merge of every planner into one AssetAssembly. */
export function buildAssetAssembly(input: AssemblyInput): AssetAssembly {
  const bp = STORY_BLUEPRINTS[input.plan.storyBlueprint];
  const planUnits = input.plan.slides.length ? input.plan.slides : input.plan.sections;
  const units = planUnits.map((u) => toUnit(u, input.conversion, input.plan));
  const isInfographic = input.assetFamily === 'infographic';

  return {
    assemblyId: `asm-${input.plan.storyBlueprint}-${input.assetFamily}`,
    assetFamily: input.assetFamily,
    message: { mainMessage: input.message.mainMessage, summary: input.message.summary, audience: input.message.audience, objective: input.message.objective, tone: input.message.tone }, // OWNER: Message Foundation
    communication: { strategy: input.strategy.selectedStrategy.id, communicationGoal: input.strategy.selectedStrategy.communicationGoal, intent: input.strategy.selectedStrategy.communicationIntent }, // OWNER: Communication Strategy
    journey: { id: input.journey.selectedJourney.id, awarenessStage: input.journey.selectedJourney.awarenessStage, decisionStage: input.journey.selectedJourney.decisionStage, trustLevel: input.journey.selectedJourney.trustLevel, ctaIntensity: input.journey.selectedJourney.ctaIntensity, audience: input.journey.selectedJourney.buyerType }, // OWNER: Audience Journey
    architecture: { contentSequence: bp.narrativeFlow, recommendedOrder: input.journey.selectedJourney.recommendedContentOrder }, // OWNER: Story Blueprint (narrative) + Journey (order)
    storyBlueprint: { id: input.plan.storyBlueprint, narrativeFlow: bp.narrativeFlow },
    visualMessaging: { overallVisualIntent: input.plan.overallVisualIntent, unitCount: units.length },
    conversion: { goal: input.conversion.conversionGoal, trustRequirement: input.conversion.trustRequirement, ctaIntensity: input.conversion.ctaIntensity, ctaPlacement: input.conversion.ctaPlacement, ctaStyle: input.conversion.ctaStyle, objections: input.conversion.likelyObjections, requiredAssets: input.conversion.requiredAssets, channels: input.conversion.recommendedChannels }, // OWNER: Conversion Strategy
    slides: isInfographic ? [] : units,
    sections: isInfographic ? units : [],
    assets: units,
    globalRules: {
      tone: input.message.tone, audience: input.journey.selectedJourney.buyerType,
      ctaIntensity: input.conversion.ctaIntensity, ctaPlacement: input.conversion.ctaPlacement,
      trustRequirement: input.conversion.trustRequirement, emphasisPriority: input.plan.globalRules.emphasisPriority,
      baselineDensity: input.plan.globalRules.baselineDensity,
    },
    metadata: { strategy: input.strategy.selectedStrategy.id, journey: input.journey.selectedJourney.id, conversionGoal: input.conversion.conversionGoal, blueprint: input.plan.storyBlueprint },
  };
}

/* ── Package bridge ────────────────────────────────────────────────────── */

export function packageAssetAssembly(pkg: ContentPackage, assetFamily: TemplateAssetFamily): AssetAssembly {
  const intel: ContentIntelligence = packageIntelligence(pkg);
  const strategy = classifyStrategy(intel);
  const journey = classifyAudienceJourney(strategy, intel);
  const message = extractMessageDocument({ content: packageToArchitectureBody(pkg), source: 'extraction', id: pkg.id });
  const plan = buildVisualMessagingPlan({ intel, strategy, journey, message, assetFamily, planId: `vmp-${pkg.id}-${assetFamily}` });
  const conversion = buildConversionStrategy({ intel, strategy, journey, message, plan, assetFamily });
  return buildAssetAssembly({ message, strategy, journey, plan, conversion, assetFamily });
}

/* ── Template bridge (the single template input) ───────────────────────── */

/** The ONE function templates call — projects the assembly per family. */
export function assemblyToTemplateFields(asm: AssetAssembly): Record<string, unknown> {
  const units = asm.slides.length ? asm.slides : asm.sections;
  const cta = units.find((u) => u.hierarchy === 'CTA');
  const conversionFields = { cta: cta ? cta.cta : '', cta_intensity: asm.conversion.ctaIntensity, cta_placement: asm.conversion.ctaPlacement, cta_style: asm.conversion.ctaStyle, offer: asm.conversion.goal, proof: asm.conversion.objections, trust: asm.conversion.trustRequirement };
  if (asm.assetFamily === 'carousel') {
    return { slides: units.map((u, i) => ({ slide_number: i + 1, title: u.headline, body: u.body || u.bullets.join(' · '), role: u.role, emphasis: u.emphasis })), ...conversionFields };
  }
  if (asm.assetFamily === 'infographic') {
    return { sections: units.map((u) => ({ label: u.headline, value: u.statistic, role: u.role })), headline: asm.message.mainMessage, ...conversionFields };
  }
  const hero = units.find((u) => u.hierarchy === 'Hero') ?? units[0];
  return { headline: hero ? hero.headline : asm.message.mainMessage, subheadline: hero ? hero.body : asm.message.summary, keyInsight: (units.find((u) => u.statistic) || { statistic: '' }).statistic, ...conversionFields };
}

/* ── Family projections ────────────────────────────────────────────────── */

export type AssetFamilyTarget = 'image' | 'carousel' | 'infographic' | 'post' | 'thread' | 'blogImage' | 'newsletterImage' | 'whitepaperImage' | 'guideImage';

/** Project the assembly for any target family (projections only; no new logic). */
export function projectAssembly(asm: AssetAssembly, family: AssetFamilyTarget): { family: AssetFamilyTarget; units: AssetAssemblyUnit[]; primary: AssetAssemblyUnit | null } {
  const units = asm.assets;
  if (family === 'carousel' || family === 'thread') return { family, units, primary: units[0] ?? null };
  if (family === 'infographic') return { family, units, primary: units.find((u) => u.statistic) ?? units[0] ?? null };
  // image / post / blogImage / newsletterImage / whitepaperImage / guideImage → hero + cta focus
  const hero = units.find((u) => u.hierarchy === 'Hero') ?? units[0] ?? null;
  const cta = units.find((u) => u.hierarchy === 'CTA') ?? null;
  return { family, units: [hero, cta].filter((u): u is AssetAssemblyUnit => u !== null), primary: hero };
}

/* ── Validation ────────────────────────────────────────────────────────── */

const VALID_HIERARCHY = new Set(['Hero', 'Primary', 'Secondary', 'Supporting', 'MicroCopy', 'Evidence', 'CTA']);

export function validateAssetAssembly(asm: AssetAssembly): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const units = asm.assets;
  if (!asm.message.mainMessage) errors.push('Missing main message.');
  if (!asm.communication.communicationGoal) errors.push('Missing communication goal.');
  if (!asm.conversion.goal) errors.push('Missing conversion goal.');
  if (!units.length) errors.push('No assembly units.');
  units.forEach((u, i) => {
    if (!u.id) errors.push(`Unit ${i} missing id.`);
    if (!u.role) errors.push(`Unit ${i} missing role.`);
    if (!VALID_HIERARCHY.has(u.hierarchy)) errors.push(`Unit ${i} invalid hierarchy.`);
  });
  // Ordering must be stable (ids unit-0..n in order).
  units.forEach((u, i) => { if (u.id !== `unit-${i}`) errors.push(`Unit ${i} out of order (${u.id}).`); });
  return { ok: errors.length === 0, errors };
}

/* ── Summary ───────────────────────────────────────────────────────────── */

export interface AssemblySummary {
  message: string; communication: string; journey: string; story: string; conversion: string;
  visualIntent: LayoutIntent; completeness: number;
}
export function summarizeAssetAssembly(asm: AssetAssembly): AssemblySummary {
  const units = asm.assets;
  const present = [asm.message.mainMessage, asm.communication.communicationGoal, asm.journey.id, asm.storyBlueprint.id, asm.conversion.goal, units.length].filter((x) => (typeof x === 'number' ? x > 0 : !!x)).length;
  return {
    message: asm.message.mainMessage, communication: asm.communication.strategy, journey: asm.journey.id,
    story: asm.storyBlueprint.id, conversion: asm.conversion.goal, visualIntent: asm.visualMessaging.overallVisualIntent,
    completeness: Math.round((present / 6) * 100) / 100,
  };
}

/* ── Search ────────────────────────────────────────────────────────────── */

const SEARCH_ALIASES: Array<[RegExp, (a: AssetAssembly) => unknown]> = [
  [/\bcta\b|action/, (a) => a.assets.filter((u) => u.hierarchy === 'CTA' || u.cta)],
  [/\bhero/, (a) => a.assets.filter((u) => u.hierarchy === 'Hero')],
  [/\bstat|number/, (a) => a.assets.filter((u) => u.statistic)],
  [/\bevidence|proof/, (a) => a.assets.filter((u) => u.hierarchy === 'Evidence')],
  [/\bheadline/, (a) => a.assets.map((u) => u.headline)],
  [/\bjourney/, (a) => a.journey],
  [/\bconversion/, (a) => a.conversion],
  [/\bquote/, (a) => a.assets.filter((u) => u.quote)],
];
export function searchAssetAssembly(asm: AssetAssembly, query: string): unknown {
  const q = query.toLowerCase().replace(/^find\s+/, '').trim();
  for (const [re, sel] of SEARCH_ALIASES) if (re.test(q)) return sel(asm);
  return asm.assets.filter((u) => `${u.role} ${u.headline} ${u.body}`.toLowerCase().includes(q));
}
