import type { TrendSignal } from './externalApiService';

type FallbackTrendSignal = TrendSignal & {
  platform: 'context';
  frequency: number;
};

const toStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : String(item || '').trim()))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const pushSignal = (
  out: FallbackTrendSignal[],
  topic: string,
  input: { volume: number; frequency: number }
) => {
  const normalizedTopic = topic.trim();
  if (!normalizedTopic) return;
  for (let i = 0; i < input.frequency; i += 1) {
    out.push({
      topic: normalizedTopic,
      source: 'fallback_context',
      volume: input.volume,
      signal_confidence: 0.8,
      platform: 'context',
      frequency: input.frequency,
    });
  }
};

/**
 * Deterministic fallback trend builder used when external APIs return no signals.
 * Returns TrendSignal-compatible items (with extra metadata fields).
 */
export const buildFallbackRecommendationSignals = (
  profile: Record<string, unknown> | null | undefined
): FallbackTrendSignal[] => {
  if (!profile || typeof profile !== 'object') return [];

  const signals: FallbackTrendSignal[] = [];
  const seen = new Set<string>();
  const addUnique = (topic: string, cfg: { volume: number; frequency: number }) => {
    const key = topic.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    pushSignal(signals, topic, cfg);
  };

  // 1) authority_domains
  for (const domain of toStringList(profile.authority_domains)) {
    addUnique(domain, { volume: 3000, frequency: 3 });
  }

  // 2) core_problem_statement
  if (typeof profile.core_problem_statement === 'string' && profile.core_problem_statement.trim()) {
    addUnique(profile.core_problem_statement, { volume: 2500, frequency: 2 });
  }

  // 3) pain_symptoms
  for (const symptom of toStringList(profile.pain_symptoms)) {
    addUnique(symptom, { volume: 2200, frequency: 1 });
  }

  // 4) desired_transformation
  if (typeof profile.desired_transformation === 'string' && profile.desired_transformation.trim()) {
    addUnique(profile.desired_transformation, { volume: 2000, frequency: 1 });
  }

  // 5) campaign_focus
  if (typeof profile.campaign_focus === 'string' && profile.campaign_focus.trim()) {
    addUnique(profile.campaign_focus, { volume: 1500, frequency: 1 });
  }

  // 6) content_themes
  for (const theme of toStringList(profile.content_themes)) {
    addUnique(theme, { volume: 1500, frequency: 1 });
  }

  // 7) growth_priorities
  for (const growth of toStringList(profile.growth_priorities)) {
    addUnique(growth, { volume: 1500, frequency: 1 });
  }

  return signals;
};

