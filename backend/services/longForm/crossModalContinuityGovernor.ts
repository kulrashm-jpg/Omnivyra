/**
 * Phase 3 — Cross-modal continuity governor.
 *
 * Inspects a (source, derived) asset pair and detects when the
 * transformation has degraded the strategic narrative, terminology, ICP
 * alignment, authority, factual grounding, or editorial intent.
 *
 * Pure / deterministic.
 *
 * Issue types:
 *   STRATEGIC_NARRATIVE_DRIFT   — derived narrative diverges from source's
 *   TERMINOLOGY_LOSS            — terminology clusters lost in derived
 *   ICP_MISALIGNMENT            — derived ICP list does not intersect source
 *   AUTHORITY_LOSS              — authorityClaimCoverage halved (or worse)
 *   FACTUAL_GROUNDING_LOSS      — evidenceDensity halved (or worse)
 *   EDITORIAL_INTENT_DISTORTION — narrative archetype mismatch
 *   OVERSIMPLIFICATION          — heavy compression with deep source
 *   CONTEXT_COLLAPSE            — terminology + ICP + narrative all degraded
 */

import type {
  CrossModalAsset,
  CrossModalContinuityIssue,
  CrossModalContinuityResult,
} from './longFormRecommendationTypes';
import { FORMAT_PROFILE } from './transformationIntelligenceEngine';

const STOPWORDS = new Set([
  'a','an','the','and','or','but','of','to','in','on','for','with','by','at','is','are',
  'be','as','from','that','this','these','those','it','its','can','should','would','will',
]);

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of (text ?? '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
    if (t.length > 2 && !STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((t) => { if (b.has(t)) inter += 1; });
  return inter / (a.size + b.size - inter);
}

function setIntersectionSize<T>(a: Set<T>, b: Set<T>): number {
  let n = 0;
  a.forEach((t) => { if (b.has(t)) n += 1; });
  return n;
}

function lowerSet(list: string[]): Set<string> {
  return new Set(list.map((s) => s.toLowerCase()));
}

export interface GovernCrossModalContinuityInput {
  source: CrossModalAsset;
  derived: CrossModalAsset;
}

export function governCrossModalContinuity(input: GovernCrossModalContinuityInput): CrossModalContinuityResult {
  const { source, derived } = input;
  const issues: CrossModalContinuityIssue[] = [];
  const preserved: string[] = [];

  // 1. Strategic narrative drift — Jaccard on narrative tokens.
  const narrJacc = jaccard(tokens(source.strategicNarrative), tokens(derived.strategicNarrative));
  if (narrJacc < 0.15) {
    issues.push({
      type: 'STRATEGIC_NARRATIVE_DRIFT',
      severity: narrJacc < 0.05 ? 'high' : 'medium',
      detail: `Derived narrative shares only ${(narrJacc * 100).toFixed(0)}% token overlap with source narrative.`,
    });
  } else if (narrJacc >= 0.4) {
    preserved.push('strategic_narrative');
  }

  // 2. Terminology loss — intersection of terminology clusters.
  const srcTerms = lowerSet(source.terminologyClusters);
  const dstTerms = lowerSet(derived.terminologyClusters);
  if (srcTerms.size > 0) {
    const overlap = setIntersectionSize(srcTerms, dstTerms);
    const overlapRatio = overlap / srcTerms.size;
    if (overlapRatio < 0.34) {
      issues.push({
        type: 'TERMINOLOGY_LOSS',
        severity: overlapRatio === 0 ? 'high' : 'medium',
        detail: `Derived asset preserves only ${overlap}/${srcTerms.size} terminology clusters from source.`,
      });
    } else if (overlapRatio >= 0.67) {
      preserved.push('terminology');
    }
  }

  // 3. ICP misalignment — no overlap in ICP focus.
  const srcIcps = lowerSet(source.icpFocus);
  const dstIcps = lowerSet(derived.icpFocus);
  if (srcIcps.size > 0 && dstIcps.size > 0) {
    const overlap = setIntersectionSize(srcIcps, dstIcps);
    if (overlap === 0) {
      issues.push({
        type: 'ICP_MISALIGNMENT',
        severity: 'high',
        detail: `Derived ICP set [${[...dstIcps].join(', ')}] does not overlap source ICP set [${[...srcIcps].join(', ')}].`,
      });
    } else {
      preserved.push('icp_alignment');
    }
  }

  // 4. Authority loss — halved or worse.
  if (source.authorityClaimCoverage >= 30 && derived.authorityClaimCoverage <= source.authorityClaimCoverage * 0.5) {
    issues.push({
      type: 'AUTHORITY_LOSS',
      severity: derived.authorityClaimCoverage <= source.authorityClaimCoverage * 0.25 ? 'high' : 'medium',
      detail: `Authority claim coverage dropped ${source.authorityClaimCoverage} → ${derived.authorityClaimCoverage}.`,
    });
  } else if (derived.authorityClaimCoverage >= source.authorityClaimCoverage * 0.75) {
    preserved.push('authority');
  }

  // 5. Factual grounding loss.
  if (source.evidenceDensity >= 30 && derived.evidenceDensity <= source.evidenceDensity * 0.5) {
    issues.push({
      type: 'FACTUAL_GROUNDING_LOSS',
      severity: derived.evidenceDensity <= source.evidenceDensity * 0.25 ? 'high' : 'medium',
      detail: `Evidence density dropped ${source.evidenceDensity} → ${derived.evidenceDensity}.`,
    });
  } else if (derived.evidenceDensity >= source.evidenceDensity * 0.75) {
    preserved.push('factual_grounding');
  }

  // 6. Editorial intent distortion — narrative archetype mismatch (when both present).
  if (source.narrativeArchetype && derived.narrativeArchetype
      && source.narrativeArchetype !== derived.narrativeArchetype) {
    issues.push({
      type: 'EDITORIAL_INTENT_DISTORTION',
      severity: 'medium',
      detail: `Narrative archetype shifted ${source.narrativeArchetype} → ${derived.narrativeArchetype} during transformation.`,
    });
  } else if (source.narrativeArchetype && source.narrativeArchetype === derived.narrativeArchetype) {
    preserved.push('editorial_intent');
  }

  // 7. Oversimplification — deep source, heavy compression, evidence density drop.
  const srcDepth = FORMAT_PROFILE[source.format].depth;
  const compressionRatio = source.approximateWordCount > 0 ? derived.approximateWordCount / source.approximateWordCount : 1;
  if (srcDepth === 'deep' && compressionRatio < 0.1 && derived.evidenceDensity < source.evidenceDensity * 0.6) {
    issues.push({
      type: 'OVERSIMPLIFICATION',
      severity: 'high',
      detail: `Deep source heavily compressed (${(compressionRatio * 100).toFixed(1)}% of source) with evidence density loss — likely oversimplified.`,
    });
  }

  // 8. Context collapse — multiple primary axes degraded.
  const degradedAxes = issues.filter((i) =>
    i.type === 'STRATEGIC_NARRATIVE_DRIFT'
    || i.type === 'TERMINOLOGY_LOSS'
    || i.type === 'ICP_MISALIGNMENT'
    || i.type === 'AUTHORITY_LOSS',
  ).length;
  if (degradedAxes >= 3) {
    issues.push({
      type: 'CONTEXT_COLLAPSE',
      severity: 'high',
      detail: `${degradedAxes} primary continuity axes degraded — full context collapse during transformation.`,
    });
  }

  // Composite continuity score: start at 100; subtract penalties.
  let score = 100;
  for (const i of issues) {
    score -= i.severity === 'high' ? 25 : i.severity === 'medium' ? 12 : 5;
  }
  score = Math.max(0, Math.min(100, score));

  return {
    continuityScore: score,
    detectedIssues: issues,
    preservedAxes: preserved,
  };
}
