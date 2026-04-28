export function safeParseRecommendationContext(input: unknown): Record<string, unknown> | null {
  if (!input) return null;
  if (typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return typeof parsed === 'object' && parsed && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  return null;
}

function compactInsights(insights: unknown[] = []) {
  const seen = new Set<string>();
  const result: unknown[] = [];

  for (const item of insights) {
    const key =
      item && typeof item === 'object' && !Array.isArray(item)
        ? String((item as { name?: unknown }).name || JSON.stringify(item))
        : JSON.stringify(item);

    if (seen.has(key)) continue;

    seen.add(key);
    result.push(item);

    if (result.length >= 5) break;
  }

  return result;
}

export function withRecommendationContextDefaults(ctx: any) {
  if (!ctx?.version) {
    return {
      version: 1,
      key_threat: ctx?.key_threat || '',
      biggest_advantage: ctx?.biggest_advantage || '',
      strategic_focus: ctx?.strategic_focus || '',
      contrarian_beliefs: Array.isArray(ctx?.contrarian_beliefs) ? ctx.contrarian_beliefs : [],
      typical_angles: Array.isArray(ctx?.typical_angles) ? ctx.typical_angles : [],
      insights: Array.isArray(ctx?.insights) ? compactInsights(ctx.insights) : [],
    };
  }

  if (ctx.version === 1) {
    return {
      version: 1,
      key_threat: ctx?.key_threat || '',
      biggest_advantage: ctx?.biggest_advantage || '',
      strategic_focus: ctx?.strategic_focus || '',
      contrarian_beliefs: Array.isArray(ctx?.contrarian_beliefs) ? ctx.contrarian_beliefs : [],
      typical_angles: Array.isArray(ctx?.typical_angles) ? ctx.typical_angles : [],
      insights: Array.isArray(ctx?.insights) ? compactInsights(ctx.insights) : [],
    };
  }

  return {
    version: typeof ctx?.version === 'number' ? ctx.version : 1,
    key_threat: ctx?.key_threat || '',
    biggest_advantage: ctx?.biggest_advantage || '',
    strategic_focus: ctx?.strategic_focus || '',
    contrarian_beliefs: Array.isArray(ctx?.contrarian_beliefs) ? ctx.contrarian_beliefs : [],
    typical_angles: Array.isArray(ctx?.typical_angles) ? ctx.typical_angles : [],
    insights: Array.isArray(ctx?.insights) ? compactInsights(ctx.insights) : [],
  };
}
