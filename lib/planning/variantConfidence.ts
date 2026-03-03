/**
 * Variant Confidence Intelligence Layer — rule-based scoring from existing variant data.
 * No AI calls, no backend changes, no persistence. Display only.
 */

export interface VariantConfidence {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
}

/**
 * Computes a 0–100 confidence score and reasons from variant payload.
 * Uses: generated_content, adaptation_trace, discoverability_meta, CTA heuristics.
 */
export function computeVariantConfidence(variant: any): VariantConfidence {
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

  const level =
    score >= 80 ? 'HIGH' : score >= 60 ? 'MEDIUM' : 'LOW';

  const result: VariantConfidence = { score, level, reasons };

  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
    console.log('[VariantConfidence]', variant?.platform ?? 'unknown', result);
  }

  return result;
}
