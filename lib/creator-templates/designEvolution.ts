/**
 * Design System Evolution Engine — pure deterministic analysis (no AI, no DB).
 *
 * Consumes ONLY existing canonical signals (Performance Intelligence rollups +
 * scores, Quality Inspector diagnostics, collection family/consistency) and
 * produces STRUCTURED recommendations. It NEVER modifies templates or
 * collections — accept/reject is the owner's decision and flows through the
 * existing collection versioning. Same inputs → same analysis (sorted outputs).
 */

import type { TemplateAssetFamily } from './types';
import type { PerfRollup } from './designPerformance';

export interface TemplatePerfInput {
  templateId: string;
  family: TemplateAssetFamily;
  rollup: PerfRollup;
  score: number;
  diagnostic?: { reportVersion?: string; visualValidation?: { passed?: boolean }; overallReadiness?: number } | null;
}

export interface EvolutionInput {
  collectionId: string;
  members: TemplatePerfInput[];
  presentFamilies: TemplateAssetFamily[];
  requiredFamilies: TemplateAssetFamily[];
  /** 'strong' | 'weak' | 'unknown' — members sharing one design language. */
  visualConsistency: 'strong' | 'weak' | 'unknown';
  /** Target platforms for the campaign (lowercased), if known. */
  targetPlatforms?: string[];
  /** Target audience label, if known. */
  audience?: string | null;
}

export type EvolutionRecType =
  | 'replace_template' | 'retire_template' | 'create_carousel' | 'add_infographic' | 'add_image'
  | 'increase_density' | 'reduce_density' | 'add_audience_variant'
  | 'improve_platform_coverage' | 'fix_diagnostics' | 'split_collection'
  | 'add_blueprint' | 'diversify_blueprint';

export interface EvolutionConfidence { level: 'low' | 'medium' | 'high'; value: number; }

export interface EvolutionRecommendation {
  id: string;
  type: EvolutionRecType;
  title: string;
  evidence: string[];
  impactedMetrics: string[];
  expectedBenefit: string;
  confidence: EvolutionConfidence;
  /** Optional deterministic action for "accept" (membership change → new version). */
  action?: { op: 'remove' | 'replace'; templateId: string; replacementTemplateId?: string };
  family?: TemplateAssetFamily | null;
}

export interface EvolutionAnalysis {
  collectionId: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: EvolutionRecommendation[];
}

// Deterministic thresholds.
const MIN_IMPRESSIONS = 200;   // a finding needs at least this much measured data
const HIGH = 70;
const LOW = 40;
const CTR_FLOOR = 0.015;
const ENGAGEMENT_FLOOR = 0.03;
const PLATFORM_ASPECTS: Record<string, string[]> = {
  linkedin: ['1:1', '4:5'], instagram: ['1:1', '4:5'], facebook: ['1:1', '4:5'], twitter: ['16:9', '1:1'], x: ['16:9', '1:1'],
};

function round(n: number, p = 2): number { const f = 10 ** p; return Math.round(n * f) / f; }
function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }
function cap(s: string): string { return s ? s[0]!.toUpperCase() + s.slice(1) : s; }
function pct(n: number): string { return `${round(n * 100, 1)}%`; }

/** Confidence is deterministic from evidence coverage (assets + impressions). */
function confidence(assetCount: number, impressions: number): EvolutionConfidence {
  const value = round(clamp01((Math.min(assetCount, 3) / 3) * 0.5 + (Math.min(impressions, 2000) / 2000) * 0.5));
  return { level: value >= 0.7 ? 'high' : value >= 0.4 ? 'medium' : 'low', value };
}

export function analyzeEvolution(input: EvolutionInput): EvolutionAnalysis {
  const measured = input.members.filter((m) => m.rollup.impressions >= MIN_IMPRESSIONS);
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const recs: EvolutionRecommendation[] = [];

  const highPerformers = measured.filter((m) => m.score >= HIGH);
  const lowPerformers = measured.filter((m) => m.score < LOW);

  // ── Strengths ──
  for (const h of highPerformers) strengths.push(`${h.templateId} is a consistent performer (${h.score}/100).`);
  if (input.visualConsistency === 'strong') strengths.push('Strong visual consistency across members.');
  const missingFamilies = input.requiredFamilies.filter((f) => !input.presentFamilies.includes(f));
  if (!missingFamilies.length && input.requiredFamilies.length) strengths.push('Complete asset-family coverage.');

  // ── Weaknesses ──
  for (const l of lowPerformers) weaknesses.push(`${l.templateId} consistently under-performs (${l.score}/100).`);
  for (const f of missingFamilies) weaknesses.push(`Missing ${f} template.`);
  if (input.visualConsistency === 'weak') weaknesses.push('Weak visual consistency across members.');

  // ── R1: replace a low performer with a high performer in the SAME family ──
  for (const low of lowPerformers) {
    const better = highPerformers
      .filter((h) => h.family === low.family && h.templateId !== low.templateId)
      .sort((a, b) => b.score - a.score)[0];
    if (better) {
      recs.push({
        id: `replace:${low.templateId}:${better.templateId}`,
        type: 'replace_template',
        title: `Replace ${low.templateId} with ${better.templateId}`,
        evidence: [`${low.templateId} scores ${low.score}/100`, `${better.templateId} scores ${better.score}/100 in the same family`],
        impactedMetrics: ['CTR', 'Engagement rate'],
        expectedBenefit: `Raise ${low.family} performance toward ${better.score}/100`,
        confidence: confidence(low.rollup.assetCount + better.rollup.assetCount, low.rollup.impressions + better.rollup.impressions),
        action: { op: 'replace', templateId: low.templateId, replacementTemplateId: better.templateId },
        family: low.family,
      });
    } else if (low.rollup.assetCount >= 3) {
      // ── R2: retire a persistent low performer with no in-family replacement ──
      recs.push({
        id: `retire:${low.templateId}`,
        type: 'retire_template',
        title: `Retire ${low.templateId}`,
        evidence: [`${low.templateId} scores ${low.score}/100 across ${low.rollup.assetCount} assets`],
        impactedMetrics: ['Engagement rate', 'Conversion rate'],
        expectedBenefit: 'Remove a consistent drag on collection performance',
        confidence: confidence(low.rollup.assetCount, low.rollup.impressions),
        action: { op: 'remove', templateId: low.templateId },
        family: low.family,
      });
    }
  }

  // ── R3: create the missing asset families ──
  for (const f of missingFamilies) {
    const type: EvolutionRecType = f === 'carousel' ? 'create_carousel' : f === 'infographic' ? 'add_infographic' : 'add_image';
    recs.push({
      id: `missing:${f}`,
      type,
      title: f === 'carousel' ? 'Create a Carousel variant' : f === 'infographic' ? 'Add an Infographic' : 'Add an Image template',
      evidence: [`Collection has no ${f} member; required for this campaign`],
      impactedMetrics: ['Reach', 'Family coverage'],
      expectedBenefit: `Unlock ${f} placements across the campaign`,
      confidence: confidence(measured.length, measured.reduce((s, m) => s + m.rollup.impressions, 0)),
      family: f,
    });
  }

  // ── R4: density nudges from low CTR / low engagement (deterministic) ──
  for (const m of measured) {
    if (m.rollup.ctr < CTR_FLOOR) {
      recs.push({
        id: `density-up:${m.templateId}`,
        type: 'increase_density',
        title: `Increase text density on ${m.templateId}`,
        evidence: [`CTR ${pct(m.rollup.ctr)} is below the ${pct(CTR_FLOOR)} floor`],
        impactedMetrics: ['CTR'],
        expectedBenefit: 'Clearer message + CTA to lift click-through',
        confidence: confidence(m.rollup.assetCount, m.rollup.impressions),
        family: m.family,
      });
    } else if (m.rollup.engagementRate < ENGAGEMENT_FLOOR) {
      recs.push({
        id: `density-down:${m.templateId}`,
        type: 'reduce_density',
        title: `Reduce text density on ${m.templateId}`,
        evidence: [`Engagement rate ${pct(m.rollup.engagementRate)} is below the ${pct(ENGAGEMENT_FLOOR)} floor`],
        impactedMetrics: ['Engagement rate'],
        expectedBenefit: 'Lighter composition to lift engagement',
        confidence: confidence(m.rollup.assetCount, m.rollup.impressions),
        family: m.family,
      });
    }
  }

  // ── R5: weak platform coverage ──
  for (const platform of input.targetPlatforms ?? []) {
    const want = new Set(PLATFORM_ASPECTS[platform] ?? []);
    if (!want.size) continue;
    const covers = measured.some((m) => m.rollup.byPlatform.some((p) => p.platform === platform && p.ctr >= CTR_FLOOR));
    if (!covers) {
      recs.push({
        id: `platform:${platform}`,
        type: 'improve_platform_coverage',
        title: `Improve ${cap(platform)} coverage`,
        evidence: [`No member performs on ${cap(platform)} above the ${pct(CTR_FLOOR)} CTR floor`],
        impactedMetrics: ['CTR', 'Reach'],
        expectedBenefit: `Stronger ${cap(platform)} placements`,
        confidence: confidence(measured.length, measured.reduce((s, m) => s + m.rollup.impressions, 0)),
      });
    }
  }

  // ── R6: diagnostic failures (Quality Inspector) ──
  for (const m of input.members) {
    const failed = m.diagnostic && (m.diagnostic.visualValidation?.passed === false || (typeof m.diagnostic.overallReadiness === 'number' && m.diagnostic.overallReadiness < 70));
    if (failed) {
      recs.push({
        id: `diagnostics:${m.templateId}`,
        type: 'fix_diagnostics',
        title: `Fix diagnostic failures on ${m.templateId}`,
        evidence: [m.diagnostic?.visualValidation?.passed === false ? 'Visual validation failed' : `Readiness ${m.diagnostic?.overallReadiness}/100 below 70`],
        impactedMetrics: ['Quality readiness'],
        expectedBenefit: 'Pass the Quality Inspector before further use',
        confidence: { level: 'high', value: 1 }, // diagnostic is a definite signal
        family: m.family,
      });
    }
  }

  // ── R7: audience variant (only if an audience is targeted) ──
  if (input.audience && measured.length) {
    recs.push({
      id: `audience:${input.audience}`,
      type: 'add_audience_variant',
      title: `Add ${cap(input.audience)} variant`,
      evidence: [`Campaign targets ${cap(input.audience)}; no audience-specific member detected`],
      impactedMetrics: ['Engagement rate'],
      expectedBenefit: `Tailored messaging for ${cap(input.audience)}`,
      confidence: confidence(measured.length, measured.reduce((s, m) => s + m.rollup.impressions, 0)),
    });
  }

  // ── R8: split a visually inconsistent multi-member collection ──
  if (input.visualConsistency === 'weak' && input.members.length >= 4) {
    recs.push({
      id: 'split',
      type: 'split_collection',
      title: 'Split collection by visual language',
      evidence: ['Weak visual consistency across 4+ members'],
      impactedMetrics: ['Brand consistency'],
      expectedBenefit: 'Two coherent design systems instead of one mixed set',
      confidence: confidence(input.members.length, measured.reduce((s, m) => s + m.rollup.impressions, 0)),
    });
  }

  recs.sort((a, b) => (b.confidence.value - a.confidence.value) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { collectionId: input.collectionId, strengths: strengths.sort(), weaknesses: weaknesses.sort(), recommendations: recs };
}
