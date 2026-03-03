/**
 * AI Strategist Suggestions — derives actionable suggestions from variant confidence and payload.
 * Optional strategic memory profile reorders by team acceptance (higher first).
 */

import type { VariantConfidence } from './variantConfidence';
import type { StrategicMemoryProfile } from '@/lib/intelligence/strategicMemory';
import { rankSuggestionsByMemory } from '@/lib/intelligence/strategicMemory';

export interface VariantSuggestion {
  id: string;
  label: string;
  description: string;
  action: 'IMPROVE_CTA' | 'IMPROVE_HOOK' | 'ADD_DISCOVERABILITY';
}

const MAX_SUGGESTIONS = 2;

/**
 * Derives up to 2 suggestions from confidence reasons and variant content.
 * If memoryProfile is provided, suggestions are ranked by acceptance rate (higher first).
 */
export function deriveVariantSuggestions(
  confidence: VariantConfidence,
  variant: any,
  platform?: string,
  memoryProfile?: StrategicMemoryProfile | null
): VariantSuggestion[] {
  const suggestions: VariantSuggestion[] = [];

  const text =
    typeof variant?.generated_content === 'string'
      ? variant.generated_content
      : typeof variant?.content === 'string'
        ? variant.content
        : '';

  if (confidence.reasons.includes('CTA could be stronger')) {
    suggestions.push({
      id: 'cta',
      label: 'Improve CTA',
      description: 'Add a clearer next action at the end.',
      action: 'IMPROVE_CTA',
    });
  }

  if (typeof text === 'string' && text.length > 120) {
    const firstLine = text.split('\n')[0]?.trim() ?? '';
    if (firstLine.length > 100) {
      suggestions.push({
        id: 'hook',
        label: 'Improve opening hook',
        description: 'Make the first line shorter and stronger.',
        action: 'IMPROVE_HOOK',
      });
    }
  }

  if (!variant?.discoverability_meta || typeof variant.discoverability_meta !== 'object') {
    suggestions.push({
      id: 'discoverability',
      label: 'Boost discoverability',
      description: 'Add hashtags or keywords for reach.',
      action: 'ADD_DISCOVERABILITY',
    });
  }

  const ranked = rankSuggestionsByMemory(suggestions, memoryProfile);
  const top = ranked.slice(0, MAX_SUGGESTIONS);

  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
    console.log('[VariantSuggestions]', platform ?? 'unknown', top);
  }

  return top;
}
