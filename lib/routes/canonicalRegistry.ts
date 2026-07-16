/**
 * Canonical route registry — the single source of truth for primary user-
 * facing pages across the app.
 *
 * Coverage scope (per-domain, primary user journeys):
 *   - auth, admin, super_admin, settings, campaigns, content, engagement,
 *     planner, intelligence, integrations, onboarding, blog, community,
 *     analytics, billing, dashboard, public, team
 *
 * What this registry IS:
 *   - The canonical destination for top-level nav links
 *   - The reference point for deep-link CTAs (readiness cards, emails,
 *     notifications, onboarding)
 *   - The lifecycle audit surface (canonical / compatibility / deprecated /
 *     quarantined / experimental / dead)
 *
 * What this registry IS NOT:
 *   - An exhaustive enumeration of every `pages/*` file. The repo has 224+
 *     pages; this registry covers PRIMARY user-facing entry points. Other
 *     pages (sub-routes, modal-only views, partial pages) are implicitly
 *     governed by their domain's per-feature registry (e.g.
 *     `lib/settings/canonicalRegistry.ts`).
 *
 * Adding a new canonical route:
 *   1. Add a `RouteRegistryEntry` to `CANONICAL_ROUTES` below.
 *   2. If the route replaces an older one, set the older entry's
 *      `lifecycle: 'compatibility'` and `canonicalKey: '<new-key>'`.
 *   3. Update consumers (nav components, deep links).
 *   4. Run the enforcement check (`scripts/route-governance-check.ts` —
 *      to be added in the enforcement phase).
 *
 * Removing a route:
 *   1. Set lifecycle: 'deprecated' first, with a `scheduledRemoval` date.
 *   2. Verify zero runtime consumers via codemod / grep.
 *   3. After the scheduled date, set lifecycle: 'dead' and delete the file.
 */

import type { RouteRegistryEntry } from './routeLifecycle';

export const CANONICAL_ROUTES: ReadonlyArray<RouteRegistryEntry> = [
  // ── Auth ────────────────────────────────────────────────────────────────
  { key: 'auth.login',           path: '/login',                              domain: 'auth',         lifecycle: 'canonical',     description: 'Primary signup/login flow (Supabase identity).' },
  { key: 'auth.callback',        path: '/auth/callback',                       domain: 'auth',         lifecycle: 'canonical',     description: 'OAuth / Supabase callback target.' },
  { key: 'auth.signup',          path: '/signup',                              domain: 'auth',         lifecycle: 'canonical',     description: 'New-user signup entry.' },

  // ── Settings (canonical destinations; per-feature registry in lib/settings/canonicalRegistry.ts) ──
  { key: 'settings.security',    path: '/settings/security',                  domain: 'settings',     lifecycle: 'canonical',     description: 'Per-user security: passkeys / TOTP / sessions / trusted devices.' },
  { key: 'settings.access',      path: '/settings/company-admin-access',      domain: 'settings',     lifecycle: 'canonical',     description: 'Per-org access flags + intelligence tier overrides.' },
  { key: 'settings.integrations', path: '/integrations?focus=website',         domain: 'integrations', lifecycle: 'canonical',     description: 'Canonical integrations page; covers OAuth + API setup.' },
  { key: 'settings.integrations.alias', path: '/settings/integrations',        domain: 'integrations', lifecycle: 'compatibility', canonicalKey: 'settings.integrations', description: '307 server-side redirect to /integrations?focus=website.' },

  // ── Admin / Super-admin ────────────────────────────────────────────────
  { key: 'super_admin.dashboard', path: '/super-admin/dashboard',              domain: 'super_admin',  lifecycle: 'canonical',     description: 'Super-admin dashboard panel (alias of /super-admin).' },
  { key: 'super_admin.login',    path: '/super-admin/login',                  domain: 'super_admin',  lifecycle: 'compatibility', canonicalKey: 'auth.login', notes: 'Env-credential mint endpoint; Wave 3 deletes once canonical bootstrap path is exercised.' },
  { key: 'super_admin.consumption', path: '/super-admin/consumption',         domain: 'super_admin',  lifecycle: 'canonical',     description: 'Aggregate consumption breakdowns (LLM/API costs).' },
  { key: 'super_admin.free_credits', path: '/super-admin/free-credits',        domain: 'super_admin',  lifecycle: 'canonical',     description: 'Free credit grants admin.' },
  { key: 'super_admin.system_health', path: '/super-admin/system-health',     domain: 'super_admin',  lifecycle: 'canonical',     description: 'Platform health dashboard.' },
  { key: 'super_admin.operations_center', path: '/super-admin/operations-center', domain: 'super_admin', lifecycle: 'canonical',   description: 'Production Operations Center — rollout flags, version, topology, and the canonical operations navigation hub.' },
  { key: 'admin.access_requests', path: '/admin/access-requests',              domain: 'admin',        lifecycle: 'canonical',     description: 'Approve / reject external access requests.' },
  { key: 'admin.intelligence_control', path: '/admin/intelligence-control',    domain: 'admin',        lifecycle: 'canonical',     description: 'Cron / scheduler / queue runtime knobs.' },
  { key: 'admin.users',          path: '/admin/users',                        domain: 'admin',        lifecycle: 'canonical',     description: 'Platform user management.' },
  { key: 'admin.engagement_health', path: '/admin/engagement-health',         domain: 'admin',        lifecycle: 'canonical',     description: 'Engagement subsystem health checks.' },
  { key: 'admin.blog',           path: '/admin/blog',                         domain: 'admin',        lifecycle: 'canonical',     description: 'Blog admin editor + intelligence dashboards.' },

  // ── Dashboard / home ───────────────────────────────────────────────────
  { key: 'dashboard.home',       path: '/dashboard',                          domain: 'dashboard',    lifecycle: 'canonical',     description: 'User home dashboard.' },
  { key: 'dashboard.intelligence', path: '/dashboard/intelligence',            domain: 'intelligence', lifecycle: 'canonical',     description: 'Intelligence cluster dashboard (market pulse, leads, signals).' },

  // ── Campaigns ──────────────────────────────────────────────────────────
  { key: 'campaigns.list',       path: '/campaigns',                          domain: 'campaigns',    lifecycle: 'canonical',     description: 'Campaigns index.' },
  { key: 'campaigns.planner',    path: '/campaign-planner',                   domain: 'planner',      lifecycle: 'canonical',     description: 'Campaign-planner unified workflow.' },
  { key: 'campaigns.bolt_text',  path: '/command-center/bolt-text',           domain: 'campaigns',    lifecycle: 'canonical',     description: 'BOLT (text) campaign workflow.' },
  { key: 'campaigns.bolt_creator', path: '/command-center/bolt-creator-strategy', domain: 'campaigns', lifecycle: 'canonical',     description: 'BOLT (creator) campaign workflow.' },
  { key: 'campaigns.intelligent_mix', path: '/command-center/intelligent-mix-strategy', domain: 'campaigns', lifecycle: 'canonical', description: 'Intelligent mix campaign workflow.' },
  { key: 'campaigns.combined_strategy', path: '/command-center/bolt-combined-strategy', domain: 'campaigns', lifecycle: 'compatibility', canonicalKey: 'campaigns.intelligent_mix', notes: 'Older combined-strategy entry; redirected to intelligent-mix in nav config.' },

  // ── Content ────────────────────────────────────────────────────────────
  { key: 'content.writer',       path: '/command-center/writer-content',      domain: 'content',      lifecycle: 'canonical',     description: 'Writer-lane content workflows (9 text-first types).' },
  { key: 'content.creator',      path: '/command-center/creator-content',     domain: 'content',      lifecycle: 'canonical',     description: 'Creator-lane content workflows (6 AI-supported types).' },
  { key: 'content.studio',       path: '/posts/create',                       domain: 'content',      lifecycle: 'canonical',     description: 'Canonical post creation entry.' },
  { key: 'content.studio_post_legacy', path: '/content-studio/post',          domain: 'content',      lifecycle: 'compatibility', canonicalKey: 'content.studio', notes: 'Redirected to /posts/create via next.config.js.' },
  { key: 'content.creation_legacy', path: '/content-creation',                domain: 'content',      lifecycle: 'compatibility', canonicalKey: 'content.studio',  notes: 'Redirected to /posts/create via next.config.js and page-local getServerSideProps.' },

  // ── Engagement ─────────────────────────────────────────────────────────
  { key: 'engagement.center',    path: '/command-center/engagement',          domain: 'engagement',   lifecycle: 'canonical',     description: 'Engagement inbox + action queue.' },
  { key: 'engagement.community', path: '/community-engagement',                domain: 'engagement',   lifecycle: 'canonical',     description: 'Community engagement workflow.' },

  // ── Intelligence ───────────────────────────────────────────────────────
  { key: 'intelligence.root',    path: '/intelligence',                       domain: 'intelligence', lifecycle: 'canonical',     description: 'Company-level marketing intelligence command center backed by the intelligence snapshot API.' },
  { key: 'intelligence.marketing_legacy', path: '/marketing-intelligence',     domain: 'intelligence', lifecycle: 'compatibility', canonicalKey: 'intelligence.root', notes: 'Same snapshot-backed command center; /intelligence is the canonical nav destination.' },
  { key: 'intelligence.website_marketing', path: '/website-marketing-intelligence', domain: 'intelligence', lifecycle: 'experimental', description: 'Website-attribution marketing optimization console for CTA, conversion, timing, campaign, and optimization-memory diagnostics.' },

  // ── Integrations ───────────────────────────────────────────────────────
  { key: 'integrations.root',    path: '/integrations?focus=website',         domain: 'integrations', lifecycle: 'canonical',     description: 'Canonical integrations entry.' },

  // ── Onboarding ─────────────────────────────────────────────────────────
  { key: 'onboarding.start',     path: '/onboarding',                         domain: 'onboarding',   lifecycle: 'canonical',     description: 'New-user onboarding entry.' },

  // ── Blog (canonical user-facing) ───────────────────────────────────────
  { key: 'blog.list',            path: '/blogs',                              domain: 'blog',         lifecycle: 'compatibility', canonicalKey: 'blog.create', notes: '/blogs redirects to /blogs/create via next.config.js.' },
  { key: 'blog.create',          path: '/blogs/create',                       domain: 'blog',         lifecycle: 'canonical',     description: 'Blog create + list workflow.' },

  // ── Community ──────────────────────────────────────────────────────────
  { key: 'community.ai',         path: '/community-ai',                       domain: 'community',    lifecycle: 'canonical',     description: 'Community AI surface.' },
  { key: 'community.health',     path: '/community-health',                   domain: 'community',    lifecycle: 'canonical',     description: 'Community health metrics.' },

  // ── Reports / Analytics ────────────────────────────────────────────────
  { key: 'reports.snapshot',     path: '/reports/digital-authority-snapshot', domain: 'analytics',    lifecycle: 'canonical',     description: 'Digital authority snapshot.' },
  { key: 'reports.performance',  path: '/reports/performance-intelligence',   domain: 'analytics',    lifecycle: 'canonical',     description: 'Performance intelligence.' },
  { key: 'reports.market_growth', path: '/reports/market-growth-intelligence', domain: 'analytics',   lifecycle: 'canonical',     description: 'Market & growth intelligence.' },
  { key: 'analytics.dashboard',  path: '/analytics-dashboard',                domain: 'analytics',    lifecycle: 'compatibility', canonicalKey: 'reports.performance', notes: 'Older analytics dashboard; superseded by /reports/* cluster.' },

  // ── Billing ────────────────────────────────────────────────────────────
  { key: 'billing.pricing',      path: '/pricing',                            domain: 'billing',      lifecycle: 'canonical',     description: 'Pricing & plans.' },

  // ── Team ───────────────────────────────────────────────────────────────
  { key: 'team.management',      path: '/team-management',                    domain: 'team',         lifecycle: 'canonical',     description: 'Team & member management.' },

  // ── Public ─────────────────────────────────────────────────────────────
  { key: 'public.about',         path: '/about',                              domain: 'public',       lifecycle: 'canonical',     description: 'Marketing about page.' },

  // ── Compatibility / redirect-only routes (server-side redirects) ──────
  { key: 'redirect.threads_generate',  path: '/threads/generate',     domain: 'content',  lifecycle: 'compatibility', canonicalKey: 'campaigns.bolt_text', notes: 'next.config.js redirect → /threads/intelligence.' },
  { key: 'redirect.threads_template',  path: '/threads/template',     domain: 'content',  lifecycle: 'compatibility', canonicalKey: 'campaigns.bolt_text', notes: 'next.config.js redirect → /threads/intelligence.' },
  { key: 'redirect.threads_suggestions', path: '/threads/suggestions', domain: 'content', lifecycle: 'compatibility', canonicalKey: 'campaigns.bolt_text', notes: 'next.config.js redirect → /threads/intelligence.' },
  { key: 'redirect.bolt_text_strategy', path: '/command-center/bolt-text-strategy', domain: 'campaigns', lifecycle: 'compatibility', canonicalKey: 'campaigns.bolt_text', notes: 'next.config.js redirect → /command-center/bolt-text.' },
];

/**
 * Look up a route entry by its key. Throws if the key is unknown — a typed
 * lookup catches stale references at compile time when called with the
 * `as const` exported keys.
 */
export function getCanonicalRoute(key: string): RouteRegistryEntry {
  const entry = CANONICAL_ROUTES.find((r) => r.key === key);
  if (!entry) {
    throw new Error(`Unknown canonical route key: ${key}`);
  }
  return entry;
}

/** All entries in a given domain. */
export function getRoutesByDomain(domain: string): ReadonlyArray<RouteRegistryEntry> {
  return CANONICAL_ROUTES.filter((r) => r.domain === domain);
}

/** All paths classified as deprecated or quarantined — must NOT appear in nav. */
export function getRouteFreezeList(): ReadonlyArray<string> {
  return CANONICAL_ROUTES
    .filter((r) => r.lifecycle === 'deprecated' || r.lifecycle === 'quarantined' || r.lifecycle === 'dead')
    .map((r) => r.path);
}

/** Compatibility-route paths — MAY be reached but MUST NOT dominate nav. */
export function getCompatibilityPaths(): ReadonlyArray<string> {
  return CANONICAL_ROUTES
    .filter((r) => r.lifecycle === 'compatibility')
    .map((r) => r.path);
}
