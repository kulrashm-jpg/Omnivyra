/**
 * Template Discovery model (CREATOR-144) — the ONE place search/filter/sort/scope
 * logic lives. The canonical TemplateDiscovery component consumes this; no consumer
 * re-implements discovery. Scope changes the DATA; the UI is identical (RULE 3).
 *
 * Selection is template_id only (RULE 7) — no blueprint logic here.
 */

import type { CreatorTemplate, TemplateAssetFamily } from '../creator-templates/types';
import { listCuratedTemplatesForGoal, listCuratedTemplates } from './curatedTemplateGallery';
import { goalCategoriesFor } from './goalAffinity';

export type DiscoveryScope =
  | 'SYSTEM' | 'MARKETPLACE' | 'ORGANIZATION' | 'PERSONAL' | 'AI'
  | 'RECENT' | 'FAVORITES' | 'COLLECTIONS';

export type DiscoverySort = 'recommended' | 'name';
export type DiscoveryView = 'grid' | 'list';

export interface DiscoveryQuery {
  scope: DiscoveryScope;
  family?: TemplateAssetFamily;
  goalId?: string | null;
  query?: string;
  category?: string;
  sort?: DiscoverySort;
}

/** Pluggable per-scope data source. SYSTEM is built-in (curated, client-loadable);
 *  the others are supplied by the host (user-template service, collections, etc.). */
export type ScopeSource = (q: DiscoveryQuery) => CreatorTemplate[];

/** The ONE filter+sort applied to any scope's items (RULE 4 — exists once). */
export function applyDiscovery(items: CreatorTemplate[], q: DiscoveryQuery): CreatorTemplate[] {
  const needle = (q.query ?? '').trim().toLowerCase();
  let out = items;
  if (q.family) out = out.filter((t) => t.assetFamily === q.family);
  if (q.category) out = out.filter((t) => (t.category || '').toLowerCase() === q.category!.toLowerCase());
  if (needle) out = out.filter((t) => `${t.name} ${t.description} ${(t.tags || []).join(' ')}`.toLowerCase().includes(needle));
  if (q.sort === 'name') {
    out = [...out].sort((a, b) => a.name.localeCompare(b.name));
  } else if (q.goalId) {
    // 'recommended' (default): order by how strongly each template's visual
    // category is affined to the active goal — a template in the goal's PRIMARY
    // category leads, secondary next, unaffined last. Without this the sort was a
    // no-op, so the single "Recommended for your campaign" pick and the browse
    // order were arbitrary insertion order rather than the goal. Stable within a
    // rank (preserves the curated pool order for ties). Deterministic.
    const cats = goalCategoriesFor(q.goalId);
    if (cats.length) {
      const rank = (t: CreatorTemplate): number => {
        const i = cats.indexOf(t.designFamily ?? '');
        return i === -1 ? cats.length : i;
      };
      out = out
        .map((t, i) => ({ t, i }))
        .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
        .map((x) => x.t);
    }
  }
  return out;
}

/** Built-in SYSTEM scope: the CANONICAL pool, goal-affined + filtered (PHASE-1). */
export const systemScopeSource: ScopeSource = (q) => {
  const base = q.goalId !== undefined ? listCuratedTemplatesForGoal(q.goalId, q.family) : listCuratedTemplates();
  return applyDiscovery(base, { ...q, family: q.goalId !== undefined ? undefined : q.family });
};

/** Default scope map. Hosts override non-SYSTEM scopes with live sources. */
export function defaultScopeSources(overrides?: Partial<Record<DiscoveryScope, ScopeSource>>): Record<DiscoveryScope, ScopeSource> {
  const empty: ScopeSource = () => [];
  return {
    SYSTEM: systemScopeSource,
    MARKETPLACE: empty, ORGANIZATION: empty, PERSONAL: empty, AI: empty,
    RECENT: empty, FAVORITES: empty, COLLECTIONS: empty,
    ...(overrides ?? {}),
  };
}

/** Distinct categories present in a scope's items (for the category filter). */
export function categoriesOf(items: CreatorTemplate[]): string[] {
  const seen = new Set<string>();
  for (const t of items) if (t.category) seen.add(t.category);
  return Array.from(seen);
}

export const SCOPE_LABEL: Record<DiscoveryScope, string> = {
  SYSTEM: 'System', MARKETPLACE: 'Marketplace', ORGANIZATION: 'Organization', PERSONAL: 'My Templates',
  AI: 'AI Generated', RECENT: 'Recent', FAVORITES: 'Favorites', COLLECTIONS: 'Collections',
};
