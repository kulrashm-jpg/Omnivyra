import type { UnifiedSource } from './sourceNormalizationService';

export type IntelligencePriority = 'low' | 'medium' | 'high';

export type IntelligenceScoringInput = {
  gapType: string;
  dueAt?: string | Date | null;
  now?: string | Date | null;
  revenuePotential?: number | null;
  metadata?: Record<string, unknown> | null;
  unifiedSource?: UnifiedSource | Record<string, unknown> | null;
};

export type IntelligenceScoreResult = {
  priority: IntelligencePriority;
  score: number;
  delayHours: number;
  revenuePotential: number | null;
  sourceCategory: string | null;
  components: {
    base: number;
    delay72Hours: number;
    delay168Hours: number;
    revenuePotential: number;
    sourceCategory: number;
  };
};

const REVENUE_POTENTIAL_THRESHOLD = 1000;

function normalizeToken(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function baseScoreForGapType(gapType: string): number {
  const normalized = normalizeToken(gapType);
  if (normalized === 'missing_revenue') return 70;
  if (normalized === 'missing_conversion') return 60;
  if (normalized === 'missing_followup') return 50;
  return 40;
}

function priorityForScore(score: number): IntelligencePriority {
  if (score >= 80) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

function parseTimestamp(value: string | Date | null | undefined, field: string): number {
  if (!value) return Date.now();
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${field} must be a valid timestamp`);
  }
  return timestamp;
}

function delayHours(dueAt: string | Date | null | undefined, now: string | Date | null | undefined): number {
  if (!dueAt) return 0;
  const dueAtMs = parseTimestamp(dueAt, 'dueAt');
  const nowMs = parseTimestamp(now, 'now');
  return Math.max(0, Math.floor((nowMs - dueAtMs) / (1000 * 60 * 60)));
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,]/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function revenuePotentialFromMetadata(metadata?: Record<string, unknown> | null): number | null {
  if (!metadata) return null;

  const keys = [
    'revenue_potential',
    'revenuePotential',
    'potential_revenue',
    'potentialRevenue',
    'expected_revenue',
    'expectedRevenue',
    'deal_value',
    'dealValue',
    'estimated_value',
    'estimatedValue',
    'amount',
  ];

  for (const key of keys) {
    const parsed = numericValue(metadata[key]);
    if (parsed != null) return parsed;
  }

  return null;
}

function sourceCategory(unifiedSource?: UnifiedSource | Record<string, unknown> | null): string | null {
  if (!unifiedSource || typeof unifiedSource !== 'object') return null;
  return normalizeToken((unifiedSource as Record<string, unknown>).category) || null;
}

function categoryWeight(category: string | null): number {
  if (category === 'crm') return 10;
  if (category === 'email') return 5;
  return 0;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreIntelligenceGap(input: IntelligenceScoringInput): IntelligenceScoreResult {
  const gapType = normalizeToken(input.gapType);
  if (!gapType) {
    throw new Error('gapType is required for intelligence scoring');
  }

  const base = baseScoreForGapType(gapType);
  const overdueHours = delayHours(input.dueAt, input.now);
  const revenuePotential =
    input.revenuePotential ??
    revenuePotentialFromMetadata(input.metadata);
  const category = sourceCategory(input.unifiedSource);

  const components = {
    base,
    delay72Hours: overdueHours > 72 ? 10 : 0,
    delay168Hours: overdueHours > 168 ? 10 : 0,
    revenuePotential:
      revenuePotential != null && revenuePotential > REVENUE_POTENTIAL_THRESHOLD ? 10 : 0,
    sourceCategory: categoryWeight(category),
  };

  const score = clampScore(
    components.base +
      components.delay72Hours +
      components.delay168Hours +
      components.revenuePotential +
      components.sourceCategory
  );

  return {
    priority: priorityForScore(score),
    score,
    delayHours: overdueHours,
    revenuePotential: revenuePotential ?? null,
    sourceCategory: category,
    components,
  };
}
