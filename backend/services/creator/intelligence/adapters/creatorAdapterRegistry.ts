/**
 * Creator Adapter Registry — Step 3 (isolated, runtime-inert)
 * ──────────────────────────────────────────────────────────────────────────
 * Implements the `CreatorAdapterRegistry` contract from `../adapterTypes`.
 * Maps a (normalized) creator format string to exactly ONE pure adapter.
 *
 * Format normalization REUSES the single source of truth —
 * `normalizeCreatorFormat` from `lib/shared/creatorGovernanceRegistry`
 * (a zero-import, pure data+function module) — so the registry resolves
 * 'slides'/'slide' → 'carousel' and 'graphic'/'visual'/'photo' → 'image'
 * identically to the rest of the system. No parallel alias table.
 *
 * Purity / isolation:
 *   - The registry holds adapters; it performs no DB / scheduler /
 *     rendering / orchestration. `get` is a pure lookup.
 *   - image + carousel (Step 3) and reel/video (Step 5) adapters are
 *     registered. The image-family variants (infographic/story) remain
 *     intentionally absent — later steps. An unknown/unsupported format
 *     resolves to `undefined` (callers decide the fallback; this module
 *     imposes none). Registration is intelligence-only — Step 5 does NOT
 *     cut reel into runtime/scheduling.
 *   - Runtime-inert: nothing in pages/ or backend/queue/ imports this.
 *
 * A module-level `creatorAdapterRegistry` singleton is exported for
 * convenience, plus the `CreatorAdapterRegistryImpl` class so tests can
 * construct isolated instances.
 */

import { normalizeCreatorFormat } from '../../../../../lib/shared/creatorGovernanceRegistry';
import { imageBlueprintAdapter } from './imageBlueprintAdapter';
import { carouselBlueprintAdapter } from './carouselBlueprintAdapter';
import { reelBlueprintAdapter } from './reelBlueprintAdapter';

import type { ContentBlueprint } from '../blueprintTypes';
import type {
  CreatorBlueprintAdapter,
  CreatorAdapterRegistry,
} from '../adapterTypes';

export class CreatorAdapterRegistryImpl implements CreatorAdapterRegistry {
  /** Keyed by NORMALIZED format string. One adapter per format. */
  private readonly adapters = new Map<string, CreatorBlueprintAdapter>();

  /**
   * Register (or replace) the adapter for its asset family. The family
   * IS the normalized format key — image/carousel adapters answer the
   * 'image'/'carousel' normalized formats. Last registration wins, so a
   * future step can override without a code edit here.
   */
  register(adapter: CreatorBlueprintAdapter): void {
    this.adapters.set(adapter.assetFamily, adapter as CreatorBlueprintAdapter<ContentBlueprint>);
  }

  /**
   * Resolve the adapter for a raw format string. Normalizes first
   * (handles aliases + casing/whitespace), then prefers an exact
   * normalized-key hit, falling back to the first registered adapter
   * whose own `supports()` claims the normalized format. Returns
   * `undefined` when nothing claims it — no implicit default.
   */
  get(format: string): CreatorBlueprintAdapter | undefined {
    const normalized = normalizeCreatorFormat(format);
    const direct = this.adapters.get(normalized);
    if (direct) return direct;
    for (const adapter of this.adapters.values()) {
      if (adapter.supports(normalized)) return adapter;
    }
    return undefined;
  }

  list(): ReadonlyArray<CreatorBlueprintAdapter> {
    return Array.from(this.adapters.values());
  }
}

/** Build a registry preloaded with the Step-3 adapters. */
export function createCreatorAdapterRegistry(): CreatorAdapterRegistryImpl {
  const registry = new CreatorAdapterRegistryImpl();
  registry.register(imageBlueprintAdapter);
  registry.register(carouselBlueprintAdapter);
  registry.register(reelBlueprintAdapter);
  return registry;
}

/** Convenience singleton. Inert until something chooses to import it. */
export const creatorAdapterRegistry: CreatorAdapterRegistry =
  createCreatorAdapterRegistry();

export default creatorAdapterRegistry;
