/**
 * Phase F — Provider-reconciliation foundation. INTERFACES ONLY.
 *
 * Lays type-level scaffolding for eventually closing the swept-row split-brain
 * gap documented in G12/G13: when the sweeper flips a stuck `'publishing'` row
 * to `'failed'`, we do not know whether the adapter actually succeeded on the
 * platform before crashing. Resume-from-failed then risks a platform-side
 * duplicate. The long-term fix is provider-side reconciliation — querying the
 * platform's recent posts to confirm whether a `platform_post_id` exists for
 * the row's expected content.
 *
 * This module ships ONLY the contracts. No implementation, no callers, no
 * runtime dependencies. Each adapter that wants reconciliation support
 * implements `ProviderReconciliationLookup` and registers itself; the
 * orchestrator / sweeper / resume endpoint can later opt into the lookup
 * before deciding to retry.
 *
 * Strict rules: no orchestrator change, no scheduler change, no adapter
 * change in this phase. Interfaces are forward infrastructure that future
 * phases plug into; existing flows are unaffected because nothing imports
 * this module today.
 */

import type { ScheduledPost } from '../../db/queries';

/**
 * Confidence with which a reconciliation result should be trusted. Adapters
 * return their own assessment so resume policy can be tuned per-platform.
 */
export type ReconciliationConfidence =
  | 'exact_match'        // platform returned a post with identical content/timestamp
  | 'likely_match'       // platform has a recent post by the same account that could be ours
  | 'no_match'           // confirmed absent: safe to retry
  | 'unverifiable';      // adapter cannot reconcile (e.g. provider API doesn't expose search)

export interface ReconciliationLookupResult {
  /** Confidence level. */
  confidence: ReconciliationConfidence;
  /** Platform-side id if found. Maps to `scheduled_posts.platform_post_id` after CAS update. */
  platformPostId?: string;
  /** Platform-side URL if found. */
  postUrl?: string;
  /** Platform-side publish timestamp (ISO) if available. */
  publishedAt?: string;
  /** Free-form diagnostic — what the adapter checked, what it found. */
  diagnostic: string;
}

/**
 * Adapter-specific reconciliation lookup. Each adapter that wants
 * reconciliation support implements this; the registry below resolves the
 * platform string to the adapter's lookup at runtime.
 *
 * The lookup MUST be read-only (no platform-side writes), idempotent (safe
 * to invoke multiple times with the same row), and bounded-latency (the
 * sweeper / resume endpoint enforces a timeout).
 */
export interface ProviderReconciliationLookup {
  /** Platform identifier the lookup handles (e.g. `'twitter'`, `'linkedin'`). */
  readonly platform: string;
  /** Stable, human-readable name for diagnostics. */
  readonly name: string;
  /**
   * Look the row up on the platform side. Returns a `ReconciliationLookupResult`
   * describing what was found, or throws on unrecoverable error (network
   * timeout, auth expired, etc.) — the caller should treat throw == unverifiable.
   */
  lookup(input: {
    row: ScheduledPost;
    socialAccountId: string;
    /** Optional time window to constrain the platform-side search. */
    sinceIso?: string;
  }): Promise<ReconciliationLookupResult>;
}

/**
 * Pre-publish verification hook. Returned by adapters that want to assert
 * a row IS NOT already on the platform before re-publishing. The orchestrator
 * (post-Phase-F-implementation) calls this BEFORE publishOneNode when resume
 * is invoked on a swept-from-publishing row, to avoid platform-side duplicate.
 *
 * Returning `{shouldPublish: true}` allows the orchestrator to proceed.
 * Returning `{shouldPublish: false, reason}` causes the orchestrator to skip
 * the publish call (the row is treated as already-published and proceeds to
 * the next sibling using the returned platformPostId as the reply target).
 */
export interface PrePublishVerification {
  shouldPublish: boolean;
  reason?: string;
  platformPostId?: string;
  postUrl?: string;
}

/**
 * Orphan-detection contract. Returned by a future reconciliation sweep job
 * that scans for platform-side posts that exist but have no matching
 * `scheduled_posts` row (e.g. a swept row that adopted `status='failed'` but
 * the platform actually has the post).
 */
export interface OrphanDetectionResult {
  platform: string;
  platformPostId: string;
  postUrl: string;
  publishedAt: string;
  diagnostic: string;
  /** When the lookup found a likely DB match, the candidate row id. */
  candidateScheduledPostId?: string;
}

/**
 * Module-local registry. Each adapter that ships a `ProviderReconciliationLookup`
 * registers itself at import time. The registry is intentionally NOT exported
 * with an existing default — Phase F ships empty so no production behavior is
 * affected by import side-effects.
 */
const REGISTRY: Map<string, ProviderReconciliationLookup> = new Map();

export function registerProviderReconciliationLookup(lookup: ProviderReconciliationLookup): void {
  REGISTRY.set(lookup.platform, lookup);
}

export function getProviderReconciliationLookup(platform: string): ProviderReconciliationLookup | null {
  return REGISTRY.get(String(platform || '').toLowerCase().trim()) ?? null;
}

export function listRegisteredReconciliationPlatforms(): readonly string[] {
  return Array.from(REGISTRY.keys()).sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase G — analysis contracts (telemetry-only foundation).
//
// Each analysis function below is pure-ish (single platform read, no DB
// mutation, no platform-side mutation). The reconcileRow entry point
// composes them and emits structured telemetry; no state changes happen.
// A future reconciliation engine will plug repair actions into the
// `repairHint` field; today repair is operator-driven.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifies the outcome of comparing a single DB row against the platform's
 * view of the post. Each variant maps to ONE telemetry event name so
 * dashboards can show absolute counts per kind.
 */
export type DriftKind =
  | 'in_sync'              // DB and platform agree (or both have no post)
  | 'orphan_publish'       // DB says failed/draft/blocked; platform has a post
  | 'missing_publish'      // DB says published; platform has no post
  | 'replay_duplicate'     // DB says published once; platform has multiple matching posts
  | 'partial_thread_drift' // Thread root says all-published; some children missing
  | 'deleted_provider'     // DB says published with id X; platform 404s id X
  | 'unverifiable';        // Provider lookup couldn't determine (timeout, no lookup registered)

export interface DriftAnalysis {
  kind: DriftKind;
  platform: string;
  rowId: string;
  /** True when telemetry would emit. False for `in_sync` (silent success). */
  shouldEmit: boolean;
  /** Free-form forensic diagnostic — what was compared, what was found. */
  diagnostic: string;
  /** Optional structured context for telemetry tags (no secrets, no URLs). */
  tags?: Record<string, string | number | boolean | null>;
  /**
   * Operator-facing hint about what a repair action WOULD do, if a repair
   * engine were attached. Always informational in this foundation phase.
   */
  repairHint?: string;
  /** The lookup result we drew this conclusion from, if any. */
  lookup?: ReconciliationLookupResult;
}

/**
 * Verifies that a row claiming `status='published'` with a `platform_post_id`
 * actually corresponds to a live platform post. Returns `in_sync` if the
 * platform confirms, `deleted_provider` if the platform 404s, `missing_publish`
 * if the platform has no record, `unverifiable` if the provider lookup can't
 * determine.
 *
 * Pure read; no mutations.
 */
export interface VerifyPublishedPostInput {
  rowId: string;
  platform: string;
  socialAccountId: string;
  platformPostId: string;
}

/**
 * Looks up a row's platform post directly (e.g. for operator tooling) without
 * doing comparison. Returns the raw provider lookup result.
 */
export interface FetchProviderPostInput {
  rowId: string;
  platform: string;
  socialAccountId: string;
  platformPostId: string;
}

/**
 * Scans for orphan publishes — platform-side posts that the DB has no record
 * of. Requires a sinceIso bound to limit platform-side search scope. Returns
 * a list of detected orphans (could be empty). Each entry includes a
 * candidate DB row id if a likely match was found, OR null if truly orphaned.
 */
export interface DetectOrphanPublishInput {
  platform: string;
  socialAccountId: string;
  sinceIso: string;
}

/**
 * Inverse: scans the DB for rows that claim published but whose platform
 * lookup returns no_match / deleted_provider. Bounded by sinceIso to keep
 * scope tight in the foundation phase.
 */
export interface DetectMissingPublishInput {
  platform: string;
  socialAccountId: string;
  sinceIso: string;
}

/**
 * Detects replay-duplicate drift: a single DB row's content matches MULTIPLE
 * platform posts (possible after a retry that re-uploaded after the original
 * had already succeeded). The provider lookup must support content-based
 * search to enable this.
 */
export interface DetectReplayDriftInput {
  rowId: string;
  platform: string;
  socialAccountId: string;
  platformPostId: string;
}

/**
 * Snapshot persisted to creator_attachment_metadata.reconciliation_snapshots.
 * Append-only: each reconciliation pass adds a new entry. Old entries are
 * trimmed by the snapshot helper to bound storage.
 */
export interface ReconciliationSnapshot {
  timestamp: string;          // ISO
  platform: string;
  kind: DriftKind;
  platformPostId?: string;    // The id the DB claimed (may be stale)
  diagnostic: string;
  confidence?: ReconciliationConfidence;
}
