/**
 * INT-001 Phase 2 — Behavioral Segmentation.
 *
 * Assigns the lead to zero or more segments, each with a confidence and
 * reasons. Rules are deterministic functions of the shared behaviour analysis,
 * the persona and the intent/qualification results. Segments below the
 * configured minimum confidence are dropped; output is sorted by confidence
 * (desc) then segment name for stable ordering.
 */

import type {
  IntentIntelligence,
  LeadCaptureSnapshot,
  PageCategory,
  PersonaIntelligence,
  QualificationIntelligence,
  SegmentAssignment,
} from './types';
import { resolveEngineConfig, type LeadIntelligenceEngineConfig } from './engineConfig';
import { analyzeBehavior, type BehaviorAnalysis } from './behaviorAnalysis';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const cap = (n: number): number => round2(Math.min(0.95, Math.max(0, n)));

export interface SegmentationInputs {
  snapshot: LeadCaptureSnapshot;
  intent: IntentIntelligence;
  persona: PersonaIntelligence;
  qualification: QualificationIntelligence;
}

export function assignSegments(
  inputs: SegmentationInputs,
  configOverride?: Partial<LeadIntelligenceEngineConfig>,
  precomputed?: BehaviorAnalysis,
): SegmentAssignment[] {
  const config = resolveEngineConfig(configOverride);
  const segCfg = config.segmentation;
  const b = precomputed ?? analyzeBehavior(inputs.snapshot, config);
  const { intent, persona, qualification } = inputs;

  const pages = (c: PageCategory): number => b.categoryPages.get(c)?.size ?? 0;
  const out: SegmentAssignment[] = [];
  const push = (segment: SegmentAssignment['segment'], confidence: number, reasons: string[]): void => {
    const c = cap(confidence);
    if (c >= segCfg.minConfidence) out.push({ segment, confidence: c, reasons });
  };

  const researchPages = pages('documentation') + pages('blog') + pages('case_study') + pages('comparison');
  if (researchPages >= segCfg.researcherMinPages) {
    push('Researchers', 0.3 + researchPages * 0.1, [`${researchPages} research-type pages (docs/blog/case studies/comparisons)`]);
  }

  if (pages('enterprise') > 0 || pages('security') > 0) {
    const signals = pages('enterprise') + pages('security');
    push('Enterprise Buyers', 0.35 + signals * 0.15, [
      `${signals} enterprise/security page(s) visited`,
      ...(qualification.sections.find((s) => s.key === 'companyFit' && s.score >= 50) ? ['strong company fit'] : []),
    ]);
  }

  if (pages('documentation') > 0 && (persona.persona === 'Developer' || persona.persona === 'CTO' || pages('documentation') >= 2)) {
    push('Technical Evaluators', 0.35 + pages('documentation') * 0.15 + (persona.persona === 'Developer' || persona.persona === 'CTO' ? 0.2 : 0), [
      `${pages('documentation')} documentation page(s)`,
      ...(persona.persona === 'Developer' || persona.persona === 'CTO' ? [`technical persona (${persona.persona})`] : []),
    ]);
  }

  const pricingOnly = pages('pricing') > 0 && pages('demo') === 0 && pages('enterprise') === 0;
  if (pricingOnly && pages('pricing') >= 1 && b.distinctPages.length <= pages('pricing') + 2) {
    push('Price Shoppers', 0.35 + pages('pricing') * 0.15, [`${pages('pricing')} pricing page(s) with little else explored`]);
  }

  if (['Founder', 'CEO', 'CTO'].includes(persona.persona)) {
    push('Decision Makers', persona.confidence, [`${persona.persona} persona at ${Math.round(persona.confidence * 100)}% confidence`]);
  }

  if (intent.score >= segCfg.highIntentScore * 0.7 && b.sessionCount >= 2 && ['Marketing', 'Sales', 'Developer'].includes(persona.persona)) {
    push('Champions', 0.3 + persona.confidence * 0.3, [
      `engaged ${persona.persona.toLowerCase()} returning across ${b.sessionCount} sessions with intent ${intent.score}`,
    ]);
  }

  if (persona.persona === 'Procurement' || (pages('security') > 0 && pages('pricing') > 0 && persona.persona !== 'Developer')) {
    push('Procurement', persona.persona === 'Procurement' ? persona.confidence : 0.35, [
      persona.persona === 'Procurement' ? 'procurement persona' : 'security + pricing review pattern',
    ]);
  }

  if (persona.persona === 'Partner' || pages('partners') > 0) {
    push('Partners', persona.persona === 'Partner' ? persona.confidence : 0.4, [
      persona.persona === 'Partner' ? 'partner persona' : 'visited partner pages',
    ]);
  }

  if (persona.persona === 'Investor' || pages('investors') > 0) {
    push('Investors', persona.persona === 'Investor' ? persona.confidence : 0.4, [
      persona.persona === 'Investor' ? 'investor persona' : 'visited investor pages',
    ]);
  }

  if (pages('careers') > 0 && intent.score < segCfg.highIntentScore) {
    push('Job Seekers', 0.3 + pages('careers') * 0.2 + (persona.persona === 'Student' ? 0.15 : 0), [
      `${pages('careers')} careers page(s) visited`,
      ...(persona.persona === 'Student' ? ['student persona'] : []),
    ]);
  }

  const src = (inputs.snapshot.lead.source ?? '').toLowerCase();
  if (src.includes('customer') || src.includes('support') || src.includes('account')) {
    push('Existing Customers', 0.5, [`lead source "${inputs.snapshot.lead.source}" indicates an existing relationship`]);
  }

  if (pages('comparison') > 0) {
    push('Competitor Evaluators', 0.35 + pages('comparison') * 0.15, [`${pages('comparison')} comparison/alternatives page(s)`]);
  }

  if (b.totalEvents <= segCfg.coldVisitorMaxEvents && intent.score < config.intent.bands.medium) {
    push('Cold Visitors', 0.6 - b.totalEvents * 0.1, [`only ${b.totalEvents} event(s) captured and intent ${intent.score}`]);
  }

  if (intent.score >= segCfg.highIntentScore) {
    push('High Intent Buyers', 0.4 + (intent.score - segCfg.highIntentScore) * 0.01 + (qualification.band === 'hot' ? 0.15 : 0), [
      `intent score ${intent.score} ≥ ${segCfg.highIntentScore}`,
      ...(qualification.band === 'hot' ? ['hot qualification band'] : []),
    ]);
  }

  return out.sort((a, z) => (z.confidence - a.confidence) || a.segment.localeCompare(z.segment));
}
