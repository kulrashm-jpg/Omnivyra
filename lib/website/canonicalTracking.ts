/**
 * G4 (LC-102 / W1.2) — Canonical Lead/Visitor Tracking topology (single source of truth).
 *
 * W0/LC-000 proved production carries virtually no historical tracking data, so this
 * wave optimizes for architectural clarity over migration compatibility — WITHOUT
 * deleting the blog-content-performance system (see the topology note below).
 *
 * ── The canonical LEAD/VISITOR event pipeline (the ONE the Lead Intelligence layer
 *    consumes) ────────────────────────────────────────────────────────────────────
 *      tracker asset : /omnivera-tracker.js
 *      ingest route  : /api/website-events/track
 *      event store   : tracking_events   (+ visitor_sessions for session state)
 *
 * ── blog_analytics is NOT a competing lead tracker ───────────────────────────────
 *    `tracker.js` → `/api/track` → `blog_analytics` is the BLOG CONTENT-PERFORMANCE
 *    system (hook/angle/cluster analytics; consumed by /api/track/* and the
 *    aggregate-blog-analytics cron). It is a DIFFERENT domain, not a second lead
 *    tracker, and is intentionally left untouched. `blog_analytics` additionally
 *    serves as a legitimate lead SOURCE for blog-origin leads via the canonical
 *    `blogAdapter` (source='blog') — that is adapter-routed ingestion, not a
 *    duplicate visitor-behaviour store.
 *
 * Rule going forward: the Lead Intelligence layer reads visitor behaviour from
 * `tracking_events` ONLY. No new lead tracker, ingest route, or behaviour store may
 * be introduced. Any future consolidation of the blog system is a separate,
 * out-of-scope initiative.
 */

export const CANONICAL_LEAD_TRACKER = {
  asset: '/omnivera-tracker.js',
  ingestRoute: '/api/website-events/track',
  eventStore: 'tracking_events',
  sessionStore: 'visitor_sessions',
} as const;

/** The legacy blog tracker — retained for blog content analytics; NOT for lead intelligence. */
export const BLOG_CONTENT_TRACKER = {
  asset: '/tracker.js',
  ingestRoute: '/api/track',
  store: 'blog_analytics',
  role: 'blog_content_performance',
  deprecatedForLeadTracking: true,
} as const;

/** The single canonical visitor-behaviour store the Lead Intelligence layer may read. */
export const CANONICAL_BEHAVIOUR_STORE = CANONICAL_LEAD_TRACKER.eventStore;
