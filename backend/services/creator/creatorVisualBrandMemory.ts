/**
 * Brand visual memory (Phase 9).
 *
 * Lightweight in-memory preference cache. NOT model training. NOT
 * persistence. Stores: the creative-direction template that produced
 * the highest-quality output for a given company so subsequent
 * generations reuse the same visual lane for cross-asset coherence.
 *
 * Cache is process-local with a TTL ceiling — preferences refresh
 * naturally as the company iterates on their visual language. No
 * database, no migrations, no schema. Restart-safe (just re-warms
 * from the next few generations).
 *
 * Architecture-future: if cross-process persistence becomes desirable,
 * the storage layer can be swapped for Redis without changing callers.
 */

import type { CreativeDirectionTemplate } from './creatorPromptComposer';

export type BrandVisualPreference = {
  companyId: string;
  preferredTemplate: CreativeDirectionTemplate;
  preferredPremium: boolean;
  lastScore: number;
  bestScore: number;
  lastUpdatedAt: string;
  /** Surfaces this preference has been observed for — informational. */
  surfacesSeen: string[];
  // ── Phase 8 — creative-intelligence preference extensions. ──────────
  /** Strategy profile id (string-typed to avoid circular import on engine). */
  preferredStrategy?: string;
  /** Emotional direction the brand's best output landed in. */
  preferredEmotionalDirection?: string;
  /** Composition strategy the brand's best output landed in. */
  preferredCompositionStrategy?: string;
  /** Realism profile that produced the brand's best output. */
  preferredRealismProfile?: string;
  /** Subject priority (product_first / human_first / balanced / environment_first). */
  preferredSubjectPriority?: string;
  /** Visual narrative (launch / reveal / workflow / etc.). */
  preferredVisualNarrative?: string;
};

const PREFERENCE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_MAX_ENTRIES = 500;

type CacheEntry = {
  preference: BrandVisualPreference;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

function pruneIfFull(): void {
  if (cache.size <= CACHE_MAX_ENTRIES) return;
  // Drop the oldest entry — Map iteration order is insertion order.
  const firstKey = cache.keys().next().value;
  if (firstKey) cache.delete(firstKey);
}

function key(companyId: string): string {
  return companyId.trim().toLowerCase();
}

/**
 * Look up the brand's currently-preferred creative direction.
 * Returns null when no preference is cached OR the cached entry has
 * expired (callers should fall back to the composer's selector).
 */
export function getBrandVisualPreference(companyId: string | null | undefined): BrandVisualPreference | null {
  if (!companyId) return null;
  const entry = cache.get(key(companyId));
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key(companyId));
    return null;
  }
  return entry.preference;
}

/**
 * Update the brand's preference based on a successful generation.
 * Only updates when the new score beats the cached best — the cache
 * is monotonic-best, which keeps the preference biased toward the
 * highest-quality lane observed for this brand.
 */
export function updateBrandVisualPreference(input: {
  companyId: string | null | undefined;
  template: CreativeDirectionTemplate;
  premium: boolean;
  score: number;
  surface?: string;
  // ── Phase 8 — optional creative-intelligence preference extensions.
  strategy?: string;
  emotionalDirection?: string;
  compositionStrategy?: string;
  realismProfile?: string;
  subjectPriority?: string;
  visualNarrative?: string;
}): BrandVisualPreference | null {
  if (!input.companyId) return null;
  const k = key(input.companyId);
  const existing = cache.get(k);
  const surfaces = existing && existing.preference.surfacesSeen
    ? [...existing.preference.surfacesSeen]
    : [];
  if (input.surface && !surfaces.includes(input.surface)) {
    surfaces.push(input.surface);
    if (surfaces.length > 8) surfaces.shift();
  }

  // Monotonic-best update: only overwrite the preferred template when
  // the new score strictly improves on the best we've seen. The new
  // Phase 8 fields follow the same monotonic-best policy.
  const shouldOverwrite = !existing || input.score > existing.preference.bestScore;
  const preference: BrandVisualPreference = {
    companyId: input.companyId,
    preferredTemplate: shouldOverwrite ? input.template : existing!.preference.preferredTemplate,
    preferredPremium: shouldOverwrite ? input.premium : existing!.preference.preferredPremium,
    lastScore: input.score,
    bestScore: existing ? Math.max(existing.preference.bestScore, input.score) : input.score,
    lastUpdatedAt: new Date().toISOString(),
    surfacesSeen: surfaces,
    preferredStrategy: shouldOverwrite ? input.strategy : existing?.preference.preferredStrategy,
    preferredEmotionalDirection: shouldOverwrite ? input.emotionalDirection : existing?.preference.preferredEmotionalDirection,
    preferredCompositionStrategy: shouldOverwrite ? input.compositionStrategy : existing?.preference.preferredCompositionStrategy,
    preferredRealismProfile: shouldOverwrite ? input.realismProfile : existing?.preference.preferredRealismProfile,
    preferredSubjectPriority: shouldOverwrite ? input.subjectPriority : existing?.preference.preferredSubjectPriority,
    preferredVisualNarrative: shouldOverwrite ? input.visualNarrative : existing?.preference.preferredVisualNarrative,
  };

  cache.set(k, {
    preference,
    expiresAt: Date.now() + PREFERENCE_TTL_MS,
  });
  pruneIfFull();
  return preference;
}

/** Test-only — drop all cached preferences. */
export function clearBrandVisualMemory(): void {
  cache.clear();
}

/** Diagnostics — current cache size. */
export function brandVisualMemoryStats(): { size: number; maxEntries: number; ttlMs: number } {
  return { size: cache.size, maxEntries: CACHE_MAX_ENTRIES, ttlMs: PREFERENCE_TTL_MS };
}
