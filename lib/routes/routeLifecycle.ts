/**
 * Route lifecycle classification — formal taxonomy used by the canonical
 * route registry and the canonical API registry.
 *
 * Every page route, API endpoint, or runtime entry point governed by these
 * registries carries one of these classifications. Consumers (nav components,
 * deep-link CTAs, redirect aliases, codemods, enforcement tests) read the
 * classification to decide how to treat the route.
 */

export type RouteLifecycle =
  /**
   * The single canonical primary path for a feature. UI navigation, deep
   * links, and external integrations should target this. Exactly ONE
   * canonical route per feature.
   */
  | 'canonical'

  /**
   * A path retained for compatibility (typically a server-side redirect to
   * the canonical destination, or a thin alias page). Compatibility routes:
   *   - MAY appear in URL bars / bookmarks
   *   - MAY be referenced in old emails / external integrations
   *   - MUST NOT be the primary nav target (would shadow the canonical route)
   *   - MUST NOT be referenced in new code; new consumers must import the
   *     canonical constant
   */
  | 'compatibility'

  /**
   * A path that previously served a feature but whose feature has been
   * retired or replaced. Deprecated routes:
   *   - MAY still resolve at the framework level (page exists)
   *   - MUST emit a deprecation warning when reached (when feasible)
   *   - MUST NOT appear in any nav / CTA / deep link
   *   - SHOULD be deleted in a future cleanup wave
   */
  | 'deprecated'

  /**
   * A path that exists in source but is suspected unsafe / unsupported /
   * incomplete. Quarantined routes:
   *   - MUST NOT appear in nav
   *   - MUST NOT be reached from runtime entry points
   *   - SHOULD have an explicit operator-action gate or an audit before
   *     being re-promoted to compatibility / canonical
   */
  | 'quarantined'

  /**
   * Behind a feature flag or available only to specific environments. May
   * become canonical, compatibility, or be deleted depending on outcome.
   * MAY appear in nav for opted-in operators only.
   */
  | 'experimental'

  /**
   * Path with NO live consumers and NO known compat / deprecation use case.
   * Candidate for deletion. Often introduced by accident or left over from
   * a partial refactor.
   */
  | 'dead';

export interface RouteRegistryEntry {
  /** Stable identifier — used for cross-references between registries. */
  key: string;
  /** The path string that consumers paste into Link/href/router.push. */
  path: string;
  /** Domain this route belongs to (settings, admin, campaigns, etc.). */
  domain: RouteDomain;
  /** Lifecycle classification (canonical / compatibility / etc.). */
  lifecycle: RouteLifecycle;
  /** Plain-English description of what this route serves. */
  description?: string;
  /**
   * For non-canonical routes, the canonical destination's `key` so the
   * registry can resolve aliases and detect dominance violations.
   */
  canonicalKey?: string;
  /**
   * Date (YYYY-MM-DD) at which a deprecated/quarantined route should be
   * deleted. Null means no scheduled removal yet.
   */
  scheduledRemoval?: string | null;
  /** Free-form notes for migration / audit context. */
  notes?: string;
}

export type RouteDomain =
  | 'auth'
  | 'admin'
  | 'super_admin'
  | 'settings'
  | 'campaigns'
  | 'content'
  | 'engagement'
  | 'planner'
  | 'intelligence'
  | 'integrations'
  | 'onboarding'
  | 'blog'
  | 'community'
  | 'analytics'
  | 'billing'
  | 'dashboard'
  | 'public'
  | 'team'
  | 'utility';

/**
 * Helper: classify a registry entry as eligible to appear in nav or as a
 * runtime entry point. Returns false for deprecated / quarantined / dead
 * entries.
 */
export function isReachableFromRuntime(entry: RouteRegistryEntry): boolean {
  return entry.lifecycle === 'canonical'
      || entry.lifecycle === 'compatibility'
      || entry.lifecycle === 'experimental';
}

/**
 * Helper: classify a registry entry as eligible to dominate primary nav
 * (the surface a user sees when they click "Settings" / "Campaigns" / etc.).
 * Only canonical entries dominate; compatibility entries serve only via
 * their canonical destination.
 */
export function isPrimaryNavTarget(entry: RouteRegistryEntry): boolean {
  return entry.lifecycle === 'canonical'
      || entry.lifecycle === 'experimental';
}
