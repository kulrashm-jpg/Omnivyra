/**
 * Market Pulse category classifier.
 * Assigns primary_category and secondary_tags to signals.
 * Priority when multiple match: BUYING_INTENT > COMPETITOR_INTELLIGENCE > MARKET_TREND >
 * INFLUENCER_ACTIVITY > SEASONAL_SIGNAL > REGIONAL_SIGNAL.
 */

export const MARKET_PULSE_CATEGORIES = [
  'BUYING_INTENT',
  'COMPETITOR_INTELLIGENCE',
  'MARKET_TREND',
  'INFLUENCER_ACTIVITY',
  'SEASONAL_SIGNAL',
  'REGIONAL_SIGNAL',
] as const;

export type MarketPulseCategory = (typeof MARKET_PULSE_CATEGORIES)[number];

const CATEGORY_PRIORITY: Record<MarketPulseCategory, number> = {
  BUYING_INTENT: 0,
  COMPETITOR_INTELLIGENCE: 1,
  MARKET_TREND: 2,
  INFLUENCER_ACTIVITY: 3,
  SEASONAL_SIGNAL: 4,
  REGIONAL_SIGNAL: 5,
};

const SEASONAL_PATTERNS = [
  /\b(holiday|black friday|cyber monday|q4|q1|seasonal|christmas|new year|back to school)\b/i,
  /\b(spring|summer|fall|winter)\s+(sale|campaign|promotion)\b/i,
];

const COMPETITOR_PATTERNS = [
  /\b(competitor|rival|vs\s+\w+|alternative to|compared to)\b/i,
  /\b(market share|competitive|outperform|outpace)\b/i,
];

export type RawSignalInput = {
  topic: string;
  source: 'signal_intelligence' | 'campaign_opportunities' | 'influencer_intelligence' | 'lead_signals';
  region?: string | null;
  rawText?: string | null;
  normalizedPayload?: Record<string, unknown> | null;
};

function getMatchingCategories(input: RawSignalInput): MarketPulseCategory[] {
  const matches: MarketPulseCategory[] = [];
  const text = [
    input.topic,
    input.rawText ?? '',
    JSON.stringify(input.normalizedPayload ?? {}),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (input.source === 'lead_signals') {
    matches.push('BUYING_INTENT');
  }

  if (input.source === 'influencer_intelligence') {
    matches.push('INFLUENCER_ACTIVITY');
  }

  if (input.region && input.region !== 'GLOBAL') {
    matches.push('REGIONAL_SIGNAL');
  }

  if (SEASONAL_PATTERNS.some((p) => p.test(text))) {
    matches.push('SEASONAL_SIGNAL');
  }

  if (COMPETITOR_PATTERNS.some((p) => p.test(text))) {
    matches.push('COMPETITOR_INTELLIGENCE');
  }

  matches.push('MARKET_TREND');

  return matches;
}

/**
 * Classify a signal into primary_category and secondary_tags.
 * Only primary_category is stored; secondary_tags are derived from other matches.
 */
export function classifyMarketPulseSignal(input: RawSignalInput): {
  primary_category: MarketPulseCategory;
  secondary_tags: string[];
} {
  const matches = getMatchingCategories(input);
  const sorted = [...matches].sort(
    (a, b) => CATEGORY_PRIORITY[a] - CATEGORY_PRIORITY[b]
  );
  const primary = sorted[0] ?? 'MARKET_TREND';
  const secondary = sorted.slice(1).filter((c) => c !== primary);
  return {
    primary_category: primary,
    secondary_tags: [...new Set(secondary)],
  };
}
