/**
 * Strategic Memory Engine — learns from strategist feedback and confidence history.
 * Phase 1: in-memory aggregator, local storage only. No backend, no schema.
 */

export type StrategistAction =
  | 'IMPROVE_CTA'
  | 'IMPROVE_HOOK'
  | 'ADD_DISCOVERABILITY';

export interface StrategistFeedbackEvent {
  campaign_id: string;
  execution_id: string;
  platform?: string;
  action: StrategistAction;
  accepted: boolean;
  timestamp: string;
}

export interface StrategicMemoryProfile {
  campaign_id: string;
  action_acceptance_rate: Record<StrategistAction, number>;
  platform_confidence_average: Record<string, number>;
  total_events: number;
}

const ALL_ACTIONS: StrategistAction[] = ['IMPROVE_CTA', 'IMPROVE_HOOK', 'ADD_DISCOVERABILITY'];

function defaultAcceptanceRates(): Record<StrategistAction, number> {
  const out = {} as Record<StrategistAction, number>;
  for (const a of ALL_ACTIONS) out[a] = 0;
  return out;
}

/**
 * Builds a strategic memory profile from feedback events and optional confidence history.
 * Pure function, no side effects, deterministic.
 */
export function buildStrategicMemoryProfile(
  events: StrategistFeedbackEvent[],
  confidenceHistory?: Array<{ platform: string; confidence: number }>
): StrategicMemoryProfile {
  const campaign_id = events.length > 0 ? events[0].campaign_id : '';
  const action_acceptance_rate = defaultAcceptanceRates();
  const actionTotals: Record<StrategistAction, number> = defaultAcceptanceRates();
  const platformSums: Record<string, { sum: number; count: number }> = {};

  for (const e of events) {
    if (!e.action || !ALL_ACTIONS.includes(e.action)) continue;
    actionTotals[e.action] += 1;
    if (e.accepted) {
      action_acceptance_rate[e.action] = (action_acceptance_rate[e.action] || 0) + 1;
    }
  }

  for (const a of ALL_ACTIONS) {
    const total = actionTotals[a];
    action_acceptance_rate[a] = total > 0 ? (action_acceptance_rate[a] || 0) / total : 0;
  }

  if (Array.isArray(confidenceHistory)) {
    for (const { platform, confidence } of confidenceHistory) {
      const key = String(platform || '').trim().toLowerCase();
      if (!key || !Number.isFinite(confidence)) continue;
      if (!platformSums[key]) platformSums[key] = { sum: 0, count: 0 };
      platformSums[key].sum += confidence;
      platformSums[key].count += 1;
    }
  }

  const platform_confidence_average: Record<string, number> = {};
  for (const [platform, { sum, count }] of Object.entries(platformSums)) {
    if (count > 0) {
      const avg = sum / count;
      platform_confidence_average[platform] = Math.max(0, Math.min(100, avg));
    }
  }

  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development' && events.length > 0) {
    console.log('[StrategicMemory]', { campaign_id, total_events: events.length, action_acceptance_rate, platform_confidence_average });
  }

  return {
    campaign_id,
    action_acceptance_rate,
    platform_confidence_average,
    total_events: events.length,
  };
}

const STORAGE_KEY = 'strategic_memory_events';

export function getStoredFeedbackEvents(): StrategistFeedbackEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendFeedbackEvent(event: StrategistFeedbackEvent): void {
  if (typeof window === 'undefined') return;
  try {
    const events = getStoredFeedbackEvents();
    events.push(event);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch (e) {
    console.warn('[StrategicMemory] append failed', e);
  }
}

/**
 * Suggestion type compatible with VariantSuggestion (has action).
 */
export interface SuggestionWithAction {
  id: string;
  label: string;
  description: string;
  action: StrategistAction;
}

/**
 * Ranks suggestions by memory: higher acceptance rate first. Unknown actions stay neutral (0.5).
 */
export function rankSuggestionsByMemory<T extends SuggestionWithAction>(
  suggestions: T[],
  profile?: StrategicMemoryProfile | null
): T[] {
  if (!profile || !suggestions.length) return [...suggestions];
  const rate = (action: StrategistAction) => {
    const r = profile.action_acceptance_rate[action];
    return Number.isFinite(r) ? r : 0.5;
  };
  return [...suggestions].sort((a, b) => rate(b.action) - rate(a.action));
}
