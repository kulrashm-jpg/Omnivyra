import type { IntelligenceMetadata } from './companyContextIntelligenceService';

export type EntityState =
  | 'missing'
  | 'unknown'
  | 'inferred'
  | 'user_confirmed'
  | 'stale'
  | 'conflicting'
  | 'deprecated'
  | 'system_generated'
  | 'irrelevant'
  | 'low_confidence';

export type FieldStateMap = Record<string, EntityState>;

export type ConsistencyWarning = {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  entity_type?: string;
  entity_id?: string | null;
};

const PRECEDENCE: Record<EntityState, number> = {
  user_confirmed: 100,
  conflicting: 90,
  stale: 80,
  deprecated: 70,
  system_generated: 60,
  inferred: 50,
  low_confidence: 40,
  unknown: 30,
  irrelevant: 20,
  missing: 0,
};

export function isStale(staleAt?: string | null): boolean {
  if (!staleAt) return false;
  const time = new Date(staleAt).getTime();
  return !Number.isNaN(time) && time <= Date.now();
}

export function resolveConfidence(metadata: IntelligenceMetadata | null | undefined): number | null {
  const confidence = Number(metadata?.confidence);
  if (!Number.isFinite(confidence)) return null;
  return Math.max(0, Math.min(1, confidence));
}

export function resolveEntityState(metadata: (IntelligenceMetadata & { entity_state?: string | null }) | null | undefined): EntityState {
  const explicit = String(metadata?.entity_state || '').trim() as EntityState;
  if (explicit && explicit in PRECEDENCE) return explicit;
  const review = String(metadata?.review_status || '').trim() as EntityState;
  if (review && review in PRECEDENCE) return review;
  if (isStale(metadata?.stale_at)) return 'stale';
  if (metadata?.user_confirmed) return 'user_confirmed';
  if (metadata?.source === 'system') return 'system_generated';
  if (metadata?.source === 'ai_inferred') return 'inferred';
  const confidence = resolveConfidence(metadata);
  if (confidence != null && confidence < 0.4) return 'low_confidence';
  return 'unknown';
}

export function resolveSectionState(states: EntityState[]): EntityState {
  if (states.length === 0) return 'missing';
  return states.reduce((best, state) => PRECEDENCE[state] > PRECEDENCE[best] ? state : best, 'missing' as EntityState);
}

export function buildFieldStates(
  row: Record<string, unknown>,
  fields: string[],
  fallbackState: EntityState,
): FieldStateMap {
  const out: FieldStateMap = {};
  for (const field of fields) {
    const value = row[field];
    const hasValue = Array.isArray(value) ? value.length > 0 : value != null && String(value).trim().length > 0;
    out[field] = hasValue ? fallbackState : 'unknown';
  }
  return out;
}

export function markConflicting<T extends { review_status?: string | null; entity_state?: string | null; field_states?: FieldStateMap | null }>(
  row: T,
  fields: string[],
): T {
  return {
    ...row,
    review_status: 'conflicting',
    entity_state: 'conflicting',
    field_states: {
      ...(row.field_states ?? {}),
      ...Object.fromEntries(fields.map((field) => [field, 'conflicting'])),
    },
  };
}

export function precedenceOf(state: EntityState): number {
  return PRECEDENCE[state] ?? 0;
}
