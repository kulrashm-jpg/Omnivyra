/**
 * Content Amplification Service
 * Computes a score (0–1) indicating how aggressively a slot should be repurposed.
 * Used to control repurpose depth dynamically based on performance signals.
 */

function normalizePlatformContent(platform?: string, type?: string): string | null {
  if (!platform || !type) return null;
  const p = String(platform).trim().toLowerCase().replace(/^twitter$/, 'x');
  const t = String(type).trim().toLowerCase();
  return `${p}_${t}`;
}

export type AmplificationSignals = {
  high_performing_platforms?: string[];
  high_performing_content_types?: string[];
  low_performing_patterns?: string[];
};

export function computeContentAmplificationScore(
  contentType: string,
  platform: string | undefined,
  signals?: AmplificationSignals,
  options?: {
    strategic_importance?: 'low' | 'normal' | 'high';
  }
): number {
  let score = 0.5;

  if (!signals) return score;

  const normalizedType = (contentType ?? '').trim().toLowerCase();

  const combo = normalizePlatformContent(platform, normalizedType);
  if (combo && signals.high_performing_content_types?.includes(combo)) {
    score += 0.35;
  } else if (signals.high_performing_content_types?.includes(normalizedType)) {
    score += 0.3;
  }

  if (platform && signals.high_performing_platforms?.includes(platform)) {
    score += 0.2;
  }

  if (signals.low_performing_patterns?.includes(normalizedType)) {
    score -= 0.3;
  }

  if (options?.strategic_importance === 'high') {
    score += 0.15;
  }

  return Math.max(0, Math.min(1, score));
}
