/**
 * Asset Assembly → Prompt Specification — the final deterministic translation
 * layer between planning and generation. It reads ONLY the `AssetAssembly` (the
 * single canonical contract) — never the upstream planners — and produces a
 * `PromptAssemblySpecification` the LLM consumes. The LLM no longer reconstructs
 * communication from fragmented inputs; it receives one assembled contract.
 * Pure: same assembly → byte-identical prompt spec. No AI, no rendering data.
 */

import type { AssetAssembly, AssetAssemblyUnit } from './assetAssembly';

export interface PromptMessageInstructions {
  mainMessage: string;
  supportingMessages: string[];
  statistics: string[];
  quotes: string[];
  examples: string[];
  benefits: string[];
  painPoints: string[];
  solutions: string[];
}

export interface PromptStoryStep { unit: number; role: string; purpose: string; }

export interface PromptVisualInstruction {
  role: string; hierarchy: string; layoutIntent: string; imageRecommendation: string; emphasis: string; density: string; purpose: string;
}

export interface PromptConversionInstructions {
  goal: string; trustLevel: string; ctaIntensity: string; ctaPlacement: string;
  requiredProof: string[]; requiredAssets: string[]; objections: string[]; expectedAudienceAction: string;
}

export interface PromptCoverage {
  message: boolean; communication: boolean; journey: boolean; blueprint: boolean; visualMessaging: boolean; conversion: boolean;
}

export interface PromptAssemblySpecification {
  systemInstructions: string[];
  communicationInstructions: string[];
  messageInstructions: PromptMessageInstructions;
  storyInstructions: { blueprint: string; sequence: PromptStoryStep[] };
  conversionInstructions: PromptConversionInstructions;
  visualInstructions: PromptVisualInstruction[];
  constraints: string[];
  outputContract: { assetFamily: string; unitCount: number; requiredFields: string[] };
  coverage: PromptCoverage;
}

const uniq = (xs: string[]): string[] => Array.from(new Set(xs.map((x) => (x || '').trim()).filter(Boolean)));

/** Translate an AssetAssembly into the canonical prompt specification (deterministic). */
export function buildPromptFromAssembly(asm: AssetAssembly): PromptAssemblySpecification {
  const units: AssetAssemblyUnit[] = asm.assets;

  // ── System (Communication + Journey + Conversion → instructions) ──
  const systemInstructions = [
    `Communicate with a ${asm.communication.intent} intent toward the goal of ${asm.communication.communicationGoal}.`,
    `Speak to a ${asm.journey.audience} audience at the ${asm.journey.awarenessStage} stage (decision: ${asm.journey.decisionStage}).`,
    `Use a ${asm.conversion.ctaStyle} conversion style; required trust level: ${asm.conversion.trustRequirement}.`,
    `Move the audience toward: ${asm.conversion.goal}.`,
  ];

  // ── Communication ──
  const communicationInstructions = [
    `Communication strategy: ${asm.communication.strategy}.`,
    `Communication goal: ${asm.communication.communicationGoal}.`,
    `Communication intent: ${asm.communication.intent}.`,
  ];

  // ── Message (exactly from the assembly — no regeneration) ──
  const messageInstructions: PromptMessageInstructions = {
    mainMessage: asm.message.mainMessage,
    supportingMessages: uniq([...units.map((u) => u.body), ...units.map((u) => u.headline)]).filter((m) => m !== asm.message.mainMessage),
    statistics: uniq(units.map((u) => u.statistic)),
    quotes: uniq(units.map((u) => u.quote)),
    examples: uniq(units.map((u) => u.example)),
    benefits: uniq(units.flatMap((u) => u.bullets)),
    painPoints: uniq(units.filter((u) => u.emphasis === 'Problem').map((u) => u.body || u.headline)),
    solutions: uniq(units.filter((u) => u.emphasis === 'Solution').map((u) => u.body || u.headline)),
  };

  // ── Story (Blueprint × Visual Messaging units → communication sequence) ──
  const storyInstructions = {
    blueprint: asm.storyBlueprint.id,
    sequence: units.map((u, i) => ({ unit: i + 1, role: u.role, purpose: u.purpose })),
  };

  // ── Conversion (directly from the assembly's conversion contract) ──
  const requiredProof = uniq([
    ...(messageInstructions.statistics.length ? ['Statistics'] : []),
    ...(messageInstructions.quotes.length ? ['Testimonials / Quotes'] : []),
    ...(units.some((u) => u.hierarchy === 'Evidence') ? ['Proof points'] : []),
  ]);
  const conversionInstructions: PromptConversionInstructions = {
    goal: asm.conversion.goal, trustLevel: asm.conversion.trustRequirement,
    ctaIntensity: asm.conversion.ctaIntensity, ctaPlacement: asm.conversion.ctaPlacement,
    requiredProof, requiredAssets: asm.conversion.requiredAssets, objections: asm.conversion.objections,
    expectedAudienceAction: `${asm.conversion.goal} (${asm.conversion.ctaIntensity} CTA, placed ${asm.conversion.ctaPlacement})`,
  };

  // ── Visual (hierarchy / layout / image / emphasis / density — no rendering) ──
  const visualInstructions: PromptVisualInstruction[] = units.map((u) => ({
    role: u.role, hierarchy: u.hierarchy, layoutIntent: u.layoutIntent, imageRecommendation: u.imageRecommendation,
    emphasis: u.emphasis, density: u.density, purpose: u.purpose,
  }));

  // ── Constraints (deterministic guardrails) ──
  const constraints = [
    'Use ONLY the provided message, statistics, quotes and examples. Do not fabricate facts, numbers, or testimonials.',
    'Follow the communication sequence in order; one unit per step.',
    `Match the CTA intensity (${asm.conversion.ctaIntensity}) and placement (${asm.conversion.ctaPlacement}).`,
    'Keep each unit\'s length appropriate to its stated density.',
    asm.conversion.objections.length ? `Pre-empt likely objections: ${asm.conversion.objections.join(', ')}.` : 'No specific objections to address.',
    'Do not invent visual styling or layout positioning — produce only the communication content.',
  ];

  // ── Output contract ──
  const requiredFields = asm.assetFamily === 'carousel' ? ['slides[].title', 'slides[].body']
    : asm.assetFamily === 'infographic' ? ['headline', 'sections[].label', 'sections[].value']
      : ['headline', 'subheadline', 'cta'];
  const outputContract = { assetFamily: asm.assetFamily, unitCount: units.length, requiredFields };

  const coverage: PromptCoverage = {
    message: !!asm.message.mainMessage,
    communication: !!asm.communication.communicationGoal,
    journey: !!asm.journey.awarenessStage,
    blueprint: asm.storyBlueprint.narrativeFlow.length > 0,
    visualMessaging: units.length > 0,
    conversion: !!asm.conversion.goal,
  };

  return { systemInstructions, communicationInstructions, messageInstructions, storyInstructions, conversionInstructions, visualInstructions, constraints, outputContract, coverage };
}

/* ── Validation ────────────────────────────────────────────────────────── */

export function validateAssemblyPrompt(spec: PromptAssemblySpecification): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!spec.systemInstructions.length) errors.push('Missing system instructions.');
  if (!spec.communicationInstructions.length) errors.push('Missing communication instructions.');
  if (!spec.messageInstructions.mainMessage) errors.push('Missing main message.');
  if (!spec.storyInstructions.sequence.length) errors.push('Missing story sequence.');
  if (!spec.conversionInstructions.goal) errors.push('Missing conversion goal.');
  if (!spec.visualInstructions.length) errors.push('Missing visual instructions.');
  if (!spec.constraints.length) errors.push('Missing constraints.');
  for (const [k, v] of Object.entries(spec.coverage)) if (!v) errors.push(`Coverage gap: ${k} not represented.`);
  return { ok: errors.length === 0, errors };
}

/* ── Summary ───────────────────────────────────────────────────────────── */

export interface PromptSummary {
  communication: string; story: string; visualPlan: string[]; conversion: string;
  constraintCount: number; coverage: PromptCoverage; coverageComplete: boolean;
}
export function summarizeAssemblyPrompt(spec: PromptAssemblySpecification): PromptSummary {
  return {
    communication: spec.communicationInstructions[0] || '',
    story: spec.storyInstructions.blueprint,
    visualPlan: spec.visualInstructions.map((v) => `${v.role}:${v.hierarchy}`),
    conversion: spec.conversionInstructions.goal,
    constraintCount: spec.constraints.length,
    coverage: spec.coverage,
    coverageComplete: Object.values(spec.coverage).every(Boolean),
  };
}
