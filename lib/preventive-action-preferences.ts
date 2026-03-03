/**
 * Adaptive learning for Suggested Options (Preventive Actions).
 * Tracks user-selected option types per user; reorders future suggestions by frequency + recency.
 * Per-user only; no global learning. All options remain visible; only ordering changes.
 */

import type { PreventiveActionCategory, UserDecisionPattern } from './campaign-health-engine';

export type { UserDecisionPattern };

export interface SelectionRecord {
  category: PreventiveActionCategory;
  campaignId?: string | null;
  timestamp: number;
}

export interface PreventiveActionSelectionStore {
  getSelections(userId: string): SelectionRecord[];
  addSelection(userId: string, category: PreventiveActionCategory, campaignId?: string | null): void;
}

const STORAGE_KEY_PREFIX = 'virality:preventive-selections:';
const MAX_SELECTIONS_PER_USER = 100;
const MIN_SELECTIONS_FOR_PATTERN = 2;
/** Decay half-life in days: weight halves every 30 days. */
const RECENCY_HALFLIFE_DAYS = 30;

function getStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

/**
 * Default store using localStorage. Per-user; persists across sessions.
 */
export function createLocalStorageStore(): PreventiveActionSelectionStore {
  return {
    getSelections(userId: string): SelectionRecord[] {
      if (typeof window === 'undefined') return [];
      try {
        const raw = window.localStorage.getItem(getStorageKey(userId));
        if (!raw) return [];
        const parsed = JSON.parse(raw) as SelectionRecord[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    addSelection(userId: string, category: PreventiveActionCategory, campaignId?: string | null): void {
      if (typeof window === 'undefined') return;
      try {
        const key = getStorageKey(userId);
        const prev = window.localStorage.getItem(key);
        const list: SelectionRecord[] = prev ? JSON.parse(prev) : [];
        list.push({ category, campaignId: campaignId ?? null, timestamp: Date.now() });
        const trimmed = list.slice(-MAX_SELECTIONS_PER_USER);
        window.localStorage.setItem(key, JSON.stringify(trimmed));
      } catch {
        // ignore
      }
    },
  };
}

/** In-memory store for tests or when localStorage is not desired. */
export function createMemoryStore(): PreventiveActionSelectionStore {
  const data: Record<string, SelectionRecord[]> = {};
  return {
    getSelections(userId: string) {
      return data[userId] ?? [];
    },
    addSelection(userId: string, category: PreventiveActionCategory, campaignId?: string | null) {
      if (!data[userId]) data[userId] = [];
      data[userId].push({ category, campaignId: campaignId ?? null, timestamp: Date.now() });
      data[userId] = data[userId].slice(-MAX_SELECTIONS_PER_USER);
    },
  };
}

/**
 * Preference scoring: frequency + recency weighting.
 * Weight for a selection = 2^(-daysAgo / RECENCY_HALFLIFE_DAYS). More recent = higher weight.
 */
function scoreSelections(selections: SelectionRecord[]): Record<PreventiveActionCategory, number> {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const scores: Record<PreventiveActionCategory, number> = {
    CLEAR: 0,
    ASSIGN: 0,
    ADVANCE: 0,
  };
  for (const s of selections) {
    const daysAgo = (now - s.timestamp) / dayMs;
    const weight = Math.pow(2, -daysAgo / RECENCY_HALFLIFE_DAYS);
    scores[s.category] = (scores[s.category] ?? 0) + weight;
  }
  return scores;
}

/**
 * Returns user's decision pattern for reordering options, or null if insufficient history.
 * Used by consumers (e.g. portfolio view) to call reorderOptionsByPreference(options, pattern).
 */
export function getUserDecisionPattern(
  userId: string,
  store: PreventiveActionSelectionStore
): UserDecisionPattern | null {
  if (!userId) return null;
  const selections = store.getSelections(userId);
  if (selections.length < MIN_SELECTIONS_FOR_PATTERN) return null;

  const scores = scoreSelections(selections);
  const categories: PreventiveActionCategory[] = ['CLEAR', 'ASSIGN', 'ADVANCE'];
  const ordered = [...categories].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  const hasVariety = new Set(selections.map((s) => s.category)).size > 1;
  if (!hasVariety) return null;

  return { preferredOrder: ordered };
}

/**
 * Records that the user selected an option (e.g. clicked "Open Related Items").
 * Call from UI when user makes a choice.
 */
export function recordSelection(
  userId: string,
  category: PreventiveActionCategory,
  campaignId: string | null | undefined,
  store: PreventiveActionSelectionStore
): void {
  if (!userId) return;
  store.addSelection(userId, category, campaignId);
}
