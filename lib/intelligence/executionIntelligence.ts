/**
 * Execution Intelligence Unification — single module for confidence, suggestions, memory ranking, strategist trigger.
 * No behavior changes; consolidation only.
 */

import type { StrategicMemoryProfile } from './strategicMemory';
import type { VariantSuggestion } from '../planning/variantSuggestions';
import { deriveVariantSuggestions } from '../planning/variantSuggestions';

export interface VariantIntelligence {
  confidence_score: number;
  confidence_level: 'LOW' | 'MEDIUM' | 'HIGH';
  missing_signals: string[];
  /** Full list for UI checklist (✔ / ⚠) */
  reasons: string[];
  strategist_suggestions: VariantSuggestion[];
  strategist_trigger_level: 'NONE' | 'SUGGEST' | 'AUTO_ELIGIBLE';
}

function computeConfidence(variant: any): { score: number; level: 'LOW' | 'MEDIUM' | 'HIGH'; reasons: string[] } {
  let score = 50;
  const reasons: string[] = [];

  if (variant?.generated_content || variant?.content) {
    score += 20;
    reasons.push('Content generated');
  }

  if (variant?.adaptation_trace && typeof variant.adaptation_trace === 'object') {
    score += 20;
    reasons.push('Adapted to platform rules');
  }

  if (variant?.discoverability_meta && typeof variant.discoverability_meta === 'object') {
    score += 10;
    reasons.push('Discoverability signals detected');
  }

  const txt =
    typeof variant?.generated_content === 'string'
      ? variant.generated_content
      : typeof variant?.content === 'string'
        ? variant.content
        : '';

  if (/(learn more|sign up|try now|book|contact|watch)/i.test(txt)) {
    score += 10;
    reasons.push('Call-to-action detected');
  } else {
    reasons.push('CTA could be stronger');
  }

  score = Math.max(0, Math.min(100, score));
  const level = score >= 80 ? 'HIGH' : score >= 60 ? 'MEDIUM' : 'LOW';
  return { score, level, reasons };
}

const POSITIVE_REASONS = new Set([
  'Content generated',
  'Adapted to platform rules',
  'Discoverability signals detected',
  'Call-to-action detected',
]);

function computeSuggestions(
  variant: any,
  platform: string | undefined,
  confidence: { score: number; level: string; reasons: string[] },
  memoryProfile?: StrategicMemoryProfile | null
): VariantSuggestion[] {
  return deriveVariantSuggestions(
    { score: confidence.score, level: confidence.level as 'LOW' | 'MEDIUM' | 'HIGH', reasons: confidence.reasons },
    variant,
    platform,
    memoryProfile
  );
}

function computeStrategistTrigger(
  level: 'LOW' | 'MEDIUM' | 'HIGH',
  suggestions: VariantSuggestion[]
): 'NONE' | 'SUGGEST' | 'AUTO_ELIGIBLE' {
  if (level === 'HIGH') return 'NONE';
  if (level === 'LOW') return 'AUTO_ELIGIBLE';
  if (level === 'MEDIUM' && suggestions.length >= 2) return 'AUTO_ELIGIBLE';
  if (level === 'MEDIUM' && suggestions.length >= 1) return 'SUGGEST';
  return 'NONE';
}

/**
 * Single entry point: confidence, suggestions (memory-ranked), and strategist trigger.
 */
export function computeVariantIntelligence(
  variant: any,
  platform?: string,
  memoryProfile?: StrategicMemoryProfile | null
): VariantIntelligence {
  const confidence = computeConfidence(variant);
  const strategist_suggestions = computeSuggestions(variant, platform, confidence, memoryProfile);
  const strategist_trigger_level = computeStrategistTrigger(confidence.level, strategist_suggestions);
  const missing_signals = confidence.reasons.filter((r) => !POSITIVE_REASONS.has(r));

  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
    console.log('[ExecutionIntelligence]', {
      platform: platform ?? variant?.platform ?? 'unknown',
      confidence_level: confidence.level,
      strategist_trigger_level,
    });
  }

  return {
    confidence_score: confidence.score,
    confidence_level: confidence.level,
    missing_signals,
    reasons: confidence.reasons,
    strategist_suggestions,
    strategist_trigger_level,
  };
}
